/**
 * Inline waivers: a comment in an analysed file that names rule ids whose findings on one line
 * BugPilot should drop. `.bugpilotignore` in this folder decides which files are read; this decides
 * which matches inside a read file are kept, and both are disclosed rather than honoured quietly.
 *
 * Two constraints come from the brief, not from here. The pass has one call site, because the session
 * builds coverage, the report and the retained texts from one `analyses` array; and a waiver shortens
 * a file's `findings` without removing its analysis, because coverage asks whether a file has an
 * analysis at all, not whether it has findings — dropping the entry would report a tier as never run
 * on a file whose rules ran. Objects are new and nothing is spliced, since those arrays belong to
 * whatever produced them.
 *
 * Content cannot silence a secret or a sensitive finding. A manifest is a choice recorded in the
 * archive; a pragma is text inside the file being reported on, and its author is usually not the
 * reader. An id `rules/sensitiveFiles.ts` calls sensitive, or one carrying the content-derived secret
 * prefix, is refused: the finding stays, and the attempt is counted and disclosed through that
 * module's predicate, so the two lists cannot drift apart.
 *
 * The rest fails open, and only that way: a pragma needs a comment opener before the token on its
 * line; ids match exactly, and `*` is not supported and must never become a waiver; an id matching
 * nothing is a silent no-op; a name with no entry waives nothing, with no normalisation, so
 * `./`-prefixed entries stay the open defect they are. The loop walks `analyses`, not the archive,
 * and takes a file's text only when it has findings, and no pattern is built from upload bytes.
 */

import type { FileAnalysis } from '../analysis/engine'
import type { AnalyzerFinding } from '../types'
import { isSensitiveRuleId } from '../rules/sensitiveFiles'

export const WAIVER_TOKEN = 'bugpilot:ignore'

/** The part of an entry this pass needs: its name, and the text read under it. */
export interface WaiverSource {
  readonly name: string
  readonly text: string
}

export interface InlineWaiverResult {
  /** One entry per input analysis, in order; a changed file is a new object. */
  readonly analyses: FileAnalysis[]
  /** Findings removed because a pragma named their rule on their line or the line above. */
  readonly waived: number
  /** Pragma ids in the secret or sensitive family, which stay reported. */
  readonly refused: number
  /** The sentence for the report's limitations, or null when there is nothing to say. */
  readonly summary: string | null
}

interface Pragmas {
  /** Waivable ids each pragma line names, keyed by 1-based line number. */
  readonly byLine: Map<number, readonly string[]>
  readonly refused: number
}

const COMMENT_OPENERS = ['//', '#', '/*', '<!--', '--', '%']
const ID_SEPARATOR = /[,\s]+/
const SECRET_RULE_PREFIX = 'bugpilot/secret/'
const NEWLINE = '\n'

function isRefusedRuleId(ruleId: string): boolean {
  return isSensitiveRuleId(ruleId) || ruleId.startsWith(SECRET_RULE_PREFIX)
}

/**
 * The ids a pragma names, or nothing when the token is not inside a comment. `line` is one source
 * line and `tokenAt` is the index of the token within it.
 */
function pragmaIds(line: string, tokenAt: number): string[] {
  const before = line.slice(0, tokenAt)
  if (!COMMENT_OPENERS.some((opener) => before.includes(opener))) return []
  return line
    .slice(tokenAt + WAIVER_TOKEN.length)
    .split(ID_SEPARATOR)
    .filter((id) => id.length > 0)
}

/** Every pragma in one file, refusals counted on the way, in a single forward pass. */
function scanPragmas(text: string): Pragmas {
  const byLine = new Map<number, readonly string[]>()
  let refused = 0
  let start = 0
  let line = 1
  while (start <= text.length) {
    const next = text.indexOf(NEWLINE, start)
    const limit = next === -1 ? text.length : next
    const tokenAt = text.indexOf(WAIVER_TOKEN, start)
    if (tokenAt !== -1 && tokenAt < limit) {
      const waivable: string[] = []
      for (const id of pragmaIds(text.slice(start, limit), tokenAt - start)) {
        if (isRefusedRuleId(id)) refused += 1
        else waivable.push(id)
      }
      if (waivable.length > 0) byLine.set(line, waivable)
    }
    if (next === -1) break
    start = next + 1
    line += 1
  }
  return { byLine, refused }
}

/** A pragma covers its own line and the line directly below it — no block ranges, no whole-file scope. */
function isWaived(finding: AnalyzerFinding, pragmas: Pragmas): boolean {
  const line = finding.range.startLine
  if (pragmas.byLine.get(line)?.includes(finding.ruleId) === true) return true
  return pragmas.byLine.get(line - 1)?.includes(finding.ruleId) === true
}

function waiverSummary(waived: number, refused: number): string | null {
  if (waived === 0 && refused === 0) return null
  const sentences: string[] = []
  if (waived > 0) {
    sentences.push(
      `${waived} ${waived === 1 ? 'finding was' : 'findings were'} waived by an inline ${WAIVER_TOKEN} comment in the analysed source.`,
    )
  }
  if (refused > 0) {
    sentences.push(
      `${refused} ${refused === 1 ? 'waiver was' : 'waivers were'} refused: a secret or sensitive finding cannot be silenced by a comment in the file it reports.`,
    )
  }
  return sentences.join(' ')
}

/**
 * Drop the findings an inline pragma names, keep every analysis that was kept to, and say what
 * happened. An entry whose last finding is waived comes back with `findings: []` and its `rulesRan`,
 * `notes` and `stoppedEarly` as they were, so coverage still tells the truth about which tiers ran.
 */
export function applyInlineWaivers(
  analyses: readonly FileAnalysis[],
  sources: readonly WaiverSource[],
): InlineWaiverResult {
  const textByName = new Map<string, string>()
  for (const source of sources) textByName.set(source.name, source.text)

  const kept: FileAnalysis[] = []
  let waived = 0
  let refused = 0
  for (const analysis of analyses) {
    if (analysis.findings.length === 0) {
      kept.push(analysis)
      continue
    }
    const text = textByName.get(analysis.file)
    if (text === undefined) {
      kept.push(analysis)
      continue
    }
    const pragmas = scanPragmas(text)
    refused += pragmas.refused
    const remaining = analysis.findings.filter((finding) => !isWaived(finding, pragmas))
    if (remaining.length === analysis.findings.length) {
      kept.push(analysis)
      continue
    }
    waived += analysis.findings.length - remaining.length
    kept.push({ ...analysis, findings: remaining })
  }

  return { analyses: kept, waived, refused, summary: waiverSummary(waived, refused) }
}
