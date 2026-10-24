import {
  BUG_STATUSES,
  FIX_STATUSES,
  SEVERITIES,
  type Bug,
  type BugDraft,
  type FieldErrors,
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
