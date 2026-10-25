import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ClipboardList,
  Plus,
  TriangleAlert,
} from 'lucide-react'
import { useWorkspace } from '../app/useWorkspace'
import { SeverityBadge, StatusBadge } from '../components/Badges'
import { formatDate } from '../features/bugs/format'
import {
  computeDashboardStats,
  getRecentBugs,
} from '../features/bugs/query'

export function DashboardPage() {
  const { bugs } = useWorkspace()
  const stats = computeDashboardStats(bugs)
  const recent = getRecentBugs(bugs, 5)

  const statItems = [
    { label: 'Total bugs', value: stats.total, tone: 'total' },
    { label: 'Open', value: stats.open, tone: 'open' },
    { label: 'In progress', value: stats.inProgress, tone: 'progress' },
    { label: 'Resolved', value: stats.resolved, tone: 'resolved' },
    {
      label: 'High and critical',
      value: stats.highCritical,
      tone: 'risk',
    },
  ]

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Local triage</p>
          <h1>Overview</h1>
          <p className="page-lede">
            A live readout of every report saved in this browser. Each count
            comes from the log, not a placeholder.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/bugs/new" className="button button--primary">
            <Plus size={17} aria-hidden="true" />
            Report a bug
          </Link>
        </div>
      </header>

      <div className="stat-strip">
        {statItems.map((item) => (
          <div
            key={item.label}
            className={`stat-cell stat-cell--${item.tone}`}
            role="group"
            aria-label={`${item.label}: ${item.value}`}
          >
            <span className="stat-value" aria-hidden="true">
              {String(item.value).padStart(2, '0')}
            </span>
            <span className="stat-label" aria-hidden="true">
              {item.label}
            </span>
          </div>
        ))}
      </div>

      <section className="panel recent-panel" aria-labelledby="recent-reports-heading">
        <header className="panel-head">
          <div>
            <p className="eyebrow">Newest first</p>
            <h2 id="recent-reports-heading">Recent reports</h2>
          </div>
          <Link to="/bugs" className="quiet-link">
            View bug log
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </header>

        {recent.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <span className="empty-icon" aria-hidden="true">
              <ClipboardList size={24} />
            </span>
            <h3>No reports yet.</h3>
            <p>Start the log with the first issue you want to track.</p>
            <Link to="/bugs/new" className="button button--secondary">
              Report the first bug
            </Link>
          </div>
        ) : (
          <ul className="recent-list">
            {recent.map((bug) => (
              <li
                key={bug.id}
                className="recent-item"
                data-severity={bug.severity}
              >
                <div className="recent-main">
                  <h3>
                    <Link to={`/bugs/${bug.id}`}>{bug.title}</Link>
                  </h3>
                  <p className="recent-meta">
                    <span>{bug.projectName}</span>
                    <span className="meta-divider" aria-hidden="true">
                      /
                    </span>
                    <span>{bug.language}</span>
                  </p>
                </div>
                <div className="recent-side">
                  <div className="badge-row">
                    <SeverityBadge severity={bug.severity} />
                    <StatusBadge status={bug.status} />
                  </div>
                  <time dateTime={bug.createdAt}>
                    {formatDate(bug.createdAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="triage-note" aria-label="How fix tracking works">
        <span className="triage-icon" aria-hidden="true">
          <TriangleAlert size={18} />
        </span>
        <p>
          A fix is only marked <strong>Verified</strong> when you record it
          yourself. BugPilot never verifies a fix on its own.
        </p>
      </aside>
    </>
  )
}
