import { Language, Parser, Query } from 'web-tree-sitter'
import { GRAMMAR_URLS, TREE_SITTER_CORE_URL, type GrammarId } from './assets'

export { Language, Parser, Query }
export type { GrammarId }

const DOWNLOAD_TIMEOUT_MS = 30_000

export type DownloadFailure = 'too-large' | 'timeout' | 'failed' | 'cancelled'

export class DownloadError extends Error {
  code: DownloadFailure

  constructor(code: DownloadFailure, message: string) {
    super(message)
    this.name = 'DownloadError'
    this.code = code
  }
}

/**
 * Fetches one engine binary with a hard byte ceiling and its own abort signal. Grammars
 * range from 19 KiB to 5.3 MB, so the size has to be watched while reading: an oversized
 * asset must not be able to fill the worker heap before the limit applies.
 */
export async function fetchCapped(
  url: string,
  maxBytes: number,
  outerSignal?: AbortSignal | null,
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DownloadError('timeout', `Downloading ${url} timed out after ${DOWNLOAD_TIMEOUT_MS} ms.`)),
    DOWNLOAD_TIMEOUT_MS,
  )
  const onOuterAbort = () => controller.abort(new DownloadError('cancelled', 'Cancelled while the engine was downloading.'))
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new DownloadError('failed', `The engine file ${url} could not be fetched (HTTP ${response.status}).`)
    }
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > maxBytes) {
      throw new DownloadError('too-large', `${url} declares ${declared} bytes, over the ${maxBytes} byte engine limit.`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      const whole = new Uint8Array(await response.arrayBuffer())
      if (whole.byteLength > maxBytes) {
        throw new DownloadError('too-large', `${url} is ${whole.byteLength} bytes, over the ${maxBytes} byte engine limit.`)
      }
      return whole
    }

    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      received += next.value.byteLength
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new DownloadError('too-large', `${url} streamed past the ${maxBytes} byte engine limit after ${received} bytes.`)
      }
      chunks.push(next.value)
      // Yield between network chunks so a cancel can be answered mid-download.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const buffer = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }
    return buffer
  } catch (error) {
    if (error instanceof DownloadError) throw error
    const reason = controller.signal.reason
    if (reason instanceof DownloadError) throw reason
    throw new DownloadError(
      'failed',
      `${url} could not be fetched: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
  }
}

let corePromise: Promise<void> | null = null

/** One `Parser.init` per worker; later calls share the same promise. */
export function initTreeSitter(): Promise<void> {
  corePromise ??= Parser.init({ locateFile: () => TREE_SITTER_CORE_URL }).then(() => undefined)
  return corePromise
}

const grammarCache = new Map<GrammarId, Promise<Language>>()

/** Loads each grammar at most once per worker and keeps the compiled `Language`. */
export function loadGrammar(
  grammar: GrammarId,
  maxBytes: number,
  signal?: AbortSignal | null,
  onDownloading?: (url: string) => void,
): Promise<Language> {
  const existing = grammarCache.get(grammar)
  if (existing) return existing

  const url = GRAMMAR_URLS[grammar]
  onDownloading?.(url)
  const promise = initTreeSitter()
    .then(() => fetchCapped(url, maxBytes, signal))
    .then((bytes) => Language.load(bytes))
    .catch((error: unknown) => {
      // A failed load must not stay cached: a later file of the same language may
      // succeed once the network or the budget allows it.
      grammarCache.delete(grammar)
      throw error
    })

  grammarCache.set(grammar, promise)
  return promise
}

export function grammarUrls(): string[] {
  return Object.values(GRAMMAR_URLS)
}
