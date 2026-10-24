import { useState } from 'react'
import type { Bug, BugDraft, BugStatus } from './types'
import {
  createBug,
  toBugDraft,
  updateBug,
  validateBugDraft,
} from './validation'
import { loadBugState, saveBugs } from './storage'

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

  return {
    bugs,
    seeded: initial.seeded,
    issue: initial.issue,
    createReport,
    updateReport,
    deleteReport,
    changeStatus,
  }
}
