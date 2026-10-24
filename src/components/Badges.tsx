import type { BugStatus, FixStatus, Severity } from '../features/bugs/types'

function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-')
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`badge badge--${slug(severity)}`}>{severity}</span>
  )
}

export function StatusBadge({ status }: { status: BugStatus }) {
  return <span className={`badge badge--${slug(status)}`}>{status}</span>
}

export function FixStatusBadge({ status }: { status: FixStatus }) {
  return (
    <span className={`badge badge--fix-${slug(status)}`}>{status}</span>
  )
}
