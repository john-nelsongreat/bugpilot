import type { AnalyzerFinding, AnalyzerReport } from '../types'
import {
  codeFenceFor,
  escapeMarkdown,
  sanitizeCodeForDisplay,
  sanitizeForDisplay,
} from '../sanitize/display'

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

function tierCell(available: boolean, ran: boolean, reason: string, label: string): string {
  if (!available) return 'not available'
  return ran ? 'ran' : `not run (${escapeMarkdown(label)}: ${escapeMarkdown(reason)})`
}

function codeSpan(value: string): string {
  return `\`${sanitizeForDisplay(value).replace(/`/g, '\\`')}\``
}

export function renderReportMarkdown(report: AnalyzerReport): string {
  const lines: string[] = []
  const push = (line = ''): void => {
    lines.push(line)
  }

  push('# BugPilot code analysis report')
  push()
  if (report.truncated) {
    const truncated = report.truncated
    push(
      `> **TRUNCATED FINDINGS LIST.** The report stores the first ${truncated.stored.toLocaleString('en-US')} findings; ` +
        `${truncated.suppressed.toLocaleString('en-US')} more matched but are not stored. Per rule: ` +
        Object.entries(truncated.perRule)
          .sort((left, right) => right[1] - left[1])
          .map(([rule, count]) => `${codeSpan(rule)}: ${count.toLocaleString('en-US')}`)
          .join(', '),
    )
    push()
  }
  if (report.session.partial) {
    const partial = report.session.partial
    push(`> **PARTIAL REPORT.** ${escapeMarkdown(partial.message)}`)
    push('>')
    push(
      `> ${partial.analysedFiles} of ${partial.plannedFiles} planned file(s) were analysed; ` +
        `${partial.unreachedFiles} file(s) were not reached. The coverage table names every file.`,
    )
    push()
  }
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
      push(`### ${escapeMarkdown(currentFile)}`)
      push()
    }
    push(`#### ${escapeMarkdown(finding.severity)}: ${escapeMarkdown(finding.message)}`)
    push()
    push(`- Rule: ${codeSpan(finding.ruleId)}`)
    push(`- Tier: ${escapeMarkdown(finding.tier)}`)
    push(`- Analyzer: ${escapeMarkdown(finding.analyzer)}`)
    push(`- Confidence: ${escapeMarkdown(finding.confidence.level)} — ${escapeMarkdown(finding.confidence.reason)}`)
    push(`- Location: line ${finding.range.startLine}${finding.range.startColumn ? `, column ${finding.range.startColumn}` : ''}`)
    push(`- Finding id: ${codeSpan(finding.id)}`)
    push()
    push(escapeMarkdown(finding.explanation))
    push()
    if (finding.evidence.length > 0) {
      push('Evidence:')
      push()
      for (const evidence of finding.evidence) {
        const location = evidence.lineNumber === undefined ? '' : ` (line ${evidence.lineNumber})`
        push(`${escapeMarkdown(evidence.label)}${location}:`)
        push()
        const fence = codeFenceFor(evidence.quote)
        push(fence)
        push(sanitizeCodeForDisplay(evidence.quote))
        push(fence)
        push()
      }
    }
    if (finding.fix) {
      push(`Suggested direction (${escapeMarkdown(finding.fix.riskClass)}, not applied): ${escapeMarkdown(finding.fix.explanation)}`)
      push()
      push(`Where it may apply: ${escapeMarkdown(finding.fix.whereItMayApply)}`)
      push()
      push(`Risk: ${escapeMarkdown(finding.fix.riskReason)}`)
      push()
    } else {
      push('No automatic fix is suggested for this finding.')
      push()
    }
    if (finding.verificationSteps.length > 0) {
      push('Verification steps:')
      push()
      for (const step of finding.verificationSteps) push(`1. ${escapeMarkdown(step)}`)
      push()
    }
    if (finding.limitations.length > 0) {
      push('Finding limitations:')
      push()
      for (const limitation of finding.limitations) push(`- ${escapeMarkdown(limitation)}`)
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
    const status = file.status === 'skipped' ? `skipped: ${escapeMarkdown(file.skipReason ?? 'no reason recorded')}` : 'analysed'
    push(
      `| ${escapeMarkdown(file.file)} | ${status} | ${escapeMarkdown(file.languageLabel)} | ${file.findings} | ${
        syntax ? tierCell(syntax.available, syntax.ran, syntax.reason, 'Syntax') : 'not available'
      } | ${pattern ? tierCell(pattern.available, pattern.ran, pattern.reason, 'Pattern') : 'not available'} |`,
    )
  }
  push()

  if (report.session.skipped.length > 0) {
    push('### Skipped entries')
    push()
    for (const item of report.session.skipped) push(`- ${escapeMarkdown(item.file)}: ${escapeMarkdown(item.reason)}`)
    push()
  }

  push('## Limitations')
  push()
  for (const limitation of report.limitations) push(`- ${escapeMarkdown(limitation)}`)
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
