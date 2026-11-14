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

  /**
   * Ten of the 28 corpus families have no `SourceLanguage` member, so their files classify as
   * `unknown` or `text` and the campaign scores them only because the pattern rules declare that
   * fallback: measured recall is 0.125 for haskell, 0.158 for elixir, 0.167 for R and 0.177 for
   * Terraform, against 0.55 for Python. No other gate in the suite names those two members —
   * `generic.docs.test.ts` derives README's Languages cell from the same constant, so a rule that
   * quietly loses `unknown` would strip a family to zero coverage with every existing check green.
   */
  it('pairs the unknown fallback with the text fallback in every rule that declares either', () => {
    const offenders = ANALYZER_RULES.filter(
      (rule) => rule.languages.includes('text') && !rule.languages.includes('unknown'),
    ).map((rule) => rule.id)
    expect(offenders, 'a rule runs on plain text but not on a file the classifier cannot name').toEqual([])
  })

  it('keeps the pattern-tier coverage the campaign scores for a file it cannot name', () => {
    for (const name of ['src/elixir/web.ex', 'src/haskell/List.hs', 'src/r/summary.R', 'src/terraform/main.tf']) {
      const language = detectLanguage(name, 'TODO: x\n').language
      expect(language, `${name} no longer classifies as the unnamed fallback`).toBe('unknown')
      const ids = rulesForLanguage(language).map((rule) => rule.id)
      expect(ids, `${name} classifies as ${language}, which selects no secret rule`).toContain(
        'bugpilot/secret/credential-assignment',
      )
      expect(ids, `${name} classifies as ${language}, which selects no generic rule`).toContain(
        'bugpilot/generic/todo-marker',
      )
    }
    // A floor, not an equality: the failure this guards is coverage shrinking, and a rule legitimately
    // joining the fallback must not turn the suite red. 17 is what the registry selects here.
    expect(rulesForLanguage('unknown').length).toBeGreaterThanOrEqual(17)
  })

  it('keeps the TypeScript syntax id stable for reports', () => {
    expect(TS_SYNTAX_RULE_ID).toBe('bugpilot/typescript/syntax')
    expect(ruleById(TS_SYNTAX_RULE_ID)).toBeUndefined()
    expect(ruleById('bugpilot/secret/aws-access-key')?.tier).toBe('pattern')
  })
})
