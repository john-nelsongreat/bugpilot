import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import { useWorkspace } from '../app/WorkspaceContext'
import { bugCode } from '../features/bugs/format'
import {
  BUG_STATUSES,
  FIX_STATUSES,
  SEVERITIES,
  type Bug,
  type BugDraft,
  type BugField,
  type BugStatus,
  type FieldErrors,
  type FixStatus,
  type Severity,
} from '../features/bugs/types'
import { toBugDraft, validateBugDraft } from '../features/bugs/validation'

const EMPTY_DRAFT: BugDraft = {
  title: '',
  description: '',
  projectName: '',
  language: '',
  errorMessage: '',
  stepsToReproduce: '',
  expectedBehavior: '',
  actualBehavior: '',
  severity: 'Medium',
  status: 'Open',
  notes: '',
  proposedFix: '',
  fixStatus: null,
  verificationNotes: '',
}

const FIELD_NAMES: Record<BugField, string> = {
  title: 'Title',
  description: 'Description',
  projectName: 'Project or application',
  language: 'Programming language',
  errorMessage: 'Error message or traceback',
  stepsToReproduce: 'Steps to reproduce',
  expectedBehavior: 'Expected behavior',
  actualBehavior: 'Actual behavior',
  severity: 'Severity',
  status: 'Status',
  notes: 'Notes',
  proposedFix: 'Proposed fix',
  fixStatus: 'Fix status',
  verificationNotes: 'Verification notes',
}

export function BugFormPage() {
  const { bugId } = useParams()
  const { bugs } = useWorkspace()
  const existing = bugId ? bugs.find((bug) => bug.id === bugId) : undefined

  if (bugId && !existing) {
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

  return (
    <BugReportForm
      key={existing?.id ?? 'new-report'}
      existing={existing}
    />
  )
}

function BugReportForm({ existing }: { existing?: Bug }) {
  const { createReport, updateReport, notify } = useWorkspace()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<BugDraft>(() =>
    existing ? toBugDraft(existing) : EMPTY_DRAFT,
  )
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitCount, setSubmitCount] = useState(0)
  const summaryRef = useRef<HTMLDivElement>(null)

  const isEditing = Boolean(existing)
  const errorEntries = Object.entries(errors) as Array<[BugField, string]>
  const cancelTo = existing ? `/bugs/${existing.id}` : '/bugs'

  useEffect(() => {
    if (submitCount > 0) summaryRef.current?.focus()
  }, [submitCount])

  function setField<K extends BugField>(field: K, value: BugDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }))
    setSubmitError(null)
    setErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      if (field === 'fixStatus' && value !== 'Verified') {
        delete next.verificationNotes
      }
      return next
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateBugDraft(draft)

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      setSubmitError(null)
      setSubmitCount((count) => count + 1)
      return
    }

    const result = existing
      ? updateReport(existing.id, draft)
      : createReport(draft)

    if (!result.ok) {
      setSubmitError(result.message)
      return
    }

    notify(existing ? 'Changes saved.' : 'Bug report created.')
    navigate(`/bugs/${result.bug.id}`)
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">
            {existing ? `Editing ${bugCode(existing.id)}` : 'New report'}
          </p>
          <h1>{existing ? 'Edit bug report' : 'Report a bug'}</h1>
          <p className="page-lede">
            Capture what happened while the details are fresh. Only the first
            four fields are required; everything else can be filled in later.
          </p>
        </div>
        <div className="page-actions">
          <Link to={cancelTo} className="button button--secondary">
            <ArrowLeft size={16} aria-hidden="true" />
            Cancel
          </Link>
        </div>
      </header>

      {submitError ? (
        <div className="notice notice--alert" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <strong>The report could not be saved</strong>
            <p>{submitError}</p>
          </div>
        </div>
      ) : null}

      {errorEntries.length > 0 ? (
        <div
          className="form-summary"
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
        >
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <strong>Fix the highlighted fields and try again.</strong>
            <ul>
              {errorEntries.map(([field, message]) => (
                <li key={field}>
                  <a href={`#${field}`}>{FIELD_NAMES[field]}</a>
                  <span>: {message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <form className="bug-form" onSubmit={handleSubmit} noValidate>
        <section className="form-section" aria-labelledby="basics-heading">
          <div className="section-head">
            <h2 id="basics-heading">Report basics</h2>
            <p>Identify the report and where it happened.</p>
          </div>

          <div className="form-grid">
            <div className="field field--full">
              <label htmlFor="title">Title</label>
              <input
                id="title"
                type="text"
                value={draft.title}
                onChange={(event) => setField('title', event.target.value)}
                placeholder="A short, specific summary"
                required
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? 'title-error' : undefined}
              />
              {errors.title ? (
                <p className="field-error" id="title-error">
                  {errors.title}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="projectName">Project or application</label>
              <input
                id="projectName"
                type="text"
                value={draft.projectName}
                onChange={(event) =>
                  setField('projectName', event.target.value)
                }
                placeholder="For example, Northstar Checkout"
                required
                aria-invalid={errors.projectName ? true : undefined}
                aria-describedby={
                  errors.projectName ? 'projectName-error' : undefined
                }
              />
              {errors.projectName ? (
                <p className="field-error" id="projectName-error">
                  {errors.projectName}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="language">Programming language</label>
              <input
                id="language"
                type="text"
                value={draft.language}
                onChange={(event) => setField('language', event.target.value)}
                placeholder="TypeScript, Python, CSS…"
                required
                aria-invalid={errors.language ? true : undefined}
                aria-describedby={
                  errors.language ? 'language-error' : undefined
                }
              />
              {errors.language ? (
                <p className="field-error" id="language-error">
                  {errors.language}
                </p>
              ) : null}
            </div>

            <div className="field field--full">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                rows={4}
                value={draft.description}
                onChange={(event) =>
                  setField('description', event.target.value)
                }
                placeholder="What is wrong, and who does it affect?"
                required
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={
                  errors.description ? 'description-error' : undefined
                }
              />
              {errors.description ? (
                <p className="field-error" id="description-error">
                  {errors.description}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="form-section" aria-labelledby="happened-heading">
          <div className="section-head">
            <h2 id="happened-heading">What happened</h2>
            <p>The evidence someone needs to reproduce the issue.</p>
          </div>

          <div className="form-grid">
            <div className="field field--full">
              <div className="label-row">
                <label htmlFor="errorMessage">Error message or traceback</label>
                <span className="optional-tag">Optional</span>
              </div>
              <textarea
                id="errorMessage"
                className="code-input"
                rows={5}
                value={draft.errorMessage}
                onChange={(event) =>
                  setField('errorMessage', event.target.value)
                }
                placeholder="Paste the raw error or stack trace here."
                aria-invalid={errors.errorMessage ? true : undefined}
                aria-describedby={
                  errors.errorMessage ? 'errorMessage-error' : undefined
                }
              />
              {errors.errorMessage ? (
                <p className="field-error" id="errorMessage-error">
                  {errors.errorMessage}
                </p>
              ) : null}
            </div>

            <div className="field field--full">
              <div className="label-row">
                <label htmlFor="stepsToReproduce">Steps to reproduce</label>
                <span className="optional-tag">Optional</span>
              </div>
              <textarea
                id="stepsToReproduce"
                rows={4}
                value={draft.stepsToReproduce}
                onChange={(event) =>
                  setField('stepsToReproduce', event.target.value)
                }
                placeholder={'1. Go to…\n2. Click…\n3. Notice…'}
                aria-invalid={errors.stepsToReproduce ? true : undefined}
                aria-describedby={
                  errors.stepsToReproduce
                    ? 'stepsToReproduce-error'
                    : undefined
                }
              />
              {errors.stepsToReproduce ? (
                <p className="field-error" id="stepsToReproduce-error">
                  {errors.stepsToReproduce}
                </p>
              ) : null}
            </div>

            <div className="field">
              <div className="label-row">
                <label htmlFor="expectedBehavior">Expected behavior</label>
                <span className="optional-tag">Optional</span>
              </div>
              <textarea
                id="expectedBehavior"
                rows={3}
                value={draft.expectedBehavior}
                onChange={(event) =>
                  setField('expectedBehavior', event.target.value)
                }
                placeholder="What should have happened?"
                aria-invalid={errors.expectedBehavior ? true : undefined}
                aria-describedby={
                  errors.expectedBehavior
                    ? 'expectedBehavior-error'
                    : undefined
                }
              />
              {errors.expectedBehavior ? (
                <p className="field-error" id="expectedBehavior-error">
                  {errors.expectedBehavior}
                </p>
              ) : null}
            </div>

            <div className="field">
              <div className="label-row">
                <label htmlFor="actualBehavior">Actual behavior</label>
                <span className="optional-tag">Optional</span>
              </div>
              <textarea
                id="actualBehavior"
                rows={3}
                value={draft.actualBehavior}
                onChange={(event) =>
                  setField('actualBehavior', event.target.value)
                }
                placeholder="What happened instead?"
                aria-invalid={errors.actualBehavior ? true : undefined}
                aria-describedby={
                  errors.actualBehavior ? 'actualBehavior-error' : undefined
                }
              />
              {errors.actualBehavior ? (
                <p className="field-error" id="actualBehavior-error">
                  {errors.actualBehavior}
                </p>
              ) : null}
            </div>

            <div className="field field--full">
              <div className="label-row">
                <label htmlFor="notes">Notes</label>
                <span className="optional-tag">Optional</span>
              </div>
              <textarea
                id="notes"
                rows={3}
                value={draft.notes}
                onChange={(event) => setField('notes', event.target.value)}
                placeholder="Context, workarounds, or related reports."
                aria-invalid={errors.notes ? true : undefined}
                aria-describedby={errors.notes ? 'notes-error' : undefined}
              />
              {errors.notes ? (
                <p className="field-error" id="notes-error">
                  {errors.notes}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="form-section" aria-labelledby="fix-heading">
          <div className="section-head">
            <h2 id="fix-heading">Fix tracking</h2>
            <p>
              Fix states are manual. Nothing is verified automatically — choose
              Verified only after you have checked the fix yourself.
            </p>
          </div>

          <div className="form-grid">
            <div className="field field--full">
              <div className="label-row">
                <label htmlFor="proposedFix">Proposed fix</label>
                <span className="optional-tag">Required with a fix status</span>
              </div>
              <textarea
                id="proposedFix"
                rows={4}
                value={draft.proposedFix}
                onChange={(event) =>
                  setField('proposedFix', event.target.value)
                }
                placeholder="Describe the change you think will resolve it. Do not paste code you have not reviewed."
                aria-invalid={errors.proposedFix ? true : undefined}
                aria-describedby={
                  errors.proposedFix ? 'proposedFix-error' : undefined
                }
              />
              {errors.proposedFix ? (
                <p className="field-error" id="proposedFix-error">
                  {errors.proposedFix}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="severity">Severity</label>
              <select
                id="severity"
                value={draft.severity}
                onChange={(event) =>
                  setField('severity', event.target.value as Severity)
                }
              >
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="status">Status</label>
              <select
                id="status"
                value={draft.status}
                onChange={(event) =>
                  setField('status', event.target.value as BugStatus)
                }
              >
                {BUG_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="fixStatus">Fix status</label>
              <select
                id="fixStatus"
                value={draft.fixStatus ?? ''}
                onChange={(event) =>
                  setField(
                    'fixStatus',
                    event.target.value === ''
                      ? null
                      : (event.target.value as FixStatus),
                  )
                }
                aria-invalid={errors.fixStatus ? true : undefined}
                aria-describedby={
                  errors.fixStatus ? 'fixStatus-error' : undefined
                }
              >
                <option value="">No fix recorded</option>
                {FIX_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              {errors.fixStatus ? (
                <p className="field-error" id="fixStatus-error">
                  {errors.fixStatus}
                </p>
              ) : null}
            </div>

            <div className="field">
              <div className="label-row">
                <label htmlFor="verificationNotes">Verification notes</label>
                <span className="optional-tag">Required when verified</span>
              </div>
              <textarea
                id="verificationNotes"
                rows={3}
                value={draft.verificationNotes}
                onChange={(event) =>
                  setField('verificationNotes', event.target.value)
                }
                placeholder="What did you check, and what was the result?"
                aria-invalid={errors.verificationNotes ? true : undefined}
                aria-describedby={
                  errors.verificationNotes
                    ? 'verificationNotes-error'
                    : undefined
                }
              />
              {errors.verificationNotes ? (
                <p className="field-error" id="verificationNotes-error">
                  {errors.verificationNotes}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <div className="form-actions">
          <button type="submit" className="button button--primary">
            {isEditing ? 'Save changes' : 'Create bug'}
          </button>
          <Link to={cancelTo} className="button button--secondary">
            Cancel
          </Link>
          <p className="form-save-note">
            Saved locally in this browser. Nothing leaves your machine.
          </p>
        </div>
      </form>
    </>
  )
}
