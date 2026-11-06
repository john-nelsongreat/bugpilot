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

type WorkerFactory = () => AnalyzerWorkerHandle

/**
 * One job at a time. The worker is terminated when the job ends so decoded source strings
 * are released instead of sitting in a live worker.
 */
export function createAnalyzerClient(getWorker: WorkerFactory): AnalyzerClient {
  let busy = false

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

      let worker: AnalyzerWorkerHandle | null = null
      try {
        worker = getWorker()
      } catch (error) {
        busy = false
        return Promise.resolve<AnalyzerRunResult>({
          files: [],
          cancelled: false,
          error: error instanceof Error ? error.message : 'The analyzer could not start.',
        })
      }

      const id = 1
      const handle = worker
      return new Promise<AnalyzerRunResult>((resolve) => {
        let settled = false
        const finish = (result: AnalyzerRunResult) => {
          if (settled) return
          settled = true
          options.signal?.removeEventListener('abort', onAbort)
          handle.terminate()
          busy = false
          resolve(result)
        }
        const onAbort = () => {
          try {
            handle.postMessage({ type: 'cancel', id })
          } catch {
            finish({ files: [], cancelled: true, error: null })
          }
        }

        // Large results arrive in slices; the accumulation yields to the main thread between
        // them, so receiving a 40,000-file analysis cannot pin the page.
        const pendingFiles: FileAnalysis[] = []
        const collected: FileAnalysis[] = []
        let sawBatch = false
        let doneMessage: Extract<AnalyzerResponse, { type: 'done' }> | null = null
        let draining = false
        function drain(): Promise<void> {
          if (draining) return Promise.resolve()
          draining = true
          const step = (): Promise<void> => {
            if (pendingFiles.length === 0) {
              draining = false
              if (doneMessage !== null) {
                finish({
                  files: sawBatch ? collected : doneMessage.result.files,
                  cancelled: doneMessage.result.cancelled,
                  error: doneMessage.error,
                })
              }
              return Promise.resolve()
            }
            collected.push(...pendingFiles.splice(0, pendingFiles.length))
            return yieldToMain().then(step)
          }
          return step()
        }

        handle.addEventListener('message', (event) => {
          const message = (event as { data?: AnalyzerResponse }).data
          if (!message || typeof message !== 'object') return
          if (message.type === 'progress') {
            options.onProgress?.(message.progress)
            return
          }
          if (message.type === 'batch') {
            sawBatch = true
            pendingFiles.push(...message.files)
            void drain()
            return
          }
          if (message.type === 'done') {
            doneMessage = message
            void drain()
          }
        })
        handle.addEventListener('error', () => {
          finish({ files: [], cancelled: false, error: 'The analyzer stopped unexpectedly. Nothing was stored.' })
        })

        if (options.signal?.aborted) {
          finish({ files: [], cancelled: true, error: null })
          return
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })

        try {
          handle.postMessage({
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
  }
}
