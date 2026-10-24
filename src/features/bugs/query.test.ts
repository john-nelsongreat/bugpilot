import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUG_QUERY,
  computeDashboardStats,
  filterAndSortBugs,
  getProjectOptions,
  getRecentBugs,
} from './query'
import { makeBug } from '../../test/factories'

const bugs = [
  makeBug({
    id: 'bug-critical',
    title: 'Cache stampede after deploy',
    projectName: 'Lumen API',
    language: 'Python',
    severity: 'Critical',
    status: 'Open',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-22T09:00:00.000Z',
  }),
  makeBug({
    id: 'bug-high',
    title: 'Export freezes on large result',
    projectName: 'Fieldnote',
    language: 'TypeScript',
    severity: 'High',
    status: 'In Progress',
    createdAt: '2026-10-19T10:00:00.000Z',
    updatedAt: '2026-10-23T08:00:00.000Z',
  }),
  makeBug({
    id: 'bug-medium',
    title: 'Invite email is not sent',
    projectName: 'Lumen API',
    language: 'JavaScript',
    severity: 'Medium',
    status: 'Resolved',
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-20T11:00:00.000Z',
  }),
  makeBug({
    id: 'bug-low',
    title: 'Help text wraps awkwardly',
    projectName: 'Fieldnote',
    language: 'TypeScript',
    severity: 'Low',
    status: 'Closed',
    createdAt: '2026-10-17T10:00:00.000Z',
    updatedAt: '2026-10-18T13:00:00.000Z',
  }),
]

describe('computeDashboardStats', () => {
  it('counts saved reports by current status and high-risk severity', () => {
    expect(computeDashboardStats(bugs)).toEqual({
      total: 4,
      open: 1,
      inProgress: 1,
      resolved: 1,
      highCritical: 2,
    })
  })

  it('returns zeroes for an empty workspace', () => {
    expect(computeDashboardStats([])).toEqual({
      total: 0,
      open: 0,
      inProgress: 0,
      resolved: 0,
      highCritical: 0,
    })
  })
})

describe('getRecentBugs', () => {
  it('returns the newest reports first and respects the limit', () => {
    const recent = getRecentBugs(bugs, 2)

    expect(recent.map((bug) => bug.id)).toEqual(['bug-critical', 'bug-high'])
  })
})

describe('filterAndSortBugs', () => {
  it('searches across title, project, language, and error text without case sensitivity', () => {
    const byTitle = filterAndSortBugs(bugs, {
      ...DEFAULT_BUG_QUERY,
      search: 'EXPORT',
    })
    const byProject = filterAndSortBugs(bugs, {
      ...DEFAULT_BUG_QUERY,
      search: 'lumen',
    })
    const byError = filterAndSortBugs(
      [
        makeBug({
          id: 'bug-error-search',
          title: 'Pipeline failure',
          errorMessage: 'KeyError: missing database_url',
        }),
        makeBug({ id: 'bug-other', title: 'Unrelated record' }),
      ],
      { ...DEFAULT_BUG_QUERY, search: 'database_url' },
    )

    expect(byTitle.map((bug) => bug.id)).toEqual(['bug-high'])
    expect(byProject.map((bug) => bug.id)).toEqual([
      'bug-critical',
      'bug-medium',
    ])
    expect(byError.map((bug) => bug.id)).toEqual(['bug-error-search'])
  })

  it('combines severity, status, and project filters', () => {
    const filtered = filterAndSortBugs(bugs, {
      ...DEFAULT_BUG_QUERY,
      severity: 'High',
      status: 'In Progress',
      project: 'Fieldnote',
    })

    expect(filtered.map((bug) => bug.id)).toEqual(['bug-high'])
  })

  it('sorts by severity, newest, oldest, recently updated, and title', () => {
    expect(
      filterAndSortBugs(bugs, { ...DEFAULT_BUG_QUERY, sort: 'severity' }).map(
        (bug) => bug.id,
      ),
    ).toEqual(['bug-critical', 'bug-high', 'bug-medium', 'bug-low'])
    expect(
      filterAndSortBugs(bugs, { ...DEFAULT_BUG_QUERY, sort: 'newest' }).map(
        (bug) => bug.id,
      ),
    ).toEqual(['bug-critical', 'bug-high', 'bug-medium', 'bug-low'])
    expect(
      filterAndSortBugs(bugs, { ...DEFAULT_BUG_QUERY, sort: 'oldest' }).map(
        (bug) => bug.id,
      ),
    ).toEqual(['bug-low', 'bug-medium', 'bug-high', 'bug-critical'])
    expect(
      filterAndSortBugs(bugs, { ...DEFAULT_BUG_QUERY, sort: 'updated' }).map(
        (bug) => bug.id,
      ),
    ).toEqual(['bug-high', 'bug-critical', 'bug-medium', 'bug-low'])
    expect(
      filterAndSortBugs(bugs, { ...DEFAULT_BUG_QUERY, sort: 'title' }).map(
        (bug) => bug.id,
      ),
    ).toEqual(['bug-critical', 'bug-high', 'bug-low', 'bug-medium'])
  })

  it('does not mutate the original records', () => {
    const originalOrder = bugs.map((bug) => bug.id)
    filterAndSortBugs(bugs, { ...DEFAULT_BUG_QUERY, sort: 'title' })

    expect(bugs.map((bug) => bug.id)).toEqual(originalOrder)
  })

  it('returns no reports when filters do not match', () => {
    expect(
      filterAndSortBugs(bugs, {
        ...DEFAULT_BUG_QUERY,
        search: 'nothing like this exists',
      }),
    ).toEqual([])
  })
})

describe('getProjectOptions', () => {
  it('returns distinct project names in alphabetical order', () => {
    expect(getProjectOptions(bugs)).toEqual(['Fieldnote', 'Lumen API'])
  })
})
