import { Suspense, lazy, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AlertTriangle, Download, RotateCcw } from 'lucide-react'
import type { Severity } from '../../bugs/types'
import type { ArchiveEntry } from '../archive/guard'
import type { DownloadReportFile } from '../export/reportFiles'
import { prepareFixPlan as prepareFixPlanDefault, type FixPlan } from '../fixes/plan'
import type { FixCandidate } from '../fixes/types'
import { NOT_CHECKED_BY_LANGUAGE, languageLabel } from '../languages'
import { splitNoteFindings } from '../rules/notes'
import { sanitizeCodeForDisplay, sanitizeForDisplay, truncateForDisplay } from '../sanitize/display'
import type { AnalyzerFinding, AnalyzerReport, CoverageTier } from '../types'

const FixReview = lazy(() => import('./FixReview'))
const CleanExportPanel = lazy(() => import('./CleanExportPanel'))

export type PrepareFixPlan = (
  findings: readonly AnalyzerFinding[],
  sources: readonly ArchiveEntry[],
  signal?: AbortSignal,
) => Promise<FixPlan>

const defaultPrepareFixPlan: PrepareFixPlan = (findings, sources, signal) =>
  prepareFixPlanDefault(findings, sources, {}, signal, {
    maxCandidates: MAX_PLAN_FINDINGS,
    maxCandidateSourceBytes: MAX_PLAN_TEXT_BYTES,
  })

const EMPTY_SOURCES: readonly ArchiveEntry[] = []
const EMPTY_PLAN: FixPlan = { available: [], unavailable: new Map(), dropped: [] }

/** Rendering every card of a 20,000-finding report is what froze the page; these caps keep it alive. */
const FINDINGS_PAGE_SIZE = 40
const NOTE_PAGE_SIZE = 40
const COVERAGE_PAGE_SIZE = 100

/**
 * Fix planning copies each file once per candidate and re-runs the analyzers on those copies.
 * A bounded slice keeps that work and its memory in proportion to what a user can act on.
 */
const MAX_PLAN_FINDINGS = 200
const MAX_PLAN_TEXT_BYTES = 8 * 1024 * 1024

const SEVERITY_OPTIONS: readonly Severity[] = ['Critical', 'High', 'Medium', 'Low']

const TIER_LABELS: Record<CoverageTier['tier'], string> = {
  syntax: 'Syntax',
  pattern: 'Pattern rules',
  'type-or-dataflow': 'Type or data-flow',
}

function severityClass(severity: Severity): string {
  return `badge badge--${severity.toLowerCase()}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / 1_048_576).toFixed(1)} MiB`
}

function tierText(tier: CoverageTier): string {
  if (!tier.available) return `not available: ${sanitizeForDisplay(tier.reason)}`
  if (tier.ran) return 'ran'
  return `not run: ${sanitizeForDisplay(tier.reason)}`
}

const NAME_DISPLAY_LIMIT = 72

function FileName({ name }: { name: string }) {
  const full = sanitizeForDisplay(name)
  return <code title={full}>{truncateForDisplay(full, NAME_DISPLAY_LIMIT)}</code>
}

function findingGroups(findings: readonly AnalyzerFinding[]): [string, AnalyzerFinding[]][] {
  const groups = new Map<string, AnalyzerFinding[]>()
  for (const finding of findings) {
    const group = groups.get(finding.file)
    if (group) group.push(finding)
    else groups.set(finding.file, [finding])
  }
  return [...groups.entries()]
}

interface FindingCardProps {
  finding: AnalyzerFinding
  candidate?: FixCandidate
  unavailableReason?: string
  checked: boolean
  onSelect: (checked: boolean) => void
}

function FindingCard({ finding, candidate, unavailableReason, checked, onSelect }: FindingCardProps) {
  const titleId = `finding-${finding.id}`
  return (
    <article className="analyze-finding" aria-labelledby={titleId}>
      <header className="analyze-finding-head">
        <div className="badge-row">
          <span className={severityClass(finding.severity)}>{finding.severity}</span>
          <span className="badge badge--muted">{finding.confidence.level} confidence</span>
          <span className="badge badge--muted">{finding.tier}</span>
        </div>
        <p className="analyze-finding-meta">
          <code>{sanitizeForDisplay(finding.ruleId)}</code>
          <span aria-hidden="true"> · </span>
          <span>Line {finding.range.startLine}</span>
        </p>
        <h4 id={titleId}>{sanitizeForDisplay(finding.message)}</h4>
        <p className="field-hint">{sanitizeForDisplay(finding.confidence.reason)}</p>
      </header>

      <p className="prose">{sanitizeForDisplay(finding.explanation)}</p>

      {finding.evidence.length > 0 ? (
        <div className="analyze-finding-section">
          <p className="eyebrow">Evidence</p>
          <ul className="analyze-evidence-list">
            {finding.evidence.map((evidence, index) => (
              <li key={`${evidence.label}-${index}`}>
                <p className="field-hint">
                  {sanitizeForDisplay(evidence.label)}
                  {evidence.lineNumber === undefined ? '' : ` · line ${evidence.lineNumber}`}
                  {' · '}
                  {sanitizeForDisplay(evidence.source)}
                </p>
                <pre className="code-block analyze-evidence">
                  <code>{sanitizeCodeForDisplay(evidence.quote)}</code>
                </pre>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="analyze-finding-section">
        {candidate ? (
          <>
            <p className="eyebrow">
              Proposed change ({candidate.riskClass}, not applied)
            </p>
            <p className="prose">{sanitizeForDisplay(candidate.description)}</p>
            {candidate.behaviourChange ? (
              <p className="analyze-behaviour">
                This change can alter behaviour. Read the diff in the review before exporting.
              </p>
            ) : null}
            {candidate.warnings.length > 0 ? (
              <ul className="analyze-list analyze-fix-warnings">
                {candidate.warnings.map((warning) => (
                  <li key={warning}>{sanitizeForDisplay(warning)}</li>
                ))}
              </ul>
            ) : null}
            <label className="analyze-check analyze-fix-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onSelect(event.target.checked)}
              />
              <span>
                Include this change{' '}
                <span className="sr-only">
                  for {sanitizeForDisplay(finding.ruleId)} at line {finding.range.startLine} in{' '}
                  {sanitizeForDisplay(finding.file)}
                </span>
              </span>
            </label>
            <p className="field-hint">
              Verified by re-running the analyzers on a copy of this file. Your files are not modified.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">
              Suggested direction ({finding.fix?.riskClass ?? 'manual-only'}, not applied)
            </p>
            {unavailableReason ? (
              <p className="analyze-unavailable">
                No automatic change offered: {sanitizeForDisplay(unavailableReason)}
              </p>
            ) : null}
            {finding.fix ? (
              <>
                <p className="prose">{sanitizeForDisplay(finding.fix.explanation)}</p>
                <p className="field-hint">{sanitizeForDisplay(finding.fix.whereItMayApply)}</p>
                <p className="field-hint">{sanitizeForDisplay(finding.fix.riskReason)}</p>
              </>
            ) : (
              <p className="prose">No automatic fix is suggested for this finding.</p>
            )}
          </>
        )}
      </div>

      {finding.verificationSteps.length > 0 ? (
        <div className="analyze-finding-section">
          <p className="eyebrow">How to verify</p>
          <ol className="analyze-list analyze-list--numbered">
            {finding.verificationSteps.map((step) => (
              <li key={step}>{sanitizeForDisplay(step)}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {finding.limitations.length > 0 ? (
        <div className="analyze-finding-section">
          <p className="eyebrow">Finding limits</p>
          <ul className="analyze-list">
            {finding.limitations.map((limitation) => (
              <li key={limitation}>{sanitizeForDisplay(limitation)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  )
}

export interface AnalyzeResultsProps {
  report: AnalyzerReport
  headingRef: RefObject<HTMLHeadingElement | null>
  downloadReportFile: DownloadReportFile
  onClear: () => void
  sources?: readonly ArchiveEntry[]
  prepareFixPlan?: PrepareFixPlan
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set()

interface PlanState {
  report: AnalyzerReport
  sources: readonly ArchiveEntry[]
  plan: FixPlan
  error: string | null
  selected: ReadonlySet<string>
}

export function AnalyzeResults({
  report,
  headingRef,
  downloadReportFile,
  onClear,
  sources = EMPTY_SOURCES,
  prepareFixPlan = defaultPrepareFixPlan,
}: AnalyzeResultsProps) {
  const [severity, setSeverity] = useState<'all' | Severity>('all')
  const [file, setFile] = useState('all')
  const [findingLimit, setFindingLimit] = useState(FINDINGS_PAGE_SIZE)
  const [noteLimit, setNoteLimit] = useState(NOTE_PAGE_SIZE)
  const [coverageLimit, setCoverageLimit] = useState(COVERAGE_PAGE_SIZE)
  const [includeSnippets, setIncludeSnippets] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [planState, setPlanState] = useState<PlanState | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)

  const planningAvailable = sources.length > 0 && report.findings.length > 0
  const planStateMatches =
    planState !== null && planState.report === report && planState.sources === sources
  const plan = planStateMatches ? planState.plan : planningAvailable ? null : EMPTY_PLAN
  const planError = planStateMatches ? planState.error : null
  const selected = planStateMatches ? planState.selected : EMPTY_SELECTION

  useEffect(() => {
    if (!planningAvailable) return
    const controller = new AbortController()
    prepareFixPlan(report.findings, sources, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return
        setPlanState({
          report,
          sources,
          plan: next,
          error: null,
          selected: new Set(
            next.available
              .filter((candidate) => candidate.riskClass === 'safe')
              .map((candidate) => candidate.findingId),
          ),
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setPlanState({
          report,
          sources,
          plan: EMPTY_PLAN,
          error:
            error instanceof Error ? error.message : 'The automatic fixes could not be prepared.',
          selected: EMPTY_SELECTION,
        })
      },
    )
    return () => controller.abort()
  }, [planningAvailable, prepareFixPlan, report, sources])

  const candidatesByFinding = useMemo(
    () => new Map((plan?.available ?? []).map((candidate) => [candidate.findingId, candidate])),
    [plan],
  )
  const selectedCandidates = useMemo(
    () => (plan?.available ?? []).filter((candidate) => selected.has(candidate.findingId)),
    [plan, selected],
  )
  const selectedFiles = useMemo(
    () => new Set(selectedCandidates.map((candidate) => candidate.file)),
    [selectedCandidates],
  )
  const hasCandidates = (plan?.available.length ?? 0) > 0

  function toggleSelection(findingId: string, checked: boolean): void {
    setPlanState((current) => {
      if (!current || current.report !== report || current.sources !== sources) return current
      const next = new Set(current.selected)
      if (checked) next.add(findingId)
      else next.delete(findingId)
      return { ...current, selected: next }
    })
  }

  function closeReview(): void {
    setReviewOpen(false)
    reviewButtonRef.current?.focus()
  }

  // Note-level rules are listed separately; they never drive the headline counts or severity filters.
  const { actionable, notes } = useMemo(() => splitNoteFindings(report.findings), [report.findings])

  const findingFiles = useMemo(
    () => [...new Set(actionable.map((finding) => finding.file))].sort((a, b) => a.localeCompare(b)),
    [actionable],
  )
  const filtered = actionable.filter(
    (finding) =>
      (severity === 'all' || finding.severity === severity) && (file === 'all' || finding.file === file),
  )
  const visibleFindings = filtered.slice(0, findingLimit)
  const groups = findingGroups(visibleFindings)
  const hiddenFindings = filtered.length - visibleFindings.length
  const visibleNotes = notes.slice(0, noteLimit)
  const hiddenNotes = notes.length - visibleNotes.length
  const visibleCoverage = report.coverage.slice(0, coverageLimit)
  const hiddenCoverage = report.coverage.length - visibleCoverage.length

  const analysedLanguages = useMemo(() => {
    const languages = new Set(
      report.coverage.filter((entry) => entry.status === 'analysed').map((entry) => entry.language),
    )
    return [...languages].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)))
  }, [report.coverage])

  const criticalAndHigh = report.summary.bySeverity.Critical + report.summary.bySeverity.High
  const filtersActive = severity !== 'all' || file !== 'all'
  const generated = new Date(report.generatedAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  function handleDownload(format: 'markdown' | 'json') {
    downloadReportFile(format, report, includeSnippets)
    setExportStatus(
      `${format === 'markdown' ? 'report.md' : 'report.json'} downloaded. ${
        includeSnippets ? 'Evidence quotes are included.' : 'Evidence quotes were left out.'
      }`,
    )
  }

  return (
    <section className="analyze-results" aria-labelledby="analyze-results-heading">
      <header className="analyze-results-head">
        <div>
          <p className="eyebrow">
            {report.session.partial ? 'Static analysis partial' : 'Static analysis complete'}
          </p>
          <h2 id="analyze-results-heading" ref={headingRef} tabIndex={-1}>
            {report.session.partial ? 'Partial results for' : 'Results for'}{' '}
            {report.session.analysedCount} file
            {report.session.analysedCount === 1 ? '' : 's'}
          </h2>
          <p className="field-hint">
            Generated {generated}. Nothing was executed. {report.session.skippedCount} file
            {report.session.skippedCount === 1 ? '' : 's'} skipped.
          </p>
        </div>
        <button type="button" className="button button--secondary" onClick={onClear}>
          <RotateCcw size={16} aria-hidden="true" />
          Clear results
        </button>
      </header>

      {report.session.partial ? (
        <div className="notice notice--alert analyze-partial" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Partial report — this is not the whole upload</strong>
            <p>{sanitizeForDisplay(report.session.partial.message)}</p>
            <p className="field-hint">
              {report.session.partial.analysedFiles} of {report.session.partial.plannedFiles} planned
              file{report.session.partial.plannedFiles === 1 ? '' : 's'} analysed;{' '}
              {report.session.partial.unreachedFiles} file
              {report.session.partial.unreachedFiles === 1 ? '' : 's'} not reached. Every unreached
              file is named in the coverage table with the reason. The exported report and clean
              export carry the same partial marker.
            </p>
          </div>
        </div>
      ) : null}

      <div className="analyze-stats" role="group" aria-label="Analysis summary">
        <div className="analyze-stat">
          <span className="analyze-stat-value">{actionable.length}</span>
          <span className="analyze-stat-label">Findings</span>
        </div>
        <div className="analyze-stat">
          <span className="analyze-stat-value">{report.session.analysedCount}</span>
          <span className="analyze-stat-label">Files analysed</span>
        </div>
        <div className="analyze-stat">
          <span className="analyze-stat-value">{report.session.skippedCount}</span>
          <span className="analyze-stat-label">Files skipped</span>
        </div>
        <div className="analyze-stat analyze-stat--risk">
          <span className="analyze-stat-value">{criticalAndHigh}</span>
          <span className="analyze-stat-label">Critical and high</span>
        </div>
      </div>

      <div className="panel analyze-export" aria-labelledby="analyze-export-heading">
        <div>
          <h3 id="analyze-export-heading">Export a report</h3>
          <p className="field-hint">
            Both files are built in this tab. Nothing is sent anywhere; your browser saves them.
          </p>
          <label className="analyze-check">
            <input
              type="checkbox"
              checked={includeSnippets}
              onChange={(event) => {
                setIncludeSnippets(event.target.checked)
                setExportStatus(null)
              }}
            />
            <span>Include code snippets (evidence quotes) in the exported files</span>
          </label>
          <p className="field-hint">
            Off by default. The findings, explanations and coverage are exported either way.
          </p>
        </div>
        <div className="analyze-export-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={() => handleDownload('markdown')}
          >
            <Download size={16} aria-hidden="true" />
            Download report.md
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => handleDownload('json')}
          >
            <Download size={16} aria-hidden="true" />
            Download report.json
          </button>
        </div>
        <p className="field-hint" role="status" aria-label="Export status">
          {exportStatus ?? ''}
        </p>
      </div>

      <div className="panel analyze-fix-select" aria-labelledby="analyze-fix-select-heading">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2 id="analyze-fix-select-heading">Automatic fixes</h2>
            <p className="field-hint">
              Each proposed change was applied to a copy and verified by re-running the analyzers.
              Your files are never modified and your upload is not saved.
            </p>
            {report.findings.length > MAX_PLAN_FINDINGS ? (
              <p className="field-hint">
                Automatic changes are planned for at most the first {MAX_PLAN_FINDINGS} findings in
                a report this large, so the tab stays responsive. The remaining findings keep their
                explained manual direction.
              </p>
            ) : null}
          </div>
        </div>
        <div className="analyze-body">
          {planError ? (
            <p className="notice notice--alert" role="alert">
              Automatic fixes could not be prepared: {sanitizeForDisplay(planError)}. The report
              export above still works and nothing was kept.
            </p>
          ) : plan === null ? (
            <p className="field-hint analyze-fix-planning">
              Checking which findings can be fixed automatically. The analyzers re-run on in-memory
              copies.
            </p>
          ) : hasCandidates ? (
            <>
              <p className="analyze-fix-summary">
                {selectedCandidates.length} change
                {selectedCandidates.length === 1 ? '' : 's'} selected in {selectedFiles.size} file
                {selectedFiles.size === 1 ? '' : 's'}
              </p>
              <p className="field-hint">
                Safe changes are ticked by default. Changes that can alter behaviour are unticked.
                Manual-only findings have no checkbox.
              </p>
              <div className="analyze-fix-actions">
                <button
                  ref={reviewButtonRef}
                  type="button"
                  className="button button--primary"
                  disabled={selectedCandidates.length === 0}
                  aria-describedby={selectedCandidates.length === 0 ? 'fix-review-disabled-note' : undefined}
                  onClick={() => setReviewOpen(true)}
                >
                  Review changes
                </button>
                {selectedCandidates.length === 0 ? (
                  <p className="field-hint" id="fix-review-disabled-note">
                    Select at least one change to open the review.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="field-hint">
              No finding in this upload has a verified automatic change. The report export above
              still works.
            </p>
          )}

          {reviewOpen && selectedCandidates.length > 0 ? (
            <>
              <Suspense
                fallback={
                  <p className="field-hint analyze-fix-planning">Loading the review view…</p>
                }
              >
                <FixReview
                  report={report}
                  sources={sources}
                  candidates={selectedCandidates}
                  onClose={closeReview}
                />
              </Suspense>
              <Suspense
                fallback={
                  <p className="field-hint analyze-fix-planning">Loading the clean export…</p>
                }
              >
                <CleanExportPanel
                  report={report}
                  sources={sources}
                  candidates={selectedCandidates}
                  onReportOnly={() => handleDownload('markdown')}
                />
              </Suspense>
            </>
          ) : null}
        </div>
      </div>

      <div className="panel analyze-filter-panel" aria-labelledby="analyze-findings-heading">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Findings</p>
            <h2 id="analyze-findings-heading">What the rules matched</h2>
          </div>
        </div>

        <div className="analyze-body">
          {actionable.length > 0 ? (
            <>
              <div className="analyze-filters">
                <div className="field">
                  <label htmlFor="analyze-severity-filter">Severity</label>
                  <select
                    id="analyze-severity-filter"
                    value={severity}
                    onChange={(event) => {
                      setSeverity(event.target.value as 'all' | Severity)
                      setFindingLimit(FINDINGS_PAGE_SIZE)
                    }}
                  >
                    <option value="all">All severities</option>
                    {SEVERITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="analyze-file-filter">File</label>
                  <select
                    id="analyze-file-filter"
                    value={file}
                    onChange={(event) => {
                      setFile(event.target.value)
                      setFindingLimit(FINDINGS_PAGE_SIZE)
                    }}
                  >
                    <option value="all">All files with findings</option>
                    {findingFiles.map((name) => {
                      const full = sanitizeForDisplay(name)
                      return (
                        <option key={name} value={name} title={full}>
                          {truncateForDisplay(full, NAME_DISPLAY_LIMIT)}
                        </option>
                      )
                    })}
                  </select>
                </div>
                <button
                  type="button"
                  className="button button--quiet analyze-filter-reset"
                  onClick={() => {
                    setSeverity('all')
                    setFile('all')
                    setFindingLimit(FINDINGS_PAGE_SIZE)
                  }}
                  disabled={!filtersActive}
                >
                  Reset filters
                </button>
              </div>
              <p className="field-hint" role="status" aria-label="Filtered finding count">
                Showing {filtered.length} of {actionable.length} finding
                {actionable.length === 1 ? '' : 's'}.
              </p>

              {hiddenFindings > 0 ? (
                <p className="field-hint">
                  The first {visibleFindings.length} matching findings are shown below; filters
                  apply to the whole report.
                </p>
              ) : null}

              {groups.length > 0 ? (
                groups.map(([name, findings]) => (
                  <section
                    key={name}
                    className="analyze-file-group"
                    aria-labelledby={`analyze-file-${encodeURIComponent(name)}`}
                  >
                    <h3 id={`analyze-file-${encodeURIComponent(name)}`}>
                      <FileName name={name} />
                      <span className="analyze-file-count">
                        {findings.length} finding{findings.length === 1 ? '' : 's'}
                      </span>
                    </h3>
                    <ul className="analyze-findings">
                      {findings.map((finding) => (
                        <li key={finding.id}>
                          <FindingCard
                            finding={finding}
                            candidate={candidatesByFinding.get(finding.id)}
                            unavailableReason={plan?.unavailable.get(finding.id)}
                            checked={selected.has(finding.id)}
                            onSelect={(checked) => toggleSelection(finding.id, checked)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              ) : (
                <p className="analyze-empty-filter">
                  No findings match these filters. Reset them to see the whole report.
                </p>
              )}

              {hiddenFindings > 0 ? (
                <button
                  type="button"
                  className="button button--secondary analyze-show-more"
                  onClick={() => setFindingLimit((current) => current + FINDINGS_PAGE_SIZE)}
                >
                  Show {Math.min(FINDINGS_PAGE_SIZE, hiddenFindings)} more finding
                  {Math.min(FINDINGS_PAGE_SIZE, hiddenFindings) === 1 ? '' : 's'}
                </button>
              ) : null}
            </>
          ) : notes.length > 0 ? (
            <div className="analyze-no-findings">
              <h3>No actionable findings matched this upload</h3>
              <p className="prose">
                The rules only matched note-level items, which are listed under Notes below. Notes
                are counted in the exported report but do not change the headline severity counts.
              </p>
            </div>
          ) : (
            <div className="analyze-no-findings">
              <h3>No rule matched this upload</h3>
              <p className="prose">
                That is not a clean bill of health. It only means none of the enabled rules fired.
                Read the per-language limits below before treating these files as correct.
              </p>
            </div>
          )}

          {notes.length > 0 ? (
            <details className="analyze-notes">
              <summary>Notes ({notes.length})</summary>
              <p className="field-hint">
                Lower-value matches kept out of the headline counts: todo markers, long lines,
                oversized files, plain http:// links and mixed indentation. They stay in the
                exported report like every other rule.
              </p>
              <ul className="analyze-findings">
                {visibleNotes.map((finding) => (
                  <li key={finding.id}>
                    <FindingCard
                      finding={finding}
                      candidate={candidatesByFinding.get(finding.id)}
                      unavailableReason={plan?.unavailable.get(finding.id)}
                      checked={selected.has(finding.id)}
                      onSelect={(checked) => toggleSelection(finding.id, checked)}
                    />
                  </li>
                ))}
              </ul>
              {hiddenNotes > 0 ? (
                <button
                  type="button"
                  className="button button--secondary analyze-show-more"
                  onClick={() => setNoteLimit((current) => current + NOTE_PAGE_SIZE)}
                >
                  Show {Math.min(NOTE_PAGE_SIZE, hiddenNotes)} more note
                  {Math.min(NOTE_PAGE_SIZE, hiddenNotes) === 1 ? '' : 's'}
                </button>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>

      <section className="panel analyze-panel" aria-labelledby="analyze-coverage-heading">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Coverage</p>
            <h2 id="analyze-coverage-heading">What was and was not checked</h2>
          </div>
        </div>
        <div className="analyze-body">
          <details open={report.coverage.length <= 50}>
            <summary>
              {report.session.analysedCount} file{report.session.analysedCount === 1 ? '' : 's'} analysed,{' '}
              {report.session.skippedCount} skipped
            </summary>
            <ul className="analyze-coverage-list">
              {visibleCoverage.map((entry) => (
                <li key={entry.file} className="analyze-coverage-item">
                  <div className="analyze-coverage-head">
                    <FileName name={entry.file} />
                    <span className="badge badge--muted">{sanitizeForDisplay(entry.languageLabel)}</span>
                    {entry.status === 'analysed' ? (
                      <span className="field-hint">
                        {formatBytes(entry.bytes)} · {entry.findings} finding
                        {entry.findings === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="badge badge--muted">Skipped</span>
                    )}
                  </div>
                  {entry.status === 'skipped' ? (
                    <p className="analyze-coverage-reason">
                      Skipped: {sanitizeForDisplay(entry.skipReason ?? '')}
                    </p>
                  ) : (
                    <ul className="analyze-tier-list">
                      {entry.tiers.map((tier) => (
                        <li key={tier.tier}>
                          <strong>{TIER_LABELS[tier.tier]}</strong>
                          {' — '}
                          {tierText(tier)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {entry.notes.map((note) => (
                    <p key={note} className="field-hint">
                      {sanitizeForDisplay(note)}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            {hiddenCoverage > 0 ? (
              <button
                type="button"
                className="button button--secondary analyze-show-more"
                onClick={() => setCoverageLimit((current) => current + COVERAGE_PAGE_SIZE)}
              >
                Show {Math.min(COVERAGE_PAGE_SIZE, hiddenCoverage)} more file
                {Math.min(COVERAGE_PAGE_SIZE, hiddenCoverage) === 1 ? '' : 's'}
              </button>
            ) : null}
          </details>
        </div>
      </section>

      <section className="panel analyze-panel analyze-honesty" aria-labelledby="analyze-honesty-heading">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Honest limits</p>
            <h2 id="analyze-honesty-heading">No findings does not mean no bugs</h2>
          </div>
        </div>
        <div className="analyze-body">
          <p className="prose">
            This run checked only what the coverage table lists. Every language below also carries
            checks that were not performed, so absence of a finding proves nothing about them.
          </p>
          <ul className="analyze-language-limits">
            {analysedLanguages.map((language) => (
              <li key={language}>
                <h3>{languageLabel(language)}</h3>
                <ul className="analyze-list">
                  {NOT_CHECKED_BY_LANGUAGE[language].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="field-hint">
            No code was executed, so no finding was confirmed by running it.
          </p>
        </div>
      </section>
    </section>
  )
}
