import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ArchiveEntry } from '../features/analyzer/archive/guard'
import type { FixPlan } from '../features/analyzer/fixes/plan'
import type { FixCandidate } from '../features/analyzer/fixes/types'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../features/analyzer/types'
import { AnalyzeResults, type PrepareFixPlan } from '../features/analyzer/ui/AnalyzeResults'
import { FixReview } from '../features/analyzer/ui/FixReview'
import { getAxeViolations } from '../test/axe'

const FAKE_SECRET = ['Zq9', 'vT4k', 'Wm8p', 'Rc2s', 'Ld7N'].join('')
const SECRET_MASK = `${FAKE_SECRET[0]}…${FAKE_SECRET[FAKE_SECRET.length - 1]}`

const APP_TEXT = `const key = "${FAKE_SECRET}"\nconst retry = 1\nexport function run() {\n  return retry\n}\n`
const MANUAL_TEXT = `// TODO: remove this marker\nconst value = 1\n`

const SECRET_START = APP_TEXT.indexOf(FAKE_SECRET) - 1
const RETRY_START = APP_TEXT.indexOf('const retry = 1')

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

function candidate(
  overrides: Partial<FixCandidate> & Pick<FixCandidate, 'findingId' | 'file' | 'edits'>,
): FixCandidate {
  return {
    ruleId: 'bugpilot/secret/credential-assignment',
    targetStartLine: 1,
    targetEndLine: 1,
    description: 'Replace the literal with an environment lookup.',
    riskClass: 'safe',
    behaviourChange: false,
    warnings: [],
    maskedSpans: [],
    ...overrides,
  }
}

const SECRET_FINDING = finding({
  id: 'f-secret-1',
  file: 'src/app.ts',
  ruleId: 'bugpilot/secret/credential-assignment',
  severity: 'High',
  message: 'Credential assigned to a literal.',
})
const RETRY_FINDING = finding({
  id: 'f-retry-2',
  file: 'src/app.ts',
  ruleId: 'bugpilot/generic/retry-literal',
  severity: 'Low',
  message: 'Retry count is hard-coded.',
  range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 16 },
})
const MANUAL_FINDING = finding({
  id: 'f-manual-3',
  file: 'src/manual.ts',
  ruleId: 'bugpilot/generic/todo-marker',
  severity: 'Low',
  message: 'TODO marker left in the code.',
})

const SECRET_CANDIDATE = candidate({
  findingId: SECRET_FINDING.id,
  file: 'src/app.ts',
  edits: [
    {
      file: 'src/app.ts',
      startOffset: SECRET_START,
      endOffset: SECRET_START + FAKE_SECRET.length + 2,
      newText: 'process.env.API_KEY',
    },
  ],
  description: 'Read the API key from process.env.API_KEY instead of a literal.',
  riskClass: 'needs-review',
  behaviourChange: true,
  warnings: ['Rotate this credential: removing it from the code does not revoke it.'],
  maskedSpans: [
    {
      startOffset: SECRET_START,
      endOffset: SECRET_START + FAKE_SECRET.length + 2,
      maskedText: SECRET_MASK,
    },
  ],
})

const RETRY_CANDIDATE = candidate({
  findingId: RETRY_FINDING.id,
  file: 'src/app.ts',
  edits: [{ file: 'src/app.ts', startOffset: RETRY_START, endOffset: RETRY_START + 15, newText: 'const retry = 2' }],
  ruleId: 'bugpilot/generic/retry-literal',
  description: 'Raise the fixed retry count from 1 to 2.',
  riskClass: 'safe',
  behaviourChange: true,
  targetStartLine: 2,
  targetEndLine: 2,
})

function planOf(available: FixCandidate[], unavailable = new Map<string, string>()): FixPlan {
  return { available, unavailable, dropped: [] }
}

function renderResults(prepare: PrepareFixPlan, findings = [SECRET_FINDING, RETRY_FINDING, MANUAL_FINDING]) {
  return render(
    <AnalyzeResults
      report={report(findings)}
      headingRef={{ current: null }}
      downloadReportFile={vi.fn()}
      onClear={vi.fn()}
      sources={[source('src/app.ts', APP_TEXT), source('src/manual.ts', MANUAL_TEXT)]}
      prepareFixPlan={prepare}
    />,
  )
}

describe('fix selection', () => {
  it('ticks safe changes by default and leaves needs-review changes unticked', async () => {
    renderResults(() => Promise.resolve(planOf([SECRET_CANDIDATE, RETRY_CANDIDATE])))

    expect(await screen.findByText('1 change selected in 1 file')).toBeInTheDocument()

    const secretBox = screen.getByRole('checkbox', {
      name: /Include this change for bugpilot\/secret\/credential-assignment/,
    })
    expect(secretBox).not.toBeChecked()

    const retryBox = screen.getByRole('checkbox', { name: /Include this change for .*retry-literal.*/ })
    expect(retryBox).toBeChecked()

    expect(screen.getAllByRole('checkbox', { name: /Include this change/ })).toHaveLength(2)
    expect(screen.getByText('Proposed change (safe, not applied)')).toBeInTheDocument()
    expect(screen.getByText('Proposed change (needs-review, not applied)')).toBeInTheDocument()
    expect(
      screen.getByText('Rotate this credential: removing it from the code does not revoke it.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No automatic fix is suggested for this finding.')).toBeInTheDocument()
  })

  it('updates the count and disables review with an explanation when nothing is selected', async () => {
    const user = userEvent.setup()
    renderResults(() => Promise.resolve(planOf([SECRET_CANDIDATE, RETRY_CANDIDATE])))

    await screen.findByText('1 change selected in 1 file')
    await user.click(screen.getByRole('checkbox', { name: /Include this change for .*credential-assignment.*/ }))
    expect(screen.getByText('2 changes selected in 1 file')).toBeInTheDocument()

    const review = screen.getByRole('button', { name: 'Review changes' })
    expect(review).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: /Include this change for .*credential-assignment.*/ }))
    await user.click(screen.getByRole('checkbox', { name: /Include this change for .*retry-literal.*/ }))

    expect(screen.getByText('0 changes selected in 0 files')).toBeInTheDocument()
    expect(review).toBeDisabled()
    expect(screen.getByText('Select at least one change to open the review.')).toBeInTheDocument()
  })

  it('explains why a proposed change was not offered', async () => {
    renderResults(() =>
      Promise.resolve(
        planOf([], new Map([[SECRET_FINDING.id, 'fix did not verify: introduced a new High finding']])),
      ),
    )

    expect(
      await screen.findByText(
        'No automatic change offered: fix did not verify: introduced a new High finding',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No finding in this upload has a verified automatic change. The report export above still works.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review changes' })).toBeNull()
  })

  it('keeps the legacy manual-only direction when there is no candidate', async () => {
    const withLegacyFix = {
      ...MANUAL_FINDING,
      fix: {
        explanation: 'Remove the marker once the work is done.',
        whereItMayApply: 'The marked line.',
        exampleCode: '',
        riskClass: 'manual-only' as const,
        riskReason: 'Only the owner knows whether the work is still planned.',
      },
    }
    renderResults(() => Promise.resolve(planOf([])), [withLegacyFix])

    expect(await screen.findByText('Suggested direction (manual-only, not applied)')).toBeInTheDocument()
    expect(screen.getByText('Remove the marker once the work is done.')).toBeInTheDocument()
  })
})

describe('diff review', () => {
  async function openReview() {
    const user = userEvent.setup()
    const view = renderResults(() => Promise.resolve(planOf([SECRET_CANDIDATE, RETRY_CANDIDATE])))
    await screen.findByText('1 change selected in 1 file')
    await user.click(screen.getByRole('checkbox', { name: /Include this change for .*credential-assignment.*/ }))
    await user.click(screen.getByRole('button', { name: 'Review changes' }))
    await screen.findByRole('heading', { name: /Diff of 2 proposed changes in 1 file/ })
    await screen.findByRole('table', { name: 'Unified diff for src/app.ts' })
    return { user, view }
  }

  it('renders a unified diff with added and removed markers and masks secrets', async () => {
    const { view } = await openReview()

    const table = screen.getByRole('table', { name: 'Unified diff for src/app.ts' })
    expect(within(table).getAllByText('added').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('removed').length).toBeGreaterThan(0)
    expect(within(table).getByText(new RegExp(SECRET_MASK))).toBeInTheDocument()
    expect(within(table).queryByText(new RegExp(FAKE_SECRET))).toBeNull()

    const review = view.container.querySelector('.fix-review')
    expect(review).not.toBeNull()
    expect(review?.querySelectorAll('[style]')).toHaveLength(0)
    expect(review?.querySelectorAll('[role="status"]')).toHaveLength(1)
  })

  it('switches to side by side and jumps between changes with the keyboard', async () => {
    const { user } = await openReview()

    await user.click(screen.getByRole('button', { name: 'Side by side' }))
    expect(screen.getByRole('table', { name: 'Side-by-side diff for src/app.ts' })).toBeInTheDocument()

    expect(screen.getByText('Change 1 of 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next change' }))
    await waitFor(() => expect(document.activeElement?.id).toMatch(/^fix-diff-/))

    await user.click(screen.getByRole('button', { name: 'Previous change' }))
    await waitFor(() => expect(document.activeElement?.id).toMatch(/^fix-diff-/))
  })

  it('closes the review and returns focus to the review button', async () => {
    const { user } = await openReview()

    await user.click(screen.getByRole('button', { name: 'Close review' }))
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Review changes' })),
    )
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('paginates a long diff', async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `const value${index} = ${index}`)
    const before = `${lines.join('\n')}\n`
    const after = `${lines.map((line) => `${line} // changed`).join('\n')}\n`
    const longSource = source('src/long.ts', before)
    const longFinding = finding({
      id: 'f-long-1',
      file: 'src/long.ts',
      ruleId: 'bugpilot/generic/long-file',
      severity: 'Low',
      message: 'Fixture long file.',
    })
    const longCandidate = candidate({
      findingId: longFinding.id,
      file: 'src/long.ts',
      edits: [{ file: 'src/long.ts', startOffset: 0, endOffset: before.length, newText: after }],
      ruleId: 'bugpilot/generic/long-file',
    })

    const user = userEvent.setup()
    render(
      <FixReview
        report={report([longFinding])}
        sources={[longSource]}
        candidates={[longCandidate]}
        onClose={vi.fn()}
        pageSize={5}
      />,
    )

    expect(await screen.findByText('Rows 1–5 of 41')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next rows' }))
    expect(screen.getByText('Rows 6–10 of 41')).toBeInTheDocument()
  })

  it('shows an empty state when nothing is selected', async () => {
    render(
      <FixReview
        report={report([MANUAL_FINDING])}
        sources={[source('src/manual.ts', MANUAL_TEXT)]}
        candidates={[]}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('No changes are selected, so there is nothing to review.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to findings' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('review accessibility', () => {
  it('has no axe violations in the unified, split and empty states', async () => {
    const user = userEvent.setup()
    const findings = [SECRET_FINDING, RETRY_FINDING]
    const view = render(
      <FixReview
        report={report(findings)}
        sources={[source('src/app.ts', APP_TEXT)]}
        candidates={[SECRET_CANDIDATE, RETRY_CANDIDATE]}
        onClose={vi.fn()}
      />,
    )

    await screen.findByRole('table', { name: 'Unified diff for src/app.ts' })
    expect(await getAxeViolations(view.container)).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Side by side' }))
    await screen.findByRole('table', { name: 'Side-by-side diff for src/app.ts' })
    expect(await getAxeViolations(view.container)).toEqual([])
    view.unmount()

    const empty = render(
      <FixReview
        report={report([MANUAL_FINDING])}
        sources={[source('src/manual.ts', MANUAL_TEXT)]}
        candidates={[]}
        onClose={vi.fn()}
      />,
    )
    expect(await getAxeViolations(empty.container)).toEqual([])
  })

  it('has no axe violations in the selection panel', async () => {
    const view = renderResults(() => Promise.resolve(planOf([SECRET_CANDIDATE, RETRY_CANDIDATE])))
    await screen.findByText('1 change selected in 1 file')
    expect(await getAxeViolations(view.container)).toEqual([])
  })
})
