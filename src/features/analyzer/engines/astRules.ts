import type { ConfidenceLevel } from '../../../diagnostics/types'
import type { Severity } from '../../bugs/types'
import { lineEvidence, manualFix, quoteLine } from '../rules/context'
import type { RuleFile } from '../rules/types'
import type { GrammarId } from './assets'
import type { EngineHit } from './protocol'
import { redactIfCredential } from './redact'

export type Confidence = ConfidenceLevel

/** The part of a tree-sitter `Node` a query result is read through. */
export interface AstNodeLike {
  type: string
  text: string
  startIndex: number
  endIndex: number
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
}

export interface AstMatchLike {
  patternIndex: number
  captures: readonly { name: string; node: AstNodeLike }[]
}

/** Injected so the evaluator can be unit-tested without a wasm grammar. */
export type AstQueryRunner = (source: string) => AstMatchLike[]

/**
 * A text guard applied to one named capture. `must` keeps the match only when the capture
 * matches, `mustNot` drops it when it does. The query is deliberately broad and these guards
 * do the precise work, because a tree-sitter query cannot express "this condition contains an
 * assignment but not a comparison" without a regex either.
 */
export interface AstRuleCheck {
  capture: string
  /** JavaScript source, always tested with the `s` flag. */
  pattern: string
  when: 'must' | 'mustNot'
}

export interface AstRuleDefinition {
  id: string
  title: string
  severity: Severity
  confidence: Confidence
  /** Grammar directory the query is written for; node names differ per grammar. */
  grammar: GrammarId
  query: string
  /** Every one of these capture names must exist for a match to count. */
  require: readonly string[]
  /** Capture whose line anchors the finding; defaults to the first `require` name. */
  anchor?: string
  /** Text guards checked against the named captures before a match becomes a finding. */
  checks?: readonly AstRuleCheck[]
  /** Drop the match when the anchor node is one of these types (a comment is not a bug). */
  rejectAnchorTypes?: readonly string[]
  /** `@name@` in the message is replaced by that capture's collapsed text. */
  message: string
  explanation: string
  limitations: readonly string[]
  verificationSteps: readonly string[]
  fixExplanation: string
  fixWhereItMayApply: string
}

export interface AstRuleInput {
  file: RuleFile
  grammar: GrammarId
  runQuery: AstQueryRunner
  maxHits: number
}

function collapse(text: string, max = 90): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

function render(template: string, captures: Map<string, AstNodeLike>): string {
  return template.replace(/@([a-zA-Z0-9_]+)@/g, (whole, name: string) => {
    const node = captures.get(name)
    // The message quotes capture text verbatim, so it is a leak path next to the evidence line.
    return node ? redactIfCredential(collapse(node.text)) : whole
  })
}

function passesChecks(captures: Map<string, AstNodeLike>, checks: readonly AstRuleCheck[] | undefined): boolean {
  for (const check of checks ?? []) {
    const node = captures.get(check.capture)
    if (!node) {
      // A `must` guard on a capture the query never produced can not be proven, so the match
      // is dropped; a `mustNot` guard is satisfied by the absence of the text it names.
      if (check.when === 'must') return false
      continue
    }
    let matched: boolean
    try {
      matched = new RegExp(check.pattern, 's').test(node.text)
    } catch {
      return false
    }
    if (check.when === 'must' && !matched) return false
    if (check.when === 'mustNot' && matched) return false
  }
  return true
}

/**
 * Part 3: run one query rule over a parsed file. A hit is always phrased as what the tree
 * shows, never as a proven defect, and every rule carries the reason it can be wrong.
 */
export function evaluateAstRule(rule: AstRuleDefinition, input: AstRuleInput): EngineHit[] {
  if (rule.grammar !== input.grammar) return []

  const hits: EngineHit[] = []
  const seen = new Set<string>()
  let matches: AstMatchLike[]
  try {
    matches = input.runQuery(rule.query)
  } catch {
    // A query the grammar rejects (node name typo, unsupported predicate) is a BugPilot
    // limitation, not a user finding; the caller records the note.
    return []
  }

  for (const match of matches) {
    if (hits.length >= input.maxHits) break

    const captures = new Map<string, AstNodeLike>()
    for (const capture of match.captures) {
      if (!captures.has(capture.name)) captures.set(capture.name, capture.node)
    }
    if (!rule.require.every((name) => captures.has(name))) continue

    const anchorName = rule.anchor ?? rule.require[0]
    const anchor = anchorName ? captures.get(anchorName) : undefined
    if (!anchor) continue
    if (rule.rejectAnchorTypes?.includes(anchor.type)) continue
    if (!passesChecks(captures, rule.checks)) continue

    const lineIndex = anchor.startPosition.row
    const key = `${lineIndex}:${anchor.startPosition.column}:${anchor.endPosition.row}`
    if (seen.has(key)) continue
    seen.add(key)

    const quoted = collapse(anchor.text, 200)
    hits.push({
      ruleId: rule.id,
      engine: 'tree-sitter',
      tier: 'pattern',
      severity: rule.severity,
      confidence: { level: rule.confidence, reason: rule.explanation },
      range: {
        startLine: lineIndex + 1,
        startColumn: anchor.startPosition.column + 1,
        endLine: anchor.endPosition.row + 1,
        endColumn: anchor.endPosition.column + 1,
      },
      evidence: [
        lineEvidence(input.file, lineIndex, redactIfCredential(quoteLine(quoted))),
      ],
      message: render(rule.message, captures),
      explanation: rule.explanation,
      fix: manualFix(
        rule.fixExplanation,
        rule.fixWhereItMayApply,
        'manual-only',
        'The rule reads the syntax tree, not the program: only a person can say whether the construct is intentional here.',
      ),
      verificationSteps: [...rule.verificationSteps],
      limitations: [...rule.limitations],
    })
  }

  return hits
}

export function evaluateAstRules(
  rules: readonly AstRuleDefinition[],
  input: AstRuleInput,
): EngineHit[] {
  const hits: EngineHit[] = []
  for (const rule of rules) {
    hits.push(...evaluateAstRule(rule, input))
    if (hits.length >= input.maxHits) break
  }
  return hits
}
