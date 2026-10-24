import {
  FIX_STATUSES,
  type Bug,
  type BugDraft,
  type BugStatus,
  type FixStatus,
  type Severity,
} from './types'
import { validateBugDraft } from './validation'
import {
  BUGS_STORAGE_KEY,
  saveBugs,
  type StorageLike,
} from './storage'

export const EXPORT_APP = 'bugpilot'
export const EXPORT_SCHEMA_VERSION = 1
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_REPORTS = 5000
export const PREIMPORT_STORAGE_KEY = 'bugpilot.bugs.preimport.v1'

export interface BugExport {
  app: typeof EXPORT_APP
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  exportedAt: string
  bugs: Bug[]
}

export interface ImportIssue {
  position: number
  reason: string
}

export type ImportParseResult =
  | {
      ok: true
      bugs: Bug[]
      invalidCount: number
      issues: ImportIssue[]
    }
  | { ok: false; message: string }

export type ImportParseSuccess = Extract<ImportParseResult, { ok: true }>

export type ImportMode = 'merge' | 'replace'

export type ApplyBugImportResult =
  | {
      ok: true
      bugs: Bug[]
      added: number
      skipped: number
      replaced: number
    }
  | { ok: false; message: string }

export type ApplyBugImportSuccess = Extract<
  ApplyBugImportResult,
  { ok: true }
>

const TEXT_FIELDS = [
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
] as const

type TextField = (typeof TEXT_FIELDS)[number]

const TEXT_FIELD_LABELS: Record<TextField, string> = {
  title: 'title',
  description: 'description',
  projectName: 'project name',
  language: 'programming language',
  errorMessage: 'error message',
  stepsToReproduce: 'reproduction steps',
  expectedBehavior: 'expected behavior',
  actualBehavior: 'actual behavior',
  notes: 'notes',
  proposedFix: 'proposed fix',
  verificationNotes: 'verification notes',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toExportedBug(bug: Bug): Bug {
  return {
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
    status: bug.status,
    notes: bug.notes,
    proposedFix: bug.proposedFix,
    fixStatus: bug.fixStatus,
    verificationNotes: bug.verificationNotes,
    createdAt: bug.createdAt,
    updatedAt: bug.updatedAt,
  }
}

export function buildBugExport(
  bugs: Bug[],
  exportedAt: Date = new Date(),
): BugExport {
  return {
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    bugs: bugs.map(toExportedBug),
  }
}

export function serializeBugExport(
  bugs: Bug[],
  exportedAt: Date = new Date(),
): string {
  return JSON.stringify(buildBugExport(bugs, exportedAt), null, 2)
}

export function getExportFileName(exportedAt: Date = new Date()): string {
  return `bugpilot-export-${exportedAt.toISOString().slice(0, 10)}.json`
}

function parseImportedBug(
  value: unknown,
): { bug: Bug } | { reason: string } {
  if (!isRecord(value)) {
    return { reason: 'The entry is not a report object.' }
  }

  if (typeof value.id !== 'string' || value.id.trim() === '') {
    return { reason: 'The report id is missing or empty.' }
  }

  if (
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    return { reason: 'The created date is not a valid date.' }
  }

  if (
    typeof value.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    return { reason: 'The updated date is not a valid date.' }
  }

  for (const field of TEXT_FIELDS) {
    if (typeof value[field] !== 'string') {
      return {
        reason: `The ${TEXT_FIELD_LABELS[field]} must be text.`,
      }
    }
  }

  if (
    value.fixStatus !== null &&
    !FIX_STATUSES.includes(value.fixStatus as FixStatus)
  ) {
    return { reason: 'Choose a valid fix status.' }
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

  const errors = validateBugDraft(draft)
  const firstError = Object.values(errors)[0]
  if (firstError) return { reason: firstError }

  return {
    bug: toExportedBug({
      ...draft,
      id: value.id,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }),
  }
}

export function parseBugImport(text: string): ImportParseResult {
  if (new Blob([text]).size > MAX_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      message: 'This file is larger than 5 MB. Choose a smaller export.',
    }
  }

  const withoutBom = text.replace(/^\uFEFF/, '')
  if (withoutBom.trim() === '') {
    return { ok: false, message: 'The selected file is empty.' }
  }

  let payload: unknown
  try {
    payload = JSON.parse(withoutBom)
  } catch {
    return {
      ok: false,
      message: 'This file is not valid JSON. Choose a BugPilot JSON export.',
    }
  }

  if (!isRecord(payload) || payload.app !== EXPORT_APP) {
    return { ok: false, message: 'This file is not a BugPilot export.' }
  }

  if (
    typeof payload.schemaVersion === 'number' &&
    payload.schemaVersion > EXPORT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      message:
        'This file was created by a newer version of BugPilot. Update BugPilot before importing it.',
    }
  }

  if (payload.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `This file has an unsupported schema version. Only version ${EXPORT_SCHEMA_VERSION} exports can be imported.`,
    }
  }

  if (!Array.isArray(payload.bugs)) {
    return { ok: false, message: 'This file does not contain a bugs array.' }
  }

  if (payload.bugs.length > MAX_IMPORT_REPORTS) {
    return {
      ok: false,
      message:
        'This file contains more than 5,000 reports. Choose a smaller export.',
    }
  }

  const bugs: Bug[] = []
  const issues: ImportIssue[] = []
  const seenIds = new Set<string>()

  payload.bugs.forEach((record, index) => {
    const parsed = parseImportedBug(record)
    if ('reason' in parsed) {
      issues.push({ position: index + 1, reason: parsed.reason })
      return
    }
    if (seenIds.has(parsed.bug.id)) {
      issues.push({
        position: index + 1,
        reason: `Duplicate id "${parsed.bug.id}" inside this file.`,
      })
      return
    }
    seenIds.add(parsed.bug.id)
    bugs.push(parsed.bug)
  })

  return {
    ok: true,
    bugs,
    invalidCount: issues.length,
    issues,
  }
}

export function countExistingBugIds(
  imported: Bug[],
  current: Bug[],
): number {
  const currentIds = new Set(current.map((bug) => bug.id))
  return imported.filter((bug) => currentIds.has(bug.id)).length
}

export function applyBugImport(options: {
  currentBugs: Bug[]
  importedBugs: Bug[]
  invalidCount: number
  mode: ImportMode
  storage?: StorageLike | null
}): ApplyBugImportResult {
  const { currentBugs, importedBugs, invalidCount, mode, storage } = options

  if (importedBugs.length === 0) {
    return {
      ok: false,
      message: 'There are no valid reports to import, so nothing was changed.',
    }
  }

  let rawCurrent: string | null
  try {
    const target = storage ?? window.localStorage
    rawCurrent = target.getItem(BUGS_STORAGE_KEY)
  } catch {
    return {
      ok: false,
      message:
        'Saved reports could not be read. Your reports are unchanged. Check that browser storage is available.',
    }
  }

  let nextBugs: Bug[]
  let added: number
  let skipped: number
  let replaced: number

  if (mode === 'merge') {
    const currentIds = new Set(currentBugs.map((bug) => bug.id))
    const additions = importedBugs.filter((bug) => !currentIds.has(bug.id))
    nextBugs = [...currentBugs, ...additions]
    added = additions.length
    skipped = invalidCount + (importedBugs.length - additions.length)
    replaced = 0
  } else {
    nextBugs = [...importedBugs]
    added = importedBugs.length
    skipped = invalidCount
    replaced = currentBugs.length
  }

  const backupTarget = storage ?? window.localStorage
  try {
    backupTarget.setItem(PREIMPORT_STORAGE_KEY, rawCurrent ?? '')
  } catch {
    return {
      ok: false,
      message:
        'The current reports could not be backed up. Your reports are unchanged. Browser storage may be full or blocked.',
    }
  }

  const saved = saveBugs(nextBugs, storage)
  if (!saved.ok) {
    return {
      ok: false,
      message: `${saved.message} Your existing reports were left unchanged.`,
    }
  }

  return { ok: true, bugs: nextBugs, added, skipped, replaced }
}
