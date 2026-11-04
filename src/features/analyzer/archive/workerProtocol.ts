import type { ArchiveLimits } from './limits'
import { readContainer } from './container'
import type { ArchiveReadProgress, ArchiveReadResult } from './bounds'

/**
 * The slice of a worker that the protocol needs. Keeping it an interface means the same code
 * runs under `new Worker(...)` in the browser and under a scripted fake in tests.
 */
export interface WorkerScope {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
}

export interface ReadArchiveRequest {
  type: 'read-archive'
  id: number
  bytes: ArrayBuffer
  /**
   * The name the user gave the file. It is a claim the reader checks against the bytes, never the
   * decision, and a request without one is simply a file whose name says nothing.
   */
  name?: string
  limits: ArchiveLimits
  /** Read generated and vendored folders too. `.git` is skipped at every setting. */
  includeGenerated?: boolean
}

export interface CancelRequest {
  type: 'cancel'
  id: number
}

export type WorkerRequest = ReadArchiveRequest | CancelRequest

export interface ProgressMessage {
  type: 'progress'
  id: number
  progress: ArchiveReadProgress
}

export interface DoneMessage {
  type: 'done'
  id: number
  result: ArchiveReadResult
}

export type WorkerResponse = ProgressMessage | DoneMessage

function isRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === 'read-archive' || type === 'cancel'
}

/**
 * One job at a time: the reader holds the archive in memory, so a second concurrent read would
 * double the ceiling the caps exist to enforce.
 */
export function startArchiveWorker(scope: WorkerScope): void {
  const running = new Map<number, AbortController>()

  const finish = (id: number, result: ArchiveReadResult): void => {
    running.delete(id)
    scope.postMessage({ type: 'done', id, result } satisfies WorkerResponse)
  }

  scope.onmessage = (event: { data: unknown }) => {
    const data = event.data
    if (!isRequest(data)) return

    if (data.type === 'cancel') {
      running.get(data.id)?.abort()
      return
    }

    const id = data.id
    if (running.size > 0) {
      finish(id, {
        refusal: { code: 'worker_error', message: 'Another read is already running. Wait for it to finish.' },
        entries: [],
        skipped: [],
        stats: { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 },
      })
      return
    }

    const controller = new AbortController()
    running.set(id, controller)
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(data.bytes)
    } catch {
      finish(id, {
        refusal: { code: 'worker_error', message: 'The file reader received an unreadable buffer. Nothing was stored.' },
        entries: [],
        skipped: [],
        stats: { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 },
      })
      return
    }

    void readContainer(bytes, data.name ?? '', {
      limits: data.limits,
      includeGenerated: data.includeGenerated === true,
      signal: controller.signal,
      onProgress: (progress) => {
        scope.postMessage({ type: 'progress', id, progress } satisfies WorkerResponse)
      },
    })
      .then((result) => finish(id, result))
      .catch(() =>
        finish(id, {
          refusal: { code: 'worker_error', message: 'The file reader stopped with an unexpected error. Nothing was stored.' },
          entries: [],
          skipped: [],
          stats: { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 },
        }),
      )
  }
}
