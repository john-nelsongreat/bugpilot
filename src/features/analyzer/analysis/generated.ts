import type { ArchiveEntry, ArchiveSkippedEntry } from '../archive/guard'
import { IGNORED_FOLDER_SEGMENTS } from '../archive/limits'
import { archiveReasonMessage } from '../archive/reasons'

/**
 * Files a project generated rather than wrote. They are skipped by default because a minified
 * bundle or a lockfile produces noise instead of findings, and because a vendored tree can fill
 * the entry budget before the user's own code is reached. The checkbox in the page turns every
 * heuristic off except `.git`, which is never read: its objects are compressed history, not files.
 */

/** Lines checked for a generated-code marker. Markers normally sit in the header. */
export const GENERATED_MARKER_LINES = 5

/** Lines checked for the very long line a minified bundle carries. */
export const GENERATED_LONG_LINE_SCAN_LINES = 20

/** A line this long is a bundle, not source a person wrote by hand. */
export const GENERATED_LONG_LINE_CHARS = 20_000

export const LOCKFILES: readonly string[] = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'cargo.lock',
  'go.sum',
  'composer.lock',
  'gemfile.lock',
]

const GENERATED_MARKER = /code generated|@generated|do not edit|auto-generated/i
const GIT_SEGMENT = '.git'

function basenameLower(name: string): string {
  const parts = name.split('/')
  return (parts[parts.length - 1] ?? name).toLowerCase()
}

function folderDetail(name: string, includeGenerated: boolean): string | null {
  const segments = name.split('/')
  if (segments.includes(GIT_SEGMENT)) return GIT_SEGMENT
  if (includeGenerated) return null
  return segments.find((segment) => IGNORED_FOLDER_SEGMENTS.includes(segment)) ?? null
}

function heuristicDetail(name: string, text: string | null): string | null {
  const base = basenameLower(name)
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 ? base.slice(dot + 1) : ''

  if (base.endsWith('.min.js') || base.endsWith('.min.css')) {
    return 'the name ends in .min.js or .min.css, which is a minified build'
  }
  if (extension === 'map') return 'the name ends in .map, which is a source map'
  if (LOCKFILES.includes(base)) return 'the name is a lockfile'

  if (text !== null) {
    const lines = text.split('\n', GENERATED_LONG_LINE_SCAN_LINES)
    if (lines.slice(0, GENERATED_MARKER_LINES).some((line) => GENERATED_MARKER.test(line))) {
      return 'the first lines carry a generated-code marker'
    }
    if (lines.some((line) => line.length > GENERATED_LONG_LINE_CHARS)) {
      return 'it contains a very long single line, which is how a minified bundle looks'
    }
  }
  return null
}

export interface GeneratedDecision {
  /** The sentence fragment the coverage message adds after the file name. */
  detail: string
}

function classify(name: string, text: string | null, includeGenerated: boolean): GeneratedDecision | null {
  const folder = folderDetail(name, includeGenerated)
  if (folder !== null) {
    return { detail: `it is inside ${folder}, a generated or vendored folder` }
  }
  if (includeGenerated) return null
  const heuristic = heuristicDetail(name, text)
  return heuristic === null ? null : { detail: heuristic }
}

/** The default decision for one file, with every heuristic and folder on. */
export function generatedSkipReason(name: string, text: string | null = null): GeneratedDecision | null {
  return classify(name, text, false)
}

/**
 * The single place the default skip is applied. `includeGenerated` keeps every entry except ones
 * inside `.git`; the size ceilings still apply to those entries in the reader, unchanged.
 */
export function splitGeneratedEntries(
  entries: readonly ArchiveEntry[],
  includeGenerated: boolean,
): { kept: readonly ArchiveEntry[]; skipped: ArchiveSkippedEntry[] } {
  const kept: ArchiveEntry[] = []
  const skipped: ArchiveSkippedEntry[] = []
  for (const entry of entries) {
    const decision = classify(entry.name, entry.text, includeGenerated)
    if (decision === null) {
      kept.push(entry)
      continue
    }
    skipped.push({
      name: entry.name,
      code: 'generated_file',
      message: archiveReasonMessage('generated_file', entry.name, decision.detail),
    })
  }
  // A run that sets nothing aside hands back the very array it was given, so the page can still
  // tell by reference that a deep pass is looking at the same text the first pass read.
  return skipped.length === 0 ? { kept: entries, skipped } : { kept, skipped }
}
