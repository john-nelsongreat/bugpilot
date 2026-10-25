import {
  BUG_STATUSES,
  FIX_STATUSES,
  SEVERITIES,
  type Bug,
  type BugDraft,
  type BugStatus,
  type FixStatus,
  type Severity,
} from './types'
import { validateBugDraft, validateSavedDiagnosis } from './validation'
import { createSampleBugs } from './samples'

export const BUGS_STORAGE_KEY = 'bugpilot.bugs.v1'
export const BUG_RECOVERY_STORAGE_KEY = 'bugpilot.bugs.recovery.v1'
const SCHEMA_VERSION = 1

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type StorageIssueCode = 'corrupt' | 'partial' | 'unreadable'

export interface StorageIssue {
  code: StorageIssueCode
  message: string
  skippedRecords?: number
}

export interface LoadBugStateResult {
  bugs: Bug[]
  seeded: boolean
  issue: StorageIssue | null
}

export type SaveBugsResult =
  | { ok: true }
  | { ok: false; message: string }

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const DRAFT_TEXT_FIELDS: Array<keyof BugDraft> = [
  'title',
  'description',
  'projectName',
  'language',
  'errorMessage',
  'stepsToReproduce',
  'expectedBehavior',
  'actualBehavior',
  'notes',
  'proposedFix',
  'verificationNotes',
]

function parseStoredBug(value: unknown): Bug | null {
  if (!isRecord(value)) return null

  if (typeof value.id !== 'string' || value.id.trim() === '') return null
  if (
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    return null
  }
  if (
    typeof value.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    return null
  }

  for (const field of DRAFT_TEXT_FIELDS) {
    if (typeof value[field] !== 'string') return null
  }

  if (!SEVERITIES.includes(value.severity as Severity)) return null
  if (!BUG_STATUSES.includes(value.status as BugStatus)) return null
  if (
    value.fixStatus !== null &&
    !FIX_STATUSES.includes(value.fixStatus as FixStatus)
  ) {
    return null
  }

  const draft: BugDraft = {
    title: value.title as string,
    description: value.description as string,
    projectName: value.projectName as string,
    language: value.language as string,
    errorMessage: value.errorMessage as string,
    stepsToReproduce: value.stepsToReproduce as string,
    expectedBehavior: value.expectedBehavior as string,
    actualBehavior: value.actualBehavior as string,
    severity: value.severity as Severity,
    status: value.status as BugStatus,
    notes: value.notes as string,
    proposedFix: value.proposedFix as string,
    fixStatus: value.fixStatus as FixStatus | null,
    verificationNotes: value.verificationNotes as string,
  }

  if (Object.keys(validateBugDraft(draft)).length > 0) return null

  const diagnosis = Object.hasOwn(value, 'diagnosis')
    ? validateSavedDiagnosis(value.diagnosis)
    : null

  return {
    ...draft,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(diagnosis?.ok ? { diagnosis: diagnosis.diagnosis } : {}),
  }
}

function copyToRecovery(storage: StorageLike, raw: string): void {
  try {
    storage.setItem(BUG_RECOVERY_STORAGE_KEY, raw)
  } catch {
    // The original entry is still untouched; recovery copy is best-effort.
  }
}

function corruptIssue(): StorageIssue {
  return {
    code: 'corrupt',
    message:
      'Stored bug data could not be read, so no saved reports are shown. The original entry was left untouched and a copy was kept in a recovery key.',
  }
}

export function loadBugState(
  storage?: StorageLike | null,
  now: Date = new Date(),
): LoadBugStateResult {
  const target = storage ?? getDefaultStorage()
  if (!target) {
    return {
      bugs: [],
      seeded: false,
      issue: {
        code: 'unreadable',
        message:
          'Browser storage is unavailable, so bug reports cannot be loaded or saved in this browser.',
      },
    }
  }

  let raw: string | null
  try {
    raw = target.getItem(BUGS_STORAGE_KEY)
  } catch {
    return {
      bugs: [],
      seeded: false,
      issue: {
        code: 'unreadable',
        message:
          'Browser storage could not be read. Bug reports are unavailable until storage access is restored.',
      },
    }
  }

  if (raw === null) {
    const samples = createSampleBugs(now)
    const result = saveBugs(samples, target)
    if (!result.ok) {
      return {
        bugs: samples,
        seeded: true,
        issue: {
          code: 'unreadable',
          message: result.message,
        },
      }
    }
    return { bugs: samples, seeded: true, issue: null }
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    copyToRecovery(target, raw)
    return { bugs: [], seeded: false, issue: corruptIssue() }
  }

  if (
    !isRecord(payload) ||
    payload.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(payload.bugs)
  ) {
    copyToRecovery(target, raw)
    return { bugs: [], seeded: false, issue: corruptIssue() }
  }

  const bugs: Bug[] = []
  let skippedRecords = 0

  for (const record of payload.bugs) {
    const bug = parseStoredBug(record)
    if (bug) {
      bugs.push(bug)
    } else {
      skippedRecords += 1
    }
  }

  if (skippedRecords > 0) {
    copyToRecovery(target, raw)
    return {
      bugs,
      seeded: false,
      issue: {
        code: 'partial',
        message: `${skippedRecords} saved ${
          skippedRecords === 1 ? 'report was' : 'reports were'
        } unreadable and skipped. The original entry was left untouched and a copy was kept in a recovery key.`,
        skippedRecords,
      },
    }
  }

  return { bugs, seeded: false, issue: null }
}

export function saveBugs(
  bugs: Bug[],
  storage?: StorageLike | null,
): SaveBugsResult {
  const target = storage ?? getDefaultStorage()
  if (!target) {
    return {
      ok: false,
      message:
        'Bug data could not be saved because browser storage is unavailable.',
    }
  }

  let payload: string
  try {
    payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, bugs })
  } catch {
    return {
      ok: false,
      message: 'Bug data could not be saved because it could not be encoded.',
    }
  }

  try {
    target.setItem(BUGS_STORAGE_KEY, payload)
    return { ok: true }
  } catch {
    return {
      ok: false,
      message:
        'Bug data could not be saved. Browser storage may be full or blocked.',
    }
  }
}
