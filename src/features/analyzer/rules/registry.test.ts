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
   * Six of the 28 corpus families have no `SourceLanguage` member, so their files classify as
   * `unknown` or `text` and the campaign scores them only because the pattern rules declare that
   * fallback: measured recall is 0.125 for haskell and 0.158 for elixir, against 0.55 for Python.
   * Measured 2026-11-17 over the 140 corpus files (`handoff-audit/evidence/l5-probe/probe7`), by
   * running the shipped `detectLanguage`: `dart`, `dockerfile` (as `Foo.Dockerfile`, where the suffix
   * is an extension and only a bare `Dockerfile` is a basename), `ex`, `hs`, `pl` and `ps1`. Nine
   * families rode the fallback before LOOP2-L5 wired `lua`, `r` and `tf`, and their 0.167 (R) and
   * 0.177 (Terraform) recall is why those three grammars were wired first — which is also why the
   * sample names below are no longer `src/r/summary.R` and `src/terraform/main.tf`: they now
   * classify as named languages, and the test right after this one guards their new coverage instead.
   * No other gate in the suite names the fallback members — `generic.docs.test.ts` derives README's
   * Languages cell from the same constant, so a rule that quietly loses `unknown` would strip a
   * family to zero coverage with every existing check green.
   */
  it('pairs the unknown fallback with the text fallback in every rule that declares either', () => {
    const offenders = ANALYZER_RULES.filter(
      (rule) => rule.languages.includes('text') && !rule.languages.includes('unknown'),
    ).map((rule) => rule.id)
    expect(offenders, 'a rule runs on plain text but not on a file the classifier cannot name').toEqual([])
  })

  it('keeps the pattern-tier coverage the campaign scores for a file it cannot name', () => {
    const fallbackNames = [
      'src/elixir/web.ex',
      'src/haskell/List.hs',
      'src/dart/InvoiceReconcile.dart',
      'src/perl/InvoiceReconcile.pl',
    ]
    for (const name of fallbackNames) {
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

  /**
   * The other half of the guard above. Naming a language takes its files out of `unknown`, so a
   * promotion that adds a grammar and forgets the two hand-maintained language lists lands the family
   * on `rulesForLanguage` with nothing selected — measured at 0 rules for `lua`, `r` and `terraform`
   * on the pre-LOOP2-L5 registry, against 17 for `unknown` and 17 for `scala`. The syntax tier would
   * have gone up while the pattern tier silently went to zero.
   */
  it('keeps the pattern tier of a family that stops classifying as the unnamed fallback', () => {
    for (const language of ['lua', 'r', 'terraform'] as const) {
      const ids = new Set(rulesForLanguage(language).map((rule) => rule.id))
      expect(ids.size, `${language} selects no pattern rules`).toBeGreaterThanOrEqual(17)
      for (const fallback of rulesForLanguage('unknown')) {
        expect(ids.has(fallback.id), `${language} lost the fallback rule ${fallback.id}`).toBe(true)
      }
    }
  })

  it('keeps the TypeScript syntax id stable for reports', () => {
    expect(TS_SYNTAX_RULE_ID).toBe('bugpilot/typescript/syntax')
    expect(ruleById(TS_SYNTAX_RULE_ID)).toBeUndefined()
    expect(ruleById('bugpilot/secret/aws-access-key')?.tier).toBe('pattern')
  })
})
