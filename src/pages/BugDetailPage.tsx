import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { useWorkspace } from '../app/WorkspaceContext'
import {
  FixStatusBadge,
  SeverityBadge,
  StatusBadge,
} from '../components/Badges'
import { DeleteBugDialog } from '../components/DeleteBugDialog'
import { bugCode, formatDateTime } from '../features/bugs/format'
import { BUG_STATUSES, type BugStatus } from '../features/bugs/types'

export function BugDetailPage() {
  const { bugId } = useParams()
  const { bugs, changeStatus, deleteReport, notify } = useWorkspace()
  const navigate = useNavigate()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setDialogError(null)
    deleteButtonRef.current?.focus()
  }, [])

  const bug = bugs.find((item) => item.id === bugId)

  if (!bug) {
    return (
      <div className="panel empty-state">
        <h1>Report not found</h1>
        <p>This report may have been deleted from this browser.</p>
        <Link to="/bugs" className="button button--primary">
          Back to bug log
        </Link>
      </div>
    )
  }

  function handleStatusChange(nextStatus: BugStatus) {
    if (!bug) return
    const result = changeStatus(bug.id, nextStatus)
    if (!result.ok) {
      setActionError(result.message)
      return
    }
    setActionError(null)
    notify(`Status changed to ${nextStatus}.`)
  }

  function handleDelete() {
    if (!bug) return
    const result = deleteReport(bug.id)
    if (!result.ok) {
      setDialogError(result.message)
      return
    }
    setDialogOpen(false)
    notify('Bug deleted.')
    navigate('/bugs')
  }

  return (
    <>
      <Link to="/bugs" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" />
        Bug log
      </Link>

      <header className="detail-head">
        <div className="detail-title">
          <p className="eyebrow">
            {bugCode(bug.id)} · {bug.projectName}
          </p>
          <h1>{bug.title}</h1>
          <div className="badge-row">
            <SeverityBadge severity={bug.severity} />
            <StatusBadge status={bug.status} />
            {bug.fixStatus ? (
              <FixStatusBadge status={bug.fixStatus} />
            ) : (
              <span className="badge badge--muted">No fix recorded</span>
            )}
          </div>
        </div>
        <div className="detail-actions">
          <Link
            to={`/bugs/${bug.id}/edit`}
            className="button button--secondary"
          >
            <Pencil size={16} aria-hidden="true" />
            Edit report
          </Link>
          <button
            type="button"
            className="button button--danger-ghost"
            ref={deleteButtonRef}
            onClick={() => {
              setDialogError(null)
              setDialogOpen(true)
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            Delete bug report
          </button>
        </div>
      </header>

      {actionError ? (
        <div className="notice notice--alert" role="alert">
          <div>
            <strong>That change was not saved</strong>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      <div className="detail-layout">
        <div className="detail-main">
          <section className="panel detail-section" aria-labelledby="desc-heading">
            <h2 id="desc-heading">Description</h2>
            <p className="prose">{bug.description}</p>
          </section>

          <section
            className="panel detail-section"
            aria-labelledby="error-heading"
          >
            <h2 id="error-heading">Error message</h2>
            {bug.errorMessage ? (
              <pre className="code-block">{bug.errorMessage}</pre>
            ) : (
              <p className="muted-copy">No error output was recorded.</p>
            )}
          </section>

          <section
            className="panel detail-section"
            aria-labelledby="steps-heading"
          >
            <h2 id="steps-heading">Steps to reproduce</h2>
            <p className="prose">
              {bug.stepsToReproduce || (
                <span className="muted-copy">No steps were recorded.</span>
              )}
            </p>
          </section>

          <div className="split-sections">
            <section
              className="panel detail-section"
              aria-labelledby="expected-heading"
            >
              <h2 id="expected-heading">Expected behavior</h2>
              <p className="prose">
                {bug.expectedBehavior || (
                  <span className="muted-copy">Not recorded.</span>
                )}
              </p>
            </section>
            <section
              className="panel detail-section"
              aria-labelledby="actual-heading"
            >
              <h2 id="actual-heading">Actual behavior</h2>
              <p className="prose">
                {bug.actualBehavior || (
                  <span className="muted-copy">Not recorded.</span>
                )}
              </p>
            </section>
          </div>

          <section className="panel detail-section" aria-labelledby="notes-heading">
            <h2 id="notes-heading">Notes</h2>
            <p className="prose">
              {bug.notes || (
                <span className="muted-copy">No notes were added.</span>
              )}
            </p>
          </section>

          <section className="panel detail-section" aria-labelledby="fix-heading">
            <div className="section-head section-head--inline">
              <div>
                <h2 id="fix-heading">Fix tracking</h2>
                <p>
                  Fix states are recorded manually. BugPilot never marks a fix
                  as verified.
                </p>
              </div>
              {bug.fixStatus ? (
                <FixStatusBadge status={bug.fixStatus} />
              ) : (
                <span className="badge badge--muted">No fix recorded</span>
              )}
            </div>

            <h3>Proposed fix</h3>
            <p className="prose">
              {bug.proposedFix || (
                <span className="muted-copy">
                  No fix has been proposed yet.
                </span>
              )}
            </p>

            <h3>Verification notes</h3>
            <p className="prose">
              {bug.verificationNotes || (
                <span className="muted-copy">
                  No verification has been recorded.
                </span>
              )}
            </p>
          </section>
        </div>

        <aside className="detail-side" aria-label="Report status and facts">
          <div className="panel fact-panel">
            <div className="status-control">
              <label htmlFor="quick-status">Update status</label>
              <select
                id="quick-status"
                value={bug.status}
                onChange={(event) =>
                  handleStatusChange(event.target.value as BugStatus)
                }
              >
                {BUG_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                This updates the log immediately. Fix status stays as recorded.
              </p>
            </div>

            <dl className="fact-list">
              <div>
                <dt>Project</dt>
                <dd>{bug.projectName}</dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd>{bug.language}</dd>
              </div>
              <div>
                <dt>Severity</dt>
                <dd>
                  <SeverityBadge severity={bug.severity} />
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{bug.status}</dd>
              </div>
              <div>
                <dt>Fix status</dt>
                <dd>{bug.fixStatus ?? 'Not set'}</dd>
              </div>
              <div>
                <dt>Reported</dt>
                <dd>
                  <time dateTime={bug.createdAt}>
                    {formatDateTime(bug.createdAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>
                  <time dateTime={bug.updatedAt}>
                    {formatDateTime(bug.updatedAt)}
                  </time>
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <DeleteBugDialog
        open={dialogOpen}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={handleDelete}
      />
    </>
  )
}
