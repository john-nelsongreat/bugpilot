import { describe, expect, it } from 'vitest'
import { diagnose } from '../../diagnostics/engine'
import type { DiagnosticResult, PossibleFix } from '../../diagnostics/types'
import { makeBug } from '../../test/factories'
import { FIELD_LIMITS } from '../bugs/validation'
import { canSaveDiagnosis, composeProposedFix } from './savePreview'

const possibleFix: PossibleFix = {
  explanation: 'Install the missing dependency.',
  whereItMayApply: 'Use this in the failing environment.',
  exampleCode: 'python -m pip install pandas',
}

function diagnosis(overrides: Partial<DiagnosticResult> = {}): DiagnosticResult {
  return {
    category: 'missing-module',
    matchedSignature: "ModuleNotFoundError: No module named '<module>'",
    likelyCause: 'The module is missing.',
    evidence: [],
    debuggingSteps: [],
    possibleFix,
    verificationSteps: [],
    confidence: { level: 'high', reason: 'Explicit language.' },
    limitations: [],
    alternativeExplanations: [],
    ...overrides,
  }
}

describe('composeProposedFix', () => {
  it('combines the explanation and example code in the documented format', () => {
    expect(composeProposedFix(possibleFix)).toEqual({
      text: 'Install the missing dependency.\n\nExample code:\npython -m pip install pandas',
      droppedExampleCode: false,
      exceedsLimit: false,
    })
  })

  it('keeps the explanation alone when there is no example code', () => {
    expect(
      composeProposedFix({ ...possibleFix, exampleCode: '   ' }),
    ).toEqual({
      text: 'Install the missing dependency.',
      droppedExampleCode: false,
      exceedsLimit: false,
    })
  })

  it('drops the example code when the full fix exceeds 20,000 characters', () => {
    const explanation = 'A'.repeat(FIELD_LIMITS.proposedFix - 10)
    const composed = composeProposedFix({
      ...possibleFix,
      explanation,
      exampleCode: 'B'.repeat(100),
    })

    expect(composed.droppedExampleCode).toBe(true)
    expect(composed.exceedsLimit).toBe(false)
    expect(composed.text).toBe(explanation)
    expect(composed.text.length).toBeLessThanOrEqual(FIELD_LIMITS.proposedFix)
  })

  it('marks the fix unsavable when even the explanation exceeds the limit', () => {
    const explanation = 'A'.repeat(FIELD_LIMITS.proposedFix + 1)
    const composed = composeProposedFix({
      ...possibleFix,
      explanation,
      exampleCode: 'B'.repeat(100),
    })

    expect(composed.droppedExampleCode).toBe(true)
    expect(composed.exceedsLimit).toBe(true)
    expect(composed.text).toBe(explanation)
  })

  it('keeps a fix that lands exactly on the limit', () => {
    const separator = '\n\nExample code:\n'
    const explanation = 'A'.repeat(
      FIELD_LIMITS.proposedFix - separator.length - 5,
    )
    const composed = composeProposedFix({
      ...possibleFix,
      explanation,
      exampleCode: 'BBBBB',
    })

    expect(composed.text.length).toBe(FIELD_LIMITS.proposedFix)
    expect(composed.droppedExampleCode).toBe(false)
    expect(composed.exceedsLimit).toBe(false)
  })
})

describe('canSaveDiagnosis', () => {
  it('requires a loaded bug and a result', () => {
    expect(canSaveDiagnosis(null, diagnosis())).toBe(false)
    expect(canSaveDiagnosis(makeBug(), null)).toBe(false)
  })

  it('requires a recognised diagnosis with a possible fix', () => {
    expect(canSaveDiagnosis(makeBug(), diagnosis())).toBe(true)
    expect(
      canSaveDiagnosis(makeBug(), diagnosis({ category: 'unrecognized' })),
    ).toBe(false)
    expect(
      canSaveDiagnosis(makeBug(), diagnosis({ possibleFix: null })),
    ).toBe(false)
  })

  it('matches the shape produced by the local engine', () => {
    const result = diagnose({
      language: 'python',
      errorText: "ModuleNotFoundError: No module named 'pandas'",
    })

    expect(canSaveDiagnosis(makeBug(), result)).toBe(true)
  })
})
