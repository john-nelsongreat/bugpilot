import { describe, expect, it } from 'vitest'
import type { Severity } from '../../bugs/types'
import type { AnalyzerFinding, AnalyzerReport } from '../types'
import { renderReportMarkdown, renderReportSarif, reportFileStem, reportForExport } from './reportFiles'

const REPORT: AnalyzerReport = {
  schemaVersion: 1,
  generatedAt: '2026-02-03T04:05:06.000Z',
  includeSnippets: true,
  session: {
    archiveBytes: 120,
    fileCount: 2,
    analysedCount: 1,
    skippedCount: 1,
    skipped: [{ file: 'logo.png', reason: 'Binary file skipped.' }],
  },
  summary: {
    findings: 1,
    bySeverity: { Low: 0, Medium: 0, High: 1, Critical: 0 },
    byTier: { syntax: 0, pattern: 1, 'type-or-dataflow': 0 },
  },
  findings: [
    {
      id: 'f-12345678-1',
      ruleId: 'bugpilot/generic/merge-conflict-markers',
      analyzer: 'bugpilot-rules',
      tier: 'pattern',
      severity: 'High',
      confidence: { level: 'high', reason: 'The marker is at the start of a line.' },
      file: 'src/app.ts',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 },
      evidence: [
        { source: 'code snippet', label: 'Line 1', quote: '<<<<<<< HEAD', lineNumber: 1 },
      ],
      message: 'Merge conflict marker left in the file.',
      explanation: 'The file still contains a conflict marker.',
      fix: {
        explanation: 'Resolve the conflict and remove the markers.',
        whereItMayApply: 'The marked block.',
        exampleCode: '',
        riskClass: 'manual-only',
        riskReason: 'Only the author knows which side is correct.',
      },
      verificationSteps: ['Search the file for the remaining markers.'],
      limitations: ['This rule cannot tell which side of the conflict is correct.'],
    },
  ],
  coverage: [
    {
      file: 'src/app.ts',
      status: 'analysed',
      language: 'typescript',
      languageSource: 'extension',
      languageLabel: 'TypeScript',
      encoding: 'utf-8',
      bytes: 20,
      findings: 1,
      tiers: [
        { tier: 'syntax', available: true, ran: false, reason: 'The syntax check timed out.' },
        { tier: 'pattern', available: true, ran: true, reason: 'BugPilot pattern rules.' },
      ],
      skipReason: null,
      notes: [],
    },
    {
      file: 'logo.png',
      status: 'skipped',
      language: 'unknown',
      languageSource: 'name-only',
      languageLabel: 'Unrecognised file type',
      encoding: null,
      bytes: 0,
      findings: 0,
      tiers: [
        { tier: 'syntax', available: false, ran: false, reason: 'Skipped.' },
        { tier: 'pattern', available: false, ran: false, reason: 'Skipped.' },
      ],
      skipReason: 'Binary file skipped.',
      notes: [],
    },
  ],
  limitations: ['This is a static analysis.'],
}

describe('report export', () => {
  it('keeps evidence and quotes when snippets are included', () => {
    const prepared = reportForExport(REPORT, true)

    expect(prepared.includeSnippets).toBe(true)
    expect(prepared.findings[0].evidence).toEqual(REPORT.findings[0].evidence)
    expect(prepared.limitations).toEqual(REPORT.limitations)
  })

  it('drops every evidence quote when snippets are excluded', () => {
    const prepared = reportForExport(REPORT, false)

    expect(prepared.includeSnippets).toBe(false)
    expect(prepared.findings[0].evidence).toEqual([])
    expect(prepared.limitations.join(' ')).toMatch(/Evidence quotes were excluded/)
    expect(REPORT.findings[0].evidence).toHaveLength(1)
  })

  it('renders findings, coverage and limitations without a quote when snippets are off', () => {
    const markdown = renderReportMarkdown(reportForExport(REPORT, false))

    expect(markdown).toContain('# BugPilot code analysis report')
    expect(markdown).toContain('#### High: Merge conflict marker left in the file.')
    expect(markdown).toContain('Code snippets in this export: no')
    expect(markdown).toContain('| src/app.ts | analysed | TypeScript | 1 |')
    expect(markdown).toContain('skipped: Binary file skipped.')
    expect(markdown).toContain('- This is a static analysis.')
    expect(markdown).toContain('Evidence quotes were excluded')
    expect(markdown).not.toContain('<<<<<<< HEAD')
  })

  it('includes the quote in the markdown when snippets are on', () => {
    const markdown = renderReportMarkdown(reportForExport(REPORT, true))

    expect(markdown).toContain('Line 1 (line 1):')
    expect(markdown).toContain('<<<<<<< HEAD')
    expect(markdown).toContain('Code snippets in this export: yes')
  })

  it('marks a partial report at the top and keeps the marker in the exported data', () => {
    const partial: AnalyzerReport = {
      ...REPORT,
      session: {
        ...REPORT.session,
        partial: {
          code: 'total_uncompressed_exceeded',
          message: 'BugPilot reached its 600 MiB unpacking budget.',
          analysedFiles: 1,
          plannedFiles: 2,
          unreachedFiles: 1,
          producedBytes: 20,
          plannedBytes: 40,
        },
      },
    }
    const markdown = renderReportMarkdown(reportForExport(partial, false))

    expect(markdown.indexOf('**PARTIAL REPORT.**')).toBeLessThan(markdown.indexOf('Generated:'))
    expect(markdown).toContain('1 of 2 planned file(s) were analysed; 1 file(s) were not reached.')
    expect(JSON.parse(JSON.stringify(reportForExport(partial, false))).session.partial.code).toBe(
      'total_uncompressed_exceeded',
    )
  })

  it('gives the downloaded pair a safe timestamped stem', () => {
    expect(reportFileStem('2026-02-03T04:05:06.000Z')).toBe(
      'bugpilot-analysis-2026-02-03T04-05-06-000Z',
    )
  })
})

describe('SARIF export', () => {
  const finding = (overrides: Partial<AnalyzerFinding>): AnalyzerFinding => ({
    ...REPORT.findings[0],
    ...overrides,
  })

  function sarifOf(report: AnalyzerReport) {
    return JSON.parse(renderReportSarif(report)) as {
      $schema: string
      version: string
      runs: {
        tool: { driver: { name: string; rules: { id: string; shortDescription: { text: string } }[] } }
        results: {
          ruleId: string
          ruleIndex: number
          level: string
          message: { text: string }
          locations: { physicalLocation: { artifactLocation: { uri: string }; region: Record<string, number> } }[]
        }[]
      }[]
    }
  }

  it('emits a 2.1.0 log with a schema reference and one BugPilot run', () => {
    const sarif = sarifOf(REPORT)

    expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json')
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs).toHaveLength(1)
    expect(sarif.runs[0].tool.driver.name).toBe('BugPilot')
  })

  it('maps every severity through the fixed table without recomputing', () => {
    const severities: Severity[] = ['Critical', 'High', 'Medium', 'Low']
    const report: AnalyzerReport = {
      ...REPORT,
      findings: severities.map((severity) => finding({ severity })),
    }
    const [run] = sarifOf(report).runs

    expect(run.results.map((result) => result.level)).toEqual(['error', 'error', 'warning', 'note'])
  })

  it('emits one descriptor per distinct ruleId, sorted, with ruleIndex on every result', () => {
    const report: AnalyzerReport = {
      ...REPORT,
      findings: [
        finding({ ruleId: 'bugpilot/b/rule-two' }),
        finding({ ruleId: 'bugpilot/a/rule-one' }),
        finding({ ruleId: 'bugpilot/b/rule-two' }),
      ],
    }
    const [run] = sarifOf(report).runs

    expect(run.tool.driver.rules.map((rule) => rule.id)).toEqual([
      'bugpilot/a/rule-one',
      'bugpilot/b/rule-two',
    ])
    expect(run.results.map((result) => result.ruleIndex)).toEqual([1, 0, 1])
  })

  it('describes each rule by the ruleId already in the report model', () => {
    const [run] = sarifOf(REPORT).runs

    expect(run.tool.driver.rules).toEqual([
      {
        id: 'bugpilot/generic/merge-conflict-markers',
        shortDescription: { text: 'bugpilot/generic/merge-conflict-markers' },
      },
    ])
  })

  it('percent-encodes each path segment of the artifact uri', () => {
    const report: AnalyzerReport = {
      ...REPORT,
      findings: [finding({ file: 'my folder/app file.ts' })],
    }
    const [run] = sarifOf(report).runs

    expect(run.results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      'my%20folder/app%20file.ts',
    )
  })

  it('emits a 1-based region and omits columns the finding does not have', () => {
    const report: AnalyzerReport = {
      ...REPORT,
      findings: [finding({ range: { startLine: 3, endLine: 4 } }), REPORT.findings[0]],
    }
    const [run] = sarifOf(report).runs

    expect(run.results[0].locations[0].physicalLocation.region).toEqual({ startLine: 3, endLine: 4 })
    expect(run.results[1].locations[0].physicalLocation.region).toEqual({
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 8,
    })
  })

  it('keeps fixes, evidence and limitations out of the SARIF payload', () => {
    const sarifText = renderReportSarif(REPORT)
    const [run] = sarifOf(REPORT).runs

    expect(Object.keys(run.results[0])).toEqual(['ruleId', 'ruleIndex', 'level', 'message', 'locations'])
    expect(run.results[0].message.text).toBe('Merge conflict marker left in the file.')
    expect(sarifText).not.toContain('<<<<<<< HEAD')
    expect(sarifText).not.toContain('manual-only')
  })

  it('exports a report with no findings as a valid empty run', () => {
    const report: AnalyzerReport = { ...REPORT, findings: [] }
    const [run] = sarifOf(report).runs

    expect(run.tool.driver.rules).toEqual([])
    expect(run.results).toEqual([])
  })
})
