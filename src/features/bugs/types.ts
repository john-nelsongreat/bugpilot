export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const BUG_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const
export type BugStatus = (typeof BUG_STATUSES)[number]

export const FIX_STATUSES = [
  'Proposed',
  'Accepted',
  'Rejected',
  'Verified',
] as const
export type FixStatus = (typeof FIX_STATUSES)[number]

export interface BugDraft {
  title: string
  description: string
  projectName: string
  language: string
  errorMessage: string
  stepsToReproduce: string
  expectedBehavior: string
  actualBehavior: string
  severity: Severity
  status: BugStatus
  notes: string
  proposedFix: string
  fixStatus: FixStatus | null
  verificationNotes: string
}

export interface Bug extends BugDraft {
  id: string
  createdAt: string
  updatedAt: string
}

export type BugField = keyof BugDraft
export type FieldErrors = Partial<Record<BugField, string>>
