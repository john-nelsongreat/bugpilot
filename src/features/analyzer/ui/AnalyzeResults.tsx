import { useMemo, useState, type RefObject } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import type { Severity } from '../../bugs/types'
import type { DownloadReportFile } from '../export/reportFiles'
import { NOT_CHECKED_BY_LANGUAGE, languageLabel } from '../languages'
import type { AnalyzerFinding, AnalyzerReport, CoverageTier } from '../types'

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
  if (!tier.available) return `not available: ${tier.reason}`
  if (tier.ran) return 'ran'
  return `not run: ${tier.reason}`
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

function FindingCard({ finding }: { finding: AnalyzerFinding }) {
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
          <code>{finding.ruleId}</code>
          <span aria-hidden="true"> · </span>
          <span>Line {finding.range.startLine}</span>
        </p>
        <h4 id={titleId}>{finding.message}</h4>
        <p className="field-hint">{finding.confidence.reason}</p>
      </header>

      <p className="prose">{finding.explanation}</p>

      {finding.evidence.length > 0 ? (
        <div className="analyze-finding-section">
          <p className="eyebrow">Evidence</p>
          <ul className="analyze-evidence-list">
            {finding.evidence.map((evidence, index) => (
              <li key={`${evidence.label}-${index}`}>
                <p className="field-hint">
                  {evidence.label}
                  {evidence.lineNumber === undefined ? '' : ` · line ${evidence.lineNumber}`}
                  {' · '}
                  {evidence.source}
                </p>
                <pre className="code-block analyze-evidence">
                  <code>{evidence.quote}</code>
                </pre>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="analyze-finding-section">
        <p className="eyebrow">Suggested direction ({finding.fix?.riskClass ?? 'manual-only'}, not applied)</p>
        {finding.fix ? (
          <>
            <p className="prose">{finding.fix.explanation}</p>
            <p className="field-hint">{finding.fix.whereItMayApply}</p>
            <p className="field-hint">{finding.fix.riskReason}</p>
          </>
        ) : (
          <p className="prose">No automatic fix is suggested for this finding.</p>
        )}
      </div>

      {finding.verificationSteps.length > 0 ? (
        <div className="analyze-finding-section">
          <p className="eyebrow">How to verify</p>
          <ol className="analyze-list analyze-list--numbered">
            {finding.verificationSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {finding.limitations.length > 0 ? (
        <div className="analyze-finding-section">
          <p className="eyebrow">Finding limits</p>
          <ul className="analyze-list">
            {finding.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
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
}

export function AnalyzeResults({ report, headingRef, downloadReportFile, onClear }: AnalyzeResultsProps) {
  const [severity, setSeverity] = useState<'all' | Severity>('all')
  const [file, setFile] = useState('all')
  const [includeSnippets, setIncludeSnippets] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const findingFiles = useMemo(
    () => [...new Set(report.findings.map((finding) => finding.file))].sort((a, b) => a.localeCompare(b)),
    [report.findings],
  )
  const filtered = report.findings.filter(
    (finding) =>
      (severity === 'all' || finding.severity === severity) && (file === 'all' || finding.file === file),
  )
  const groups = findingGroups(filtered)

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
          <p className="eyebrow">Static analysis complete</p>
          <h2 id="analyze-results-heading" ref={headingRef} tabIndex={-1}>
            Results for {report.session.analysedCount} file
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

      <div className="analyze-stats" role="group" aria-label="Analysis summary">
        <div className="analyze-stat">
          <span className="analyze-stat-value">{report.summary.findings}</span>
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

      <div className="panel analyze-filter-panel" aria-labelledby="analyze-findings-heading">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Findings</p>
            <h2 id="analyze-findings-heading">What the rules matched</h2>
          </div>
        </div>

        <div className="analyze-body">
          {report.findings.length > 0 ? (
            <>
              <div className="analyze-filters">
                <div className="field">
                  <label htmlFor="analyze-severity-filter">Severity</label>
                  <select
                    id="analyze-severity-filter"
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as 'all' | Severity)}
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
                    onChange={(event) => setFile(event.target.value)}
                  >
                    <option value="all">All files with findings</option>
                    {findingFiles.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="button button--quiet analyze-filter-reset"
                  onClick={() => {
                    setSeverity('all')
                    setFile('all')
                  }}
                  disabled={!filtersActive}
                >
                  Reset filters
                </button>
              </div>
              <p className="field-hint" role="status" aria-label="Filtered finding count">
                Showing {filtered.length} of {report.findings.length} finding
                {report.findings.length === 1 ? '' : 's'}.
              </p>

              {groups.length > 0 ? (
                groups.map(([name, findings]) => (
                  <section
                    key={name}
                    className="analyze-file-group"
                    aria-labelledby={`analyze-file-${encodeURIComponent(name)}`}
                  >
                    <h3 id={`analyze-file-${encodeURIComponent(name)}`}>
                      <code>{name}</code>
                      <span className="analyze-file-count">
                        {findings.length} finding{findings.length === 1 ? '' : 's'}
                      </span>
                    </h3>
                    <ul className="analyze-findings">
                      {findings.map((finding) => (
                        <li key={finding.id}>
                          <FindingCard finding={finding} />
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
            </>
          ) : (
            <div className="analyze-no-findings">
              <h3>No rule matched this upload</h3>
              <p className="prose">
                That is not a clean bill of health. It only means none of the enabled rules fired.
                Read the per-language limits below before treating these files as correct.
              </p>
            </div>
          )}
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
              {report.coverage.map((entry) => (
                <li key={entry.file} className="analyze-coverage-item">
                  <div className="analyze-coverage-head">
                    <code>{entry.file}</code>
                    <span className="badge badge--muted">{entry.languageLabel}</span>
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
                    <p className="analyze-coverage-reason">Skipped: {entry.skipReason}</p>
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
                      {note}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
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
