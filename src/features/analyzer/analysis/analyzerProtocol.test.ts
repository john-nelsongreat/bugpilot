import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import { DEFAULT_ANALYSIS_LIMITS } from './engine'
import { startAnalyzerWorker } from './analyzerWorker'
import { createAnalyzerClient, type AnalyzerWorkerHandle } from './analyzerClient'
import type { WorkerScope } from './analyzerProtocol'

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: text.length,
  }
}

interface FakeScope {
  scope: WorkerScope
  posted: Array<{ type: string; [key: string]: unknown }>
  dispatched: (data: unknown) => void
}

function makeScope(): FakeScope {
  const posted: Array<{ type: string; [key: string]: unknown }> = []
  let handler: ((event: { data: unknown }) => void) | null = null
  return {
    posted,
    scope: {
      postMessage: (message: unknown) => posted.push(message as { type: string }),
      set onmessage(next: ((event: { data: unknown }) => void) | null) {
        handler = next
      },
      get onmessage() {
        return handler ?? null
      },
    } as WorkerScope,
    dispatched: (data) => handler?.({ data }),
  }
}

const limits = DEFAULT_ANALYSIS_LIMITS

// Observe worker completion by polling the posted 'done' messages instead of betting on a fixed
// wait; the 5000ms ceiling only guards a hang, and the unchanged assertions run once done is seen.
function waitForDone(fake: FakeScope, count = 1, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fake.posted.filter((message) => message.type === 'done').length >= count) resolve()
      else if (Date.now() - started > timeoutMs) reject(new Error('analyzer worker never posted done'))
      else setTimeout(poll, 0)
    }
    poll()
  })
}

describe('analyzer worker protocol', () => {
  it('answers an analysis request with per-file findings', async () => {
    const fake = makeScope()
    startAnalyzerWorker(fake.scope)

    fake.dispatched({
      type: 'analyze',
      id: 7,
      entries: [entry('src/app.js', '// TODO: tidy\n'), entry('data/bad.json', '{"a":1,}')],
      limits,
    })
    await waitForDone(fake)

    const done = fake.posted.filter((message) => message.type === 'done') as unknown as Array<{
      id: number
      result: { files: Array<{ file: string; findings: unknown[] }>; cancelled: boolean }
      error: string | null
    }>
    expect(done).toHaveLength(1)
    expect(done[0].id).toBe(7)
    expect(done[0].error).toBeNull()
    expect(done[0].result.cancelled).toBe(false)
    expect(done[0].result.files).toHaveLength(2)
    expect(done[0].result.files[0].findings.length).toBeGreaterThan(0)
  })

  it('streams progress before the final answer', async () => {
    const fake = makeScope()
    startAnalyzerWorker(fake.scope)

    fake.dispatched({ type: 'analyze', id: 2, entries: [entry('src/a.js', 'x\n'), entry('src/b.js', 'y\n')], limits })
    await waitForDone(fake)

    const types = fake.posted.map((message) => message.type)
    expect(types).toContain('progress')
    expect(types[types.length - 1]).toBe('done')
    // Progress is throttled: an opening post and one final post bracket a tiny run.
    expect(fake.posted.filter((message) => message.type === 'progress')).toHaveLength(2)
  })

  it('throttles progress for a large run instead of posting per file', async () => {
    const fake = makeScope()
    startAnalyzerWorker(fake.scope)

    const many = Array.from({ length: 1_000 }, (_, index) => entry(`src/f${index}.js`, '// TODO: x\nconst a = 1;\n'))
    fake.dispatched({ type: 'analyze', id: 5, entries: many, limits })
    await waitForDone(fake)

    const progress = fake.posted.filter((message) => message.type === 'progress') as unknown as Array<{
      progress: { filesDone: number; filesTotal: number }
    }>
    // One opening post, one per 50 files, one closing post — never one per file.
    expect(progress.length).toBeLessThanOrEqual(25)
    const batches = fake.posted.filter((message) => message.type === 'batch') as unknown as Array<{
      files: unknown[]
    }>
    const done = fake.posted.filter((message) => message.type === 'done') as unknown as Array<{
      result: { files: unknown[]; cancelled: boolean }
    }>
    expect(done).toHaveLength(1)
    expect(done[0].result.cancelled).toBe(false)
    expect(batches.reduce((total, batch) => total + batch.files.length, 0)).toBe(1_000)
    expect(progress.at(-1)?.progress.filesDone).toBe(1_000)
    expect(progress.at(-1)?.progress.filesTotal).toBe(1_000)
  })

  it('cancels between files and returns nothing', async () => {
    const fake = makeScope()
    startAnalyzerWorker(fake.scope)

    fake.dispatched({
      type: 'analyze',
      id: 3,
      entries: Array.from({ length: 6 }, (_, index) => entry(`src/f${index}.js`, '// TODO: x\n')),
      limits,
    })
    fake.dispatched({ type: 'cancel', id: 3 })
    await waitForDone(fake)

    const done = fake.posted.filter((message) => message.type === 'done') as unknown as Array<{
      result: { files: unknown[]; cancelled: boolean }
    }>
    expect(done).toHaveLength(1)
    expect(done[0].result.cancelled).toBe(true)
    expect(done[0].result.files).toEqual([])
  })

  it('refuses a second job while one is running', async () => {
    const fake = makeScope()
    startAnalyzerWorker(fake.scope)

    fake.dispatched({
      type: 'analyze',
      id: 1,
      entries: [entry('src/a.js', 'x\n'), entry('src/b.js', 'y\n')],
      limits,
    })
    fake.dispatched({ type: 'analyze', id: 2, entries: [entry('src/c.js', 'z\n')], limits })
    await waitForDone(fake, 2)

    const done = fake.posted.filter((message) => message.type === 'done') as unknown as Array<{
      id: number
      result: { files: unknown[] }
      error: string | null
    }>
    const busy = done.find((message) => message.id === 2)
    expect(busy?.error).toMatch(/already working/)
    expect(busy?.result.files).toEqual([])
    expect(done.find((message) => message.id === 1)?.error).toBeNull()
  })

  it('ignores a cancel for a job that already finished', async () => {
    const fake = makeScope()
    startAnalyzerWorker(fake.scope)

    fake.dispatched({ type: 'analyze', id: 4, entries: [entry('src/a.js', 'x\n')], limits })
    await waitForDone(fake)
    fake.dispatched({ type: 'cancel', id: 4 })
    // Cancel of a finished job is a no-op: one macrotask to flush the handler, then assert NO 2nd 'done'.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fake.posted.filter((message) => message.type === 'done')).toHaveLength(1)
  })
})

interface FakeWorker {
  handle: AnalyzerWorkerHandle
  posted: Array<{ message: { type: string; id?: number; entries?: unknown[] }; transfer?: unknown[] }>
  listeners: Record<string, Array<(event: unknown) => void>>
  emit: (type: string, event: unknown) => void
  terminated: boolean
}

function makeWorker(): FakeWorker {
  const fake: FakeWorker = {
    posted: [],
    listeners: {},
    terminated: false,
    emit: (type, event) => {
      for (const listener of fake.listeners[type] ?? []) listener(event)
    },
    handle: {
      postMessage: () => {},
      addEventListener: () => {},
      terminate: () => {},
    } as unknown as AnalyzerWorkerHandle,
  }
  fake.handle.postMessage = (message: unknown) => {
    fake.posted.push({ message: message as { type: string } })
  }
  fake.handle.addEventListener = (type: string, listener: (event: unknown) => void) => {
    fake.listeners[type] = [...(fake.listeners[type] ?? []), listener]
  }
  fake.handle.terminate = () => {
    fake.terminated = true
  }
  return fake
}

function respond(fake: FakeWorker, message: unknown): void {
  fake.emit('message', { data: message })
}

describe('analyzer worker client', () => {
  it('posts the entries and resolves the worker result', async () => {
    const fake = makeWorker()
    const pending = createAnalyzerClient(() => fake.handle).analyze([entry('src/a.js', 'x\n')], { limits })
    expect(fake.posted[0].message.type).toBe('analyze')
    expect(fake.posted[0].message.entries).toHaveLength(1)

    respond(fake, {
      type: 'done',
      id: 1,
      result: { files: [{ file: 'src/a.js', findings: [], notes: [], rulesRan: [], stoppedEarly: false }], cancelled: false },
      error: null,
    })
    await expect(pending).resolves.toMatchObject({ error: null, cancelled: false })
    expect(fake.terminated).toBe(true)
  })

  it('forwards progress messages', async () => {
    const fake = makeWorker()
    const seen: number[] = []
    const pending = createAnalyzerClient(() => fake.handle).analyze([entry('src/a.js', 'x\n')], {
      limits,
      onProgress: (progress) => seen.push(progress.filesDone),
    })

    respond(fake, { type: 'progress', id: 1, progress: { phase: 'rules', filesDone: 1, filesTotal: 1, findings: 0 } })
    respond(fake, { type: 'done', id: 1, result: { files: [], cancelled: false }, error: null })
    await pending

    expect(seen).toEqual([1])
  })

  it('posts a cancel when the caller aborts and keeps the worker answer', async () => {
    const fake = makeWorker()
    const controller = new AbortController()
    const pending = createAnalyzerClient(() => fake.handle).analyze([entry('src/a.js', 'x\n')], {
      limits,
      signal: controller.signal,
    })

    controller.abort()
    expect(fake.posted.map((item) => item.message.type)).toEqual(['analyze', 'cancel'])

    respond(fake, { type: 'done', id: 1, result: { files: [], cancelled: true }, error: null })
    await expect(pending).resolves.toMatchObject({ cancelled: true, files: [] })
  })

  it('turns a worker crash into an error with nothing produced', async () => {
    const fake = makeWorker()
    const pending = createAnalyzerClient(() => fake.handle).analyze([entry('src/a.js', 'x\n')], { limits })

    fake.emit('error', { message: 'boom' })

    await expect(pending).resolves.toMatchObject({ files: [], error: expect.stringMatching(/stopped unexpectedly/) })
    expect(fake.terminated).toBe(true)
  })

  it('refuses a second concurrent analysis', async () => {
    const fake = makeWorker()
    const client = createAnalyzerClient(() => fake.handle)
    const first = client.analyze([entry('src/a.js', 'x\n')], { limits })
    const second = client.analyze([entry('src/b.js', 'y\n')], { limits })

    await expect(second).resolves.toMatchObject({ files: [], error: expect.stringMatching(/already working/) })
    respond(fake, { type: 'done', id: 1, result: { files: [], cancelled: false }, error: null })
    await expect(first).resolves.toMatchObject({ error: null })
  })

  it('assembles a batched result in order before settling', async () => {
    const fake = makeWorker()
    const fileAnalysis = (name: string) => ({ file: name, findings: [], notes: [], rulesRan: [], stoppedEarly: false })
    const pending = createAnalyzerClient(() => fake.handle).analyze([entry('src/a.js', 'x\n')], { limits })

    respond(fake, { type: 'batch', id: 1, files: [fileAnalysis('src/a.js'), fileAnalysis('src/b.js')] })
    respond(fake, { type: 'batch', id: 1, files: [fileAnalysis('src/c.js')] })
    respond(fake, { type: 'done', id: 1, result: { files: [], cancelled: false }, error: null })

    const result = await pending
    expect(result.files.map((item) => item.file)).toEqual(['src/a.js', 'src/b.js', 'src/c.js'])
    expect(result.cancelled).toBe(false)
    expect(result.error).toBeNull()
    expect(fake.terminated).toBe(true)
  })

  it('keeps one worker alive across jobs and disposes it on demand', async () => {
    const fake = makeWorker()
    const client = createAnalyzerClient(() => fake.handle, { persistent: true })

    const first = client.analyze([entry('src/a.js', 'x\n')], { limits })
    respond(fake, {
      type: 'done',
      id: 1,
      result: { files: [{ file: 'src/a.js', findings: [], notes: [], rulesRan: [], stoppedEarly: false }], cancelled: false },
      error: null,
    })
    await expect(first).resolves.toMatchObject({ error: null })
    expect(fake.terminated).toBe(false)

    const second = client.analyze([entry('src/b.js', 'y\n')], { limits })
    const posted = fake.posted.at(-1)?.message as { type: string; id: number }
    expect(posted.type).toBe('analyze')
    expect(posted.id).toBe(2)
    respond(fake, { type: 'done', id: 2, result: { files: [], cancelled: false }, error: null })
    await expect(second).resolves.toMatchObject({ error: null })
    expect(fake.terminated).toBe(false)

    client.dispose()
    expect(fake.terminated).toBe(true)
  })

  it('ignores a late message addressed to a finished job', async () => {
    const fake = makeWorker()
    const client = createAnalyzerClient(() => fake.handle, { persistent: true })

    const first = client.analyze([entry('src/a.js', 'x\n')], { limits })
    respond(fake, { type: 'done', id: 1, result: { files: [], cancelled: false }, error: null })
    await first

    const second = client.analyze([entry('src/b.js', 'y\n')], { limits })
    respond(fake, {
      type: 'done',
      id: 1,
      result: { files: [{ file: 'stale.js', findings: [], notes: [], rulesRan: [], stoppedEarly: false }], cancelled: false },
      error: null,
    })
    respond(fake, { type: 'done', id: 2, result: { files: [], cancelled: false }, error: null })
    await expect(second).resolves.toMatchObject({ files: [], error: null })
    client.dispose()
  })
})
