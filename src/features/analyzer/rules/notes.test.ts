import { describe, expect, it } from 'vitest'
import { ANALYZER_RULES, TS_SYNTAX_RULE_ID } from './registry'
import { isNoteRuleId, NOTE_RULE_IDS, splitNoteFindings } from './notes'
import { makeFinding } from '../analysis/finding'
import type { AnalyzerFinding } from '../types'

function finding(ruleId: string, file: string): AnalyzerFinding {
  return makeFinding({
    ruleId,
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: 'Low',
    confidence: { level: 'high', reason: 'matched a literal pattern' },
    file,
    range: { startLine: 1, endLine: 1 },
    evidence: [],
    message: `test finding for ${ruleId}`,
    explanation: 'explains the finding',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

describe('note rules', () => {
  it('names six rules, and every one of them is registered', () => {
    expect(NOTE_RULE_IDS).toHaveLength(6)
    const registered = new Set(ANALYZER_RULES.map((rule) => rule.id))
    for (const id of NOTE_RULE_IDS) {
      expect(registered.has(id), `${id} is registered`).toBe(true)
    }
  })

  it('never marks a non-note rule as a note', () => {
    const registered = new Set(ANALYZER_RULES.map((rule) => rule.id))
    for (const id of registered) {
      if (!NOTE_RULE_IDS.includes(id)) {
        expect(isNoteRuleId(id), `${id} is not a note`).toBe(false)
      }
    }
    expect(isNoteRuleId(TS_SYNTAX_RULE_ID)).toBe(false)
    expect(isNoteRuleId('bugpilot/generic/empty-catch')).toBe(false)
    expect(isNoteRuleId('')).toBe(false)
  })

  it('splits findings into actionable and notes, keeping the report order', () => {
    const findings = [
      finding('bugpilot/generic/empty-catch', 'src/a.js'),
      finding('bugpilot/generic/todo-marker', 'src/a.js'),
      finding('bugpilot/secret/credential-assignment', 'src/b.py'),
      finding('bugpilot/generic/insecure-http-url', 'src/b.py'),
    ]
    const split = splitNoteFindings(findings)
    expect(split.actionable.map((item) => item.ruleId)).toEqual([
      'bugpilot/generic/empty-catch',
      'bugpilot/secret/credential-assignment',
    ])
    expect(split.notes.map((item) => item.ruleId)).toEqual([
      'bugpilot/generic/todo-marker',
      'bugpilot/generic/insecure-http-url',
    ])
  })

  it('splits nothing when there are no findings', () => {
    const split = splitNoteFindings([])
    expect(split.actionable).toEqual([])
    expect(split.notes).toEqual([])
  })
})
