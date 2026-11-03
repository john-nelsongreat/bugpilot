import { describe, expect, it } from 'vitest'
import { makeRuleFile } from '../rules/context'
import type { RuleFile } from '../rules/types'
import type { EngineHit } from './protocol'
import { RULE_SPECS, RUFF_SELECTED_RULES, ruffHitToEngineHit, type RuffDiagnostic } from './ruff'

function fileOf(text: string, language = 'python'): RuleFile {
  return makeRuleFile({
    name: `sample.${language}`,
    text,
    language: language as never,
    languageSource: 'extension',
    encoding: 'utf-8',
  })
}

function diagnostic(code: string | null, message: string, row = 2, column = 0): RuffDiagnostic {
  return { code, message, start_location: { row, column }, end_location: { row, column: column + 8 } }
}

/** Assembled at run time so no repository file holds a credential-shaped literal. */
const FAKE = ['K7mN', '2pQ9', 'rS4t', 'V6wX8yZ1'].join('')

/** A dropped mapping is a failed expectation, so say so rather than let the assertions run on null. */
function mapped(hit: EngineHit | null): EngineHit {
  if (!hit) throw new Error('Expected the diagnostic to map to a finding')
  return hit
}

describe('Ruff rule selection', () => {
  it('selects only rules BugPilot can describe', () => {
    expect(RUFF_SELECTED_RULES.length).toBeGreaterThan(15)
    for (const code of RUFF_SELECTED_RULES) {
      expect(RULE_SPECS[code], `${code} has no description`).toBeDefined()
    }
  })

  it('describes every selected rule with a severity and a confidence', () => {
    for (const [code, spec] of Object.entries(RULE_SPECS)) {
      expect(spec.severity, code).toMatch(/^(Critical|High|Medium|Low)$/)
      expect(spec.confidence, code).toMatch(/^(high|medium|low)$/)
      expect(spec.meaning.length, code).toBeGreaterThan(10)
    }
  })

  it('keeps the security-shaped rules conservative about their own claim', () => {
    // A hardcoded password match is a shape, not proof, and S608 sees no data flow.
    expect(RULE_SPECS.S105.confidence).toBe('medium')
    expect(RULE_SPECS.S608.confidence).toBe('low')
    expect(RULE_SPECS.S608.extraLimitations?.join(' ')).toContain('not a data-flow result')
    expect(RULE_SPECS.F821.extraLimitations?.join(' ')).toContain('one file at a time')
  })
})

describe('Ruff finding mapping', () => {
  it('maps a known rule to a manual-only Python finding', () => {
    const file = fileOf('import os\n\n\nprint(1)\n')
    const hit = mapped(ruffHitToEngineHit(diagnostic('F401', '`os` imported but unused', 1), file))
    expect(hit.ruleId).toBe('ruff/F401')
    expect(hit.engine).toBe('ruff')
    expect(hit.tier).toBe('pattern')
    expect(hit.severity).toBe('Low')
    expect(hit.confidence.level).toBe('high')
    expect(hit.message).toContain('imported but unused')
    expect(hit.message).toContain('(F401)')
    expect(hit.range.startLine).toBe(1)
    expect(hit.evidence[0].quote).toContain('import os')
    // The WASM build exposes no fix, so nothing here may read as an offered edit.
    expect(hit.fix?.riskClass).toBe('manual-only')
    expect(hit.fix?.exampleCode).toBe('')
    expect(hit.limitations.join(' ')).toContain('No automatic change is offered for Python')
  })

  it('treats a parse failure as a syntax finding at high confidence', () => {
    const hit = mapped(ruffHitToEngineHit(diagnostic(null, 'Expected ")"', 1), fileOf('def f(:\n')))
    expect(hit.ruleId).toBe('ruff/syntax-error')
    expect(hit.tier).toBe('syntax')
    expect(hit.severity).toBe('High')
    expect(hit.confidence.level).toBe('high')
    expect(hit.message).toBe('Syntax error: Expected ")"')
    expect(hit.explanation).toContain('Everything after it in this file is unparsed')
  })

  it('recognises the syntax code the shipped binary actually emits', () => {
    // Measured in ruff.wasm.test.ts: an unparsable file comes back as `invalid-syntax`, not
    // as a style rule, and must not be filed under the pattern tier.
    for (const code of ['invalid-syntax', 'E999', '', null]) {
      const hit = mapped(ruffHitToEngineHit(diagnostic(code, 'Expected ")"', 1), fileOf('def f(:\n')))
      expect(hit.tier, String(code)).toBe('syntax')
      expect(hit.severity, String(code)).toBe('High')
      expect(hit.confidence.level, String(code)).toBe('high')
    }
  })

  it('reports a rule it has no description for without inventing one', () => {
    const hit = mapped(ruffHitToEngineHit(diagnostic('PLR0911', 'Too many return statements'), fileOf('x = 1\ny = 2\n')))
    expect(hit.ruleId).toBe('ruff/PLR0911')
    expect(hit.confidence.level).toBe('low')
    expect(hit.confidence.reason).toContain('no description for')
    expect(hit.explanation).toContain('the reason in the message above')
  })

  it('strips the applicability suffix Ruff puts in brackets from the rule id', () => {
    const hit = mapped(ruffHitToEngineHit(diagnostic('F401[*]', 'unused'), fileOf('a\nb\n')))
    expect(hit.ruleId).toBe('ruff/F401')
    expect(hit.message).toContain('(F401)')
  })

  it('keeps a credential-shaped value out of both the quote and the message', () => {
    const file = fileOf(`x = 1\npassword = "${FAKE}"\n`)
    const hit = mapped(
      ruffHitToEngineHit(diagnostic('S105', `Possible hardcoded password: "${FAKE}"`, 2), file),
    )
    expect(hit.evidence[0].quote).not.toContain(FAKE)
    expect(hit.message).not.toContain(FAKE)
    expect(hit.message).toContain('Possible hardcoded password')
    expect(hit.severity).toBe('Critical')
  })

  it('clamps a position the engine reports outside the file', () => {
    const hit = mapped(ruffHitToEngineHit(diagnostic('F841', 'local variable is assigned to but never used', 99), fileOf('a\nb\n')))
    expect(hit.range.startLine).toBe(99)
    expect(hit.evidence[0].quote).toBe('')
  })
})
