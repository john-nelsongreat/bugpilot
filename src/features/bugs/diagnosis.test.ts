import { describe, expect, it } from 'vitest'
import { makeBug, makeBugDraft, makeSavedDiagnosis } from '../../test/factories'
import {
  DIAGNOSIS_LIMITS,
  toBugDraft,
  updateBug,
  validateSavedDiagnosis,
} from './validation'
import {
  attachDiagnosisToBug,
  removeDiagnosisFromBug,
  type AttachDiagnosisInput,
} from './diagnosis'
import type { SavedDiagnosis } from './types'

const NOW = '2026-10-25T12:00:00.000Z'

function validDiagnosis(
  overrides: Partial<SavedDiagnosis> = {},
): SavedDiagnosis {
  return {
    category: 'missing-module',
    ruleId: 'python.missing-module',
    matchedSignature: "ModuleNotFoundError: No module named 'pandas'",
    confidence: 'high',
    evidence: [
      {
        label: 'Error text',
        quote: "ModuleNotFoundError: No module named 'pandas'",
      },
      { label: 'Code snippet', quote: 'import pandas as pd' },
    ],
    savedAt: '2026-10-24T09:30:00.000Z',
    ...overrides,
  }
}

function expectValid(value: unknown): SavedDiagnosis {
  const result = validateSavedDiagnosis(value)
  if (!result.ok) throw new Error(result.reason)
  return result.diagnosis
}

function expectInvalid(value: unknown): string {
  const result = validateSavedDiagnosis(value)
  if (result.ok) throw new Error('Expected the diagnosis to be invalid')
  return result.reason
}

function attachment(
  overrides: Partial<Omit<SavedDiagnosis, 'savedAt'>> = {},
): Omit<SavedDiagnosis, 'savedAt'> {
  return {
    category: 'missing-module',
    ruleId: 'python.missing-module',
    matchedSignature: "ModuleNotFoundError: No module named 'pandas'",
    confidence: 'high',
    evidence: [
      {
        label: 'Error text',
        quote: "ModuleNotFoundError: No module named 'pandas'",
      },
    ],
    ...overrides,
  }
}

describe('validateSavedDiagnosis', () => {
  it('accepts a complete diagnosis without altering known fields', () => {
    expect(expectValid(validDiagnosis())).toEqual(validDiagnosis())
  })

  it('accepts category values outside the current engine enum', () => {
    const future = validDiagnosis({ category: 'dependency-lockfile-drift' })

    expect(expectValid(future)).toEqual(future)
  })

  it('accepts an omitted ruleId, a null signature, and no evidence', () => {
    const minimal = {
      category: 'future-category',
      matchedSignature: null,
      confidence: 'low',
      evidence: [],
      savedAt: '2026-10-24T09:30:00.000Z',
    }

    expect(expectValid(minimal)).toEqual(minimal)
  })

  it.each(['low', 'medium', 'high'] as const)(
    'accepts the %s confidence',
    (confidence) => {
      expect(expectValid(validDiagnosis({ confidence })).confidence).toBe(
        confidence,
      )
    },
  )

  it('accepts every field exactly at its documented limit', () => {
    const atLimit = validDiagnosis({
      category: 'c'.repeat(DIAGNOSIS_LIMITS.category),
      ruleId: 'r'.repeat(DIAGNOSIS_LIMITS.ruleId),
      matchedSignature: 's'.repeat(DIAGNOSIS_LIMITS.matchedSignature),
      evidence: Array.from(
        { length: DIAGNOSIS_LIMITS.evidence },
        () => ({
          label: 'l'.repeat(DIAGNOSIS_LIMITS.evidenceLabel),
          quote: 'q'.repeat(DIAGNOSIS_LIMITS.evidenceQuote),
        }),
      ),
    })

    expect(expectValid(atLimit)).toEqual(atLimit)
  })

  it('accepts ISO timestamps with and without fractional seconds and offsets', () => {
    expect(
      expectValid(validDiagnosis({ savedAt: '2026-10-24T09:30:00Z' })).savedAt,
    ).toBe('2026-10-24T09:30:00Z')
    expect(
      expectValid(validDiagnosis({ savedAt: '2026-10-24T11:30:00+02:00' }))
        .savedAt,
    ).toBe('2026-10-24T11:30:00+02:00')
  })

  it.each([null, undefined, 'diagnosis', 42, [], true])(
    'rejects a non-object diagnosis (%s)',
    (value) => {
      expect(expectInvalid(value)).toMatch(/object/i)
    },
  )

  it.each([
    ['missing category', { category: undefined }, /category/i],
    ['numeric category', { category: 42 }, /category/i],
    ['empty category', { category: '' }, /category/i],
    [
      'overlong category',
      { category: 'c'.repeat(DIAGNOSIS_LIMITS.category + 1) },
      /80 characters/,
    ],
  ])('rejects a %s', (_label, overrides, reason) => {
    expect(
      expectInvalid({ ...validDiagnosis(), ...overrides }),
    ).toMatch(reason)
  })

  it.each([
    ['null rule id', { ruleId: null }],
    ['numeric rule id', { ruleId: 42 }],
    ['overlong rule id', { ruleId: 'r'.repeat(DIAGNOSIS_LIMITS.ruleId + 1) }],
  ])('rejects a %s', (_label, overrides) => {
    expect(
      expectInvalid({ ...validDiagnosis(), ...overrides }),
    ).toMatch(/rule id/i)
  })

  it.each([
    ['missing signature', { matchedSignature: undefined }],
    ['numeric signature', { matchedSignature: 42 }],
    [
      'overlong signature',
      { matchedSignature: 's'.repeat(DIAGNOSIS_LIMITS.matchedSignature + 1) },
    ],
  ])('rejects a %s', (_label, overrides) => {
    expect(
      expectInvalid({ ...validDiagnosis(), ...overrides }),
    ).toMatch(/signature/i)
  })

  it.each([undefined, null, 'certain', 3])(
    'rejects the invalid confidence %s',
    (confidence) => {
      expect(
        expectInvalid({ ...validDiagnosis(), confidence }),
      ).toMatch(/confidence/i)
    },
  )

  it.each([
    ['a non-list evidence value', { evidence: 'line one' }],
    ['an object evidence value', { evidence: { label: 'x', quote: 'y' } }],
    [
      'more than five evidence items',
      {
        evidence: Array.from(
          { length: DIAGNOSIS_LIMITS.evidence + 1 },
          () => ({ label: 'line', quote: 'text' }),
        ),
      },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(
      expectInvalid({ ...validDiagnosis(), ...overrides }),
    ).toMatch(/evidence/i)
  })

  it.each([
    ['a non-object evidence item', [null]],
    ['a missing label', [{ quote: 'text' }]],
    ['a missing quote', [{ label: 'line' }]],
    ['a numeric label', [{ label: 1, quote: 'text' }]],
    ['a numeric quote', [{ label: 'line', quote: 1 }]],
    [
      'an overlong label',
      [
        {
          label: 'l'.repeat(DIAGNOSIS_LIMITS.evidenceLabel + 1),
          quote: 'text',
        },
      ],
    ],
    [
      'an overlong quote',
      [
        {
          label: 'line',
          quote: 'q'.repeat(DIAGNOSIS_LIMITS.evidenceQuote + 1),
        },
      ],
    ],
  ])('rejects %s', (_label, evidence) => {
    expect(
      expectInvalid({ ...validDiagnosis(), evidence }),
    ).toMatch(/evidence|label|quote/i)
  })

  it.each([
    ['missing savedAt', undefined],
    ['numeric savedAt', 42],
    ['empty savedAt', ''],
    ['non-date savedAt', 'not-a-date'],
    ['date-only savedAt', '2026-10-24'],
    ['missing timezone savedAt', '2026-10-24T09:30:00'],
  ])('rejects %s', (_label, savedAt) => {
    const candidate = { ...validDiagnosis(), savedAt }

    expect(expectInvalid(candidate)).toMatch(/saved date|timestamp/i)
  })

  it('drops unknown and prototype-related keys without pollution', () => {
    const malicious = JSON.parse(`{
      "category": "missing-module",
      "matchedSignature": null,
      "confidence": "high",
      "evidence": [
        {
          "label": "Error text",
          "quote": "ModuleNotFoundError: No module named 'pandas'",
          "__proto__": { "polluted": true },
          "constructor": { "polluted": true },
          "prototype": { "polluted": true },
          "lineNumber": 4
        }
      ],
      "savedAt": "2026-10-24T09:30:00.000Z",
      "__proto__": { "polluted": true },
      "constructor": { "polluted": true },
      "prototype": { "polluted": true },
      "rawErrorText": "private pasted text",
      "codeSnippet": "private code"
    }`) as unknown

    const result = expectValid(malicious)

    expect(Object.keys(result)).toEqual([
      'category',
      'matchedSignature',
      'confidence',
      'evidence',
      'savedAt',
    ])
    expect(Object.keys(result.evidence[0])).toEqual(['label', 'quote'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('private pasted text')
    expect(JSON.stringify(result)).not.toContain('private code')
  })
})

describe('diagnosis persistence on ordinary updates', () => {
  it('keeps a saved diagnosis when updateBug rebuilds a report', () => {
    const diagnosis = validDiagnosis()
    const existing = makeBug({ id: 'update-preserve', diagnosis })

    const updated = updateBug(
      existing,
      makeBugDraft({ title: 'Updated title', status: 'Resolved' }),
      NOW,
    )

    expect(updated.diagnosis).toEqual(diagnosis)
    expect(updated.title).toBe('Updated title')
    expect(updated.updatedAt).toBe(NOW)
  })

  it('never exposes the diagnosis through the form draft', () => {
    const existing = makeBug({ id: 'draft-hidden', diagnosis: validDiagnosis() })

    expect(toBugDraft(existing)).not.toHaveProperty('diagnosis')
  })
})

describe('attachDiagnosisToBug', () => {
  it.each([undefined, '', '   '])(
    'requires proposed-fix text (%j) and writes nothing',
    (proposedFix) => {
      const bug = makeBug({ id: 'missing-fix', proposedFix: '', fixStatus: null })
      const before = JSON.stringify(bug)
      const input: AttachDiagnosisInput = {
        diagnosis: attachment(),
        proposedFix,
      }

      const result = attachDiagnosisToBug(bug, input, NOW)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('missing-proposed-fix')
        expect(result.message).toMatch(/proposed fix/i)
      }
      expect(JSON.stringify(bug)).toBe(before)
    },
  )

  it('rejects an unrecognised diagnosis', () => {
    const bug = makeBug({ id: 'unrecognized', proposedFix: '', fixStatus: null })

    const result = attachDiagnosisToBug(
      bug,
      {
        diagnosis: attachment({ category: 'unrecognized' }),
        proposedFix: 'Install the missing module.',
      },
      NOW,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('unrecognized-diagnosis')
      expect(result.message).toMatch(/not recognised/i)
    }
  })

  it('rejects an invalid diagnosis with a specific reason', () => {
    const bug = makeBug({ id: 'invalid-diagnosis', proposedFix: '', fixStatus: null })

    const result = attachDiagnosisToBug(
      bug,
      {
        diagnosis: attachment({
          confidence: 'certain' as unknown as SavedDiagnosis['confidence'],
        }),
        proposedFix: 'Install the missing module.',
      },
      NOW,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('invalid-diagnosis')
      expect(result.message).toMatch(/confidence/i)
    }
  })

  it('stores the diagnosis, proposed fix, and timestamps when no fix exists', () => {
    const bug = makeBug({
      id: 'attach-fresh',
      proposedFix: '',
      fixStatus: null,
      verificationNotes: '',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    })

    const result = attachDiagnosisToBug(
      bug,
      {
        diagnosis: attachment(),
        proposedFix: '  Install pandas in the active environment.  ',
      },
      NOW,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bug.id).toBe('attach-fresh')
    expect(result.bug.proposedFix).toBe(
      'Install pandas in the active environment.',
    )
    expect(result.bug.fixStatus).toBe('Proposed')
    expect(result.bug.verificationNotes).toBe('')
    expect(result.bug.createdAt).toBe('2026-10-01T08:00:00.000Z')
    expect(result.bug.updatedAt).toBe(NOW)
    expect(result.bug.diagnosis).toEqual({
      ...attachment(),
      savedAt: NOW,
    })
    expect(bug.diagnosis).toBeUndefined()
  })

  it('keeps an existing non-empty proposed fix unless replaceFix is true', () => {
    const bug = makeBug({
      id: 'keep-fix',
      proposedFix: 'Existing reviewed fix.',
      fixStatus: 'Accepted',
      verificationNotes: '',
    })

    const kept = attachDiagnosisToBug(
      bug,
      { diagnosis: attachment(), proposedFix: 'Newer untrusted fix.' },
      NOW,
    )

    expect(kept.ok).toBe(true)
    if (kept.ok) {
      expect(kept.bug.proposedFix).toBe('Existing reviewed fix.')
      expect(kept.bug.fixStatus).toBe('Accepted')
    }

    const replaced = attachDiagnosisToBug(
      bug,
      {
        diagnosis: attachment(),
        proposedFix: '  Replacement fix.  ',
        replaceFix: true,
      },
      NOW,
    )

    expect(replaced.ok).toBe(true)
    if (replaced.ok) {
      expect(replaced.bug.proposedFix).toBe('Replacement fix.')
      expect(replaced.bug.fixStatus).toBe('Accepted')
      expect(replaced.bug.verificationNotes).toBe('')
    }
  })

  it.each(['Accepted', 'Rejected', 'Verified'] as const)(
    'never changes an existing %s fix state or its notes',
    (fixStatus) => {
      const verificationNotes =
        fixStatus === 'Verified' ? 'Checked in a fresh environment.' : 'Keep note.'
      const bug = makeBug({
        id: `status-${fixStatus}`,
        proposedFix: 'Existing fix.',
        fixStatus,
        verificationNotes,
      })

      const result = attachDiagnosisToBug(
        bug,
        {
          diagnosis: attachment(),
          proposedFix: 'Replacement fix.',
          replaceFix: true,
        },
        NOW,
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.bug.fixStatus).toBe(fixStatus)
      expect(result.bug.verificationNotes).toBe(verificationNotes)
    },
  )

  it('sets Proposed when the fix state is null but a fix already exists', () => {
    const bug = makeBug({
      id: 'null-status-with-fix',
      proposedFix: 'Existing fix without a state.',
      fixStatus: null,
    })

    const result = attachDiagnosisToBug(
      bug,
      { diagnosis: attachment(), proposedFix: 'Ignored because one exists.' },
      NOW,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bug.proposedFix).toBe('Existing fix without a state.')
    expect(result.bug.fixStatus).toBe('Proposed')
  })

  it('replaces an earlier diagnosis instead of keeping duplicates', () => {
    const oldDiagnosis = validDiagnosis({ savedAt: '2026-10-01T08:00:00.000Z' })
    const bug = makeBug({
      id: 'one-diagnosis',
      proposedFix: '',
      fixStatus: null,
      diagnosis: oldDiagnosis,
    })

    const result = attachDiagnosisToBug(
      bug,
      {
        diagnosis: attachment({
          category: 'undefined-name',
          matchedSignature: 'NameError: name is not defined',
        }),
        proposedFix: 'Define the variable before use.',
      },
      NOW,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bug.diagnosis).toEqual({
      category: 'undefined-name',
      ruleId: 'python.missing-module',
      matchedSignature: 'NameError: name is not defined',
      confidence: 'high',
      evidence: attachment().evidence,
      savedAt: NOW,
    })
    expect(Object.keys(result.bug)).toContain('diagnosis')
    expect(bug.diagnosis).toEqual(oldDiagnosis)
  })
})

describe('removeDiagnosisFromBug', () => {
  it('removes only the diagnosis, keeps every other field, and updates updatedAt', () => {
    const diagnosis = makeSavedDiagnosis()
    const bug = makeBug({
      id: 'remove-diagnosis',
      proposedFix: 'Keep this proposed fix.',
      fixStatus: 'Verified',
      verificationNotes: 'Verified by hand on staging.',
      status: 'Resolved',
      diagnosis,
      updatedAt: '2026-10-20T08:00:00.000Z',
    })
    const original = structuredClone(bug)
    const removalAt = '2026-10-25T14:00:00.000Z'

    const result = removeDiagnosisFromBug(bug, removalAt)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bug).not.toHaveProperty('diagnosis')
    expect(result.bug).toMatchObject({
      id: bug.id,
      title: bug.title,
      description: bug.description,
      projectName: bug.projectName,
      language: bug.language,
      errorMessage: bug.errorMessage,
      stepsToReproduce: bug.stepsToReproduce,
      expectedBehavior: bug.expectedBehavior,
      actualBehavior: bug.actualBehavior,
      severity: bug.severity,
      status: 'Resolved',
      notes: bug.notes,
      proposedFix: 'Keep this proposed fix.',
      fixStatus: 'Verified',
      verificationNotes: 'Verified by hand on staging.',
      createdAt: bug.createdAt,
    })
    expect(result.bug.updatedAt).toBe(removalAt)
    expect(result.bug.updatedAt).not.toBe(bug.updatedAt)
    expect(JSON.stringify(result.bug)).not.toContain('"diagnosis"')
    expect(bug).toEqual(original)
  })

  it('returns no-diagnosis for a report without one and does not change it', () => {
    const bug = makeBug({ id: 'remove-nothing' })
    const original = structuredClone(bug)

    const result = removeDiagnosisFromBug(bug, '2026-10-25T14:00:00.000Z')

    expect(result).toMatchObject({
      ok: false,
      code: 'no-diagnosis',
    })
    if (result.ok) return
    expect(result.message).toMatch(/no saved diagnosis/i)
    expect(bug).toEqual(original)
  })
})
