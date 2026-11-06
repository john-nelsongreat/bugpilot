import type { ArchiveEntry, ArchiveSkippedEntry } from './guard'
import type { ArchiveLimits } from './limits'
import { readContainerSource } from './container'
import { readLooseFiles, type IntakeSource } from './readLooseFiles'
import { createBlobSource, createMemorySource, type ByteSource } from './source'
import { yieldToMain } from '../yieldToMain'
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
  /** Names an earlier pass settled, sent as an array because it crosses a message boundary. */
  resumeProcessedNames?: readonly string[]
}

export interface CancelRequest {
  type: 'cancel'
  id: number
}

/**
 * One picked or pasted file, described so it can cross the message boundary: a `File` clones
 * without copying its bytes, and a paste travels as the bytes this tab already encoded.
 */
export interface WorkerIntakeSource {
  path: string
  size: number
  file?: Blob
  bytes?: Uint8Array
}

/**
 * The loose-file pass, run inside the worker so a folder of thousands of files never holds the
 * page's main thread while it decodes, screens and language-detects each one.
 */
export interface ReadFilesRequest {
  type: 'read-files'
  id: number
  sources: readonly WorkerIntakeSource[]
  limits: ArchiveLimits
  /** Read generated and vendored folders too. `.git` is skipped at every setting. */
  includeGenerated?: boolean
  /** Keep what was read when a budget or the user stops the pass, and mark the result partial. */
  keepPartial?: boolean
  /** Names an earlier pass settled, sent as an array because it crosses a message boundary. */
  resumeProcessedNames?: readonly string[]
}

export type WorkerRequest = ReadArchiveRequest | ReadFilesRequest | CancelRequest

export interface ProgressMessage {
  type: 'progress'
  id: number
  progress: ArchiveReadProgress
}

/**
 * One slice of a large result. A 40,000-file read produces hundreds of megabytes of decoded
 * text; delivering it as one message would make its deserialization one long main-thread task,
 * so the worker sends at most a few hundred entries at a time.
 */
export interface BatchMessage {
  type: 'batch'
  id: number
  entries?: readonly ArchiveEntry[]
  skipped?: readonly ArchiveSkippedEntry[]
}

export interface DoneMessage {
  type: 'done'
  id: number
  result: ArchiveReadResult
}

export type WorkerResponse = ProgressMessage | BatchMessage | DoneMessage

function isRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === 'read-archive' || type === 'read-files' || type === 'cancel'
}

/** The size of one result slice; chosen so each deserialization stays a short task. */
const RESULT_BATCH_ENTRIES = 500

function emptyReadResult(): ArchiveReadResult {
  return {
    refusal: null,
    entries: [],
    skipped: [],
    stats: { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 },
  }
}

/**
 * One job at a time: the reader holds the archive in memory, so a second concurrent read would
 * double the ceiling the caps exist to enforce.
 */
export function startArchiveWorker(scope: WorkerScope): void {
  const running = new Map<number, AbortController>()

  const fail = (id: number, message: string): void => {
    running.delete(id)
    scope.postMessage({
      type: 'done',
      id,
      result: { ...emptyReadResult(), refusal: { code: 'worker_error', message } },
    } satisfies WorkerResponse)
  }

  /**
   * Delivering a huge result as one message would make its deserialization one long task on the
   * page's main thread, so a large result leaves the worker in slices with a yield between them.
   */
  const finish = async (id: number, result: ArchiveReadResult): Promise<void> => {
    running.delete(id)
    if (result.entries.length > RESULT_BATCH_ENTRIES || result.skipped.length > RESULT_BATCH_ENTRIES) {
      for (let index = 0; index < result.entries.length; index += RESULT_BATCH_ENTRIES) {
        scope.postMessage({
          type: 'batch',
          id,
          entries: result.entries.slice(index, index + RESULT_BATCH_ENTRIES),
        } satisfies WorkerResponse)
        await yieldToMain()
      }
      for (let index = 0; index < result.skipped.length; index += RESULT_BATCH_ENTRIES) {
        scope.postMessage({
          type: 'batch',
          id,
          skipped: result.skipped.slice(index, index + RESULT_BATCH_ENTRIES),
        } satisfies WorkerResponse)
        await yieldToMain()
      }
      scope.postMessage({ type: 'done', id, result: { ...result, entries: [], skipped: [] } } satisfies WorkerResponse)
      return
    }
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
      fail(id, 'Another read is already running. Wait for it to finish.')
      return
    }

    if (data.type === 'read-files') {
      let sources: IntakeSource[]
      try {
        sources = data.sources.map((item) => {
          const base = { path: item.path, size: item.size }
          if (item.bytes) return { ...base, read: async () => item.bytes as Uint8Array }
          const file = item.file
          if (!file) {
            throw new Error('The file reader received a source with no bytes to read. Nothing was stored.')
          }
          return {
            ...base,
            file,
            read: async () => new Uint8Array(await file.arrayBuffer()),
          }
        })
      } catch (error) {
        fail(id, error instanceof Error ? error.message : 'The file reader received an unreadable file list. Nothing was stored.')
        return
      }
      const controller = new AbortController()
      running.set(id, controller)
      void readLooseFiles(sources, {
        limits: data.limits,
        signal: controller.signal,
        includeGenerated: data.includeGenerated === true,
        keepPartial: data.keepPartial === true,
        resumeProcessedNames: data.resumeProcessedNames ? new Set(data.resumeProcessedNames) : undefined,
        onProgress: (progress) => {
          scope.postMessage({ type: 'progress', id, progress } satisfies WorkerResponse)
        },
      })
        .then((result) => finish(id, result))
        .catch(() => fail(id, 'The file reader stopped with an unexpected error. Nothing was stored.'))
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
        fail(id, 'The file reader received an unreadable buffer. Nothing was stored.')
        return
      }
    } else {
      fail(id, 'The file reader received no file to read. Nothing was stored.')
      return
    }

    void readContainerSource(source, data.name ?? '', {
      limits: data.limits,
      includeGenerated: data.includeGenerated === true,
      keepPartial: data.keepPartial === true,
      resumeProcessedNames: data.resumeProcessedNames ? new Set(data.resumeProcessedNames) : undefined,
      signal: controller.signal,
      onProgress: (progress) => {
        scope.postMessage({ type: 'progress', id, progress } satisfies WorkerResponse)
      },
    })
      .then((result) => finish(id, result))
      .catch(() => fail(id, 'The file reader stopped with an unexpected error. Nothing was stored.'))
  }
}
