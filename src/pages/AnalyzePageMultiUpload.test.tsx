import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../features/analyzer/archive/classify'
import type { ArchiveEntry, ArchiveReadStats, ArchiveSkippedEntry } from '../features/analyzer/archive/guard'
import { LANGUAGE_LABELS } from '../features/analyzer/languages'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadFilesInput,
  UploadInput,
} from '../features/analyzer/analysis/session'
import type { AnalyzerReport } from '../features/analyzer/types'
import { AnalyzePage } from './AnalyzePage'

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

const STATS: ArchiveReadStats = {
  walkedRecords: 0,
  producedBytes: 0,
  entries: 0,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 0,
}

function entry(name: string): ArchiveEntry {
  const text = 'a = 1\n'
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: text.length,
  }
}

/** A report that lists exactly what the session was handed, so the page mirrors the intake. */
function reportFor(paths: readonly string[], notes: readonly ArchiveSkippedEntry[]): AnalyzerReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-02-03T04:05:06.000Z',
    includeSnippets: true,
    session: {
      archiveBytes: 6,
      fileCount: paths.length + notes.length,
      analysedCount: paths.length,
      skippedCount: notes.length,
      skipped: notes.map((note) => ({ file: note.name, reason: note.message })),
    },
    summary: {
      findings: 0,
      bySeverity: { Low: 0, Medium: 0, High: 0, Critical: 0 },
      byTier: { syntax: 0, pattern: 0, 'type-or-dataflow': 0 },
    },
    findings: [],
    coverage: [
      ...paths.map((path) => {
        const item = entry(path)
        return {
          file: item.name,
          status: 'analysed' as const,
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
      }),
      ...notes.map((note) => {
        const item = entry(note.name)
        return {
          file: note.name,
          status: 'skipped' as const,
          language: item.language,
          languageSource: 'name-only' as const,
          languageLabel: LANGUAGE_LABELS[item.language],
          encoding: null,
          bytes: 0,
          findings: 0,
          tiers: [],
          skipReason: note.message,
          notes: [],
        }
      }),
    ],
    limitations: ['This is a static analysis.'],
  }
}

const analyzeOverUploads: AnalyzeFunction = async (input) => {
  const paths = input.kind === 'files' ? input.sources.map((source) => source.path) : []
  const notes = input.kind === 'files' ? (input.notes ?? []) : []
  return {
    status: 'completed',
    message: null,
    report: reportFor(paths, notes),
    stats: { ...STATS, entries: paths.length, walkedRecords: paths.length },
    sources: paths.map(entry),
    retention: 'all',
    skipped: notes,
  }
}

function file(path: string): File {
  return new File(['a = 1\n'], path, { type: 'text/plain' })
}

function pickFiles(files: File[]): void {
  const input = screen.getByLabelText('Choose files to analyse') as HTMLInputElement
  input.value = ''
  fireEvent.change(input, { target: { files } })
}

function asFiles(input: UploadInput): UploadFilesInput {
  if (input.kind !== 'files') throw new Error(`expected the loose-file pipeline, got "${input.kind}"`)
  return input
}

describe('Analyze page with more than one upload', () => {
  it('runs one pass over both uploads with a namespace per upload', async () => {
    const analyze = vi.fn<AnalyzeFunction>(analyzeOverUploads)
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    pickFiles([file('src/a.py'), file('src/b.py')])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    expect(asFiles(analyze.mock.calls[0][0]).sources.map((source) => source.path)).toEqual([
      'src/a.py',
      'src/b.py',
    ])

    fireEvent.click(screen.getByRole('button', { name: /Add another upload/ }))
    pickFiles([file('src/c.py')])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2))

    const second = asFiles(analyze.mock.calls[1][0])
    expect(second.sources.map((source) => source.path)).toEqual([
      'upload-1/src/a.py',
      'upload-1/src/b.py',
      'upload-2/src/c.py',
    ])
    expect(second.notes ?? []).toEqual([])
    expect(analyze.mock.calls[1][1].archiveBytes).toBe(18)
  })

  it('keeps analysing the good uploads when one of them is set aside', async () => {
    const analyze = vi.fn<AnalyzeFunction>(analyzeOverUploads)
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    pickFiles([file('src/a.py')])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /Add another upload/ }))
    pickFiles([file('../escape.py')])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2))

    const second = asFiles(analyze.mock.calls[1][0])
    expect(second.sources.map((source) => source.path)).toEqual(['upload-1/src/a.py'])
    expect(second.notes?.map((note) => note.name)).toEqual(['upload-2'])
    expect(screen.getByText('upload-2')).toBeVisible()
  })

  it('forgets the first upload when the run is cleared', async () => {
    const analyze = vi.fn<AnalyzeFunction>(analyzeOverUploads)
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    pickFiles([file('src/a.py')])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Add another upload/ }))
    pickFiles([file('src/c.py')])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2))

    fireEvent.click(await screen.findByRole('button', { name: /Clear results/ }))
    pickFiles([file('src/d.py')])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(3))

    expect(asFiles(analyze.mock.calls[2][0]).sources.map((source) => source.path)).toEqual(['src/d.py'])
  })
})
