import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeBug, makeSavedDiagnosis } from '../../test/factories'
import { BUGS_STORAGE_KEY, loadBugState, saveBugs } from './storage'
import type { RemoveDiagnosisResult } from './diagnosis'
import { useBugWorkspace } from './useBugWorkspace'

function seed(...bugs: ReturnType<typeof makeBug>[]) {
  const result = saveBugs(bugs)
  expect(result.ok).toBe(true)
}

function runRemove(run: () => RemoveDiagnosisResult): RemoveDiagnosisResult {
  const outcomes: RemoveDiagnosisResult[] = []
  act(() => {
    outcomes.push(run())
  })
  const outcome = outcomes[0]
  if (!outcome) throw new Error('Expected a removal result')
  return outcome
}

describe('useBugWorkspace.removeDiagnosis', () => {
  it('persists the removal and keeps the fix, state, notes and status', () => {
    const diagnosis = makeSavedDiagnosis()
    const bug = makeBug({
      id: 'workspace-remove',
      diagnosis,
      proposedFix: 'Keep this fix.',
      fixStatus: 'Verified',
      verificationNotes: 'Confirmed on staging.',
      status: 'Resolved',
      updatedAt: '2026-10-20T08:00:00.000Z',
    })
    seed(bug)
    const { result } = renderHook(() => useBugWorkspace())

    const removed = runRemove(() => result.current.removeDiagnosis(bug.id))
    expect(removed.ok).toBe(true)
    if (!removed.ok) return

    const stored = loadBugState(localStorage).bugs[0]
    expect(stored).not.toHaveProperty('diagnosis')
    expect(stored.proposedFix).toBe('Keep this fix.')
    expect(stored.fixStatus).toBe('Verified')
    expect(stored.verificationNotes).toBe('Confirmed on staging.')
    expect(stored.status).toBe('Resolved')
    expect(stored.updatedAt).toBe(removed.bug.updatedAt)
    expect(stored.updatedAt).not.toBe(bug.updatedAt)
    expect(result.current.bugs[0]).not.toHaveProperty('diagnosis')
  })

  it('removes only the diagnosis on the requested report', () => {
    const first = makeBug({
      id: 'remove-first',
      diagnosis: makeSavedDiagnosis(),
    })
    const second = makeBug({
      id: 'remove-second',
      diagnosis: makeSavedDiagnosis({ category: 'undefined-name' }),
    })
    seed(first, second)
    const { result } = renderHook(() => useBugWorkspace())

    const removed = runRemove(() => result.current.removeDiagnosis(first.id))
    expect(removed.ok).toBe(true)

    const stored = loadBugState(localStorage).bugs
    expect(stored[0]).not.toHaveProperty('diagnosis')
    expect(stored[1]?.diagnosis?.category).toBe('undefined-name')
  })

  it('returns a typed error for an unknown report and writes nothing', () => {
    const bug = makeBug({
      id: 'remove-known',
      diagnosis: makeSavedDiagnosis(),
    })
    seed(bug)
    const raw = localStorage.getItem(BUGS_STORAGE_KEY)
    const { result } = renderHook(() => useBugWorkspace())

    const failed = runRemove(() => result.current.removeDiagnosis('missing'))
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.code).toBe('bug-not-found')
      expect(failed.message).toMatch(/no longer exists/i)
    }
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    expect(result.current.bugs[0]?.diagnosis).toBeDefined()
  })

  it('returns no-diagnosis and writes nothing when there is nothing to remove', () => {
    const bug = makeBug({ id: 'remove-empty' })
    seed(bug)
    const raw = localStorage.getItem(BUGS_STORAGE_KEY)
    const { result } = renderHook(() => useBugWorkspace())

    const failed = runRemove(() => result.current.removeDiagnosis(bug.id))
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.code).toBe('no-diagnosis')
      expect(failed.message).toMatch(/no saved diagnosis/i)
    }
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
  })

  it('leaves data unchanged when the storage write fails', () => {
    const bug = makeBug({
      id: 'remove-storage-failure',
      diagnosis: makeSavedDiagnosis(),
      proposedFix: 'Keep this fix.',
    })
    seed(bug)
    const raw = localStorage.getItem(BUGS_STORAGE_KEY)
    const { result } = renderHook(() => useBugWorkspace())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })

    const failed = runRemove(() => result.current.removeDiagnosis(bug.id))
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.code).toBe('storage-write-failed')
      expect(failed.message).toMatch(/save|storage|quota/i)
    }
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    expect(result.current.bugs[0]?.diagnosis).toBeDefined()
    expect(result.current.bugs[0]?.proposedFix).toBe('Keep this fix.')
  })
})
