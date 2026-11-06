import type { ArchiveEntry } from '../archive/guard'
import { DEFAULT_ANALYSIS_LIMITS, type AnalysisLimits, type AnalysisProgress, type FileAnalysis } from './engine'
import type { AnalyzerResponse } from './analyzerProtocol'
import { yieldToMain } from '../yieldToMain'

export interface AnalyzerWorkerHandle {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  terminate(): void
}

export interface AnalyzerRunResult {
  files: FileAnalysis[]
  cancelled: boolean
  error: string | null
}

export interface AnalyzerRunOptions {
  limits?: AnalysisLimits
  signal?: AbortSignal
  onProgress?: (progress: AnalysisProgress) => void
}

export interface AnalyzerClient {
  analyze(entries: readonly ArchiveEntry[], options?: AnalyzerRunOptions): Promise<AnalyzerRunResult>
}

export interface DisposableAnalyzerClient extends AnalyzerClient {
  /** Stops a persistent worker; a non-persistent client already terminated its own. */
  dispose: () => void
}

type WorkerFactory = () => AnalyzerWorkerHandle

export interface AnalyzerClientOptions {
  /**
   * Keep one worker alive across analyze calls instead of spawning and terminating one per
   * job. The worker pool uses this so a large run does not pay a fresh worker startup for
   * every chunk; the pool calls `dispose` when the run ends.
   */
  persistent?: boolean
}

interface JobState {
  id: number
  onProgress?: (progress: AnalysisProgress) => void
  pendingFiles: FileAnalysis[]
  collected: FileAnalysis[]
  sawBatch: boolean
  doneMessage: Extract<AnalyzerResponse, { type: 'done' }> | null
  draining: boolean
  finish: (result: AnalyzerRunResult) => void
}

/**
 * Large results arrive in slices; accumulation yields to the main thread between them, so
 * receiving a 40,000-file analysis cannot pin the page.
 */
function drain(state: JobState): void {
  if (state.draining) return
  state.draining = true
  const step = (): void => {
    if (state.pendingFiles.length === 0) {
      state.draining = false
      if (state.doneMessage !== null) {
        state.finish({
          files: state.sawBatch ? state.collected : state.doneMessage.result.files,
          cancelled: state.doneMessage.result.cancelled,
          error: state.doneMessage.error,
        })
      }
      return
    }
    state.collected.push(...state.pendingFiles.splice(0, state.pendingFiles.length))
    void yieldToMain().then(step)
  }
  step()
}

/**
 * One job at a time. A non-persistent client terminates its worker when the job ends so
 * decoded source strings are released instead of sitting in a live worker.
 */
export function createAnalyzerClient(
  getWorker: WorkerFactory,
  factoryOptions?: AnalyzerClientOptions,
): DisposableAnalyzerClient {
  const persistent = factoryOptions?.persistent === true
  let busy = false
  let handle: AnalyzerWorkerHandle | null = null
  let listenersBound = false
  let jobCounter = 0
  let job: JobState | null = null

  function terminateWorker(): void {
    if (handle === null) return
    handle.terminate()
    handle = null
    listenersBound = false
    job = null
  }

  return {
    analyze(entries, options = {}) {
      if (busy) {
        return Promise.resolve<AnalyzerRunResult>({
          files: [],
          cancelled: false,
          error: 'The analyzer is already working on another file set.',
        })
      }
      busy = true

      try {
        handle ??= getWorker()
      } catch (error) {
        busy = false
        return Promise.resolve<AnalyzerRunResult>({
          files: [],
          cancelled: false,
          error: error instanceof Error ? error.message : 'The analyzer could not start.',
        })
      }
      const worker = handle

      if (!listenersBound) {
        listenersBound = true
        worker.addEventListener('message', (event) => {
          const current = job
          const message = (event as { data?: AnalyzerResponse }).data
          if (!message || typeof message !== 'object' || current === null || message.id !== current.id) return
          if (message.type === 'progress') {
            current.onProgress?.(message.progress)
            return
          }
          if (message.type === 'batch') {
            current.sawBatch = true
            current.pendingFiles.push(...message.files)
            drain(current)
            return
          }
          if (message.type === 'done') {
            current.doneMessage = message
            drain(current)
          }
        })
        worker.addEventListener('error', () => {
          const current = job
          if (current === null) return
          current.finish({
            files: [],
            cancelled: false,
            error: 'The analyzer stopped unexpectedly. Nothing was stored.',
          })
          terminateWorker()
        })
      }

      const id = ++jobCounter
      return new Promise<AnalyzerRunResult>((resolve) => {
        let settled = false
        const finish = (result: AnalyzerRunResult): void => {
          if (settled) return
          settled = true
          options.signal?.removeEventListener('abort', onAbort)
          if (job !== null && job.id === id) job = null
          busy = false
          if (!persistent) terminateWorker()
          resolve(result)
        }
        const state: JobState = {
          id,
          onProgress: options.onProgress,
          pendingFiles: [],
          collected: [],
          sawBatch: false,
          doneMessage: null,
          draining: false,
          finish,
        }
        const onAbort = () => {
          try {
            worker.postMessage({ type: 'cancel', id })
          } catch {
            finish({ files: [], cancelled: true, error: null })
          }
        }
        job = state

        if (options.signal?.aborted) {
          finish({ files: [], cancelled: true, error: null })
          return
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })

        try {
          worker.postMessage({
            type: 'analyze',
            id,
            entries: [...entries],
            limits: options.limits ?? DEFAULT_ANALYSIS_LIMITS,
          })
        } catch (error) {
          finish({
            files: [],
            cancelled: false,
            error: error instanceof Error ? error.message : 'The analyzer rejected the request.',
          })
        }
      })
    },
    dispose: terminateWorker,
  }
}
