import type { ArchiveReadProgress, ArchiveReadResult } from './bounds'
import type { ArchiveLimits } from './limits'

export interface WorkerHandle {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message' | 'error', listener: (event: unknown) => void): void
  terminate(): void
}

export interface ArchiveClientReadOptions {
  limits: ArchiveLimits
  /** The name the user gave the file; the reader only uses it to check the bytes against it. */
  name?: string
  signal?: AbortSignal
  onProgress?: (progress: ArchiveReadProgress) => void
  /** Read generated and vendored folders too. `.git` is skipped at every setting. */
  includeGenerated?: boolean
  /** Keep entries read before a budget or cancel stop and mark the result partial. */
  keepPartial?: boolean
}

/** A copied buffer for tests and callers that hold bytes, or the picked file for random access. */
export type ArchiveReadInput = Uint8Array | Blob

export interface ArchiveClient {
  read(input: ArchiveReadInput, options: ArchiveClientReadOptions): Promise<ArchiveReadResult>
}

const EMPTY_STATS = {
  walkedRecords: 0,
  producedBytes: 0,
  entries: 0,
  skipped: 0,
  durationMs: 0,
  peakEntryBytes: 0,
}

function failedResult(message: string): ArchiveReadResult {
  return {
    refusal: { code: 'worker_error', message },
    entries: [],
    skipped: [],
    stats: { ...EMPTY_STATS },
  }
}

/**
 * The page owns one read at a time. The worker is terminated when the job ends, so the
 * archive bytes and every extracted string are released instead of sitting in a live worker.
 */
export function createArchiveClient(getWorker: () => WorkerHandle): ArchiveClient {
  let worker: WorkerHandle | null = null
  let busy = false
  let nextId = 1

  const release = (): void => {
    worker?.terminate()
    worker = null
    busy = false
  }

  return {
    read(input, options) {
      if (busy) {
        return Promise.resolve(failedResult('Another read is already running. Wait for it to finish.'))
      }

      busy = true
      const id = nextId
      nextId += 1
      const handle = getWorker()
      worker = handle

      return new Promise<ArchiveReadResult>((resolve) => {
        let settled = false
        const settle = (result: ArchiveReadResult): void => {
          if (settled) return
          settled = true
          options.signal?.removeEventListener('abort', onAbort)
          release()
          resolve(result)
        }
        const onAbort = (): void => {
          handle.postMessage({ type: 'cancel', id })
        }

        handle.addEventListener('message', (rawEvent) => {
          const message = (rawEvent as { data?: unknown }).data as
            | { type?: string; id?: number; progress?: ArchiveReadProgress; result?: ArchiveReadResult }
            | undefined
          if (message?.type === 'progress' && message.id === id) {
            if (message.progress) options.onProgress?.(message.progress)
            return
          }
          if (message?.type === 'done' && message.id === id) {
            settle(message.result ?? failedResult('The file reader returned no result.'))
          }
        })
        handle.addEventListener('error', () => {
          settle(failedResult('The file reader stopped unexpectedly. Nothing was stored.'))
        })

        if (options.signal?.aborted) {
          settle({
            refusal: { code: 'cancelled', message: 'You cancelled the upload, so nothing was read.' },
            entries: [],
            skipped: [],
            stats: { ...EMPTY_STATS },
          })
          return
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })

        const body =
          input instanceof Blob
            ? { blob: input }
            : { bytes: input.buffer as ArrayBuffer }
        handle.postMessage(
          {
            type: 'read-archive',
            id,
            ...body,
            name: options.name ?? '',
            limits: options.limits,
            includeGenerated: options.includeGenerated === true,
            keepPartial: options.keepPartial === true,
          },
          input instanceof Blob ? [] : [input.buffer as ArrayBuffer],
        )
      })
    },
  }
}
