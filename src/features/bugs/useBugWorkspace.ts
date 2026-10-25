import { useState } from 'react'
import type { Bug, BugDraft, BugStatus } from './types'
import {
  createBug,
  toBugDraft,
  updateBug,
  validateBugDraft,
} from './validation'
import { loadBugState, saveBugs } from './storage'
import {
  applyBugImport,
  type ApplyBugImportResult,
  type ImportMode,
} from './exportImport'
import {
  attachDiagnosisToBug,
  removeDiagnosisFromBug,
  type AttachDiagnosisInput,
  type AttachDiagnosisResult,
  type RemoveDiagnosisResult,
} from './diagnosis'

export type SaveActionResult =
  | { ok: true }
  | { ok: false; message: string }

export type CreateBugResult =
  | { ok: true; bug: Bug }
  | { ok: false; message: string }

export type UpdateBugResult =
  | { ok: true; bug: Bug }
  | { ok: false; message: string }

export function useBugWorkspace() {
  const [initial] = useState(() => loadBugState())
  const [bugs, setBugs] = useState<Bug[]>(initial.bugs)
  const [seeded, setSeeded] = useState(initial.seeded)
  const [issue, setIssue] = useState(initial.issue)

  function commit(next: Bug[]): SaveActionResult {
    const result = saveBugs(next)
    if (!result.ok) return result
    setBugs(next)
    return { ok: true }
  }

  function createReport(draft: BugDraft): CreateBugResult {
    if (Object.keys(validateBugDraft(draft)).length > 0) {
      return { ok: false, message: 'Fix the highlighted fields and try again.' }
    }

    const bug = createBug(draft)
    const result = commit([...bugs, bug])
    if (!result.ok) return result
    return { ok: true, bug }
  }

  function updateReport(id: string, draft: BugDraft): UpdateBugResult {
    const existing = bugs.find((bug) => bug.id === id)
    if (!existing) {
      return { ok: false, message: 'This bug report no longer exists.' }
    }
    if (Object.keys(validateBugDraft(draft)).length > 0) {
      return { ok: false, message: 'Fix the highlighted fields and try again.' }
    }

    const updated = updateBug(existing, draft)
    const next = bugs.map((bug) => (bug.id === id ? updated : bug))
    const result = commit(next)
    if (!result.ok) return result
    return { ok: true, bug: updated }
  }

  function deleteReport(id: string): SaveActionResult {
    return commit(bugs.filter((bug) => bug.id !== id))
  }

  function changeStatus(id: string, status: BugStatus): UpdateBugResult {
    const existing = bugs.find((bug) => bug.id === id)
    if (!existing) {
      return { ok: false, message: 'This bug report no longer exists.' }
    }

    const updated = updateBug(existing, {
      ...toBugDraft(existing),
      status,
    })
    const next = bugs.map((bug) => (bug.id === id ? updated : bug))
    const result = commit(next)
    if (!result.ok) return result
    return { ok: true, bug: updated }
  }

  function attachDiagnosis(
    id: string,
    input: AttachDiagnosisInput,
  ): AttachDiagnosisResult {
    const existing = bugs.find((bug) => bug.id === id)
    if (!existing) {
      return {
        ok: false,
        code: 'bug-not-found',
        message: 'This bug report no longer exists.',
      }
    }

    const attached = attachDiagnosisToBug(existing, input)
    if (!attached.ok) return attached

    const next = bugs.map((bug) => (bug.id === id ? attached.bug : bug))
    const result = commit(next)
    if (!result.ok) {
      return {
        ok: false,
        code: 'storage-write-failed',
        message: result.message,
      }
    }

    return { ok: true, bug: attached.bug }
  }

  function removeDiagnosis(id: string): RemoveDiagnosisResult {
    const existing = bugs.find((bug) => bug.id === id)
    if (!existing) {
      return {
        ok: false,
        code: 'bug-not-found',
        message: 'This bug report no longer exists.',
      }
    }

    const removed = removeDiagnosisFromBug(existing)
    if (!removed.ok) return removed

    const next = bugs.map((bug) => (bug.id === id ? removed.bug : bug))
    const result = commit(next)
    if (!result.ok) {
      return {
        ok: false,
        code: 'storage-write-failed',
        message: result.message,
      }
    }

    return { ok: true, bug: removed.bug }
  }

  function importReports(
    importedBugs: Bug[],
    invalidCount: number,
    mode: ImportMode,
  ): ApplyBugImportResult {
    const result = applyBugImport({
      currentBugs: bugs,
      importedBugs,
      invalidCount,
      mode,
    })
    if (!result.ok) return result

    setBugs(result.bugs)
    setSeeded(false)
    setIssue(null)
    return result
  }

  return {
    bugs,
    seeded,
    issue,
    createReport,
    updateReport,
    deleteReport,
    changeStatus,
    attachDiagnosis,
    removeDiagnosis,
    importReports,
  }
}
