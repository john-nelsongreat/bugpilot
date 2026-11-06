import type { AnalyzerFinding } from '../types'

/**
 * The housekeeping rules whose findings are honest but rarely urgent: a todo left in the code, a
 * line that runs long, a file that grew too big, a plain http:// link, mixed indentation. The UI
 * keeps them out of the headline counts and shows them in a collapsed group so a noisy upload
 * cannot bury the real findings; the exports keep them listed like every other rule.
 */
export const NOTE_RULE_IDS: readonly string[] = [
  'bugpilot/generic/todo-marker',
  'bugpilot/generic/long-line',
  'bugpilot/generic/large-file',
  'bugpilot/generic/insecure-http-url',
  'bugpilot/generic/mixed-indentation',
]

const NOTE_RULE_SET: ReadonlySet<string> = new Set(NOTE_RULE_IDS)

export function isNoteRuleId(ruleId: string): boolean {
  return NOTE_RULE_SET.has(ruleId)
}

export interface SplitNotes {
  /** Findings the headline counts and the filters are built from. */
  actionable: AnalyzerFinding[]
  /** Housekeeping findings, shown collapsed and always exported. */
  notes: AnalyzerFinding[]
}

export function splitNoteFindings(findings: readonly AnalyzerFinding[]): SplitNotes {
  const actionable: AnalyzerFinding[] = []
  const notes: AnalyzerFinding[] = []
  for (const finding of findings) {
    if (isNoteRuleId(finding.ruleId)) notes.push(finding)
    else actionable.push(finding)
  }
  return { actionable, notes }
}
