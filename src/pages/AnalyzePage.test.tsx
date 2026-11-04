import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import type { AnalysisSessionResult, AnalyzeUploadOptions, UploadInput } from '../features/analyzer/analysis/session'
import type { ArchiveReadStats } from '../features/analyzer/archive/guard'
import type { DownloadReportFile } from '../features/analyzer/export/reportFiles'
import type { AnalyzerFinding, AnalyzerReport } from '../features/analyzer/types'
import { getAxeViolations } from '../test/axe'
import { AnalyzePage } from './AnalyzePage'

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

const STATS: ArchiveReadStats = {
  walkedRecords: 3,
  producedBytes: 64,
  entries: 2,
  skipped: 1,
  durationMs: 4,
  peakEntryBytes: 40,
}

function finding(overrides: Partial<AnalyzerFinding> & Pick<AnalyzerFinding, 'id' | 'severity' | 'message' | 'file'>): AnalyzerFinding {
  return {
    ruleId: 'bugpilot/generic/todo-marker',
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    confidence: { level: 'medium', reason: 'The marker is at the start of a line.' },
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 },
    evidence: [
      { source: 'code snippet', label: 'Line 1', quote: 'const todo = "later"', lineNumber: 1 },
    ],
    explanation: 'The rule found a marker the reader may have missed.',
    fix: {
      explanation: 'Resolve the marker and remove it.',
      whereItMayApply: 'The marked line.',
      exampleCode: '',
      riskClass: 'manual-only',
      riskReason: 'Only the owner knows whether the work is still planned.',
    },
    verificationSteps: ['Search the file for the remaining marker.'],
    limitations: ['The rule cannot tell whether the task is already done.'],
    ...overrides,
  }
}

function makeReport(): AnalyzerReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-02-03T04:05:06.000Z',
    includeSnippets: true,
    session: {
      archiveBytes: 64,
      fileCount: 3,
      analysedCount: 2,
      skippedCount: 1,
      skipped: [{ file: 'assets/logo.png', reason: 'Binary file skipped.' }],
    },
    summary: {
      findings: 2,
      bySeverity: { Low: 1, Medium: 0, High: 0, Critical: 1 },
      byTier: { syntax: 0, pattern: 2, 'type-or-dataflow': 0 },
    },
    findings: [
      finding({
        id: 'f-11111111-1',
        severity: 'Critical',
        message: 'Possible AWS access key id.',
        file: 'src/app.ts',
        ruleId: 'bugpilot/secret/aws-access-key',
        confidence: { level: 'high', reason: 'The value has the fixed prefix AWS issues.' },
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
        evidence: [
          { source: 'code snippet', label: 'Line 1', quote: 'const key = "***"', lineNumber: 1 },
        ],
      }),
      finding({
        id: 'f-22222222-5',
        severity: 'Low',
        message: 'Plain HTTP URL to a non-local host.',
        file: 'src/app.ts',
        ruleId: 'bugpilot/generic/insecure-http-url',
        range: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
        evidence: [
          {
            source: 'code snippet',
            label: 'Line 5',
            quote: 'fetch("http://example.test/api")',
            lineNumber: 5,
          },
        ],
      }),
    ],
    coverage: [
      {
        file: 'src/app.ts',
        status: 'analysed',
        language: 'typescript',
        languageSource: 'extension',
        languageLabel: 'TypeScript',
        encoding: 'utf-8',
        bytes: 40,
        findings: 2,
        tiers: [
          { tier: 'syntax', available: true, ran: true, reason: 'Syntax diagnostics ran.' },
          { tier: 'pattern', available: true, ran: true, reason: 'BugPilot pattern rules.' },
        ],
        skipReason: null,
        notes: [],
      },
      {
        file: 'scripts/tool.py',
        status: 'analysed',
        language: 'python',
        languageSource: 'extension',
        languageLabel: 'Python',
        encoding: 'utf-8',
        bytes: 24,
        findings: 0,
        tiers: [
          { tier: 'syntax', available: false, ran: false, reason: 'No Python syntax engine is bundled.' },
          { tier: 'pattern', available: true, ran: true, reason: 'BugPilot pattern rules.' },
        ],
        skipReason: null,
        notes: [],
      },
      {
        file: 'assets/logo.png',
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
}

function completedAnalyze(report: AnalyzerReport, onOptions?: (options: AnalyzeUploadOptions) => void): AnalyzeFunction {
  return async (_input, options) => {
    onOptions?.(options)
    options.onProgress?.({
      phase: 'rules',
      filesDone: 1,
      filesTotal: 2,
      findings: 1,
      detail: 'Pattern rules: 1 of 2 file(s) checked.',
    })
    return { status: 'completed', message: null, report, stats: STATS }
  }
}

function selectFiles(files: File[]): void {
  const input = screen.getByLabelText('Choose files to analyse') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

const shippedLang = /<html\b[^>]*\blang="([^"]*)"/i.exec(indexHtml)?.[1]

beforeAll(() => {
  if (shippedLang) document.documentElement.lang = shippedLang
})

afterAll(() => {
  document.documentElement.removeAttribute('lang')
})

describe('Analyze page', () => {
  it('shows the privacy note, upload limits, pickers and empty state before any upload', async () => {
    const analyze = vi.fn<AnalyzeFunction>()
    render(<AnalyzePage analyze={analyze} />)

    expect(screen.getByRole('heading', { name: 'Analyze code', level: 1 })).toBeVisible()
    expect(screen.getByText(/Local analysis only/)).toBeVisible()
    expect(screen.getByText(/Archive up to 25 MiB/)).toBeVisible()
    expect(screen.getByText(/Up to 5,000 entries/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'No files checked yet' })).toBeVisible()
    expect(screen.getByLabelText('Choose a folder to analyse')).toHaveAttribute('webkitdirectory')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('reads loose files, shows progress, and renders findings with coverage and honesty notes', async () => {
    const analyze = vi.fn<AnalyzeFunction>(completedAnalyze(makeReport()))
    const { container } = render(
      <AnalyzePage
        analyze={analyze}
        readFile={async () => new Uint8Array([1])}
        downloadReportFile={vi.fn()}
      />,
    )

    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])

    const resultsHeading = await screen.findByRole('heading', { name: 'Results for 2 files' })
    expect(resultsHeading).toHaveFocus()

    const [input, options] = analyze.mock.calls[0]
    expect(input.kind).toBe('files')
    if (input.kind !== 'files') throw new Error('expected loose files')
    expect(input.sources.map((source) => source.path)).toEqual(['app.ts'])
    expect(options.archiveBytes).toBeGreaterThan(0)

    expect(screen.getByText('Possible AWS access key id.')).toBeVisible()
    expect(screen.getByText('Plain HTTP URL to a non-local host.')).toBeVisible()
    expect(screen.getByText('No findings does not mean no bugs')).toBeVisible()
    expect(screen.getAllByText(/TypeScript/).length).toBeGreaterThan(0)
    expect(screen.getByText(/No Python syntax engine is bundled/)).toBeVisible()
    expect(screen.getByText(/Binary file skipped/)).toBeVisible()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Severity'), 'Low')

    expect(screen.queryByText('Possible AWS access key id.')).not.toBeInTheDocument()
    expect(screen.getByText('Plain HTTP URL to a non-local host.')).toBeVisible()
    expect(screen.getByRole('status', { name: 'Filtered finding count' })).toHaveTextContent(
      'Showing 1 of 2 findings.',
    )

    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByText('Possible AWS access key id.')).toBeVisible()

    expect(await getAxeViolations(container)).toEqual([])
  })

  it('downloads reports without snippets by default and includes them after opting in', async () => {
    const user = userEvent.setup()
    const download = vi.fn<DownloadReportFile>()
    render(
      <AnalyzePage
        analyze={completedAnalyze(makeReport())}
        readFile={async () => new Uint8Array([1])}
        downloadReportFile={download}
      />,
    )

    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 2 files' })

    const snippetBox = screen.getByRole('checkbox', {
      name: /Include code snippets/,
    })
    expect(snippetBox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Download report.md' }))
    expect(download).toHaveBeenLastCalledWith('markdown', expect.any(Object), false)
    expect(screen.getByRole('status', { name: 'Export status' })).toHaveTextContent(
      'report.md downloaded. Evidence quotes were left out.',
    )

    await user.click(snippetBox)
    await user.click(screen.getByRole('button', { name: 'Download report.json' }))
    expect(download).toHaveBeenLastCalledWith('json', expect.any(Object), true)
    expect(screen.getByRole('status', { name: 'Export status' })).toHaveTextContent(
      'report.json downloaded. Evidence quotes are included.',
    )
  })

  it('clears the report and returns focus to the upload heading', async () => {
    const user = userEvent.setup()
    render(
      <AnalyzePage
        analyze={completedAnalyze(makeReport())}
        readFile={async () => new Uint8Array([1])}
        downloadReportFile={vi.fn()}
      />,
    )

    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 2 files' })

    await user.click(screen.getByRole('button', { name: 'Clear results' }))

    expect(screen.queryByRole('heading', { name: 'Results for 2 files' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No files checked yet' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Upload code to check' })).toHaveFocus()
  })

  it('treats a single zip as an archive and passes its bytes to the session', async () => {
    const analyze = vi.fn<AnalyzeFunction>(completedAnalyze(makeReport()))
    const readFile = vi.fn(async () => new Uint8Array([80, 75, 3, 4]))
    render(
      <AnalyzePage analyze={analyze} readFile={readFile} downloadReportFile={vi.fn()} />,
    )

    selectFiles([new File(['zip bytes'], 'bundle.zip', { type: 'application/zip' })])
    await screen.findByRole('heading', { name: 'Results for 2 files' })

    expect(readFile).toHaveBeenCalledTimes(1)
    const [input, options] = analyze.mock.calls[0]
    expect(input.kind).toBe('archive')
    expect(options.archiveBytes).toBe(4)
  })

  it('shows a refusal without producing results', async () => {
    const analyze: AnalyzeFunction = async () => ({
      status: 'refused',
      message: 'This archive holds more than 2,000 entries. BugPilot stops reading at that count.',
      report: null,
      stats: STATS,
    })
    render(<AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} />)

    selectFiles([new File(['zip bytes'], 'bundle.zip', { type: 'application/zip' })])

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload refused')
    expect(screen.getByRole('alert')).toHaveTextContent('2,000 entries')
    expect(screen.queryByRole('heading', { name: /Results for/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Upload code to check' })).toBeVisible()
  })

  it('reports a read failure as an analysis failure', async () => {
    const analyze: AnalyzeFunction = async () => {
      throw new Error('The uploaded file could not be read.')
    }
    render(<AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} />)

    selectFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })])

    expect(await screen.findByRole('alert')).toHaveTextContent('Analysis failed')
    expect(screen.getByRole('alert')).toHaveTextContent('The uploaded file could not be read.')
  })

  it('cancels a run in progress and keeps nothing', async () => {
    const user = userEvent.setup()
    const analyze: AnalyzeFunction = (_input, options) =>
      new Promise<AnalysisSessionResult>((resolve) => {
        options.onProgress?.({
          phase: 'rules',
          filesDone: 0,
          filesTotal: 2,
          findings: 0,
          detail: 'Pattern rules: 0 of 2 file(s) checked.',
        })
        options.signal?.addEventListener(
          'abort',
          () => resolve({ status: 'cancelled', message: null, report: null, stats: null }),
          { once: true },
        )
      })

    render(<AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} />)
    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])

    expect(await screen.findByText('Running BugPilot rules')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Analysis cancelled')).toBeVisible()
    expect(screen.queryByRole('heading', { name: /Results for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('passes an axe audit before and after a run', async () => {
    const { container, unmount } = render(
      <AnalyzePage
        analyze={completedAnalyze(makeReport())}
        readFile={async () => new Uint8Array([1])}
        downloadReportFile={vi.fn()}
      />,
    )

    expect(await getAxeViolations(container)).toEqual([])

    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 2 files' })
    await waitFor(async () => {
      expect(await getAxeViolations(container)).toEqual([])
    })

    unmount()
  })
})
