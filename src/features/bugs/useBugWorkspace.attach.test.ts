import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeBug, makeSavedDiagnosis } from '../../test/factories'
import { BUGS_STORAGE_KEY, loadBugState, saveBugs } from './storage'
import type { AttachDiagnosisInput, AttachDiagnosisResult } from './diagnosis'
import { useBugWorkspace } from './useBugWorkspace'

const ATTACHMENT: AttachDiagnosisInput = {
  diagnosis: {
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
  },
  proposedFix: 'Install pandas in the active environment.',
}

function seed(...bugs: ReturnType<typeof makeBug>[]) {
  const result = saveBugs(bugs)
  expect(result.ok).toBe(true)
}

function runAttach(run: () => AttachDiagnosisResult): AttachDiagnosisResult {
  const outcomes: AttachDiagnosisResult[] = []
  act(() => {
    outcomes.push(run())
  })
  const outcome = outcomes[0]
  if (!outcome) throw new Error('Expected an attachment result')
  return outcome
}

describe('useBugWorkspace.attachDiagnosis', () => {
  it('attaches a diagnosis through storage and exposes the saved report', () => {
    const bug = makeBug({
      id: 'workspace-attach',
      proposedFix: '',
      fixStatus: null,
    })
    seed(bug)
    const { result } = renderHook(() => useBugWorkspace())

    const saved = runAttach(() =>
      result.current.attachDiagnosis(bug.id, ATTACHMENT),
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const stored = loadBugState(localStorage).bugs[0]
    expect(stored.diagnosis).toEqual(saved.bug.diagnosis)
    expect(stored.proposedFix).toBe(ATTACHMENT.proposedFix)
    expect(stored.fixStatus).toBe('Proposed')
    expect(stored.updatedAt).toBe(saved.bug.updatedAt)
    expect(stored.updatedAt).not.toBe(bug.updatedAt)
    expect(result.current.bugs[0].diagnosis).toEqual(saved.bug.diagnosis)
  })

  it('returns a typed error for an unknown report and writes nothing', () => {
    const bug = makeBug({ id: 'workspace-known' })
    seed(bug)
    const raw = localStorage.getItem(BUGS_STORAGE_KEY)
    const { result } = renderHook(() => useBugWorkspace())

    const failed = runAttach(() =>
      result.current.attachDiagnosis('missing-report', ATTACHMENT),
    )
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.code).toBe('bug-not-found')
      expect(failed.message).toMatch(/no longer exists/i)
    }
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    expect(result.current.bugs).toEqual([bug])
  })

  it('leaves data unchanged when the storage write fails', () => {
    const bug = makeBug({
      id: 'workspace-storage-failure',
      proposedFix: '',
      fixStatus: null,
    })
    seed(bug)
    const raw = localStorage.getItem(BUGS_STORAGE_KEY)
    const { result } = renderHook(() => useBugWorkspace())
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })

    const failed = runAttach(() =>
      result.current.attachDiagnosis(bug.id, ATTACHMENT),
    )
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.code).toBe('storage-write-failed')
      expect(failed.message).toMatch(/save|storage|quota/i)
    }
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    expect(result.current.bugs[0].diagnosis).toBeUndefined()
    expect(result.current.bugs[0].proposedFix).toBe('')
  })

  it('keeps one diagnosis when attached twice', () => {
    const bug = makeBug({
      id: 'workspace-replace',
      proposedFix: '',
      fixStatus: null,
    })
    seed(bug)
    const { result } = renderHook(() => useBugWorkspace())

    act(() => {
      result.current.attachDiagnosis(bug.id, ATTACHMENT)
    })
    act(() => {
      result.current.attachDiagnosis(bug.id, {
        ...ATTACHMENT,
        diagnosis: {
          ...ATTACHMENT.diagnosis,
          category: 'undefined-name',
        },
      })
    })

    const stored = loadBugState(localStorage).bugs[0]
    expect(stored.diagnosis?.category).toBe('undefined-name')
    expect(Object.keys(stored).filter((key) => key === 'diagnosis')).toHaveLength(
      1,
    )
  })

  it('removes the diagnosis when the report is deleted', () => {
    const diagnosis = makeSavedDiagnosis()
    const bug = makeBug({ id: 'workspace-delete', diagnosis })
    seed(bug)
    const { result } = renderHook(() => useBugWorkspace())

    act(() => {
      const deletion = result.current.deleteReport(bug.id)
      expect(deletion.ok).toBe(true)
    })

    expect(loadBugState(localStorage).bugs).toEqual([])
  })
})
