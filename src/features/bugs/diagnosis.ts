import type { Bug, SavedDiagnosis } from './types'
import { validateSavedDiagnosis } from './validation'

export type DiagnosisAttachment = Omit<SavedDiagnosis, 'savedAt'>

export interface AttachDiagnosisInput {
  diagnosis: DiagnosisAttachment
  proposedFix?: string
  replaceFix?: boolean
}

export type AttachDiagnosisErrorCode =
  | 'bug-not-found'
  | 'missing-proposed-fix'
  | 'unrecognized-diagnosis'
  | 'invalid-diagnosis'
  | 'storage-write-failed'

export type AttachDiagnosisResult =
  | { ok: true; bug: Bug }
  | { ok: false; code: AttachDiagnosisErrorCode; message: string }

export type RemoveDiagnosisErrorCode =
  | 'bug-not-found'
  | 'no-diagnosis'
  | 'storage-write-failed'

export type RemoveDiagnosisResult =
  | { ok: true; bug: Bug }
  | { ok: false; code: RemoveDiagnosisErrorCode; message: string }

export function attachDiagnosisToBug(
  existing: Bug,
  input: AttachDiagnosisInput,
  now: string = new Date().toISOString(),
): AttachDiagnosisResult {
  if (typeof input.proposedFix !== 'string' || input.proposedFix.trim() === '') {
    return {
      ok: false,
      code: 'missing-proposed-fix',
      message: 'A proposed fix is required before a diagnosis can be saved.',
    }
  }

  const parsed = validateSavedDiagnosis({
    ...(input.diagnosis ?? {}),
    savedAt: now,
  })
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'invalid-diagnosis',
      message: `The diagnosis could not be saved: ${parsed.reason}`,
    }
  }

  if (parsed.diagnosis.category.trim().toLowerCase() === 'unrecognized') {
    return {
      ok: false,
      code: 'unrecognized-diagnosis',
      message: 'This diagnosis is not recognised, so there is no fix to save.',
    }
  }

  const hasExistingFix = existing.proposedFix.trim() !== ''
  const proposedFix =
    hasExistingFix && input.replaceFix !== true
      ? existing.proposedFix
      : input.proposedFix.trim()

  return {
    ok: true,
    bug: {
      ...existing,
      proposedFix,
      fixStatus: existing.fixStatus ?? 'Proposed',
      diagnosis: parsed.diagnosis,
      updatedAt: now,
    },
  }
}

export function removeDiagnosisFromBug(
  existing: Bug,
  now: string = new Date().toISOString(),
): RemoveDiagnosisResult {
  if (existing.diagnosis === undefined) {
    return {
      ok: false,
      code: 'no-diagnosis',
      message: 'This bug has no saved diagnosis to remove.',
    }
  }

  const bug = { ...existing }
  delete bug.diagnosis

  return {
    ok: true,
    bug: {
      ...bug,
      updatedAt: now,
    },
  }
}
