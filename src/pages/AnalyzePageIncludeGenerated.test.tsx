import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../features/analyzer/archive/classify'
import type { ArchiveEntry, ArchiveReadStats } from '../features/analyzer/archive/guard'
import { LANGUAGE_LABELS } from '../features/analyzer/languages'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadInput,
} from '../features/analyzer/analysis/session'
import type { AnalyzerReport } from '../features/analyzer/types'
import { AnalyzePage } from './AnalyzePage'

const STATS: ArchiveReadStats = {
  walkedRecords: 1,
  producedBytes: 6,
  entries: 1,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 6,
}

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: new TextEncoder().encode(text).length,
  }
}

function completed(): AnalysisSessionResult {
  const item = entry('pasted/snippet.txt', 'a = 1\n')
  const report: AnalyzerReport = {
    schemaVersion: 1,
    generatedAt: '2026-02-03T04:05:06.000Z',
    includeSnippets: true,
    session: { archiveBytes: 6, fileCount: 1, analysedCount: 1, skippedCount: 0, skipped: [] },
    summary: {
      findings: 0,
      bySeverity: { Low: 0, Medium: 0, High: 0, Critical: 0 },
      byTier: { syntax: 0, pattern: 0, 'type-or-dataflow': 0 },
    },
    findings: [],
    coverage: [
      {
        file: item.name,
        status: 'analysed',
        language: item.language,
        languageSource: item.languageSource,
        languageLabel: LANGUAGE_LABELS[item.language],
        encoding: item.encoding,
        bytes: item.bytes,
        findings: 0,
        tiers: [],
        skipReason: null,
        notes: [],
      },
    ],
    limitations: ['This is a static analysis.'],
  }
  return { status: 'completed', message: null, report, stats: STATS, sources: [item], retention: 'all', skipped: [] }
}

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

function runPastedText(): void {
  fireEvent.click(screen.getByRole('tab', { name: 'Paste code' }))
  fireEvent.change(screen.getByLabelText('Code to check'), { target: { value: 'a = 1\n' } })
  fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))
}

describe('Analyze page generated-file override', () => {
  it('is off by default and tells the user what it does', () => {
    render(<AnalyzePage analyze={vi.fn<AnalyzeFunction>(async () => completed())} />)

    const box = screen.getByRole('checkbox', { name: /Include generated and vendored files/ })
    expect(box).not.toBeChecked()
    expect(screen.getByText(/same size limits apply/i)).toBeInTheDocument()
    expect(screen.getByText(/\.git is never read/i)).toBeInTheDocument()
    expect(screen.getByText(/sensitive file names are always reported/i)).toBeInTheDocument()
  })

  it('forwards the setting to the analysis when it is ticked', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed())
    render(<AnalyzePage analyze={analyze} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Include generated and vendored files/ }))
    runPastedText()
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    expect(analyze.mock.calls[0][1].includeGenerated).toBe(true)
  })

  it('sends false when the box is left alone', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed())
    render(<AnalyzePage analyze={analyze} />)

    runPastedText()
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    expect(analyze.mock.calls[0][1].includeGenerated).toBe(false)
  })

  it('returns to off when results are cleared', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed())
    render(<AnalyzePage analyze={analyze} />)

    const box = screen.getByRole('checkbox', { name: /Include generated and vendored files/ })
    fireEvent.click(box)
    runPastedText()
    await waitFor(() => expect(screen.getByRole('button', { name: /Clear results/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Clear results/ }))
    expect(box).not.toBeChecked()
  })
})
