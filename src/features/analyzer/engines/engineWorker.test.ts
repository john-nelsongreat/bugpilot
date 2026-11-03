import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import type { WorkerScope } from '../analysis/analyzerProtocol'
import { startEngineWorker, type EngineWorkerDeps } from './engineWorker'
import type { EngineRunContext } from './runFile'
import {
  DEFAULT_ENGINE_LIMITS,
  type EngineFileResult,
  type EngineProbeResult,
  type EngineRequest,
  type EngineResponse,
} from './protocol'

const OK_PROBE: EngineProbeResult = { ok: true, code: 'available', message: 'WebAssembly compiles.' }
const BLOCKED_PROBE: EngineProbeResult = {
  ok: false,
  code: 'blocked-by-policy',
  message: 'Content Security Policy disallows use of wasm-unsafe-eval',
}

function entry(name: string, text = 'x = 1\n'): ArchiveEntry {
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

function fileResult(name: string): EngineFileResult {
  return { file: name, hits: [], enginesRan: ['tree-sitter'], parse: 'parsed', notes: [] }
}

interface FakeScope {
  scope: WorkerScope
  posted: EngineResponse[]
  send: (message: unknown) => Promise<void>
  latest: () => EngineResponse | undefined
}

function fakeScope(): FakeScope {
  const posted: EngineResponse[] = []
  const scope: WorkerScope = {
    postMessage: (message) => posted.push(message as EngineResponse),
    onmessage: null,
  }
  return {
    scope,
    posted,
    async send(message) {
      await scope.onmessage?.({ data: message })
    },
    latest: () => posted[posted.length - 1],
  }
}

function analyseMessage(entries: ArchiveEntry[], overrides: Partial<EngineRequest> = {}): EngineRequest {
  return { type: 'analyse', id: 2, entries, limits: DEFAULT_ENGINE_LIMITS, ...overrides } as EngineRequest
}

const ENTRIES = [entry('a/app.py'), entry('b/Main.java')]

describe('engine worker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('probes WebAssembly once per worker', async () => {
    const probe = vi.fn(async () => OK_PROBE)
    const deps = { probe, runFile: vi.fn() } as unknown as EngineWorkerDeps
    const { scope, posted, send } = fakeScope()
    startEngineWorker(scope, deps)

    await send({ type: 'probe', id: 1 })
    await send({ type: 'probe', id: 3 })

    expect(probe).toHaveBeenCalledTimes(1)
    expect(posted).toEqual([
      { type: 'probe-result', id: 1, result: OK_PROBE },
      { type: 'probe-result', id: 3, result: OK_PROBE },
    ])
  })

  it('does not touch a single engine file when the probe failed', async () => {
    const runFile = vi.fn()
    const deps = { probe: async () => BLOCKED_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, send, latest } = fakeScope()
    startEngineWorker(scope, deps)

    await send(analyseMessage(ENTRIES))

    expect(runFile).not.toHaveBeenCalled()
    expect(latest()).toEqual({
      type: 'done',
      id: 2,
      result: { files: [], filesNotRun: ['a/app.py', 'b/Main.java'], cancelled: false, unavailable: BLOCKED_PROBE },
      error: null,
    })
  })

  it('runs every file in order and reports progress', async () => {
    const runFile = vi.fn(async (file: ArchiveEntry, _ctx: EngineRunContext) => fileResult(file.name))
    const deps = { probe: async () => OK_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, posted, send } = fakeScope()
    startEngineWorker(scope, deps)

    await send(analyseMessage(ENTRIES))

    expect(runFile.mock.calls.map((call) => call[0].name)).toEqual(['a/app.py', 'b/Main.java'])
    expect(runFile.mock.calls[0][1]).toMatchObject({ limits: DEFAULT_ENGINE_LIMITS })
    expect(posted.filter((message) => message.type === 'progress')).toEqual([
      { type: 'progress', id: 2, filesDone: 0, filesTotal: 2, note: 'a/app.py' },
      { type: 'progress', id: 2, filesDone: 1, filesTotal: 2, note: 'b/Main.java' },
    ])
    expect(posted.at(-1)).toMatchObject({
      type: 'done',
      result: { files: [fileResult('a/app.py'), fileResult('b/Main.java')], filesNotRun: [], cancelled: false },
    })
  })

  it('announces each engine file before it downloads', async () => {
    const runFile = vi.fn(async (file: ArchiveEntry, ctx: { onDownloading?: (url: string) => void }) => {
      ctx.onDownloading?.('/assets/engines/tree-sitter-python.wasm')
      return fileResult(file.name)
    })
    const deps = { probe: async () => OK_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, posted, send } = fakeScope()
    startEngineWorker(scope, deps)

    await send(analyseMessage([entry('a/app.py')]))

    expect(posted.some((message) => message.type === 'downloading' && message.url.includes('tree-sitter-python'))).toBe(
      true,
    )
  })

  it('drops a cancelled run instead of returning half a file list', async () => {
    const runFile = vi.fn(
      (file: ArchiveEntry, ctx: { signal: AbortSignal }) =>
        new Promise<EngineFileResult>((resolve) => {
          // The engine answers the cancel from inside the file it is working on, which is the
          // only moment a long grammar check can actually be stopped.
          ctx.signal.addEventListener('abort', () => resolve(fileResult(file.name)), { once: true })
        }),
    )
    const deps = { probe: async () => OK_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, send, latest } = fakeScope()
    startEngineWorker(scope, deps)

    const running = send(analyseMessage(ENTRIES))
    await vi.waitFor(() => expect(runFile).toHaveBeenCalled())
    await send({ type: 'cancel', id: 2 })
    await running

    expect(runFile).toHaveBeenCalledTimes(1)
    expect(latest()).toEqual({
      type: 'done',
      id: 2,
      result: { files: [], filesNotRun: ['a/app.py', 'b/Main.java'], cancelled: true, unavailable: null },
      error: null,
    })
  })

  it('leaves unreached files as missing coverage when the total budget runs out', async () => {
    let clock = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const runFile = vi.fn(async (file: ArchiveEntry) => {
      clock = 9_000
      return fileResult(file.name)
    })
    const deps = { probe: async () => OK_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, send, latest } = fakeScope()
    startEngineWorker(scope, deps)

    await send(analyseMessage(ENTRIES, { limits: { ...DEFAULT_ENGINE_LIMITS, totalBudgetMs: 50 } }))

    expect(runFile).toHaveBeenCalledTimes(1)
    expect(latest()).toMatchObject({
      type: 'done',
      result: { files: [fileResult('a/app.py')], filesNotRun: ['b/Main.java'], cancelled: false },
      error: null,
    })
  })

  it('refuses a second file set while one is running', async () => {
    // Each call parks its resolver here; the test releases one file at a time.
    const pending: Array<() => void> = []
    const runFile = vi.fn(
      (file: ArchiveEntry) =>
        new Promise<EngineFileResult>((resolve) => {
          pending.push(() => resolve(fileResult(file.name)))
        }),
    )
    const deps = { probe: async () => OK_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, posted, send } = fakeScope()
    startEngineWorker(scope, deps)

    const first = send(analyseMessage(ENTRIES))
    await vi.waitFor(() => expect(runFile).toHaveBeenCalled())
    await send(analyseMessage([entry('c/app.py')], { id: 3 }))

    expect(posted.at(-1)).toMatchObject({ type: 'done', id: 3, error: 'The deep engines are already working on another file set.' })

    pending.shift()?.()
    await vi.waitFor(() => expect(runFile).toHaveBeenCalledTimes(2))
    pending.shift()?.()
    await first
    expect(posted.filter((message) => message.type === 'done')).toHaveLength(2)
  })

  it('records an engine that throws as a stopped run, not a clean file list', async () => {
    const runFile = vi.fn(async () => {
      throw new Error('the grammar panicked')
    })
    const deps = { probe: async () => OK_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, send, latest } = fakeScope()
    startEngineWorker(scope, deps)

    await send(analyseMessage(ENTRIES))

    expect(latest()).toMatchObject({
      type: 'done',
      result: { files: [], filesNotRun: ['a/app.py', 'b/Main.java'] },
      error: 'the grammar panicked',
    })
  })

  it('ignores junk and cancels that belong to another job', async () => {
    const runFile = vi.fn(async (file: ArchiveEntry) => fileResult(file.name))
    const deps = { probe: async () => OK_PROBE, runFile } as unknown as EngineWorkerDeps
    const { scope, posted, send } = fakeScope()
    startEngineWorker(scope, deps)

    await send('not a message')
    await send(null)
    await send({ type: 'cancel', id: 42 })
    expect(posted).toEqual([])

    const running = send(analyseMessage([entry('a/app.py')]))
    await send({ type: 'cancel', id: 99 })
    await running

    expect(runFile).toHaveBeenCalledTimes(1)
    expect(posted.at(-1)).toMatchObject({ type: 'done', result: { cancelled: false, filesNotRun: [] } })
  })
})
