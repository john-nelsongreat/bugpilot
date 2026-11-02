import type { AnalyzerFinding } from '../../types'
import type { TsWorkerMessage } from './tsProtocol'

export const TS_FILE_TIMEOUT_MS = 5_000

export interface TsWorkerHandle {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  terminate(): void
}

export interface TsCheckResult {
  findings: AnalyzerFinding[]
  timedOut: boolean
  cancelled: boolean
  error: string | null
}

export interface TsCheckOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface TsSyntaxClient {
  check(file: { name: string; text: string }, options?: TsCheckOptions): Promise<TsCheckResult>
  dispose(): void
}

type WorkerFactory = () => Promise<TsWorkerHandle> | TsWorkerHandle

const EMPTY = (overrides: Partial<TsCheckResult>): TsCheckResult => ({
  findings: [],
  timedOut: false,
  cancelled: false,
  error: null,
  ...overrides,
})

/**
 * The classic TypeScript worker is created on first use and terminated as soon as a check
 * ends, times out or is cancelled. Nothing from the upload survives a terminated worker.
 */
export function createTsClient(getWorker: WorkerFactory): TsSyntaxClient {
  let worker: TsWorkerHandle | null = null
  let pending:
    | {
        id: number
        resolve: (result: TsCheckResult) => void
        timer: ReturnType<typeof setTimeout>
        signal: AbortSignal | undefined
        onAbort: (() => void) | null
      }
    | null = null
  let nextId = 1
  let disposed = false
  let starting = false

  function finish(result: TsCheckResult): void {
    if (!pending) return
    const current = pending
    pending = null
    clearTimeout(current.timer)
    if (current.signal && current.onAbort) current.signal.removeEventListener('abort', current.onAbort)
    current.resolve(result)
  }

  function terminate(): void {
    if (!worker) return
    worker.terminate()
    worker = null
  }

  function attach(handle: TsWorkerHandle): void {
    handle.addEventListener('message', (event) => {
      const message = (event as { data?: TsWorkerMessage }).data
      if (!message || typeof message !== 'object') return
      if (message.type === 'result' && message.id === pending?.id) {
        finish(EMPTY({ findings: message.findings }))
      } else if (message.type === 'error' && message.id === pending?.id) {
        terminate()
        finish(EMPTY({ error: message.message }))
      }
    })
    handle.addEventListener('error', () => {
      terminate()
      finish(EMPTY({ error: 'The syntax checker stopped unexpectedly. Other files were unaffected.' }))
    })
  }

  async function ensureWorker(): Promise<TsWorkerHandle | string> {
    if (worker) return worker
    try {
      const handle = await getWorker()
      worker = handle
      attach(handle)
      return handle
    } catch (error) {
      return error instanceof Error ? error.message : 'The syntax checker could not start.'
    }
  }

  return {
    async check(file, options = {}) {
      if (disposed) return EMPTY({ error: 'The syntax checker was already closed.' })
      if (pending || starting) return EMPTY({ error: 'The syntax checker is already checking another file.' })
      if (options.signal?.aborted) return EMPTY({ cancelled: true })

      starting = true
      const handle = await ensureWorker()
      starting = false
      if (typeof handle === 'string') return EMPTY({ error: handle })
      if (disposed) {
        terminate()
        return EMPTY({ cancelled: true })
      }
      if (options.signal?.aborted) {
        terminate()
        return EMPTY({ cancelled: true })
      }

      const id = nextId++
      const timeoutMs = options.timeoutMs ?? TS_FILE_TIMEOUT_MS
      return new Promise<TsCheckResult>((resolve) => {
        const timer = setTimeout(() => {
          terminate()
          finish(EMPTY({ timedOut: true }))
        }, timeoutMs)
        const onAbort = () => {
          terminate()
          finish(EMPTY({ cancelled: true }))
        }
        pending = { id, resolve, timer, signal: options.signal, onAbort: options.signal ? onAbort : null }
        options.signal?.addEventListener('abort', onAbort, { once: true })
        try {
          handle.postMessage({ type: 'check', id, name: file.name, text: file.text })
        } catch (error) {
          clearTimeout(timer)
          pending = null
          terminate()
          resolve(EMPTY({ error: error instanceof Error ? error.message : 'The syntax checker rejected the request.' }))
        }
      })
    },
    dispose() {
      disposed = true
      terminate()
      finish(EMPTY({ cancelled: true }))
    },
  }
}

/** Vite emits this as an IIFE (classic) worker asset; it is fetched only when a JS/TS file exists. */
export async function createDefaultTsClient(): Promise<TsSyntaxClient> {
  return createTsClient(async () => {
    const module = await import('./tsWorkerEntry?worker')
    return new module.default() as TsWorkerHandle
  })
}
