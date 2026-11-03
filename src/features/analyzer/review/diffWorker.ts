import { buildReviewDiff, type ReviewDiffInput } from './reviewDiff'

export interface DiffWorkerScope {
  onmessage: ((event: { data?: unknown }) => void) | null
  postMessage(message: unknown): void
}

export function startDiffWorker(scope: DiffWorkerScope): void {
  scope.onmessage = (event) => {
    const message = event.data as { type?: string; id?: number; inputs?: unknown } | null
    if (
      !message ||
      typeof message !== 'object' ||
      message.type !== 'build' ||
      typeof message.id !== 'number' ||
      !Array.isArray(message.inputs)
    ) {
      return
    }
    const results = (message.inputs as ReviewDiffInput[]).map(buildReviewDiff)
    scope.postMessage({ type: 'done', id: message.id, results })
  }
}
