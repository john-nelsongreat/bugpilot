import { analyzeFile, type AnalysisLimits, type FileAnalysis } from './engine'
import { ANALYZER_RULES } from '../rules/registry'
import type { AnalyzerRequest, WorkerScope } from './analyzerProtocol'

/** Lets cancel messages reach the worker between files; each file itself is bounded by its budget. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function startAnalyzerWorker(scope: WorkerScope): void {
  let running: { id: number; controller: AbortController } | null = null

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
      scope.postMessage({
        type: 'done',
        id: message.id,
        result: { files: cancelled ? [] : files, cancelled },
        error: null,
      })
    } catch (error) {
      scope.postMessage({
        type: 'done',
        id: message.id,
        result: { files: [], cancelled: false },
        error: error instanceof Error ? error.message : 'The analyzer stopped unexpectedly.',
      })
    } finally {
      running = null
    }
  }
}
