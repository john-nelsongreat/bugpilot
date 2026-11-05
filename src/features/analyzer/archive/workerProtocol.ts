import type { ArchiveLimits } from './limits'
import { readContainerSource } from './container'
import { createBlobSource, createMemorySource, type ByteSource } from './source'
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
  /** A copied buffer, kept for callers and tests that already hold the bytes. */
  bytes?: ArrayBuffer
  /**
   * The picked file itself. A Blob is structured-cloned without copying its bytes in the page,
   * and the zip reader seeks inside it, so a large archive never becomes one page-sized buffer.
   */
  blob?: Blob
  /**
   * The name the user gave the file. It is a claim the reader checks against the bytes, never the
   * decision, and a request without one is simply a file whose name says nothing.
   */
  name?: string
  limits: ArchiveLimits
  /** Read generated and vendored folders too. `.git` is skipped at every setting. */
  includeGenerated?: boolean
  /** Keep what was read when a budget or the user stops the pass, and mark the result partial. */
  keepPartial?: boolean
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
    let source: ByteSource
    if (data.blob) {
      source = createBlobSource(data.blob)
    } else if (data.bytes) {
      try {
        source = createMemorySource(new Uint8Array(data.bytes))
      } catch {
        finish(id, {
          refusal: { code: 'worker_error', message: 'The file reader received an unreadable buffer. Nothing was stored.' },
          entries: [],
          skipped: [],
          stats: { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 },
        })
        return
      }
    } else {
      finish(id, {
        refusal: { code: 'worker_error', message: 'The file reader received no file to read. Nothing was stored.' },
        entries: [],
        skipped: [],
        stats: { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 },
      })
      return
    }

    void readContainerSource(source, data.name ?? '', {
      limits: data.limits,
      includeGenerated: data.includeGenerated === true,
      keepPartial: data.keepPartial === true,
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
