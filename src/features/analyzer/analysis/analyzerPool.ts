import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerClient, AnalyzerRunResult } from './analyzerClient'
import type { FileAnalysis } from './engine'

type PoolClientFactory = () => AnalyzerClient & { dispose?: () => void }

/**
 * One pattern-rules worker per spare core, up to four: past that the decoders and the page
 * itself fight for the same cores and everything slows down together. One core means the
 * old single-worker behaviour exactly.
 */
export function poolSizeFor(hardwareConcurrency: number | undefined): number {
  const cores = typeof hardwareConcurrency === 'number' && hardwareConcurrency >= 1 ? Math.floor(hardwareConcurrency) : 2
  return Math.max(1, Math.min(cores - 1, 4))
}

/**
 * Files handed to one worker per job. Small enough that a slow file cannot hold up the
 * queue behind an oversized batch, large enough that the message overhead stays trivial.
 */
const POOL_CHUNK_FILES = 50

interface PoolChunk {
  entries: ArchiveEntry[]
  index: number
}

/**
 * Runs the pattern rules across a fixed set of analyzer workers. Chunks are dispatched to
 * the first free worker, so no worker ever has two jobs queued, and results are reassembled
 * in input order no matter which worker finished first — the report is identical to a
 * single-worker run.
 */
export function createAnalyzerPool(
  createClient: PoolClientFactory,
  size: number,
  chunkFiles: number = POOL_CHUNK_FILES,
): AnalyzerClient {
  return {
    analyze(entries, options = {}) {
      const signal = options.signal
      if (entries.length === 0 || signal?.aborted) {
        return Promise.resolve<AnalyzerRunResult>({ files: [], cancelled: signal?.aborted === true, error: null })
      }

      const step = Math.max(1, chunkFiles)
      const chunks: PoolChunk[] = []
      for (let at = 0; at < entries.length; at += step) {
        chunks.push({ entries: entries.slice(at, at + step), index: chunks.length })
      }

      // An internal signal stops the in-flight workers when the caller cancels or when one
      // worker fails; callers only ever see the original signal's cancel.
      const internal = new AbortController()
      const forwardAbort = () => internal.abort()
      signal?.addEventListener('abort', forwardAbort, { once: true })

      const workerCount = Math.min(Math.max(1, size), chunks.length)
      const workers = Array.from({ length: workerCount }, () => createClient())
      const results: Array<FileAnalysis[] | null> = new Array(chunks.length).fill(null)

      let dispatched = 0
      let sawCancel = false
      let failure: string | null = null
      let filesDone = 0
      let findings = 0
      const chunkDone = new Map<number, number>()
      const chunkFindings = new Map<number, number>()

      options.onProgress?.({ phase: 'rules', filesDone: 0, filesTotal: entries.length, findings: 0 })

      const runChunk = async (worker: AnalyzerClient, chunk: PoolChunk): Promise<void> => {
        const result = await worker.analyze(chunk.entries, {
          limits: options.limits,
          signal: internal.signal,
          onProgress: (progress) => {
            const previousDone = chunkDone.get(chunk.index) ?? 0
            const previousFindings = chunkFindings.get(chunk.index) ?? 0
            chunkDone.set(chunk.index, progress.filesDone)
            chunkFindings.set(chunk.index, progress.findings)
            filesDone += progress.filesDone - previousDone
            findings += progress.findings - previousFindings
            options.onProgress?.({ phase: 'rules', filesDone, filesTotal: entries.length, findings })
          },
        })
        if (result.error && failure === null) {
          failure = result.error
          internal.abort()
        }
        if (result.cancelled) sawCancel = true
        if (result.files.length > 0) results[chunk.index] = result.files
      }

      const runWorker = async (worker: AnalyzerClient): Promise<void> => {
        while (dispatched < chunks.length) {
          if (internal.signal.aborted || failure !== null) return
          const chunk = chunks[dispatched]
          dispatched += 1
          await runChunk(worker, chunk)
        }
      }

      const settle = async (): Promise<AnalyzerRunResult> => {
        await Promise.all(workers.map((worker) => runWorker(worker)))
        if (failure !== null) return { files: [], cancelled: false, error: failure }
        if (sawCancel || internal.signal.aborted) return { files: [], cancelled: true, error: null }
        const files: FileAnalysis[] = []
        for (const part of results) {
          if (part === null) return { files: [], cancelled: true, error: null }
          files.push(...part)
        }
        return { files, cancelled: false, error: null }
      }

      return settle().finally(() => {
        signal?.removeEventListener('abort', forwardAbort)
        internal.abort()
        for (const worker of workers) worker.dispose?.()
      })
    },
  }
}
