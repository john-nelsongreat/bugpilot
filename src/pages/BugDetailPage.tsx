import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, Pencil, Stethoscope, Trash2 } from 'lucide-react'
import { useWorkspace } from '../app/useWorkspace'
import {
  FixStatusBadge,
  SeverityBadge,
  StatusBadge,
} from '../components/Badges'
import { DeleteBugDialog } from '../components/DeleteBugDialog'
import { RemoveDiagnosisDialog } from '../components/RemoveDiagnosisDialog'
import { CONFIDENCE_LABELS, diagnosticCategoryLabel } from '../diagnostics/labels'
import { bugCode, formatDateTime } from '../features/bugs/format'
import { BUG_STATUSES, type BugStatus } from '../features/bugs/types'
import { copyTextToClipboard } from '../lib/clipboard'

type CopyStatus =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

function CopyStatusMessage({ status }: { status: CopyStatus }) {
  return (
    <p
      className={
        status.kind === 'error'
          ? 'assistant-copy-status is-error'
          : 'assistant-copy-status'
      }
      role={status.kind === 'error' ? 'alert' : 'status'}
    >
      {status.message}
    </p>
  )
}

export function BugDetailPage() {
  const { bugId } = useParams()
  const { bugs, changeStatus, deleteReport, removeDiagnosis, notify } =
    useWorkspace()
  const navigate = useNavigate()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [errorCopyStatus, setErrorCopyStatus] = useState<CopyStatus | null>(null)
  const [fixCopyStatus, setFixCopyStatus] = useState<CopyStatus | null>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const removeButtonRef = useRef<HTMLButtonElement>(null)
  const fixHeadingRef = useRef<HTMLHeadingElement>(null)

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setDialogError(null)
    deleteButtonRef.current?.focus()
  }, [])

  const closeRemoveDialog = useCallback(() => {
    setRemoveOpen(false)
    setRemoveError(null)
    removeButtonRef.current?.focus()
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

  async function handleCopy(field: 'error' | 'fix') {
    if (!bug) return
    const text = field === 'error' ? bug.errorMessage : bug.proposedFix
    const label = field === 'error' ? 'Error message' : 'Proposed fix'
    const copied = await copyTextToClipboard(text)
    const status: CopyStatus = copied
      ? { kind: 'success', message: `${label} copied to the clipboard.` }
      : {
          kind: 'error',
          message:
            'Could not copy automatically. Select the text and copy it manually.',
        }

    if (field === 'error') {
      setErrorCopyStatus(status)
    } else {
      setFixCopyStatus(status)
    }
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

  function handleRemoveDiagnosis() {
    if (!bug) return
    const result = removeDiagnosis(bug.id)
    if (!result.ok) {
      setRemoveError(result.message)
      notify(result.message, { tone: 'error' })
      return
    }
    setRemoveOpen(false)
    setRemoveError(null)
    notify('Saved diagnosis removed.')
    fixHeadingRef.current?.focus()
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
              <>
                <div className="detail-copy-row">
                  <Link
                    to={`/assistant?bugId=${encodeURIComponent(bug.id)}`}
                    className="button button--secondary"
                  >
                    <Stethoscope size={15} aria-hidden="true" />
                    Analyse with Assistant
                  </Link>
                  <button
                    type="button"
                    className="button button--secondary assistant-copy"
                    onClick={() => void handleCopy('error')}
                  >
                    <Copy size={15} aria-hidden="true" />
                    Copy error message
                  </button>
                </div>
                {errorCopyStatus ? (
                  <CopyStatusMessage status={errorCopyStatus} />
                ) : null}
                <pre className="code-block">{bug.errorMessage}</pre>
              </>
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

          {bug.diagnosis ? (
            <section
              className="panel detail-section"
              aria-labelledby="saved-diagnosis-heading"
            >
              <div className="section-head section-head--inline diagnosis-head">
                <div>
                  <h2 id="saved-diagnosis-heading">Saved diagnosis</h2>
                  <p>
                    This is a suggestion from the assistant, not a verified fix.
                  </p>
                </div>
                <button
                  type="button"
                  className="button button--danger-ghost"
                  ref={removeButtonRef}
                  onClick={() => {
                    setRemoveError(null)
                    setRemoveOpen(true)
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Remove saved diagnosis
                </button>
              </div>

              <dl className="fact-list">
                <div>
                  <dt>Category</dt>
                  <dd>{diagnosticCategoryLabel(bug.diagnosis.category)}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>
                    {CONFIDENCE_LABELS[bug.diagnosis.confidence]} confidence
                  </dd>
                </div>
                <div>
                  <dt>Signature</dt>
                  <dd>
                    <code className="assistant-signature">
                      {bug.diagnosis.matchedSignature ??
                        'No specific signature'}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Saved</dt>
                  <dd>
                    <time dateTime={bug.diagnosis.savedAt}>
                      {formatDateTime(bug.diagnosis.savedAt)}
                    </time>
                  </dd>
                </div>
              </dl>

              <div className="diagnosis-evidence">
                <h3>Saved evidence</h3>
                {bug.diagnosis.evidence.length > 0 ? (
                  <ul className="assistant-evidence-list">
                    {bug.diagnosis.evidence.map((item, index) => (
                      <li
                        key={`${item.label}-${index}`}
                        className="assistant-evidence"
                      >
                        <div className="assistant-evidence-meta">
                          <span>{item.label}</span>
                        </div>
                        <code className="assistant-quote">{item.quote}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">
                    No evidence was saved with this diagnosis.
                  </p>
                )}
              </div>
            </section>
          ) : null}

          <section className="panel detail-section" aria-labelledby="fix-heading">
            <div className="section-head section-head--inline">
              <div>
                <h2 id="fix-heading" ref={fixHeadingRef} tabIndex={-1}>
                  Fix tracking
                </h2>
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
            {bug.proposedFix ? (
              <>
                <div className="detail-copy-row">
                  <button
                    type="button"
                    className="button button--secondary assistant-copy"
                    onClick={() => void handleCopy('fix')}
                  >
                    <Copy size={15} aria-hidden="true" />
                    Copy proposed fix
                  </button>
                </div>
                {fixCopyStatus ? (
                  <CopyStatusMessage status={fixCopyStatus} />
                ) : null}
              </>
            ) : null}
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

      <RemoveDiagnosisDialog
        open={removeOpen}
        error={removeError}
        onCancel={closeRemoveDialog}
        onConfirm={handleRemoveDiagnosis}
      />
    </>
  )
}
