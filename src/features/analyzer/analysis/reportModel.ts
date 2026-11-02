import type { Severity } from '../../bugs/types'
import type { ArchiveEntry, ArchiveSkippedEntry } from '../archive/guard'
import type { AnalyzerFinding, AnalyzerReport, AnalyzerSummary, AnalyzerTier, FileCoverage } from '../types'
import type { FileAnalysis } from './engine'

export const REPORT_LIMITATIONS = [
  'This is a static analysis. Nothing was executed and no finding was verified by running the code.',
  'Uploaded source stayed in this browser tab; BugPilot did not upload or store it.',
  'No type checking, data-flow analysis or full linter ran. Each file lists the tiers that were actually available.',
  'A file with no findings was not proven correct; it only means no enabled rule matched.',
]

const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Medium', 'Low']
const TIER_ORDER: AnalyzerTier[] = ['syntax', 'pattern', 'type-or-dataflow']

export function summarizeFindings(findings: readonly AnalyzerFinding[]): AnalyzerSummary {
  const bySeverity: Record<Severity, number> = { Low: 0, Medium: 0, High: 0, Critical: 0 }
  const byTier: Record<AnalyzerTier, number> = { syntax: 0, pattern: 0, 'type-or-dataflow': 0 }
  for (const finding of findings) {
    bySeverity[finding.severity] += 1
    byTier[finding.tier] += 1
  }
  return { findings: findings.length, bySeverity, byTier }
}

export function sortReportFindings(findings: AnalyzerFinding[]): AnalyzerFinding[] {
  return findings.sort((left, right) => {
    if (left.file !== right.file) return left.file.localeCompare(right.file)
    if (left.range.startLine !== right.range.startLine) return left.range.startLine - right.range.startLine
    if ((left.range.startColumn ?? 0) !== (right.range.startColumn ?? 0)) {
      return (left.range.startColumn ?? 0) - (right.range.startColumn ?? 0)
    }
    const severity = SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity)
    if (severity !== 0) return severity
    return left.ruleId.localeCompare(right.ruleId)
  })
}

export interface ReportBuildInput {
  generatedAt: Date
  archiveBytes: number
  entries: readonly ArchiveEntry[]
  skipped: readonly ArchiveSkippedEntry[]
  analyses: readonly FileAnalysis[]
  coverage: readonly FileCoverage[]
}

export function buildReport(input: ReportBuildInput): AnalyzerReport {
  const findings = sortReportFindings(input.analyses.flatMap((analysis) => analysis.findings))
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt.toISOString(),
    includeSnippets: true,
    session: {
      archiveBytes: input.archiveBytes,
      fileCount: input.entries.length + input.skipped.length,
      analysedCount: input.entries.length,
      skippedCount: input.skipped.length,
      skipped: input.skipped.map((item) => ({ file: item.name, reason: item.message })),
    },
    summary: summarizeFindings(findings),
    findings,
    coverage: [...input.coverage],
    limitations: [...REPORT_LIMITATIONS],
  }
}

export const SEVERITY_DISPLAY_ORDER = SEVERITY_ORDER
export const TIER_DISPLAY_ORDER = TIER_ORDER
