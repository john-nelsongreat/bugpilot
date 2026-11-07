import { analyzeFile, type AnalysisBatchResult, type AnalysisLimits, type FileAnalysis } from './engine'
import { ANALYZER_RULES } from '../rules/registry'
import type { AnalyzerRequest, AnalyzerResponse, WorkerScope } from './analyzerProtocol'

/**
 * Lets cancel messages reach the worker between files. A channel message is an ordinary task,
 * so it interleaves without the timer clamp: browsers clamp nested `setTimeout(0)` to 4 ms,
 * which alone would add minutes to a twenty-thousand-file run.
 */
const yieldResolvers: Array<() => void> = []
const yieldChannel = typeof MessageChannel === 'function' ? new MessageChannel() : null
if (yieldChannel) {
  yieldChannel.port1.onmessage = () => {
    const next = yieldResolvers.shift()
    next?.()
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (yieldChannel) {
      yieldResolvers.push(resolve)
      yieldChannel.port2.postMessage(null)
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** The size of one result slice; chosen so each deserialization stays a short task on the page. */
const RESULT_BATCH_FILES = 500

/**
 * One progress post per this many files. Every post becomes a page render, so a post per file
 * would turn a twenty-thousand-file run into twenty thousand renders; fifty keeps the counter
 * live at a fraction of the cost.
 */
const PROGRESS_EVERY_FILES = 50

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
    let lastProgressFiles = -1

    const postProgress = (): void => {
      lastProgressFiles = files.length
      scope.postMessage({
        type: 'progress',
        id: message.id,
        progress: { phase: 'rules', filesDone: files.length, filesTotal: message.entries.length, findings },
      } satisfies AnalyzerResponse)
    }

    try {
      postProgress()
      for (const entry of message.entries) {
        if (controller.signal.aborted) break
        const analysis = analyzeFile(entry, { rules: ANALYZER_RULES, limits, signal: controller.signal })
        if (!analysis) break
        files.push(analysis)
        findings += analysis.findings.length
        if (files.length % PROGRESS_EVERY_FILES === 0) postProgress()
        await yieldToEventLoop()
      }
      if (files.length !== lastProgressFiles) postProgress()
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
