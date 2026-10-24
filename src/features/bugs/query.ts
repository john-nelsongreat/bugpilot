import type { Bug, BugStatus, Severity } from './types'

export const BUG_SORTS = [
  'newest',
  'oldest',
  'severity',
  'updated',
  'title',
] as const
export type BugSort = (typeof BUG_SORTS)[number]

export interface BugQuery {
  search: string
  severity: Severity | 'All'
  status: BugStatus | 'All'
  project: string | 'All'
  sort: BugSort
}

export const DEFAULT_BUG_QUERY: BugQuery = {
  search: '',
  severity: 'All',
  status: 'All',
  project: 'All',
  sort: 'newest',
}

export interface DashboardStats {
  total: number
  open: number
  inProgress: number
  resolved: number
  highCritical: number
}

const SEVERITY_RANK: Record<Severity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
}

export function filterAndSortBugs(bugs: Bug[], query: BugQuery): Bug[] {
  const term = query.search.trim().toLowerCase()

  const filtered = bugs.filter((bug) => {
    if (query.severity !== 'All' && bug.severity !== query.severity) {
      return false
    }
    if (query.status !== 'All' && bug.status !== query.status) {
      return false
    }
    if (query.project !== 'All' && bug.projectName !== query.project) {
      return false
    }
    if (!term) return true

    const searchable = [
      bug.id,
      bug.title,
      bug.projectName,
      bug.language,
      bug.description,
      bug.errorMessage,
      bug.stepsToReproduce,
      bug.expectedBehavior,
      bug.actualBehavior,
      bug.notes,
      bug.proposedFix,
      bug.verificationNotes,
    ]
      .join('\n')
      .toLowerCase()

    return searchable.includes(term)
  })

  return filtered.sort((a, b) => {
    switch (query.sort) {
      case 'oldest':
        return a.createdAt.localeCompare(b.createdAt)
      case 'severity':
        return (
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          b.createdAt.localeCompare(a.createdAt)
        )
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt)
      case 'title':
        return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
      case 'newest':
      default:
        return b.createdAt.localeCompare(a.createdAt)
    }
  })
}

export function computeDashboardStats(bugs: Bug[]): DashboardStats {
  return bugs.reduce<DashboardStats>(
    (stats, bug) => {
      stats.total += 1
      if (bug.status === 'Open') stats.open += 1
      if (bug.status === 'In Progress') stats.inProgress += 1
      if (bug.status === 'Resolved') stats.resolved += 1
      if (bug.severity === 'High' || bug.severity === 'Critical') {
        stats.highCritical += 1
      }
      return stats
    },
    {
      total: 0,
      open: 0,
      inProgress: 0,
      resolved: 0,
      highCritical: 0,
    },
  )
}

export function getRecentBugs(bugs: Bug[], limit = 5): Bug[] {
  return [...bugs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

export function getProjectOptions(bugs: Bug[]): string[] {
  return [...new Set(bugs.map((bug) => bug.projectName))].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  )
}
