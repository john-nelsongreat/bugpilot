import { buildReviewDiff } from './reviewDiff'
import type { ReviewDiffBuilder, ReviewDiffResult } from './reviewDiff'

export interface DiffWorkerHandle {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  terminate(): void
}

interface DiffWorkerResponse {
  type?: string
  id?: number
  results?: ReviewDiffResult[]
  error?: string | null
}

/**
 * One job at a time. The worker is terminated when the job ends or aborts so the
 * source strings are not retained in a live worker.
 */
export function createReviewDiffClient(getWorker: () => DiffWorkerHandle): ReviewDiffBuilder {
  return (inputs, signal) => {
    if (inputs.length === 0) return Promise.resolve([])

    let worker: DiffWorkerHandle
    try {
      worker = getWorker()
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error('The diff worker could not start.'),
      )
    }

    const id = 1
    return new Promise<ReviewDiffResult[]>((resolve, reject) => {
      let settled = false
      const finish = (outcome: { results?: ReviewDiffResult[]; error?: string }) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        worker.terminate()
        if (outcome.error) reject(new Error(outcome.error))
        else resolve(outcome.results ?? [])
      }
      const onAbort = () => finish({ results: [] })

      worker.addEventListener('message', (event) => {
        const message = (event as { data?: DiffWorkerResponse }).data
        if (!message || typeof message !== 'object') return
        if (message.type !== 'done' || message.id !== id) return
        if (message.error) finish({ error: message.error })
        else finish({ results: message.results ?? [] })
      })
      worker.addEventListener('error', () =>
        finish({ error: 'The diff worker stopped unexpectedly. Nothing was saved.' }),
      )

      if (signal?.aborted) {
        finish({ results: [] })
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        worker.postMessage({ type: 'build', id, inputs: [...inputs] })
      } catch (error) {
        finish({
          error: error instanceof Error ? error.message : 'The diff worker rejected the request.',
        })
      }
    })
  }
}

/** Environments without workers (the test harness) build the diff in place. */
export function createSyncReviewDiffBuilder(): ReviewDiffBuilder {
  return (inputs) => Promise.resolve(inputs.map(buildReviewDiff))
}

export function createDefaultReviewDiffBuilder(): ReviewDiffBuilder {
  if (typeof Worker === 'undefined') return createSyncReviewDiffBuilder()
  return createReviewDiffClient(() => new Worker(new URL('./diffEntry.ts', import.meta.url), { type: 'module' }))
}
