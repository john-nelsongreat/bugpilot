import type { AnalyzerWorkerHandle } from '../analysis/analyzerClient'
import type { ArchiveEntry } from '../archive/guard'
import {
  DEFAULT_ENGINE_LIMITS,
  type EngineFileResult,
  type EngineLimits,
  type EngineProbeResult,
  type EngineResponse,
} from './protocol'

/** A probe that never answers is treated as blocked; the page must not hang. */
const PROBE_TIMEOUT_MS = 10_000

export interface EngineRunOutcome {
  files: EngineFileResult[]
  filesNotRun: string[]
  cancelled: boolean
  /** Non-null when WebAssembly was refused; the caller degrades and says why. */
  unavailable: EngineProbeResult | null
  error: string | null
}

export interface EngineRunOptions {
  limits?: Partial<EngineLimits>
  signal?: AbortSignal
  onProgress?: (done: number, total: number, currentFile: string) => void
  onDownloading?: (url: string) => void
}

export interface EngineClient {
  run(entries: readonly ArchiveEntry[], options?: EngineRunOptions): Promise<EngineRunOutcome>
}

type WorkerFactory = () => AnalyzerWorkerHandle

const NO_FILES = (entries: readonly ArchiveEntry[]): string[] => entries.map((entry) => entry.name)

/**
 * Probes before it analyses: the answer to "can this browser compile WebAssembly at all"
 * decides whether any engine chunk is fetched. The worker is terminated when the job ends,
 * so decoded source and the instantiated engines are released with it.
 */
export function createEngineClient(getWorker: WorkerFactory): EngineClient {
  let busy = false

  return {
    run(entries, options = {}) {
      if (busy) {
        return Promise.resolve<EngineRunOutcome>({
          files: [],
          filesNotRun: NO_FILES(entries),
          cancelled: false,
          unavailable: null,
          error: 'The deep engines are already working on another file set.',
        })
      }
      busy = true

      let worker: AnalyzerWorkerHandle
      try {
        worker = getWorker()
      } catch (error) {
        busy = false
        return Promise.resolve<EngineRunOutcome>({
          files: [],
          filesNotRun: NO_FILES(entries),
          cancelled: false,
          unavailable: {
            ok: false,
            code: 'worker-error',
            message: error instanceof Error ? error.message : 'The engine worker could not start.',
          },
          error: null,
        })
      }

      const handle = worker
      const limits: EngineLimits = { ...DEFAULT_ENGINE_LIMITS, ...options.limits }

      return new Promise<EngineRunOutcome>((resolve) => {
        let settled = false
        const probeId = 1
        const runId = 2
        let probeTimer: ReturnType<typeof setTimeout> | null = null

        const finish = (outcome: EngineRunOutcome) => {
          if (settled) return
          settled = true
          if (probeTimer) clearTimeout(probeTimer)
          options.signal?.removeEventListener('abort', onAbort)
          handle.terminate()
          busy = false
          resolve(outcome)
        }

        const onAbort = () => {
          try {
            handle.postMessage({ type: 'cancel', id: runId })
          } catch {
            finish({ files: [], filesNotRun: NO_FILES(entries), cancelled: true, unavailable: null, error: null })
          }
        }

        const unavailableOutcome = (probe: EngineProbeResult): EngineRunOutcome => ({
          files: [],
          filesNotRun: NO_FILES(entries),
          cancelled: false,
          unavailable: probe,
          error: null,
        })

        handle.addEventListener('message', (event) => {
          const message = (event as { data?: EngineResponse }).data
          if (!message || typeof message !== 'object') return

          if (message.type === 'probe-result') {
            if (message.id !== probeId) return
            if (probeTimer) {
              clearTimeout(probeTimer)
              probeTimer = null
            }
            if (!message.result.ok) {
              finish(unavailableOutcome(message.result))
              return
            }
            if (options.signal?.aborted) {
              finish({ files: [], filesNotRun: NO_FILES(entries), cancelled: true, unavailable: null, error: null })
              return
            }
            try {
              handle.postMessage({ type: 'analyse', id: runId, entries: [...entries], limits })
            } catch (error) {
              finish({
                files: [],
                filesNotRun: NO_FILES(entries),
                cancelled: false,
                unavailable: null,
                error: error instanceof Error ? error.message : 'The deep engines rejected the request.',
              })
            }
            return
          }

          if (message.type === 'downloading') {
            options.onDownloading?.(message.url)
            return
          }

          if (message.type === 'progress') {
            options.onProgress?.(message.filesDone, message.filesTotal, message.note)
            return
          }

          if (message.type === 'done') {
            finish({
              files: message.result.files,
              filesNotRun: message.result.filesNotRun,
              cancelled: message.result.cancelled,
              unavailable: message.result.unavailable,
              error: message.error,
            })
          }
        })

        handle.addEventListener('error', () => {
          finish({
            files: [],
            filesNotRun: NO_FILES(entries),
            cancelled: false,
            unavailable: null,
            error: 'The deep engines stopped unexpectedly. Nothing was stored.',
          })
        })

        if (options.signal?.aborted) {
          finish({ files: [], filesNotRun: NO_FILES(entries), cancelled: true, unavailable: null, error: null })
          return
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })

        probeTimer = setTimeout(() => {
          finish(
            unavailableOutcome({
              ok: false,
              code: 'blocked-by-policy',
              message: `The engine worker did not answer the WebAssembly probe within ${PROBE_TIMEOUT_MS} ms.`,
            }),
          )
        }, PROBE_TIMEOUT_MS)

        try {
          handle.postMessage({ type: 'probe', id: probeId })
        } catch (error) {
          finish({
            files: [],
            filesNotRun: NO_FILES(entries),
            cancelled: false,
            unavailable: {
              ok: false,
              code: 'worker-error',
              message: error instanceof Error ? error.message : 'The engine worker rejected the probe.',
            },
            error: null,
          })
        }
      })
    },
  }
}
