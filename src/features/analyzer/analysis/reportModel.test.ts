import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveSkippedEntry } from '../archive/guard'
import type { AnalyzerFinding } from '../types'
import type { FileAnalysis } from './engine'
import { makeFinding } from './finding'
import { buildReport, REPORT_LIMITATIONS, sortReportFindings, summarizeFindings } from './reportModel'

function finding(file: string, line: number, severity: AnalyzerFinding['severity'], ruleId = 'rule/a'): AnalyzerFinding {
  return makeFinding({
    ruleId,
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity,
    confidence: { level: 'medium', reason: 'Test.' },
    file,
    range: { startLine: line, startColumn: 1, endLine: line, endColumn: 2 },
    evidence: [{ source: 'code snippet', label: `Line ${line}`, quote: 'x', lineNumber: line }],
    message: 'Test finding.',
    explanation: 'Test.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

function entry(name: string): ArchiveEntry {
  const text = 'x\n'
  const detection = detectLanguage(name, text)
  return { name, text, language: detection.language, languageSource: detection.source, encoding: 'utf-8', bytes: 2 }
}

function analysis(file: string, findings: AnalyzerFinding[]): FileAnalysis {
  return { file, findings, notes: [], rulesRan: [], stoppedEarly: false }
}

describe('report summary', () => {
  it('counts by severity and tier', () => {
    const summary = summarizeFindings([
      finding('a.ts', 1, 'Critical'),
      finding('a.ts', 2, 'Low'),
      { ...finding('b.ts', 1, 'High'), tier: 'syntax' },
    ])

    expect(summary.findings).toBe(3)
    expect(summary.bySeverity).toEqual({ Low: 1, Medium: 0, High: 1, Critical: 1 })
    expect(summary.byTier).toEqual({ syntax: 1, pattern: 2, 'type-or-dataflow': 0 })
  })

  it('sorts by file then line, with severity as the tie-break', () => {
    const sorted = sortReportFindings([
      finding('b.ts', 1, 'Critical'),
      finding('a.ts', 9, 'Low'),
      finding('a.ts', 2, 'Low'),
      finding('a.ts', 2, 'High'),
    ])

    expect(sorted.map((item) => `${item.file}:${item.range.startLine}:${item.severity}`)).toEqual([
      'a.ts:2:High',
      'a.ts:2:Low',
      'a.ts:9:Low',
      'b.ts:1:Critical',
    ])
  })
})

describe('report builder', () => {
  it('describes the session, keeps coverage and states its limits', () => {
    const skipped: ArchiveSkippedEntry[] = [
      { name: 'image.png', code: 'binary_content', message: 'Binary file skipped.' },
    ]
    const entries = [entry('src/app.ts')]
    const coverage = [
      {
        file: 'src/app.ts',
        status: 'analysed' as const,
        language: 'typescript' as const,
        languageSource: 'extension' as const,
        languageLabel: 'TypeScript',
        encoding: 'utf-8' as const,
        bytes: 2,
        findings: 1,
        tiers: [],
        skipReason: null,
        notes: [],
      },
    ]
    const report = buildReport({
      generatedAt: new Date('2026-02-03T04:05:06Z'),
      archiveBytes: 120,
      entries,
      skipped,
      analyses: [analysis('src/app.ts', [finding('src/app.ts', 1, 'Critical')])],
      coverage,
    })

    expect(report.schemaVersion).toBe(1)
    expect(report.generatedAt).toBe('2026-02-03T04:05:06.000Z')
    expect(report.includeSnippets).toBe(true)
    expect(report.session).toEqual({
      archiveBytes: 120,
      fileCount: 2,
      analysedCount: 1,
      skippedCount: 1,
      skipped: [{ file: 'image.png', reason: 'Binary file skipped.' }],
    })
    expect(report.summary.bySeverity.Critical).toBe(1)
    expect(report.coverage).toEqual(coverage)
    expect(report.limitations).toEqual(REPORT_LIMITATIONS)
  })

  it('is deterministic for the same input and generation time', () => {
    const build = () =>
      buildReport({
        generatedAt: new Date('2026-02-03T04:05:06Z'),
        archiveBytes: 2,
        entries: [entry('a.json')],
        skipped: [],
        analyses: [analysis('a.json', [finding('a.json', 1, 'Low')])],
        coverage: [],
      })

    expect(build()).toEqual(build())
  })
})
