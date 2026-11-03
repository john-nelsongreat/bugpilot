import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerWorkerHandle } from '../analysis/analyzerClient'
import { createEngineClient } from './engineClient'
import { DEFAULT_ENGINE_LIMITS, type EngineProbeResult, type EngineResponse } from './protocol'

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

interface FakeWorker {
  handle: AnalyzerWorkerHandle
  posted: unknown[]
  terminate: ReturnType<typeof vi.fn>
  emit: (type: string, data: unknown) => void
}

function fakeWorker(options: { failPost?: (message: unknown) => void } = {}): FakeWorker {
  const posted: unknown[] = []
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  const terminate = vi.fn()
  const handle: AnalyzerWorkerHandle = {
    postMessage(message: unknown) {
      options.failPost?.(message)
      posted.push(message)
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    terminate,
  }
  return {
    handle,
    posted,
    terminate,
    emit(type, data) {
      for (const listener of listeners.get(type) ?? []) listener({ data })
    },
  }
}

const OK_PROBE: EngineProbeResult = { ok: true, code: 'available', message: 'WebAssembly compiles.' }
const BLOCKED_PROBE: EngineProbeResult = {
  ok: false,
  code: 'blocked-by-policy',
  message: 'WebAssembly.compile(): Content Security Policy disallows use of wasm-unsafe-eval',
}

const ENTRIES = [entry('src/app.py', 'import os\n'), entry('src/Main.java', 'class Main {}\n')]

function doneMessage(files: unknown[] = [], overrides: Partial<EngineResponse> = {}): EngineResponse {
  return {
    type: 'done',
    id: 2,
    result: { files, filesNotRun: [], cancelled: false, unavailable: null },
    error: null,
    ...overrides,
  } as EngineResponse
}

afterEach(() => {
  vi.useRealTimers()
})

describe('engine client', () => {
  it('probes before it analyses and merges the caller limits', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)

    const promise = client.run(ENTRIES, { limits: { perFileBudgetMs: 50 } })
    expect(worker.posted[0]).toEqual({ type: 'probe', id: 1 })

    worker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })
    const analyse = worker.posted[1] as { type: string; limits: typeof DEFAULT_ENGINE_LIMITS; entries: ArchiveEntry[] }
    expect(analyse.type).toBe('analyse')
    expect(analyse.limits.perFileBudgetMs).toBe(50)
    expect(analyse.limits.totalBudgetMs).toBe(DEFAULT_ENGINE_LIMITS.totalBudgetMs)
    expect(analyse.entries.map((item) => item.name)).toEqual(['src/app.py', 'src/Main.java'])

    worker.emit('message', doneMessage([{ file: 'src/app.py' }]))
    const outcome = await promise
    expect(outcome.files).toHaveLength(1)
    expect(outcome.cancelled).toBe(false)
    expect(outcome.unavailable).toBeNull()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('fetches no engine file when the browser cannot compile WebAssembly', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)

    const promise = client.run(ENTRIES)
    worker.emit('message', { type: 'probe-result', id: 1, result: BLOCKED_PROBE })

    const outcome = await promise
    expect(outcome.unavailable?.code).toBe('blocked-by-policy')
    expect(outcome.files).toEqual([])
    expect(outcome.filesNotRun).toEqual(['src/app.py', 'src/Main.java'])
    expect(worker.posted.some((message) => (message as { type: string }).type === 'analyse')).toBe(false)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('treats a worker that never answers the probe as blocked', async () => {
    vi.useFakeTimers()
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)

    const promise = client.run(ENTRIES)
    await vi.advanceTimersByTimeAsync(10_000)

    const outcome = await promise
    expect(outcome.unavailable?.code).toBe('blocked-by-policy')
    expect(outcome.unavailable?.message).toContain('did not answer the WebAssembly probe')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('refuses a second file set while the engines are busy', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)

    const first = client.run(ENTRIES)
    const second = await client.run([entry('other/app.py', 'x = 1\n')])
    expect(second.error).toContain('already working')
    expect(second.filesNotRun).toEqual(['other/app.py'])

    worker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })
    worker.emit('message', doneMessage())
    await first

    // The lock is released, so a later deep pass works.
    const thirdWorker = fakeWorker()
    const clientWithNewWorker = createEngineClient(() => thirdWorker.handle)
    const third = clientWithNewWorker.run(ENTRIES)
    expect(thirdWorker.posted[0]).toEqual({ type: 'probe', id: 1 })
    thirdWorker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })
    thirdWorker.emit('message', doneMessage())
    await expect(third).resolves.toMatchObject({ unavailable: null, error: null })
  })

  it('says the worker could not start instead of hanging', async () => {
    const client = createEngineClient(() => {
      throw new Error('Worker is not allowed on this page.')
    })
    const outcome = await client.run(ENTRIES)
    expect(outcome.unavailable?.code).toBe('worker-error')
    expect(outcome.unavailable?.message).toBe('Worker is not allowed on this page.')
    expect(outcome.filesNotRun).toHaveLength(2)
  })

  it('reports a worker that dies mid-run without pretending files were checked', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)

    const promise = client.run(ENTRIES)
    worker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })
    worker.emit('error', null)

    const outcome = await promise
    expect(outcome.error).toContain('stopped unexpectedly')
    expect(outcome.files).toEqual([])
    expect(outcome.filesNotRun).toEqual(['src/app.py', 'src/Main.java'])
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('forwards the download notice and the per-file progress', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)
    const downloading = vi.fn()
    const onProgress = vi.fn()

    const promise = client.run(ENTRIES, { onDownloading: downloading, onProgress })
    worker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })
    worker.emit('message', { type: 'downloading', id: 2, url: '/assets/engines/tree-sitter-python.wasm' })
    worker.emit('message', { type: 'progress', id: 2, filesDone: 1, filesTotal: 2, note: 'src/Main.java' })
    worker.emit('message', doneMessage())

    await promise
    expect(downloading).toHaveBeenCalledWith('/assets/engines/tree-sitter-python.wasm')
    expect(onProgress).toHaveBeenCalledWith(1, 2, 'src/Main.java')
  })

  it('asks the worker to cancel when the caller aborts', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)
    const controller = new AbortController()

    const promise = client.run(ENTRIES, { signal: controller.signal })
    worker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })
    controller.abort()
    expect(worker.posted).toContainEqual({ type: 'cancel', id: 2 })

    worker.emit('message', {
      type: 'done',
      id: 2,
      result: { files: [], filesNotRun: ['src/app.py', 'src/Main.java'], cancelled: true, unavailable: null },
      error: null,
    })
    const outcome = await promise
    expect(outcome.cancelled).toBe(true)
  })

  it('cancels immediately when the signal was already aborted', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)
    const controller = new AbortController()
    controller.abort()

    const outcome = await client.run(ENTRIES, { signal: controller.signal })
    expect(outcome.cancelled).toBe(true)
    expect(outcome.files).toEqual([])
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('reports a worker that rejects the analysed source', async () => {
    const worker = fakeWorker({
      failPost: (message) => {
        if ((message as { type: string }).type === 'analyse') throw new Error('The message port is closed.')
      },
    })
    const client = createEngineClient(() => worker.handle)

    const promise = client.run(ENTRIES)
    worker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })

    const outcome = await promise
    expect(outcome.error).toBe('The message port is closed.')
    expect(outcome.filesNotRun).toHaveLength(2)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('ignores messages from another job', async () => {
    const worker = fakeWorker()
    const client = createEngineClient(() => worker.handle)

    const promise = client.run(ENTRIES)
    worker.emit('message', { type: 'probe-result', id: 99, result: BLOCKED_PROBE })
    worker.emit('message', { type: 'progress', id: 2, filesDone: 0, filesTotal: 2, note: 'src/app.py' })
    worker.emit('message', null)
    worker.emit('message', { type: 'probe-result', id: 1, result: OK_PROBE })
    worker.emit('message', doneMessage([], { error: 'Engine run stopped.' }))

    const outcome = await promise
    expect(outcome.error).toBe('Engine run stopped.')
  })
})
