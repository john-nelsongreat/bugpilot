import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadInput,
} from '../features/analyzer/analysis/session'
import type { ArchiveReadStats } from '../features/analyzer/archive/guard'
import type { DownloadReportFile } from '../features/analyzer/export/reportFiles'
import type { AnalyzerFinding, AnalyzerReport } from '../features/analyzer/types'
import { makeBug, makeSavedDiagnosis } from '../test/factories'
import { BUGS_STORAGE_KEY, saveBugs } from '../features/bugs/storage'
import { AnalyzePage } from './AnalyzePage'

type AnalyzeFunction = (
  input: UploadInput,
  options: AnalyzeUploadOptions,
) => Promise<AnalysisSessionResult>

const STATS: ArchiveReadStats = {
  walkedRecords: 1,
  producedBytes: 32,
  entries: 1,
  skipped: 0,
  durationMs: 3,
  peakEntryBytes: 32,
}

const FINDING: AnalyzerFinding = {
  id: 'f-abcdef12-3',
  ruleId: 'bugpilot/generic/insecure-http-url',
  analyzer: 'bugpilot-rules',
  tier: 'pattern',
  severity: 'Low',
  confidence: { level: 'high', reason: 'The URL is written literally in the file.' },
  range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 24 },
  file: 'src/app.ts',
  evidence: [
    { source: 'code snippet', label: 'Line 3', quote: 'fetch("http://example.test")', lineNumber: 3 },
  ],
  message: 'Plain HTTP URL to a non-local host.',
  explanation: 'Traffic to this host is not encrypted.',
  fix: null,
  verificationSteps: ['Open the line and confirm the scheme.'],
  limitations: ['The rule cannot see URLs built at runtime.'],
}

const REPORT: AnalyzerReport = {
  schemaVersion: 1,
  generatedAt: '2026-02-03T04:05:06.000Z',
  includeSnippets: true,
  session: {
    archiveBytes: 32,
    fileCount: 1,
    analysedCount: 1,
    skippedCount: 0,
    skipped: [],
  },
  summary: {
    findings: 1,
    bySeverity: { Low: 1, Medium: 0, High: 0, Critical: 0 },
    byTier: { syntax: 0, pattern: 1, 'type-or-dataflow': 0 },
  },
  findings: [FINDING],
  coverage: [
    {
      file: 'src/app.ts',
      status: 'analysed',
      language: 'typescript',
      languageSource: 'extension',
      languageLabel: 'TypeScript',
      encoding: 'utf-8',
      bytes: 32,
      findings: 1,
      tiers: [
        { tier: 'syntax', available: true, ran: true, reason: 'Syntax diagnostics ran.' },
        { tier: 'pattern', available: true, ran: true, reason: 'BugPilot pattern rules.' },
      ],
      skipReason: null,
      notes: [],
    },
  ],
  limitations: ['This is a static analysis.'],
}

function completedAnalyze(): AnalyzeFunction {
  return async (_input, options) => {
    options.onProgress?.({
      phase: 'rules',
      filesDone: 1,
      filesTotal: 1,
      findings: 1,
      detail: 'Pattern rules: 1 of 1 file(s) checked.',
    })
    return { status: 'completed', message: null, report: REPORT, stats: STATS }
  }
}

function selectFiles(files: File[]): void {
  const input = screen.getByLabelText('Choose files to analyse') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

function storageSnapshot(): Array<[string, string]> {
  const collect = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? ''
      return [key, storage.getItem(key) ?? ''] as [string, string]
    }).sort(([left], [right]) => left.localeCompare(right))
  return [...collect(localStorage), ...collect(sessionStorage)]
}

function seedSavedWork(): { before: Array<[string, string]>; bugLog: string | null } {
  const saved = makeBug({ diagnosis: makeSavedDiagnosis() })
  expect(saveBugs([saved]).ok).toBe(true)
  return {
    before: storageSnapshot(),
    bugLog: localStorage.getItem(BUGS_STORAGE_KEY),
  }
}

interface PrivacySpies {
  writes: ReturnType<typeof vi.fn>[]
  requests: ReturnType<typeof vi.fn>[]
  xhrOpen: ReturnType<typeof vi.fn>
  xhrSend: ReturnType<typeof vi.fn>
  beacon: ReturnType<typeof vi.fn>
  indexedOpen: ReturnType<typeof vi.fn>
}

function installPrivacySpies(): PrivacySpies {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
  const clear = vi.spyOn(Storage.prototype, 'clear')

  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)

  const xhrOpen = vi.fn()
  const xhrSend = vi.fn()
  class TrackingXhr {
    open = xhrOpen
    send = xhrSend
  }
  vi.stubGlobal('XMLHttpRequest', TrackingXhr)

  const beacon = vi.fn()
  Object.defineProperty(navigator, 'sendBeacon', {
    value: beacon,
    configurable: true,
  })

  const indexedOpen = vi.fn()
  vi.stubGlobal('indexedDB', { open: indexedOpen })

  return {
    writes: [setItem, removeItem, clear],
    requests: [fetchSpy, beacon],
    xhrOpen,
    xhrSend,
    beacon,
    indexedOpen,
  }
}

function expectQuiet(spies: PrivacySpies): void {
  for (const write of spies.writes) expect(write).not.toHaveBeenCalled()
  for (const request of spies.requests) expect(request).not.toHaveBeenCalled()
  expect(spies.xhrOpen).not.toHaveBeenCalled()
  expect(spies.xhrSend).not.toHaveBeenCalled()
  expect(spies.indexedOpen).not.toHaveBeenCalled()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'sendBeacon')
})

describe('Analyze page privacy', () => {
  it('analyses and exports without writing storage, opening IndexedDB, or making requests', async () => {
    const { before, bugLog } = seedSavedWork()
    const spies = installPrivacySpies()
    const download = vi.fn<DownloadReportFile>()
    const user = userEvent.setup()

    render(
      <AnalyzePage
        analyze={completedAnalyze()}
        readFile={async () => new Uint8Array([1])}
        downloadReportFile={download}
      />,
    )

    selectFiles([new File(['fetch("http://example.test")\n'], 'app.ts', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 1 file' })

    await user.click(screen.getByRole('button', { name: 'Download report.md' }))
    await user.click(
      screen.getByRole('checkbox', { name: /Include code snippets/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Download report.json' }))

    expect(download).toHaveBeenCalledTimes(2)
    expectQuiet(spies)
    expect(storageSnapshot()).toEqual(before)
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(bugLog)
  })

  it('clears the report without touching saved work', async () => {
    const { before, bugLog } = seedSavedWork()
    const user = userEvent.setup()

    render(
      <AnalyzePage
        analyze={completedAnalyze()}
        readFile={async () => new Uint8Array([1])}
        downloadReportFile={vi.fn()}
      />,
    )

    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 1 file' })

    const spies = installPrivacySpies()
    await user.click(screen.getByRole('button', { name: 'Clear results' }))

    expect(screen.queryByText('Plain HTTP URL to a non-local host.')).not.toBeInTheDocument()
    expectQuiet(spies)
    expect(storageSnapshot()).toEqual(before)
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(bugLog)
  })

  it('drops the report when the route changes and leaves saved work alone', async () => {
    const { before, bugLog } = seedSavedWork()
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/analyze']}>
        <Link to="/elsewhere">Leave the analyzer</Link>
        <Routes>
          <Route
            path="/analyze"
            element={
              <AnalyzePage
                analyze={completedAnalyze()}
                readFile={async () => new Uint8Array([1])}
                downloadReportFile={vi.fn()}
              />
            }
          />
          <Route path="/elsewhere" element={<p>Another page</p>} />
        </Routes>
      </MemoryRouter>,
    )

    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 1 file' })
    await user.click(screen.getByText('Notes (1)'))
    expect(screen.getByText('Plain HTTP URL to a non-local host.')).toBeVisible()

    const spies = installPrivacySpies()
    await user.click(screen.getByRole('link', { name: 'Leave the analyzer' }))

    expect(await screen.findByText('Another page')).toBeVisible()
    expect(screen.queryByText('Plain HTTP URL to a non-local host.')).not.toBeInTheDocument()
    expect(screen.queryByText(/fetch\("http:\/\/example\.test"\)/)).not.toBeInTheDocument()
    expectQuiet(spies)
    expect(storageSnapshot()).toEqual(before)
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(bugLog)
  })
})
