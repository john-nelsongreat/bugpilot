import type { Severity } from '../../bugs/types'
import { MAX_FINDINGS_STORED } from '../archive/limits'
import type { ArchiveEntry, ArchiveSkippedEntry } from '../archive/guard'
import type { AnalyzerFinding, AnalyzerFindingsTruncation, AnalyzerPartialInfo, AnalyzerReport, AnalyzerSummary, AnalyzerTier, FileCoverage } from '../types'
import type { FileAnalysis } from './engine'

export const REPORT_LIMITATIONS = [
  'This is a static analysis. Nothing was executed and no finding was verified by running the code.',
  'Uploaded source stayed in this browser tab; BugPilot did not upload or store it.',
  'No type checking or data-flow analysis ran. A linter is used only where the file coverage says so, and it reads one file at a time.',
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

const TRUNCATION_NOTE_PREFIX = 'The findings store keeps'

export function isTruncationNote(line: string): boolean {
  return line.startsWith(TRUNCATION_NOTE_PREFIX)
}

export function findingsTruncationNote(truncation: AnalyzerFindingsTruncation): string {
  const perRule = Object.entries(truncation.perRule)
    .sort((left, right) => right[1] - left[1])
    .map(([rule, count]) => `${rule}: ${count.toLocaleString('en-US')}`)
    .join(', ')
  return (
    `${TRUNCATION_NOTE_PREFIX} the first ${truncation.stored.toLocaleString('en-US')} findings. ` +
    `${truncation.suppressed.toLocaleString('en-US')} more matched but are not stored (${perRule}). ` +
    'Exports state the same truncation.'
  )
}

/**
 * The store holds a bounded number of findings so a rule that fires on every line of a generated
 * file cannot push the tab out of memory. The caller sorts first, so what is kept is a
 * deterministic prefix, and what is dropped is counted per rule rather than vanished.
 */
export function capStoredFindings(
  findings: AnalyzerFinding[],
  maxStored: number = MAX_FINDINGS_STORED,
): {
  findings: AnalyzerFinding[]
  truncation: AnalyzerFindingsTruncation | null
} {
  if (findings.length <= maxStored) return { findings, truncation: null }
  const kept = findings.slice(0, maxStored)
  const perRule: Record<string, number> = {}
  for (const finding of findings.slice(maxStored)) {
    perRule[finding.ruleId] = (perRule[finding.ruleId] ?? 0) + 1
  }
  return {
    findings: kept,
    truncation: { stored: kept.length, suppressed: findings.length - kept.length, perRule },
  }
}

export interface ReportBuildInput {
  generatedAt: Date
  archiveBytes: number
  entries: readonly ArchiveEntry[]
  skipped: readonly ArchiveSkippedEntry[]
  analyses: readonly FileAnalysis[]
  coverage: readonly FileCoverage[]
  /** Engine-specific honesty lines: what did not run this time, and why. */
  extraLimitations?: readonly string[]
  /** Set when the reader stopped early and kept what it had. */
  partial?: AnalyzerPartialInfo | null
}

export function buildReport(input: ReportBuildInput): AnalyzerReport {
  const sorted = sortReportFindings(input.analyses.flatMap((analysis) => analysis.findings))
  const summary = summarizeFindings(sorted)
  const { findings, truncation } = capStoredFindings(sorted)
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
      ...(input.partial ? { partial: { ...input.partial } } : {}),
    },
    summary,
    findings,
    coverage: [...input.coverage],
    limitations: [
      ...REPORT_LIMITATIONS,
      ...(input.extraLimitations ?? []),
      ...(truncation ? [findingsTruncationNote(truncation)] : []),
    ],
    ...(truncation ? { truncated: truncation } : {}),
  }
}

export const SEVERITY_DISPLAY_ORDER = SEVERITY_ORDER
export const TIER_DISPLAY_ORDER = TIER_ORDER
