import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../types'
import { AnalyzeResults } from './AnalyzeResults'
import { getAxeViolations } from '../../../test/axe'

function source(name: string, text: string): ArchiveEntry {
  return {
    name,
    text,
    language: 'typescript',
    languageSource: 'extension',
    encoding: 'utf-8',
    bytes: text.length,
  }
}

function finding(
  overrides: Partial<AnalyzerFinding> & Pick<AnalyzerFinding, 'id' | 'file' | 'ruleId' | 'severity' | 'message'>,
): AnalyzerFinding {
  return {
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    confidence: { level: 'high', reason: 'A test fixture.' },
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 },
    evidence: [],
    explanation: 'Fixture explanation.',
    fix: null,
    verificationSteps: [],
    limitations: [],
    ...overrides,
  }
}

function coverage(file: string, findings: number): FileCoverage {
  return {
    file,
    status: 'analysed',
    language: 'typescript',
    languageSource: 'extension',
    languageLabel: 'TypeScript',
    encoding: 'utf-8',
    bytes: 100,
    findings,
    tiers: [
      { tier: 'syntax', available: true, ran: true, reason: '' },
      { tier: 'pattern', available: true, ran: true, reason: '' },
      { tier: 'type-or-dataflow', available: true, ran: true, reason: '' },
    ],
    skipReason: null,
    notes: [],
  }
}

function report(findings: AnalyzerFinding[]): AnalyzerReport {
  const files = [...new Set(findings.map((entry) => entry.file))]
  const bySeverity = { Low: 0, Medium: 0, High: 0, Critical: 0 } as AnalyzerReport['summary']['bySeverity']
  const byTier: AnalyzerReport['summary']['byTier'] = {
    syntax: 0,
    pattern: 0,
    'type-or-dataflow': 0,
  }
  for (const entry of findings) {
    bySeverity[entry.severity] += 1
    byTier[entry.tier] += 1
  }
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-03T10:00:00.000Z',
    includeSnippets: false,
    session: {
      archiveBytes: 200,
      fileCount: files.length,
      analysedCount: files.length,
      skippedCount: 0,
      skipped: [],
    },
    summary: { findings: findings.length, bySeverity, byTier },
    findings,
    coverage: files.map((file) =>
      coverage(file, findings.filter((entry) => entry.file === file).length),
    ),
    limitations: [],
  }
}

const ACTIONABLE = finding({
  id: 'f-catch-1',
  file: 'src/app.ts',
  ruleId: 'bugpilot/generic/empty-catch',
  severity: 'Medium',
  message: 'Empty catch block swallows the error.',
})
const TODO_NOTE = finding({
  id: 'f-todo-2',
  file: 'src/notes.ts',
  ruleId: 'bugpilot/generic/todo-marker',
  severity: 'Low',
  message: 'TODO marker left in the code.',
})
const LONG_LINE_NOTE = finding({
  id: 'f-line-3',
  file: 'src/notes.ts',
  ruleId: 'bugpilot/generic/long-line',
  severity: 'Low',
  message: 'Line is longer than 160 characters.',
})

const NO_PLAN = () => Promise.resolve({ available: [], unavailable: new Map(), dropped: [] })

function renderResults(findings: AnalyzerFinding[]) {
  return render(
    <AnalyzeResults
      report={report(findings)}
      headingRef={{ current: null }}
      downloadReportFile={vi.fn()}
      onClear={vi.fn()}
      sources={[source('src/app.ts', 'try {}\ncatch (error) {}\n')]}
      prepareFixPlan={NO_PLAN}
    />,
  )
}

describe('notes group', () => {
  it('keeps note rules out of the headline count and lists them in a collapsed group', async () => {
    const user = userEvent.setup()
    const view = renderResults([ACTIONABLE, TODO_NOTE, LONG_LINE_NOTE])

    const stats = screen.getByRole('group', { name: 'Analysis summary' })
    expect(within(stats).getByText('1')).toBeInTheDocument()
    expect(within(stats).getByText('2')).toBeInTheDocument()

    expect(screen.getByText('Showing 1 of 1 finding.')).toBeInTheDocument()
    const groupHeads = [...view.container.querySelectorAll('.analyze-file-group h3')].map(
      (heading) => heading.textContent,
    )
    expect(groupHeads).toEqual(['src/app.ts1 finding'])

    await user.click(screen.getByText('Notes (2)'))
    expect(screen.getByText('TODO marker left in the code.')).toBeInTheDocument()
    expect(screen.getByText('Line is longer than 160 characters.')).toBeInTheDocument()
  })

  it('paginates the notes group on its own page size', async () => {
    const user = userEvent.setup()
    const notes = Array.from({ length: 45 }, (_, index) =>
      finding({
        id: `f-todo-${index}`,
        file: `src/n${index}.ts`,
        ruleId: 'bugpilot/generic/todo-marker',
        severity: 'Low',
        message: `TODO marker ${index}`,
      }),
    )
    renderResults([ACTIONABLE, ...notes])

    await user.click(screen.getByText('Notes (45)'))
    const details = screen.getByText('Notes (45)').closest('details') as HTMLDetailsElement
    expect(details.querySelectorAll('.analyze-finding')).toHaveLength(40)
    await user.click(screen.getByRole('button', { name: 'Show 5 more notes' }))
    expect(details.querySelectorAll('.analyze-finding')).toHaveLength(45)
  })

  it('gives a notes-only report its own message instead of the clean-report claim', () => {
    renderResults([TODO_NOTE, LONG_LINE_NOTE])

    expect(screen.getByText('No actionable findings matched this upload')).toBeInTheDocument()
    expect(screen.queryByText('No rule matched this upload')).toBeNull()
    expect(screen.getByText('Notes (2)')).toBeInTheDocument()
  })

  it('has no axe violations with the notes group open', async () => {
    const user = userEvent.setup()
    const view = renderResults([ACTIONABLE, TODO_NOTE, LONG_LINE_NOTE])

    await user.click(screen.getByText('Notes (2)'))
    expect(screen.getByText('TODO marker left in the code.')).toBeInTheDocument()
    expect(await getAxeViolations(view.container)).toEqual([])
  })
})
