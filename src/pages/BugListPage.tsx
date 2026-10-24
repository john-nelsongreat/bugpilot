import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Plus, Search } from 'lucide-react'
import { useWorkspace } from '../app/WorkspaceContext'
import { SeverityBadge, StatusBadge } from '../components/Badges'
import { bugCode, formatDate } from '../features/bugs/format'
import {
  BUG_SORTS,
  DEFAULT_BUG_QUERY,
  filterAndSortBugs,
  getProjectOptions,
  type BugQuery,
  type BugSort,
} from '../features/bugs/query'
import {
  BUG_STATUSES,
  SEVERITIES,
  type BugStatus,
  type Severity,
} from '../features/bugs/types'

const SORT_LABELS: Record<BugSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  severity: 'Severity',
  updated: 'Recently updated',
  title: 'Title A–Z',
}

export function BugListPage() {
  const { bugs } = useWorkspace()
  const [query, setQuery] = useState<BugQuery>(DEFAULT_BUG_QUERY)

  const projects = getProjectOptions(bugs)
  const visibleBugs = filterAndSortBugs(bugs, query)
  const hasReports = bugs.length > 0
  const hasActiveFilters =
    query.search.trim() !== '' ||
    query.severity !== 'All' ||
    query.status !== 'All' ||
    query.project !== 'All' ||
    query.sort !== DEFAULT_BUG_QUERY.sort

  function updateQuery(patch: Partial<BugQuery>) {
    setQuery((current) => ({ ...current, ...patch }))
  }

  function clearFilters() {
    setQuery({ ...DEFAULT_BUG_QUERY })
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Saved reports</p>
          <h1>Bug log</h1>
          <p className="page-lede">
            Search the full log, narrow by severity or status, and open a report
            to update its progress.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/bugs/new" className="button button--primary">
            <Plus size={17} aria-hidden="true" />
            Report a bug
          </Link>
        </div>
      </header>

      {!hasReports ? (
        <div className="panel empty-state">
          <span className="empty-icon" aria-hidden="true">
            <ClipboardList size={26} />
          </span>
          <h2>No bugs recorded yet.</h2>
          <p>
            Your log is empty. Add the first report to start tracking what needs
            attention.
          </p>
          <Link to="/bugs/new" className="button button--primary">
            Report your first bug
          </Link>
        </div>
      ) : (
        <>
          <div className="filter-bar" role="search" aria-label="Find bug reports">
            <div className="field filter-search">
              <label htmlFor="bug-search">Search bugs</label>
              <div className="search-control">
                <Search size={16} aria-hidden="true" />
                <input
                  id="bug-search"
                  type="search"
                  value={query.search}
                  onChange={(event) =>
                    updateQuery({ search: event.target.value })
                  }
                  placeholder="Title, project, error text"
                />
              </div>
            </div>

            <div className="field filter-compact">
              <label htmlFor="filter-severity">Filter by severity</label>
              <select
                id="filter-severity"
                value={query.severity}
                onChange={(event) =>
                  updateQuery({ severity: event.target.value as Severity | 'All' })
                }
              >
                <option value="All">All severities</option>
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
            </div>

            <div className="field filter-compact">
              <label htmlFor="filter-status">Filter by status</label>
              <select
                id="filter-status"
                value={query.status}
                onChange={(event) =>
                  updateQuery({ status: event.target.value as BugStatus | 'All' })
                }
              >
                <option value="All">All statuses</option>
                {BUG_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="field filter-compact">
              <label htmlFor="filter-project">Filter by project</label>
              <select
                id="filter-project"
                value={query.project}
                onChange={(event) =>
                  updateQuery({ project: event.target.value })
                }
              >
                <option value="All">All projects</option>
                {projects.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
            </div>

            <div className="field filter-compact">
              <label htmlFor="sort-reports">Sort reports</label>
              <select
                id="sort-reports"
                value={query.sort}
                onChange={(event) =>
                  updateQuery({ sort: event.target.value as BugSort })
                }
              >
                {BUG_SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </option>
                ))}
              </select>
            </div>

            {hasActiveFilters ? (
              <button
                type="button"
                className="button button--quiet clear-filters"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            ) : null}
          </div>

          <p className="result-count" aria-live="polite">
            Showing {visibleBugs.length} of {bugs.length}{' '}
            {bugs.length === 1 ? 'report' : 'reports'}
          </p>

          {visibleBugs.length === 0 ? (
            <div className="panel empty-state empty-state--compact">
              <span className="empty-icon" aria-hidden="true">
                <Search size={24} />
              </span>
              <h2>No reports match these filters.</h2>
              <p>
                Adjust the search term or filters above to bring reports back
                into view.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="bug-table" aria-label="Saved bug reports">
                <thead>
                  <tr>
                    <th scope="col">Report</th>
                    <th scope="col">Project</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Status</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBugs.map((bug) => (
                    <tr key={bug.id}>
                      <td className="cell-report">
                        <Link to={`/bugs/${bug.id}`} className="table-title">
                          {bug.title}
                        </Link>
                        <span className="table-code">{bugCode(bug.id)}</span>
                      </td>
                      <td>{bug.projectName}</td>
                      <td>
                        <SeverityBadge severity={bug.severity} />
                      </td>
                      <td>
                        <StatusBadge status={bug.status} />
                      </td>
                      <td>
                        <time dateTime={bug.updatedAt}>
                          {formatDate(bug.updatedAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
