import type { ArchiveReadProgress, ArchiveReadResult } from './bounds'
import type { ArchiveEntry, ArchiveSkippedEntry } from './guard'
import type { ArchiveLimits } from './limits'
import type { WorkerIntakeSource } from './workerProtocol'
import { yieldToMain } from '../yieldToMain'

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
  /** Names an earlier pass settled; the reader walks past them without reading. */
  resumeProcessedNames?: ReadonlySet<string>
}

/** A copied buffer for tests and callers that hold bytes, or the picked file for random access. */
export type ArchiveReadInput = Uint8Array | Blob

export interface ArchiveClient {
  read(input: ArchiveReadInput, options: ArchiveClientReadOptions): Promise<ArchiveReadResult>
  /** The loose-file pass, run inside the worker so decoding never holds the page. */
  readFiles(sources: readonly WorkerIntakeSource[], options: ArchiveClientReadOptions): Promise<ArchiveReadResult>
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

function cancelledResult(): ArchiveReadResult {
  return {
    refusal: { code: 'cancelled', message: 'You cancelled the upload, so nothing was read.' },
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

  function runJob(
    request: Record<string, unknown>,
    transfer: Transferable[],
    options: ArchiveClientReadOptions,
  ): Promise<ArchiveReadResult> {
    const handle = worker as WorkerHandle
    const id = request.id as number
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
        try {
          handle.postMessage({ type: 'cancel', id })
        } catch {
          settle(cancelledResult())
        }
      }

      // Large results arrive as batches; the accumulation yields to the main thread between
      // them so a 40,000-file read cannot pin the page while it receives its own results.
      const entries: ArchiveEntry[] = []
      const skipped: ArchiveSkippedEntry[] = []
      let sawBatch = false
      let doneResult: ArchiveReadResult | null = null
      let draining = false
      const pending: { entries: readonly ArchiveEntry[]; skipped: readonly ArchiveSkippedEntry[] }[] = []

      const drain = (): Promise<void> => {
        if (draining) return Promise.resolve()
        draining = true
        const step = (): Promise<void> => {
          if (pending.length === 0) {
            draining = false
            if (doneResult !== null) {
              settle(
                sawBatch ? { ...doneResult, entries, skipped } : doneResult,
              )
            }
            return Promise.resolve()
          }
          const batch = pending.shift() as { entries: readonly ArchiveEntry[]; skipped: readonly ArchiveSkippedEntry[] }
          entries.push(...batch.entries)
          skipped.push(...batch.skipped)
          return yieldToMain().then(step)
        }
        return step()
      }

      handle.addEventListener('message', (rawEvent) => {
        const message = (rawEvent as { data?: unknown }).data as
          | {
              type?: string
              id?: number
              progress?: ArchiveReadProgress
              entries?: readonly ArchiveEntry[]
              skipped?: readonly ArchiveSkippedEntry[]
              result?: ArchiveReadResult
            }
          | undefined
        if (message?.type === 'progress' && message.id === id) {
          if (message.progress) options.onProgress?.(message.progress)
          return
        }
        if (message?.type === 'batch' && message.id === id) {
          sawBatch = true
          pending.push({ entries: message.entries ?? [], skipped: message.skipped ?? [] })
          void drain()
          return
        }
        if (message?.type === 'done' && message.id === id) {
          doneResult = message.result ?? failedResult('The file reader returned no result.')
          void drain()
        }
      })
      handle.addEventListener('error', () => {
        settle(failedResult('The file reader stopped unexpectedly. Nothing was stored.'))
      })

      if (options.signal?.aborted) {
        settle(cancelledResult())
        return
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        handle.postMessage(request, transfer)
      } catch (error) {
        settle(
          failedResult(
            error instanceof Error ? error.message : 'The file reader rejected the request.',
          ),
        )
      }
    })
  }

  return {
    read(input, options) {
      if (busy) {
        return Promise.resolve(failedResult('Another read is already running. Wait for it to finish.'))
      }

      busy = true
      const id = nextId
      nextId += 1
      worker = getWorker()

      const body =
        input instanceof Blob
          ? { blob: input }
          : { bytes: input.buffer as ArrayBuffer }
      return runJob(
        {
          type: 'read-archive',
          id,
          ...body,
          name: options.name ?? '',
          limits: options.limits,
          includeGenerated: options.includeGenerated === true,
          keepPartial: options.keepPartial === true,
          resumeProcessedNames: options.resumeProcessedNames ? [...options.resumeProcessedNames] : undefined,
        },
        input instanceof Blob ? [] : [input.buffer as ArrayBuffer],
        options,
      )
    },

    readFiles(sources, options) {
      if (busy) {
        return Promise.resolve(failedResult('Another read is already running. Wait for it to finish.'))
      }

      busy = true
      const id = nextId
      nextId += 1
      worker = getWorker()

      const transfer: Transferable[] = []
      for (const source of sources) {
        if (source.bytes?.buffer !== undefined) transfer.push(source.bytes.buffer)
      }
      return runJob(
        {
          type: 'read-files',
          id,
          sources: [...sources],
          limits: options.limits,
          includeGenerated: options.includeGenerated === true,
          keepPartial: options.keepPartial === true,
          resumeProcessedNames: options.resumeProcessedNames ? [...options.resumeProcessedNames] : undefined,
        },
        transfer,
        options,
      )
    },
  }
}
