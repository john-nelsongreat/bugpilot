import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { detectLanguage } from './features/analyzer/archive/classify'
import { redactIfCredential } from './features/analyzer/engines/redact'
import { makeRuleFile } from './features/analyzer/rules/context'
import { secretRules } from './features/analyzer/rules/secrets'
import type { RuleHit } from './features/analyzer/rules/types'

/**
 * The repository's own secret scanner, run by `src/repoSecrets.test.ts` on every `npm test`.
 *
 * BugPilot ships a code scanner, so a credential-shaped literal in this repository would be
 * served to every visitor of the live site and would trip GitHub push protection. Fake secrets in
 * tests are built at run time from fragments; this is what proves the convention held. There are
 * deliberately no path or extension exclusions: an earlier audit excluded any path containing
 * `engines/` and missed a literal in the very file that documented the fragment rule.
 */

/**
 * The shape the production rules cannot see: an unquoted credential assignment anywhere in a line
 * — the word `password` followed by `=` and a bare value, or `db_password` followed by `:` and one
 * — including a match nested inside a string or a call. A quoted value is left to
 * `QUOTED_ASSIGNMENT` in `rules/secrets.ts`, so nothing overlaps.
 */
const CREDENTIAL_WORD =
  /(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)/i
const IDENTIFIER = /[A-Za-z0-9_.-]{3,}/g
const ASSIGNMENT_AFTER_NAME = /^[ \t]*[=:][ \t]*(?!["'=!])([A-Za-z0-9_+/@~-]{8,})(?![\w.(-])/

/** Values that read as an identifier or a constant rather than as a literal secret. */
function isCodeExpression(value: string): boolean {
  if (/^[A-Z][A-Z0-9_]*$/.test(value)) return true
  return value.startsWith('process.env')
}

/**
 * A credential literal ends the assignment: quote, comma, semicolon, bracket or end of line.
 * Anything else (`secretRules: readonly AnalyzerRule[]`, `SECRET_FINDING: DeepEngineRow = {`) is a
 * type annotation that merely puts a word after a colon.
 */
function endsTheAssignment(rest: string): boolean {
  const next = rest.trimStart()
  return next === '' || /^['"`)\]};,]/.test(next)
}

export interface Finding {
  file: string
  line: number
  ruleId: string
  /** The offending line with the value masked: a scan log must not copy what it found. */
  text: string
}

/**
 * Files that legitimately carry credential-shaped text. Keyed `file|ruleId`, each with the reason
 * it is not a leak. `src/repoSecrets.test.ts` fails on a stale entry and on a short reason, so this
 * list cannot quietly grow or rot.
 */
export const ALLOWLIST: readonly { key: string; reason: string }[] = []

export function trackedFiles(cwd: string = process.cwd()): string[] {
  const raw = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
  return raw.split('\0').filter((entry) => entry !== '')
}

export function unquotedFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    IDENTIFIER.lastIndex = 0
    for (const name of line.matchAll(IDENTIFIER)) {
      if (!CREDENTIAL_WORD.test(name[0] ?? '')) continue
      const rest = line.slice((name.index ?? 0) + (name[0] ?? '').length)
      ASSIGNMENT_AFTER_NAME.lastIndex = 0
      const assignment = ASSIGNMENT_AFTER_NAME.exec(rest)
      const value = assignment?.[1]
      if (!value || isCodeExpression(value)) continue
      if (!endsTheAssignment(rest.slice(assignment?.[0].length ?? 0))) continue
      findings.push({
        file,
        line: index + 1,
        ruleId: 'repo/unquoted-credential-assignment',
        text: line.replace(value, '[redacted]').trim().slice(0, 120),
      })
      break
    }
  }
  return findings
}

/** BugPilot's own secret rules, run exactly as the analyzer worker runs them. */
export function ruleFindings(file: string, text: string): Finding[] {
  const detection = detectLanguage(file, text)
  const ruleFile = makeRuleFile({
    name: file,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
  })
  const found: Finding[] = []
  for (const rule of secretRules) {
    let hits: RuleHit[] = []
    try {
      hits = rule.check(ruleFile)
    } catch {
      // A rule that cannot read this file reports nothing here; its own unit tests cover it.
      continue
    }
    for (const hit of hits) {
      const line = ruleFile.lines[hit.range.startLine - 1] ?? ''
      found.push({
        file,
        line: hit.range.startLine,
        ruleId: rule.id,
        // Masked the same way findings are masked in the app, so a failing CI log is not a copy.
        text: redactIfCredential(line).trim().slice(0, 120),
      })
    }
  }
  return found
}

export function scanFile(file: string, cwd: string = process.cwd()): Finding[] {
  let text = ''
  try {
    text = readFileSync(resolve(cwd, file), 'utf8')
  } catch {
    // Tracked but unreadable (a staged deletion, a broken symlink): there is nothing to leak.
    return []
  }
  return [...ruleFindings(file, text), ...unquotedFindings(file, text)]
}

export function scanRepository(cwd: string = process.cwd()): Finding[] {
  return trackedFiles(cwd).flatMap((file) => scanFile(file, cwd))
}

export function isAllowlisted(finding: Finding): boolean {
  return ALLOWLIST.some((entry) => entry.key === `${finding.file}|${finding.ruleId}`)
}
