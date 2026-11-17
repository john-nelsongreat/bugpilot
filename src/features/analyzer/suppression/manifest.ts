/**
 * The archive's own ignore list: one file at the archive root, `.bugpilotignore`, holding one path
 * pattern per line. This module turns those bytes into a decision about a name. It reads nothing and
 * writes nothing — the session hands it the manifest text it already has and the names it is about to
 * analyse — so the whole subset is testable without a reader, a worker or a browser.
 *
 * Two rules hold this file together.
 *
 * It is a leaf. `archive/` supplies paths, reasons and ceilings and `analysis/` holds the session, and
 * both import the decision made here; importing either of them back would run the module graph through
 * the thing that decides what gets skipped. So nothing here comes from `analysis/` or `archive/`, and the
 * one string `archive/reasons.ts` prints in its skip message is inlined there rather than imported from
 * here.
 *
 * No pattern is ever compiled into a `RegExp`. These bytes arrive from inside the upload, so they are
 * hostile input, and a glob turned into a regex is how a small file stops a browser tab. Matching walks
 * the pattern and the path with two indices instead. The syntax subset is what makes that bound
 * structural rather than hopeful: a `**` is legal only as a whole path segment and only once per pattern,
 * so the matcher never explores an exponential number of splits.
 */

export interface IgnorePattern {
  /** The line as written, trimmed. */
  readonly raw: string
  /** Path split on '/'; empty segments removed. [] for an invalid or trivial pattern. */
  readonly segments: readonly string[]
  /** True when the line ended with '/', meaning "this folder and everything under it". */
  readonly folderOnly: boolean
  /** True when the line uses syntax this subset refuses; such patterns never match. */
  readonly invalid: boolean
}

export interface IgnoreManifest {
  readonly patterns: readonly IgnorePattern[]
  readonly invalidCount: number
  /** How many non-blank, non-comment lines the manifest had. */
  readonly ruleCount: number
}

export interface ManifestMatch {
  readonly ignored: boolean
  /** The `raw` line that matched, or null when nothing matched. */
  readonly pattern: string | null
}

export const IGNORE_MANIFEST_NAME = '.bugpilotignore'

const SEPARATOR = '/'
const COMMENT = '#'
const ESCAPE = '\\'
const NEGATION = '!'
const CLASS_OPEN = '['
const CLASS_CLOSE = ']'
const STAR = '*'
const DOUBLE_STAR = '**'
const BOM_CODE = 0xfeff

const EMPTY_MANIFEST: IgnoreManifest = { patterns: [], invalidCount: 0, ruleCount: 0 }

/**
 * `*` matches any run of characters inside one segment and never a `/`, which is why the text compared
 * here is already a single segment. The scan keeps one index into the pattern and one into the text and,
 * on a mismatch, rewinds to the last `*` it saw and hands that star one more character — so a segment
 * pair costs a few passes over its own length, whatever order its stars and literals come in.
 */
function segmentMatches(pattern: string, text: string): boolean {
  let p = 0
  let t = 0
  let starAt = -1
  let resumeAt = 0
  while (t < text.length) {
    const left = pattern[p]
    if (left === text[t]) {
      p += 1
      t += 1
      continue
    }
    if (left === STAR) {
      starAt = p
      resumeAt = t
      p += 1
      continue
    }
    if (starAt === -1) return false
    p = starAt + 1
    resumeAt += 1
    t = resumeAt
  }
  while (pattern[p] === STAR) p += 1
  return p === pattern.length
}

function splitPath(path: string): string[] {
  return path.split(SEPARATOR).filter((segment) => segment.length > 0)
}

function parsePattern(raw: string): IgnorePattern {
  const folderOnly = raw.endsWith(SEPARATOR)
  const body = folderOnly ? raw.slice(0, -1) : raw
  const segments = splitPath(body)
  const doubleStars = segments.filter((segment) => segment === DOUBLE_STAR).length
  const invalid =
    raw.startsWith(NEGATION) ||
    raw.includes(CLASS_OPEN) ||
    raw.includes(CLASS_CLOSE) ||
    raw.includes(ESCAPE) ||
    doubleStars > 1
  return { raw, segments: invalid ? [] : segments, folderOnly, invalid }
}

function matchesSuffix(suffix: readonly string[], path: readonly string[], at: number): boolean {
  for (let i = 0; i < suffix.length; i += 1) {
    if (!segmentMatches(suffix[i] ?? '', path[at + i] ?? '')) return false
  }
  return true
}

/**
 * Can this pattern's segments start at `start` in `path`? `consumeAll` is the difference between a file
 * pattern and a folder pattern: a folder match has to leave something under it, so its run ends before
 * the last segment rather than on it.
 *
 * The geometry is settled before any character is compared, so a pattern that cannot fit is rejected in
 * one step. A `**` leaves its suffix free to sit anywhere between the end of the prefix and the end
 * limit, which is one linear scan over the path — one star, one pass.
 */
function matchFrom(
  patterns: readonly string[],
  path: readonly string[],
  start: number,
  consumeAll: boolean,
): boolean {
  const wildcard = patterns.indexOf(DOUBLE_STAR)
  if (wildcard === -1) {
    const end = start + patterns.length
    if (end > path.length) return false
    if (consumeAll ? end !== path.length : end >= path.length) return false
    for (let i = 0; i < patterns.length; i += 1) {
      if (!segmentMatches(patterns[i] ?? '', path[start + i] ?? '')) return false
    }
    return true
  }

  const prefix = patterns.slice(0, wildcard)
  const suffix = patterns.slice(wildcard + 1)
  for (let i = 0; i < prefix.length; i += 1) {
    if (!segmentMatches(prefix[i] ?? '', path[start + i] ?? '')) return false
  }
  const from = start + prefix.length
  const lastStart = (consumeAll ? path.length : path.length - 1) - suffix.length
  if (lastStart < from) return false
  if (consumeAll) return matchesSuffix(suffix, path, lastStart)
  for (let at = lastStart; at >= from; at -= 1) {
    if (matchesSuffix(suffix, path, at)) return true
  }
  return false
}

function patternMatches(pattern: IgnorePattern, path: readonly string[]): boolean {
  // An invalid line refuses to match, and a line naming nothing (`/`) is trivial rather than a rule over
  // the whole tree: with no segments to compare against it would match every path it was offered.
  if (pattern.invalid || pattern.segments.length === 0) return false
  if (pattern.folderOnly) {
    for (let start = 0; start < path.length; start += 1) {
      if (matchFrom(pattern.segments, path, start, false)) return true
    }
    return false
  }
  // gitignore's anchoring rule: a line holding a separator is a path from the archive root, one without
  // it is a name that may appear at any depth.
  if (pattern.raw.includes(SEPARATOR)) return matchFrom(pattern.segments, path, 0, true)
  for (let start = 0; start < path.length; start += 1) {
    if (matchFrom(pattern.segments, path, start, true)) return true
  }
  return false
}

/**
 * Read the manifest bytes. A null or empty text is no manifest at all, so an archive without the file
 * keeps the behaviour it had before this feature existed.
 *
 * A byte-order mark and `\r` are tolerated because this file is written by editors and by tools on
 * Windows, not by this app. Blank lines and `#` comments are not counted as rules; every other line is
 * one pattern, and an unsupported one is kept in the list so its line still counts, but marked invalid so
 * it can never match.
 */
export function parseIgnoreManifest(text: string | null): IgnoreManifest {
  if (text === null || text.length === 0) return EMPTY_MANIFEST
  const body = text.charCodeAt(0) === BOM_CODE ? text.slice(1) : text
  const patterns: IgnorePattern[] = []
  let invalidCount = 0
  for (const line of body.split('\n')) {
    const raw = line.trim()
    if (raw.length === 0 || raw.startsWith(COMMENT)) continue
    const pattern = parsePattern(raw)
    if (pattern.invalid) invalidCount += 1
    patterns.push(pattern)
  }
  return { patterns, invalidCount, ruleCount: patterns.length }
}

/**
 * The first pattern that matches, with its line as written so the report can name it. Nothing
 * un-ignores a file: the order of the file is the order of precedence, and an invalid line is skipped
 * rather than honoured.
 */
export function matchIgnoreManifest(path: string, manifest: IgnoreManifest): ManifestMatch {
  const segments = splitPath(path)
  for (const pattern of manifest.patterns) {
    if (patternMatches(pattern, segments)) return { ignored: true, pattern: pattern.raw }
  }
  return { ignored: false, pattern: null }
}
