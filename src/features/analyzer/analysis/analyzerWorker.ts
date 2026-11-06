import { analyzeFile, type AnalysisBatchResult, type AnalysisLimits, type FileAnalysis } from './engine'
import { ANALYZER_RULES } from '../rules/registry'
import type { AnalyzerRequest, AnalyzerResponse, WorkerScope } from './analyzerProtocol'

/** Lets cancel messages reach the worker between files; each file itself is bounded by its budget. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** The size of one result slice; chosen so each deserialization stays a short task on the page. */
const RESULT_BATCH_FILES = 500

export function startAnalyzerWorker(scope: WorkerScope): void {
  let running: { id: number; controller: AbortController } | null = null

  const postDone = async (id: number, result: AnalysisBatchResult): Promise<void> => {
    if (result.files.length > RESULT_BATCH_FILES) {
      for (let index = 0; index < result.files.length; index += RESULT_BATCH_FILES) {
        scope.postMessage({
          type: 'batch',
          id,
          files: result.files.slice(index, index + RESULT_BATCH_FILES),
        } satisfies AnalyzerResponse)
        await yieldToEventLoop()
      }
      scope.postMessage({ type: 'done', id, result: { ...result, files: [] }, error: null } satisfies AnalyzerResponse)
      return
    }
    scope.postMessage({ type: 'done', id, result, error: null } satisfies AnalyzerResponse)
  }

  scope.onmessage = async (event) => {
    const message = event.data as AnalyzerRequest | null
    if (!message || typeof message !== 'object') return

    if (message.type === 'cancel') {
      if (running?.id === message.id) running.controller.abort()
      return
    }

    if (message.type !== 'analyze') return
    if (running) {
      scope.postMessage({
        type: 'done',
        id: message.id,
        result: { files: [], cancelled: false },
        error: 'The analyzer is already working on another file set.',
      })
      return
    }

    const controller = new AbortController()
    running = { id: message.id, controller }
    const limits: AnalysisLimits = message.limits
    const files: FileAnalysis[] = []
    let findings = 0

    try {
      scope.postMessage({
        type: 'progress',
        id: message.id,
        progress: { phase: 'rules', filesDone: 0, filesTotal: message.entries.length, findings: 0 },
      })
      for (const entry of message.entries) {
        if (controller.signal.aborted) break
        const analysis = analyzeFile(entry, { rules: ANALYZER_RULES, limits, signal: controller.signal })
        if (!analysis) break
        files.push(analysis)
        findings += analysis.findings.length
        scope.postMessage({
          type: 'progress',
          id: message.id,
          progress: { phase: 'rules', filesDone: files.length, filesTotal: message.entries.length, findings },
        })
        await yieldToEventLoop()
      }
      const cancelled = controller.signal.aborted
      await postDone(message.id, { files: cancelled ? [] : files, cancelled })
    } catch (error) {
      scope.postMessage({
        type: 'done',
        id: message.id,
        result: { files: [], cancelled: false },
        error: error instanceof Error ? error.message : 'The analyzer stopped unexpectedly.',
      } satisfies AnalyzerResponse)
    } finally {
      running = null
    }
  }
}
