import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../features/analyzer/archive/classify'
import type { ArchiveEntry, ArchiveReadStats } from '../features/analyzer/archive/guard'
import { LANGUAGE_LABELS } from '../features/analyzer/languages'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadFilesInput,
  UploadInput,
} from '../features/analyzer/analysis/session'
import type { AnalyzerReport, FileCoverage } from '../features/analyzer/types'
import { MAX_PASTED_BYTES } from '../features/analyzer/upload/paste'
import { AnalyzePage } from './AnalyzePage'
import { getAxeViolations } from '../test/axe'

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

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

function reportFor(item: ArchiveEntry): AnalyzerReport {
  const coverage: FileCoverage = {
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
  }
  return {
    schemaVersion: 1,
    generatedAt: '2026-02-03T04:05:06.000Z',
    includeSnippets: true,
    session: {
      archiveBytes: item.bytes,
      fileCount: 1,
      analysedCount: 1,
      skippedCount: 0,
      skipped: [],
    },
    summary: {
      findings: 0,
      bySeverity: { Low: 0, Medium: 0, High: 0, Critical: 0 },
      byTier: { syntax: 0, pattern: 0, 'type-or-dataflow': 0 },
    },
    findings: [],
    coverage: [coverage],
    limitations: ['This is a static analysis.'],
  }
}

function completed(text: string): AnalysisSessionResult {
  const item = entry('pasted/snippet.txt', text)
  return {
    status: 'completed',
    message: null,
    report: reportFor(item),
    stats: STATS,
    sources: [item],
    retention: 'all',
    skipped: [],
  }
}

function openPasteTab(): void {
  fireEvent.click(screen.getByRole('tab', { name: 'Paste code' }))
}

function paste(text: string): void {
  fireEvent.change(screen.getByLabelText('Code to check'), { target: { value: text } })
}

function asFiles(input: UploadInput): UploadFilesInput {
  if (input.kind !== 'files') throw new Error(`expected the loose-file pipeline, got "${input.kind}"`)
  return input
}

describe('Analyze page paste-code tab', () => {
  it('sends pasted text through the same pipeline as a picked file', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed('a = 1\n'))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    openPasteTab()
    paste('a = 1\n')
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    const input = asFiles(analyze.mock.calls[0][0])
    expect(input.sources).toHaveLength(1)
    expect(input.sources[0]?.path).toBe('pasted/snippet.txt')
    expect(input.sources[0]?.size).toBe(6)
    expect(new TextDecoder().decode(await input.sources[0]?.read())).toBe('a = 1\n')
    expect(analyze.mock.calls[0][1].limits).toBeDefined()
  })

  it('names the pasted file after the language chosen so the right rules run', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed('print(1)\n'))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    openPasteTab()
    fireEvent.change(screen.getByLabelText('Language of the pasted code'), { target: { value: 'py' } })
    paste('print(1)\n')
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    expect(asFiles(analyze.mock.calls[0][0]).sources[0]?.path).toBe('pasted/snippet.py')
  })

  it('defaults to Auto and sniffs the language from the pasted text', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed('{"a": 1}\n'))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    openPasteTab()
    expect(screen.getByLabelText('Language of the pasted code')).toHaveValue('auto')
    paste('{"a": 1}\n')
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    expect(asFiles(analyze.mock.calls[0][0]).sources[0]?.path).toBe('pasted/snippet.json')
  })

  it('uses the optional virtual file name and strips any path from it', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed('print(1)\n'))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    openPasteTab()
    fireEvent.change(screen.getByLabelText('Virtual file name (optional)'), {
      target: { value: '../../etc/checks.py' },
    })
    paste('print(1)\n')
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    const path = asFiles(analyze.mock.calls[0][0]).sources[0]?.path
    expect(path).toBe('pasted/checks.py')
  })

  it('refuses a paste over the ceiling without reading a byte of it', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed(''))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    openPasteTab()
    paste('x'.repeat(MAX_PASTED_BYTES + 1))
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/1 MiB/)
    expect(alert.textContent).toMatch(/pasted|paste/i)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('counts multi-byte characters as bytes, not characters', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed(''))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    openPasteTab()
    // '€' is three UTF-8 bytes, so this is one byte over the ceiling at three quarters the length.
    paste('€'.repeat(Math.floor(MAX_PASTED_BYTES / 3) + 1))
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('wipes the pasted text when the results are cleared', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async (input) => {
      const files = asFiles(input)
      return completed(new TextDecoder().decode(await files.sources[0]?.read()))
    })
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    openPasteTab()
    paste('a = 1\n')
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: /Clear results/ }))

    expect(screen.getByLabelText('Code to check')).toHaveValue('')
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('passes an axe audit with the paste tab open and after a paste run', async () => {
    const analyze = vi.fn<AnalyzeFunction>(async () => completed('a = 1\n'))
    const { container, unmount } = render(
      <AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />,
    )

    openPasteTab()
    expect(await getAxeViolations(container)).toEqual([])

    paste('a = 1\n')
    fireEvent.click(screen.getByRole('button', { name: /Check the pasted text/ }))
    await screen.findByRole('heading', { name: /Results for/ })
    await waitFor(async () => {
      expect(await getAxeViolations(container)).toEqual([])
    })

    unmount()
  })
})
