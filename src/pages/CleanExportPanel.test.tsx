import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchiveEntry } from '../features/analyzer/archive/guard'
import { buildCleanExport, type CleanExportResult } from '../features/analyzer/cleanExport/build'
import { authorizeCleanExport } from '../features/analyzer/cleanExport/gate'
import type { FixCandidate } from '../features/analyzer/fixes/types'
import type { AnalyzerFinding, AnalyzerReport } from '../features/analyzer/types'
import { CleanExportPanel } from '../features/analyzer/ui/CleanExportPanel'
import { getAxeViolations } from '../test/axe'

vi.mock('../features/analyzer/cleanExport/gate', () => ({
  authorizeCleanExport: vi.fn(() => ({
    allowed: true,
    reason: 'Clean export runs entirely in this browser tab, so it is enabled without credits.',
  })),
}))

vi.mock('../features/analyzer/cleanExport/build', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/analyzer/cleanExport/build')>()
  return { ...actual, buildCleanExport: vi.fn() }
})

const FINDING: AnalyzerFinding = {
  id: 'f-1',
  ruleId: 'bugpilot/secret/credential-assignment',
  analyzer: 'bugpilot-rules',
  tier: 'pattern',
  severity: 'High',
  confidence: { level: 'high', reason: 'Fixture.' },
  file: 'src/app.js',
  range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 20 },
  evidence: [],
  message: 'Credential assigned to a literal.',
  explanation: 'Fixture.',
  fix: null,
  verificationSteps: [],
  limitations: [],
}

const REPORT: AnalyzerReport = {
  schemaVersion: 1,
  generatedAt: '2026-11-03T10:00:00.000Z',
  includeSnippets: false,
  session: { archiveBytes: 10, fileCount: 1, analysedCount: 1, skippedCount: 0, skipped: [] },
  summary: {
    findings: 1,
    bySeverity: { Low: 0, Medium: 0, High: 1, Critical: 0 },
    byTier: { syntax: 0, pattern: 1, 'type-or-dataflow': 0 },
  },
  findings: [FINDING],
  coverage: [],
  limitations: [],
}

const SOURCES: ArchiveEntry[] = [
  {
    name: 'src/app.js',
    text: 'const apiKey = "value"\n',
    language: 'javascript',
    languageSource: 'extension',
    encoding: 'utf-8',
    bytes: 24,
  },
]

const CANDIDATES: FixCandidate[] = [
  {
    findingId: 'f-1',
    ruleId: 'bugpilot/secret/credential-assignment',
    file: 'src/app.js',
    targetStartLine: 1,
    targetEndLine: 1,
    edits: [{ file: 'src/app.js', startOffset: 15, endOffset: 22, newText: 'process.env.API_KEY' }],
    description: 'Read the API key from process.env.API_KEY.',
    riskClass: 'needs-review',
    behaviourChange: true,
    warnings: [],
    maskedSpans: [],
  },
]

function readyResult(): CleanExportResult {
  return {
    status: 'ready',
    applied: [],
    cleanFiles: [{ file: 'src/app.js', text: 'const apiKey = process.env.API_KEY\n' }],
    files: [
      { name: 'changes.patch', bytes: new Uint8Array([100, 105, 102, 102]), mime: 'text/x-diff' },
      { name: 'clean.zip', bytes: new Uint8Array([80, 75]), mime: 'application/zip' },
    ],
  }
}

describe('CleanExportPanel', () => {
  beforeEach(() => {
    vi.mocked(authorizeCleanExport).mockReturnValue({ allowed: true, reason: 'ok' })
    vi.mocked(buildCleanExport).mockReset()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:test'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  it('shows the outputs, the patch warning and the build action', async () => {
    const view = render(
      <CleanExportPanel report={REPORT} sources={SOURCES} candidates={CANDIDATES} onReportOnly={vi.fn()} />,
    )

    expect(screen.getByRole('checkbox', { name: /changes\.patch/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /clean\.zip/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /CHANGELOG\.md/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /report\.md and report\.json/ })).toBeChecked()
    expect(screen.getByText(/changes\.patch contains your original lines/)).toBeInTheDocument()
    expect(await getAxeViolations(view.container)).toEqual([])
  })

  it('builds through the single gate and offers one download button per file', async () => {
    vi.mocked(buildCleanExport).mockResolvedValue(readyResult())
    const user = userEvent.setup()
    render(
      <CleanExportPanel report={REPORT} sources={SOURCES} candidates={CANDIDATES} onReportOnly={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Build clean export' }))
    expect(await screen.findByRole('button', { name: 'Download changes.patch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download clean.zip' })).toBeInTheDocument()
    expect(authorizeCleanExport).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Download changes.patch' }))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('changes.patch download started.')).toBeInTheDocument()
  })

  it('shows the blocked reason and offers the report-only fallback', async () => {
    vi.mocked(buildCleanExport).mockResolvedValue({
      status: 'blocked',
      message: 'Applying changes.patch to src/app.js did not reproduce the clean file byte for byte.',
    })
    const onReportOnly = vi.fn()
    const user = userEvent.setup()
    render(
      <CleanExportPanel report={REPORT} sources={SOURCES} candidates={CANDIDATES} onReportOnly={onReportOnly} />,
    )

    await user.click(screen.getByRole('button', { name: 'Build clean export' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Applying changes.patch to src/app.js did not reproduce the clean file byte for byte.',
    )
    await user.click(screen.getByRole('button', { name: 'Download report only' }))
    expect(onReportOnly).toHaveBeenCalledTimes(1)
  })

  it('does not build when the gate refuses', async () => {
    vi.mocked(authorizeCleanExport).mockReturnValue({ allowed: false, reason: 'No credits left today.' })
    const user = userEvent.setup()
    render(
      <CleanExportPanel report={REPORT} sources={SOURCES} candidates={CANDIDATES} onReportOnly={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Build clean export' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No credits left today.'))
    expect(buildCleanExport).not.toHaveBeenCalled()
  })

  it('requires at least one output', async () => {
    const user = userEvent.setup()
    render(
      <CleanExportPanel report={REPORT} sources={SOURCES} candidates={CANDIDATES} onReportOnly={vi.fn()} />,
    )

    for (const name of [/changes\.patch/, /clean\.zip/, /CHANGELOG\.md/, /report\.md and report\.json/]) {
      await user.click(screen.getByRole('checkbox', { name }))
    }
    expect(screen.getByText('Tick at least one output to build.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build clean export' })).toBeDisabled()
  })
})
