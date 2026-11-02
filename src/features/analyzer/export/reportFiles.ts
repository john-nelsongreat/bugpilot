import type { AnalyzerFinding, AnalyzerReport } from '../types'

const SNIPPET_EXCLUDED_NOTE = 'Evidence quotes were excluded from this export because code snippets were not included.'

/**
 * The on-screen report keeps evidence so findings can be checked in place. An export only
 * keeps it when the user ticked the snippet box; otherwise every evidence quote is dropped.
 */
export function reportForExport(report: AnalyzerReport, includeSnippets: boolean): AnalyzerReport {
  const findings: AnalyzerFinding[] = includeSnippets
    ? report.findings
    : report.findings.map((finding) => ({ ...finding, evidence: [] }))
  return {
    ...report,
    includeSnippets,
    findings,
    limitations: includeSnippets ? report.limitations : [...report.limitations, SNIPPET_EXCLUDED_NOTE],
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function tierCell(available: boolean, ran: boolean, reason: string, label: string): string {
  if (!available) return 'not available'
  return ran ? 'ran' : `not run (${escapeCell(label)}: ${escapeCell(reason)})`
}

export function renderReportMarkdown(report: AnalyzerReport): string {
  const lines: string[] = []
  const push = (line = ''): void => {
    lines.push(line)
  }

  push('# BugPilot code analysis report')
  push()
  push(`Generated: ${report.generatedAt}`)
  push()
  push(`- Files analysed: ${report.session.analysedCount} of ${report.session.fileCount}`)
  push(`- Files skipped: ${report.session.skippedCount}`)
  push(`- Archive bytes: ${report.session.archiveBytes}`)
  push(`- Findings: ${report.summary.findings}`)
  push(`- Code snippets in this export: ${report.includeSnippets ? 'yes' : 'no'}`)
  push()

  push('## Summary')
  push()
  push('| Severity | Findings |')
  push('| --- | ---: |')
  for (const severity of ['Critical', 'High', 'Medium', 'Low'] as const) {
    push(`| ${severity} | ${report.summary.bySeverity[severity]} |`)
  }
  push()

  push('## Findings')
  push()
  if (report.findings.length === 0) {
    push('No rule matched. That does not prove the files are correct; see the limitations below.')
    push()
  }

  let currentFile = ''
  for (const finding of report.findings) {
    if (finding.file !== currentFile) {
      currentFile = finding.file
      push(`### ${currentFile}`)
      push()
    }
    push(`#### ${finding.severity}: ${finding.message}`)
    push()
    push(`- Rule: \`${finding.ruleId}\``)
    push(`- Tier: ${finding.tier}`)
    push(`- Analyzer: ${finding.analyzer}`)
    push(`- Confidence: ${finding.confidence.level} — ${finding.confidence.reason}`)
    push(`- Location: line ${finding.range.startLine}${finding.range.startColumn ? `, column ${finding.range.startColumn}` : ''}`)
    push(`- Finding id: \`${finding.id}\``)
    push()
    push(finding.explanation)
    push()
    if (finding.evidence.length > 0) {
      push('Evidence:')
      push()
      for (const evidence of finding.evidence) {
        const location = evidence.lineNumber === undefined ? '' : ` (line ${evidence.lineNumber})`
        push(`${evidence.label}${location}:`)
        push()
        push('```')
        push(evidence.quote)
        push('```')
        push()
      }
    }
    if (finding.fix) {
      push(`Suggested direction (${finding.fix.riskClass}, not applied): ${finding.fix.explanation}`)
      push()
      push(`Where it may apply: ${finding.fix.whereItMayApply}`)
      push()
      push(`Risk: ${finding.fix.riskReason}`)
      push()
    } else {
      push('No automatic fix is suggested for this finding.')
      push()
    }
    if (finding.verificationSteps.length > 0) {
      push('Verification steps:')
      push()
      for (const step of finding.verificationSteps) push(`1. ${step}`)
      push()
    }
    if (finding.limitations.length > 0) {
      push('Finding limitations:')
      push()
      for (const limitation of finding.limitations) push(`- ${limitation}`)
      push()
    }
  }

  push('## Coverage')
  push()
  push('| File | Status | Language | Findings | Syntax | Pattern |')
  push('| --- | --- | --- | ---: | --- | --- |')
  for (const file of report.coverage) {
    const syntax = file.tiers.find((tier) => tier.tier === 'syntax')
    const pattern = file.tiers.find((tier) => tier.tier === 'pattern')
    const status = file.status === 'skipped' ? `skipped: ${escapeCell(file.skipReason ?? 'no reason recorded')}` : 'analysed'
    push(
      `| ${escapeCell(file.file)} | ${escapeCell(status)} | ${escapeCell(file.languageLabel)} | ${file.findings} | ${
        syntax ? tierCell(syntax.available, syntax.ran, syntax.reason, 'Syntax') : 'not available'
      } | ${pattern ? tierCell(pattern.available, pattern.ran, pattern.reason, 'Pattern') : 'not available'} |`,
    )
  }
  push()

  if (report.session.skipped.length > 0) {
    push('### Skipped entries')
    push()
    for (const item of report.session.skipped) push(`- ${item.file}: ${item.reason}`)
    push()
  }

  push('## Limitations')
  push()
  for (const limitation of report.limitations) push(`- ${limitation}`)
  push()

  return lines.join('\n')
}

export function reportFileStem(generatedAt: string): string {
  return `bugpilot-analysis-${generatedAt.replace(/[:.]/g, '-')}`
}

function downloadTextFile(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking sooner can cancel a blob download that has not started yet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export type DownloadReportFile = (
  format: 'markdown' | 'json',
  report: AnalyzerReport,
  includeSnippets: boolean,
) => void

/** Builds one file in the tab and hands it to the browser's download flow. */
export function downloadReportMarkdown(report: AnalyzerReport, includeSnippets: boolean): void {
  const prepared = reportForExport(report, includeSnippets)
  downloadTextFile(
    `${reportFileStem(prepared.generatedAt)}.md`,
    renderReportMarkdown(prepared),
    'text/markdown;charset=utf-8',
  )
}

export function downloadReportJson(report: AnalyzerReport, includeSnippets: boolean): void {
  const prepared = reportForExport(report, includeSnippets)
  downloadTextFile(
    `${reportFileStem(prepared.generatedAt)}.json`,
    JSON.stringify(prepared, null, 2),
    'application/json;charset=utf-8',
  )
}
