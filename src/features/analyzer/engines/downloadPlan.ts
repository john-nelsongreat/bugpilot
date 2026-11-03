import type { SourceLanguage } from '../archive/classify'
import { grammarFor, LANGUAGE_ENGINES } from './registry'

export interface EngineFileEntry {
  path: string
  kind: 'engine-worker' | 'engine-client' | 'tree-sitter-core' | 'grammar' | 'ruff' | 'other'
  language: string | null
  rawBytes: number
  gzipBytes: number
}

export interface EngineManifest {
  schemaVersion: number
  files: EngineFileEntry[]
}

const MANIFEST_URL = `${import.meta.env.BASE_URL ?? '/'}assets/engines/manifest.json`

type FetchLike = (input: string, init?: { cache?: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

let manifestPromise: Promise<EngineManifest | null> | null = null

/**
 * The sizes the page quotes before anything heavy loads come from the build, not from a
 * table someone maintains by hand. If the manifest is missing the page still works; it just
 * cannot promise a number.
 */
export function loadEngineManifest(fetchImpl?: FetchLike): Promise<EngineManifest | null> {
  manifestPromise ??= (async () => {
    const doFetch = fetchImpl ?? (fetch as unknown as FetchLike)
    try {
      const response = await doFetch(MANIFEST_URL, { cache: 'no-store' })
      if (!response.ok) return null
      const parsed = (await response.json()) as Partial<EngineManifest>
      if (!parsed || !Array.isArray(parsed.files)) return null
      const files = parsed.files.filter(
        (entry): entry is EngineFileEntry =>
          !!entry && typeof entry.path === 'string' && typeof entry.rawBytes === 'number',
      )
      return { schemaVersion: parsed.schemaVersion ?? 1, files }
    } catch {
      return null
    }
  })()
  return manifestPromise
}

/** Test seam: forget the cached manifest between cases. */
export function resetEngineManifestCache(): void {
  manifestPromise = null
}

export interface EngineDownloadPlan {
  files: EngineFileEntry[]
  gzipBytes: number
  rawBytes: number
  /** Languages in the upload that no shipped grammar covers. */
  uncovered: SourceLanguage[]
  needsRuff: boolean
  needsTreeSitter: boolean
}

function pick(manifest: EngineManifest, paths: (entry: EngineFileEntry) => boolean): EngineFileEntry[] {
  return manifest.files.filter(paths)
}

/**
 * Exactly what this upload would download, sized from the build manifest. The page shows it
 * and offers Cancel before a single byte of engine data moves.
 */
export function planEngineDownload(
  manifest: EngineManifest | null,
  languages: readonly SourceLanguage[],
): EngineDownloadPlan {
  const grammars = new Set<string>()
  const uncovered: SourceLanguage[] = []
  let needsRuff = false
  let needsTreeSitter = false

  for (const language of languages) {
    if (!LANGUAGE_ENGINES[language]) {
      uncovered.push(language)
      continue
    }
    const grammar = grammarFor(language)
    if (grammar) {
      grammars.add(grammar)
      needsTreeSitter = true
    }
    if (LANGUAGE_ENGINES[language]?.engines.includes('ruff')) needsRuff = true
  }

  if (!manifest) {
    return { files: [], gzipBytes: 0, rawBytes: 0, uncovered, needsRuff, needsTreeSitter }
  }

  // An upload whose languages none of the engines reads would start a worker that has nothing
  // to load, so the plan is empty and the page quotes a download of zero bytes.
  if (!needsTreeSitter && !needsRuff) {
    return { files: [], gzipBytes: 0, rawBytes: 0, uncovered, needsRuff: false, needsTreeSitter: false }
  }

  const files = [
    // The worker and the small loader that starts it are the two scripts the CSP allows to
    // compile WebAssembly, and a deep run always fetches both.
    ...pick(manifest, (entry) => entry.kind === 'engine-worker' || entry.kind === 'engine-client'),
    ...(needsTreeSitter ? pick(manifest, (entry) => entry.kind === 'tree-sitter-core') : []),
    ...(needsTreeSitter
      ? pick(manifest, (entry) => entry.kind === 'grammar' && !!entry.language && grammars.has(entry.language))
      : []),
    ...(needsRuff ? pick(manifest, (entry) => entry.kind === 'ruff') : []),
  ]

  return {
    files,
    gzipBytes: files.reduce((total, entry) => total + entry.gzipBytes, 0),
    rawBytes: files.reduce((total, entry) => total + entry.rawBytes, 0),
    uncovered,
    needsRuff,
    needsTreeSitter,
  }
}

export function formatEngineBytes(value: number): string {
  if (value < 1024) return `${value} B`
  const kb = value / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KiB`
  return `${(kb / 1024).toFixed(1)} MiB`
}
