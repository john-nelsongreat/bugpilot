import { describe, expect, it } from 'vitest'
import { buildZip } from '../../../test/zipFixtures'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'
import type { ArchiveLimits } from './limits'
import { startArchiveWorker, type WorkerScope } from './workerProtocol'
import { createArchiveClient, type WorkerHandle } from './workerClient'

function filler(name: string, size: number) {
  const lines: string[] = []
  for (let at = 0; at < size; at += 40) lines.push(`const v${at} = "value-${at}"\n`.padEnd(40, ' ').slice(0, 40))
  return { name, content: lines.join('') }
}

interface FakeScope {
  scope: WorkerScope
  posted: unknown[]
  dispatched: (data: unknown) => void
}

function makeScope(): FakeScope {
  const posted: unknown[] = []
  let handler: ((event: { data: unknown }) => void) | null = null
  return {
    posted,
    scope: {
      postMessage: (message: unknown) => posted.push(message),
      set onmessage(next: ((event: { data: unknown }) => void) | null) {
        handler = next
      },
      get onmessage() {
        return handler ?? null
      },
    } as WorkerScope,
    dispatched: (data) => {
      handler?.({ data })
    },
  }
}

function limitsFor(): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, maxArchiveBytes: 65_536 }
}

describe('archive worker protocol', () => {
  it('answers a read request with the extracted entries', async () => {
    const fake = makeScope()
    startArchiveWorker(fake.scope)
    const bytes = buildZip([filler('src/a.js', 200)])

    fake.dispatched({ type: 'read-archive', id: 7, bytes: bytes.buffer, limits: limitsFor() })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const done = fake.posted.filter((message) => (message as { type: string }).type === 'done') as Array<{
      id: number
      result: { refusal: unknown; entries: Array<{ name: string; language: string }> }
    }>
    expect(done).toHaveLength(1)
    expect(done[0].id).toBe(7)
    expect(done[0].result.refusal).toBeNull()
    expect(done[0].result.entries[0].name).toBe('src/a.js')
    expect(done[0].result.entries[0].language).toBe('javascript')
  })

  it('honours the generated-file override inside the worker', async () => {
    const fake = makeScope()
    startArchiveWorker(fake.scope)
    const bytes = buildZip([
      filler('node_modules/left-pad/index.js', 200),
      filler('.git/config', 200),
      filler('src/a.js', 200),
    ])

    fake.dispatched({ type: 'read-archive', id: 11, bytes: bytes.buffer, limits: limitsFor(), includeGenerated: true })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const done = fake.posted.filter((message) => (message as { type: string }).type === 'done') as Array<{
      id: number
      result: { entries: Array<{ name: string }>; skipped: Array<{ name: string }> }
    }>
    expect(done).toHaveLength(1)
    expect(done[0].result.entries.map((entry) => entry.name)).toEqual(['node_modules/left-pad/index.js', 'src/a.js'])
    expect(done[0].result.skipped.map((entry) => entry.name)).toEqual(['.git/config'])
  })

  it('streams progress before the final answer', async () => {
    const fake = makeScope()
    startArchiveWorker(fake.scope)
    const bytes = buildZip([filler('src/a.js', 200), filler('src/b.js', 200)])

    fake.dispatched({ type: 'read-archive', id: 1, bytes: bytes.buffer, limits: limitsFor() })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const types = fake.posted.map((message) => (message as { type: string }).type)
    expect(types).toContain('progress')
    expect(types[types.length - 1]).toBe('done')
  })

  it('cancels the job in flight when a cancel message arrives', async () => {
    const fake = makeScope()
    startArchiveWorker(fake.scope)
    const bytes = buildZip(Array.from({ length: 12 }, (_, i) => filler(`src/m${i}.js`, 900)))

    fake.dispatched({ type: 'read-archive', id: 3, bytes: bytes.buffer, limits: limitsFor() })
    fake.dispatched({ type: 'cancel', id: 3 })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const done = fake.posted.filter((message) => (message as { type: string }).type === 'done') as Array<{
      result: { refusal: { code: string } | null; entries: unknown[] }
    }>
    expect(done).toHaveLength(1)
    expect(done[0].result.refusal?.code).toBe('cancelled')
    expect(done[0].result.entries).toHaveLength(0)
  })

  it('answers a request whose bytes are not an archive instead of hanging', async () => {
    const fake = makeScope()
    startArchiveWorker(fake.scope)

    fake.dispatched({ type: 'read-archive', id: 9, bytes: new Uint8Array([1, 2, 3, 4]).buffer, limits: limitsFor() })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const done = fake.posted as Array<{ type: string; result?: { refusal: { code: string } | null; entries: unknown[] } }>
    expect(done.at(-1)?.type).toBe('done')
    expect(done.at(-1)?.result?.refusal?.code).toBe('unsupported_format')
    expect(done.at(-1)?.result?.entries).toHaveLength(0)
  })

  it('refuses a second job while one is running', async () => {
    const fake = makeScope()
    startArchiveWorker(fake.scope)
    const bytes = buildZip([filler('src/a.js', 200)])

    fake.dispatched({ type: 'read-archive', id: 1, bytes: bytes.buffer, limits: limitsFor() })
    fake.dispatched({ type: 'read-archive', id: 2, bytes: bytes.buffer, limits: limitsFor() })
    await new Promise((resolve) => setTimeout(resolve, 50))

    const done = fake.posted.filter((message) => (message as { type: string }).type === 'done') as Array<{
      id: number
      result: { refusal: { code: string } | null }
    }>
    const busy = done.find((message) => message.id === 2)
    expect(busy?.result.refusal?.code).toBe('worker_error')
    expect(done.find((message) => message.id === 1)?.result.refusal).toBeNull()
  })

  it('ignores a cancel for a job that already finished', async () => {
    const fake = makeScope()
    startArchiveWorker(fake.scope)
    const bytes = buildZip([filler('src/a.js', 200)])

    fake.dispatched({ type: 'read-archive', id: 4, bytes: bytes.buffer, limits: limitsFor() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    fake.dispatched({ type: 'cancel', id: 4 })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const done = fake.posted.filter((message) => (message as { type: string }).type === 'done')
    expect(done).toHaveLength(1)
  })
})

interface FakeWorker {
  handle: WorkerHandle
  posted: Array<{ message: unknown; transfer?: unknown[] }>
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
    } as unknown as WorkerHandle,
  }
  fake.handle.postMessage = (message: unknown, transfer?: unknown[]) => {
    fake.posted.push({ message, transfer })
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

describe('archive worker client', () => {
  it('hands the buffer over instead of copying it', async () => {
    const fake = makeWorker()
    const bytes = new Uint8Array([1, 2, 3])
    const pending = createArchiveClient(() => fake.handle).read(bytes, { limits: limitsFor() })
    const posted = fake.posted[0]
    expect((posted.message as { type: string }).type).toBe('read-archive')
    expect(posted.transfer).toEqual([bytes.buffer])

    respond(fake, { type: 'done', id: (posted.message as { id: number }).id, result: { refusal: null, entries: [], skipped: [], stats: {} } })
    await expect(pending).resolves.toMatchObject({ refusal: null })
  })

  it('forwards progress messages to the caller', async () => {
    const fake = makeWorker()
    const seen: number[] = []
    const pending = createArchiveClient(() => fake.handle).read(new Uint8Array([1]), {
      limits: limitsFor(),
      onProgress: (progress) => seen.push(progress.producedBytes),
    })

    respond(fake, { type: 'progress', id: 1, progress: { phase: 'extract', walkedRecords: 1, extractedEntries: 1, producedBytes: 42 } })
    respond(fake, { type: 'done', id: 1, result: { refusal: null, entries: [], skipped: [], stats: {} } })
    await pending

    expect(seen).toEqual([42])
  })

  it('posts a cancel when the caller aborts', async () => {
    const fake = makeWorker()
    const controller = new AbortController()
    const pending = createArchiveClient(() => fake.handle).read(new Uint8Array([1]), {
      limits: limitsFor(),
      signal: controller.signal,
    })

    controller.abort()
    expect(fake.posted.map((entry) => (entry.message as { type: string }).type)).toEqual(['read-archive', 'cancel'])

    respond(fake, { type: 'done', id: 1, result: { refusal: { code: 'cancelled', message: 'x' }, entries: [], skipped: [], stats: {} } })
    await expect(pending).resolves.toMatchObject({ refusal: { code: 'cancelled' } })
  })

  it('turns a worker crash into a refusal with nothing produced', async () => {
    const fake = makeWorker()
    const pending = createArchiveClient(() => fake.handle).read(new Uint8Array([1]), { limits: limitsFor() })

    fake.emit('error', { message: 'boom' })

    await expect(pending).resolves.toMatchObject({
      refusal: { code: 'worker_error' },
      entries: [],
      skipped: [],
    })
    expect(fake.terminated).toBe(true)
  })

  it('refuses a second concurrent read rather than mixing jobs', async () => {
    const fake = makeWorker()
    const client = createArchiveClient(() => fake.handle)
    const first = client.read(new Uint8Array([1]), { limits: limitsFor() })
    const second = client.read(new Uint8Array([2]), { limits: limitsFor() })

    await expect(second).resolves.toMatchObject({ refusal: { code: 'worker_error' } })
    respond(fake, { type: 'done', id: 1, result: { refusal: null, entries: [], skipped: [], stats: {} } })
    await expect(first).resolves.toMatchObject({ refusal: null })
  })
})
