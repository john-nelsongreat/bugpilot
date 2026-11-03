import type { WorkerScope } from '../analysis/analyzerProtocol'
import { probeWebAssembly, type WebAssemblyProbe } from './featureProbe'
import {
  DEFAULT_ENGINE_LIMITS,
  type EngineFileResult,
  type EngineRequest,
  type EngineResponse,
  type EngineRunResult,
} from './protocol'
import { runEngineFile } from './runFile'

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export interface EngineWorkerDeps {
  probe: () => Promise<WebAssemblyProbe>
  runFile: typeof runEngineFile
}

const REAL_DEPS: EngineWorkerDeps = { probe: probeWebAssembly, runFile: runEngineFile }

/**
 * The engine worker is the only script in the app served with `wasm-unsafe-eval`, so it is
 * the only place a WebAssembly engine may be constructed. One job at a time, one probe per
 * worker, and an engine that fails on a file is recorded as missing coverage instead of
 * killing the run.
 */
export function startEngineWorker(scope: WorkerScope, deps: EngineWorkerDeps = REAL_DEPS): void {
  let running: { id: number; controller: AbortController } | null = null
  let probeResult: WebAssemblyProbe | null = null

  const post = (message: EngineResponse): void => scope.postMessage(message)

  scope.onmessage = async (event) => {
    const message = event.data as EngineRequest | null
    if (!message || typeof message !== 'object') return

    if (message.type === 'cancel') {
      if (running?.id === message.id) running.controller.abort()
      return
    }

    if (message.type === 'probe') {
      probeResult ??= await deps.probe()
      post({ type: 'probe-result', id: message.id, result: probeResult })
      return
    }

    if (running) {
      post({
        type: 'done',
        id: message.id,
        result: { files: [], filesNotRun: [], cancelled: false, unavailable: null },
        error: 'The deep engines are already working on another file set.',
      })
      return
    }

    const controller = new AbortController()
    running = { id: message.id, controller }
    const limits = message.limits ?? DEFAULT_ENGINE_LIMITS
    const runStartedAt = Date.now()
    const files: EngineFileResult[] = []
    const allNames = message.entries.map((entry) => entry.name)

    try {
      probeResult ??= await deps.probe()
      if (!probeResult.ok) {
        post({
          type: 'done',
          id: message.id,
          result: { files: [], filesNotRun: allNames, cancelled: false, unavailable: probeResult },
          error: null,
        })
        return
      }

      let budgetExhausted = false
      for (const entry of message.entries) {
        if (controller.signal.aborted) break
        if (Date.now() - runStartedAt > limits.totalBudgetMs) {
          budgetExhausted = true
          break
        }

        post({
          type: 'progress',
          id: message.id,
          filesDone: files.length,
          filesTotal: message.entries.length,
          note: entry.name,
        })

        files.push(
          await deps.runFile(entry, {
            limits,
            signal: controller.signal,
            runStartedAt,
            onDownloading: (url) => {
              post({ type: 'downloading', id: message.id, url })
            },
          }),
        )
        await yieldToEventLoop()
      }

      const cancelled = controller.signal.aborted
      const result: EngineRunResult = cancelled
        ? { files: [], filesNotRun: allNames, cancelled: true, unavailable: null }
        : {
            files,
            filesNotRun: budgetExhausted ? allNames.slice(files.length) : [],
            cancelled: false,
            unavailable: null,
          }
      post({ type: 'done', id: message.id, result, error: null })
    } catch (error) {
      post({
        type: 'done',
        id: message.id,
        result: { files: [], filesNotRun: allNames, cancelled: false, unavailable: null },
        error: error instanceof Error ? error.message : 'The deep engines stopped unexpectedly.',
      })
    } finally {
      running = null
    }
  }
}
