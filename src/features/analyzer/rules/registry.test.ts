import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { buildLineStarts } from './context'
import { ANALYZER_RULES, TS_SYNTAX_RULE_ID, ruleById, rulesForLanguage } from './registry'
import type { RuleFile } from './types'

function emptyFile(): RuleFile {
  const text = ''
  const detection = detectLanguage('src/empty.ts', text)
  return {
    file: 'src/empty.ts',
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    text,
    lines: text.split('\n'),
    lineStarts: buildLineStarts(text),
  }
}

describe('analyzer rule registry', () => {
  it('has a unique, namespaced id and required metadata for every rule', () => {
    const ids = ANALYZER_RULES.map((rule) => rule.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(16)
    for (const rule of ANALYZER_RULES) {
      expect(rule.id).toMatch(/^bugpilot\/[a-z0-9-]+\/[a-z0-9-]+$/)
      expect(['syntax', 'pattern']).toContain(rule.tier)
      expect(['Low', 'Medium', 'High', 'Critical']).toContain(rule.severity)
      expect(rule.title.length).toBeGreaterThan(0)
      expect(rule.description.length).toBeGreaterThan(0)
      expect(rule.languages.length).toBeGreaterThan(0)
    }
  })

  it('returns no findings for an empty file from any rule', () => {
    for (const rule of ANALYZER_RULES) {
      expect(rule.check(emptyFile())).toEqual([])
    }
  })

  it('selects rules by language', () => {
    const python = rulesForLanguage('python').map((rule) => rule.id)
    expect(python).toContain('bugpilot/secret/aws-access-key')
    expect(python).toContain('bugpilot/generic/empty-catch')
    expect(python).not.toContain('bugpilot/syntax/json')

    const json = rulesForLanguage('json').map((rule) => rule.id)
    expect(json).toContain('bugpilot/syntax/json')
    expect(json).not.toContain('bugpilot/generic/empty-catch')
  })

  it('keeps the TypeScript syntax id stable for reports', () => {
    expect(TS_SYNTAX_RULE_ID).toBe('bugpilot/typescript/syntax')
    expect(ruleById(TS_SYNTAX_RULE_ID)).toBeUndefined()
    expect(ruleById('bugpilot/secret/aws-access-key')?.tier).toBe('pattern')
  })
})
