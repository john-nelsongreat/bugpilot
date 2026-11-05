import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../features/analyzer/archive/classify'
import type { ArchiveEntry, ArchiveReadStats } from '../features/analyzer/archive/guard'
import { limitsForDevice } from '../features/analyzer/archive/limits'
import { LANGUAGE_LABELS } from '../features/analyzer/languages'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadFilesInput,
  UploadInput,
  UploadPreReadInput,
} from '../features/analyzer/analysis/session'
import type { AnalyzerReport } from '../features/analyzer/types'
import { AnalyzePage } from './AnalyzePage'

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

const STATS: ArchiveReadStats = {
  walkedRecords: 2,
  producedBytes: 34,
  entries: 2,
  skipped: 0,
  durationMs: 5,
  peakEntryBytes: 22,
}

function entry(name: string, text: string): ArchiveEntry {
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

function reportFor(files: readonly ArchiveEntry[]): AnalyzerReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-02-03T04:05:06.000Z',
    includeSnippets: true,
    session: {
      archiveBytes: 34,
      fileCount: files.length,
      analysedCount: files.length,
      skippedCount: 0,
      skipped: [],
    },
    summary: { findings: 0, bySeverity: { Low: 0, Medium: 0, High: 0, Critical: 0 }, byTier: { syntax: 0, pattern: 0, 'type-or-dataflow': 0 } },
    findings: [],
    coverage: files.map((item) => ({
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
    })),
    limitations: ['This is a static analysis.'],
  }
}

function kept(entries: readonly ArchiveEntry[]): AnalysisSessionResult {
  return {
    status: 'completed',
    message: null,
    report: reportFor(entries),
    stats: STATS,
    sources: entries,
    retention: 'all',
    skipped: [],
  }
}

function droppedText(entries: readonly ArchiveEntry[]): AnalysisSessionResult {
  return {
    status: 'completed',
    message: null,
    report: reportFor(entries),
    stats: STATS,
    sources: [],
    retention: 'findings',
    skipped: [],
  }
}

function staleHandleError(): Error {
  const error = new Error('A request to read a file was interrupted because the file may have been moved or deleted')
  error.name = 'NotReadableError'
  return error
}

function selectFiles(files: File[]): void {
  const input = screen.getByLabelText('Choose files to analyse') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

async function pickArchiveThenDeepPass(readFile: (file: File) => Promise<Uint8Array>) {
  const analyze = vi.fn<AnalyzeFunction>()
  const entries = [entry('scripts/a.py', 'a = 1\n')]
  analyze.mockResolvedValueOnce(kept(entries)).mockResolvedValueOnce(kept(entries))
  render(<AnalyzePage analyze={analyze} readFile={readFile} downloadReportFile={vi.fn()} />)

  selectFiles([new File([new Uint8Array([0x1f, 0x8b])], 'project.zip', { type: 'application/zip' })])
  await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
  fireEvent.click(await screen.findByRole('button', { name: 'Run deep analysis' }))
  await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2))
  return { analyze, entries }
}

function asFiles(input: UploadInput): UploadFilesInput {
  if (input.kind !== 'files') throw new Error(`expected the loose-file pipeline, got "${input.kind}"`)
  return input
}

function asPreRead(input: UploadInput): UploadPreReadInput {
  if (input.kind !== 'pre-read') throw new Error(`expected the already-read pipeline, got "${input.kind}"`)
  return input
}

const originalDeviceMemory = Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory')

function reportDeviceMemory(gib: number): void {
  Object.defineProperty(window.navigator, 'deviceMemory', { value: gib, configurable: true, writable: true })
}

afterEach(() => {
  delete (window.navigator as unknown as { deviceMemory?: number }).deviceMemory
  if (originalDeviceMemory) {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', originalDeviceMemory)
  }
})

describe('Analyze page deep pass and memory ceilings', () => {
  it('applies the ceilings this machine can afford to the limits list and the reader', async () => {
    reportDeviceMemory(2)
    const analyze = vi.fn<AnalyzeFunction>(async () => ({ status: 'cancelled', message: null, report: null, stats: STATS }))
    render(<AnalyzePage analyze={analyze} />)

    expect(screen.getByText(/Zip up to 125 MiB/)).toBeVisible()
    expect(screen.getByText(/Up to 10,000 entries/)).toBeVisible()

    selectFiles([new File(['hello\n'], 'notes.txt', { type: 'text/plain' })])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    expect(analyze.mock.calls[0][1].limits).toEqual(limitsForDevice(2))
  })

  it('re-reads the same selection in the same order for the deep pass', async () => {
    const analyze = vi.fn<AnalyzeFunction>()
    const entries = [entry('scripts/a.py', 'a = 1\n'), entry('scripts/b.py', 'b = 2\n')]
    analyze.mockResolvedValue(kept(entries))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    selectFiles([
      new File(['a = 1\n'], 'scripts/a.py', { type: 'text/plain' }),
      new File(['b = 2\n'], 'scripts/b.py', { type: 'text/plain' }),
    ])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Run deep analysis' }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2))

    const second = asFiles(analyze.mock.calls[1][0])
    expect(second.sources.map((source) => source.path)).toEqual(['scripts/a.py', 'scripts/b.py'])
    expect(analyze.mock.calls[0][1].engines).toBeUndefined()
    expect(analyze.mock.calls[1][1].engines).toBe('approved')
  })

  it('runs the deep pass on text this tab already read when the browser refuses the handle', async () => {
    const readFile = vi
      .fn<(file: File) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([0x1f, 0x8b]))
      .mockRejectedValueOnce(staleHandleError())
    const { analyze, entries } = await pickArchiveThenDeepPass(readFile)

    const second = asPreRead(analyze.mock.calls[1][0])
    expect(second.entries).toEqual(entries)
    expect(second.stats).toBe(STATS)
    expect(analyze.mock.calls[1][1].engines).toBe('approved')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-runs a deep pass that the reader could not stream from its handle', async () => {
    const analyze = vi.fn<AnalyzeFunction>()
    const entries = [entry('scripts/a.py', 'a = 1\n')]
    analyze
      .mockResolvedValueOnce(kept(entries))
      .mockResolvedValueOnce({
        status: 'error',
        message: 'The browser would not re-open one of the files.',
        report: null,
        stats: null,
        handleStale: true,
      })
      .mockResolvedValueOnce(kept(entries))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    selectFiles([new File(['a = 1\n'], 'scripts/a.py', { type: 'text/plain' })])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Run deep analysis' }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(3))

    expect(asPreRead(analyze.mock.calls[2][0]).entries).toEqual(entries)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-streams the archive for a deep pass when the first pass kept no text', async () => {
    const analyze = vi.fn<AnalyzeFunction>()
    const entries = [entry('scripts/a.py', 'a = 1\n')]
    analyze.mockResolvedValueOnce(droppedText(entries)).mockResolvedValueOnce(kept(entries))
    render(<AnalyzePage analyze={analyze} downloadReportFile={vi.fn()} />)

    const archive = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'project.zip', {
      type: 'application/zip',
    })
    selectFiles([archive])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Run deep analysis' }))
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2))

    const second = analyze.mock.calls[1][0]
    if (second.kind !== 'archive') throw new Error(`expected the archive pipeline, got "${second.kind}"`)
    expect(second.file).toBe(archive)
    expect(second.bytes).toBeUndefined()
    expect(analyze.mock.calls[1][1].engines).toBe('approved')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says what to do when the handle is stale and the text was not kept', async () => {
    const readFile = vi
      .fn<(file: File) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([0x1f, 0x8b]))
      .mockRejectedValueOnce(staleHandleError())
    const analyze = vi.fn<AnalyzeFunction>()
    analyze.mockResolvedValueOnce(droppedText([entry('scripts/a.py', 'a = 1\n')]))
    render(<AnalyzePage analyze={analyze} readFile={readFile} downloadReportFile={vi.fn()} />)

    selectFiles([new File([new Uint8Array([0x1f, 0x8b])], 'project.zip', { type: 'application/zip' })])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Run deep analysis' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Choose the same folder or archive again/)
    expect(analyze).toHaveBeenCalledTimes(1)
  })
})
