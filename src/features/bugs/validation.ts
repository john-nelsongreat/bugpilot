import {
  BUG_STATUSES,
  DIAGNOSIS_CONFIDENCES,
  FIX_STATUSES,
  SEVERITIES,
  type Bug,
  type BugDraft,
  type DiagnosisConfidence,
  type FieldErrors,
  type SavedDiagnosis,
  type SavedDiagnosisEvidence,
} from './types'

export const FIELD_LIMITS = {
  title: 140,
  projectName: 80,
  language: 30,
  description: 5000,
  errorMessage: 50000,
  stepsToReproduce: 10000,
  expectedBehavior: 5000,
  actualBehavior: 5000,
  notes: 10000,
  proposedFix: 20000,
  verificationNotes: 5000,
} as const

export const DIAGNOSIS_LIMITS = {
  category: 80,
  ruleId: 80,
  matchedSignature: 300,
  evidence: 5,
  evidenceLabel: 80,
  evidenceQuote: 500,
} as const

const FIELD_LABELS: Record<keyof typeof FIELD_LIMITS, string> = {
  title: 'title',
  projectName: 'project name',
  language: 'programming language',
  description: 'description',
  errorMessage: 'error message',
  stepsToReproduce: 'reproduction steps',
  expectedBehavior: 'expected behavior',
  actualBehavior: 'actual behavior',
  notes: 'notes',
  proposedFix: 'proposed fix',
  verificationNotes: 'verification notes',
}

export type SavedDiagnosisValidation =
  | { ok: true; diagnosis: SavedDiagnosis }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidDiagnosis(reason: string): SavedDiagnosisValidation {
  return { ok: false, reason }
}

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function isValidIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_TIMESTAMP.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

export function validateSavedDiagnosis(
  value: unknown,
): SavedDiagnosisValidation {
  if (!isRecord(value)) {
    return invalidDiagnosis('The saved diagnosis must be an object.')
  }

  if (typeof value.category !== 'string') {
    return invalidDiagnosis('The diagnosis category must be text.')
  }
  if (value.category.length === 0) {
    return invalidDiagnosis('Enter a diagnosis category.')
  }
  if (value.category.length > DIAGNOSIS_LIMITS.category) {
    return invalidDiagnosis(
      `Keep the diagnosis category to ${DIAGNOSIS_LIMITS.category} characters or fewer.`,
    )
  }

  let ruleId: string | undefined
  if (value.ruleId !== undefined) {
    if (typeof value.ruleId !== 'string') {
      return invalidDiagnosis('The diagnosis rule id must be text.')
    }
    if (value.ruleId.length > DIAGNOSIS_LIMITS.ruleId) {
      return invalidDiagnosis(
        `Keep the diagnosis rule id to ${DIAGNOSIS_LIMITS.ruleId} characters or fewer.`,
      )
    }
    ruleId = value.ruleId
  }

  if (
    value.matchedSignature !== null &&
    typeof value.matchedSignature !== 'string'
  ) {
    return invalidDiagnosis('The matched signature must be text or null.')
  }
  if (
    typeof value.matchedSignature === 'string' &&
    value.matchedSignature.length > DIAGNOSIS_LIMITS.matchedSignature
  ) {
    return invalidDiagnosis(
      `Keep the matched signature to ${DIAGNOSIS_LIMITS.matchedSignature} characters or fewer.`,
    )
  }

  if (
    !DIAGNOSIS_CONFIDENCES.includes(
      value.confidence as DiagnosisConfidence,
    )
  ) {
    return invalidDiagnosis('Choose a valid diagnosis confidence.')
  }

  if (!Array.isArray(value.evidence)) {
    return invalidDiagnosis('The diagnosis evidence must be a list.')
  }
  if (value.evidence.length > DIAGNOSIS_LIMITS.evidence) {
    return invalidDiagnosis(
      `Keep the diagnosis evidence to ${DIAGNOSIS_LIMITS.evidence} items or fewer.`,
    )
  }

  const evidence: SavedDiagnosisEvidence[] = []
  for (const item of value.evidence) {
    if (!isRecord(item)) {
      return invalidDiagnosis('Each diagnosis evidence item must be an object.')
    }
    if (typeof item.label !== 'string') {
      return invalidDiagnosis('Each evidence label must be text.')
    }
    if (item.label.length > DIAGNOSIS_LIMITS.evidenceLabel) {
      return invalidDiagnosis(
        `Keep each evidence label to ${DIAGNOSIS_LIMITS.evidenceLabel} characters or fewer.`,
      )
    }
    if (typeof item.quote !== 'string') {
      return invalidDiagnosis('Each evidence quote must be text.')
    }
    if (item.quote.length > DIAGNOSIS_LIMITS.evidenceQuote) {
      return invalidDiagnosis(
        `Keep each evidence quote to ${DIAGNOSIS_LIMITS.evidenceQuote} characters or fewer.`,
      )
    }
    evidence.push({ label: item.label, quote: item.quote })
  }

  if (!isValidIsoTimestamp(value.savedAt)) {
    return invalidDiagnosis(
      'The diagnosis saved date must be a valid ISO timestamp.',
    )
  }

  return {
    ok: true,
    diagnosis: {
      category: value.category,
      ...(ruleId === undefined ? {} : { ruleId }),
      matchedSignature: value.matchedSignature as string | null,
      confidence: value.confidence as DiagnosisConfidence,
      evidence,
      savedAt: value.savedAt,
    },
  }
}

export function validateBugDraft(draft: BugDraft): FieldErrors {
  const errors: FieldErrors = {}

  if (!draft.title.trim()) errors.title = 'Enter a title.'
  if (!draft.projectName.trim()) {
    errors.projectName = 'Enter a project or application name.'
  }
  if (!draft.language.trim()) {
    errors.language = 'Enter the programming language.'
  }
  if (!draft.description.trim()) {
    errors.description = 'Describe the bug so someone else can understand it.'
  }

  for (const field of Object.keys(FIELD_LIMITS) as Array<
    keyof typeof FIELD_LIMITS
  >) {
    const limit = FIELD_LIMITS[field]
    if (draft[field].length > limit) {
      errors[field] = `Keep the ${FIELD_LABELS[field]} to ${limit.toLocaleString('en-US')} characters or fewer.`
    }
  }

  if (!SEVERITIES.includes(draft.severity)) {
    errors.severity = 'Choose a valid severity.'
  }
  if (!BUG_STATUSES.includes(draft.status)) {
    errors.status = 'Choose a valid status.'
  }
  if (draft.fixStatus !== null && !FIX_STATUSES.includes(draft.fixStatus)) {
    errors.fixStatus = 'Choose a valid fix status.'
  }

  if (draft.fixStatus !== null && !draft.proposedFix.trim()) {
    errors.proposedFix = 'Add the proposed fix before setting a fix status.'
  }
  if (
    draft.fixStatus === 'Verified' &&
    !draft.verificationNotes.trim()
  ) {
    errors.verificationNotes =
      'Record how the fix was verified before marking it verified.'
  }

  return errors
}

export function normalizeBugDraft(draft: BugDraft): BugDraft {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    projectName: draft.projectName.trim(),
    language: draft.language.trim(),
    errorMessage: draft.errorMessage.trim(),
    stepsToReproduce: draft.stepsToReproduce.trim(),
    expectedBehavior: draft.expectedBehavior.trim(),
    actualBehavior: draft.actualBehavior.trim(),
    severity: draft.severity,
    status: draft.status,
    notes: draft.notes.trim(),
    proposedFix: draft.proposedFix.trim(),
    fixStatus: draft.fixStatus,
    verificationNotes: draft.verificationNotes.trim(),
  }
}

export function createBugId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID()
  }

  return `bug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createBug(
  draft: BugDraft,
  options: { id?: string; now?: string } = {},
): Bug {
  const timestamp = options.now ?? new Date().toISOString()

  return {
    id: options.id ?? createBugId(),
    ...normalizeBugDraft(draft),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function updateBug(
  existing: Bug,
  draft: BugDraft,
  now: string = new Date().toISOString(),
): Bug {
  return {
    id: existing.id,
    ...normalizeBugDraft(draft),
    createdAt: existing.createdAt,
    updatedAt: now,
    ...(existing.diagnosis === undefined
      ? {}
      : { diagnosis: existing.diagnosis }),
  }
}

export function toBugDraft(bug: Bug): BugDraft {
  return {
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
  }
}
