import { describe, expect, it } from 'vitest'
import type { BugDraft, FixStatus, Severity } from './types'
import { FIX_STATUSES } from './types'
import {
  FIELD_LIMITS,
  createBug,
  updateBug,
  validateBugDraft,
} from './validation'
import { makeBug, makeBugDraft } from '../../test/factories'

describe('fix tracking states', () => {
  it('supports exactly proposed, accepted, rejected, and verified', () => {
    expect(FIX_STATUSES).toEqual(['Proposed', 'Accepted', 'Rejected', 'Verified'])
  })
})

describe('validateBugDraft', () => {
  it('accepts a complete valid report', () => {
    expect(validateBugDraft(makeBugDraft())).toEqual({})
  })

  it('reports each missing required field', () => {
    const errors = validateBugDraft(
      makeBugDraft({
        title: '   ',
        projectName: '',
        language: '',
        description: '',
      }),
    )

    expect(errors.title).toMatch(/title/i)
    expect(errors.projectName).toMatch(/project/i)
    expect(errors.language).toMatch(/language/i)
    expect(errors.description).toMatch(/description|describe/i)
  })

  it('requires a proposed fix before a fix status can be recorded', () => {
    const errors = validateBugDraft(
      makeBugDraft({ fixStatus: 'Proposed', proposedFix: '   ' }),
    )

    expect(errors.proposedFix).toMatch(/proposed fix/i)
  })

  it('requires evidence notes before a fix is marked verified', () => {
    const errors = validateBugDraft(
      makeBugDraft({
        fixStatus: 'Verified',
        proposedFix: 'Guard the missing amount.',
        verificationNotes: '  ',
      }),
    )

    expect(errors.verificationNotes).toMatch(/verified/i)
  })

  it.each(['Proposed', 'Accepted', 'Rejected', 'Verified'] satisfies FixStatus[])(
    'accepts the %s fix state with a proposed fix and notes where required',
    (fixStatus) => {
      const errors = validateBugDraft(
        makeBugDraft({
          fixStatus,
          proposedFix: 'Guard the value before reading it.',
          verificationNotes:
            fixStatus === 'Verified' ? 'The failing case now passes.' : '',
        }),
      )

      expect(errors).toEqual({})
    },
  )

  it('allows a report with no fix yet', () => {
    expect(
      validateBugDraft(makeBugDraft({ fixStatus: null, proposedFix: '' })),
    ).toEqual({})
  })

  it('rejects an unsupported severity', () => {
    const errors = validateBugDraft(
      makeBugDraft({ severity: 'Urgent' as Severity }),
    )

    expect(errors.severity).toMatch(/severity/i)
  })

  it('rejects an unusually long error message without truncating the value', () => {
    const errorMessage = 'x'.repeat(FIELD_LIMITS.errorMessage + 1)
    const errors = validateBugDraft(makeBugDraft({ errorMessage }))

    expect(errors.errorMessage).toMatch(/error message/i)
  })
})

describe('createBug and updateBug', () => {
  it('trims input and records an id, creation time, and update time', () => {
    const draft = makeBugDraft({
      title: '  Padded title  ',
      projectName: '  Fieldnote  ',
    })

    const created = createBug(draft, {
      id: 'bug-fixed-id',
      now: '2026-10-20T10:00:00.000Z',
    })

    expect(created).toMatchObject({
      id: 'bug-fixed-id',
      title: 'Padded title',
      projectName: 'Fieldnote',
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
    })
  })

  it('assigns unique ids when none is supplied', () => {
    const draft: BugDraft = makeBugDraft()
    const first = createBug(draft)
    const second = createBug(draft)

    expect(first.id).not.toBe(second.id)
  })

  it('preserves id and creation time while updating the record', () => {
    const existing = makeBug({
      id: 'bug-preserved',
      title: 'Old title',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    })

    const updated = updateBug(
      existing,
      makeBugDraft({ title: '  New title  ', status: 'Resolved' }),
      '2026-10-22T12:30:00.000Z',
    )

    expect(updated).toMatchObject({
      id: 'bug-preserved',
      title: 'New title',
      status: 'Resolved',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-22T12:30:00.000Z',
    })
  })
})
