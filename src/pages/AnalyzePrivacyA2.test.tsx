import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadInput,
} from '../features/analyzer/analysis/session'
import type { ArchiveReadStats, ArchiveEntry } from '../features/analyzer/archive/guard'
import type { FixPlan } from '../features/analyzer/fixes/plan'
import type { FixCandidate } from '../features/analyzer/fixes/types'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../features/analyzer/types'
import { AnalyzePage } from './AnalyzePage'

vi.mock('../features/analyzer/analysis/verifyFixes', () => ({
  verifyFixCandidates: async (candidates: readonly unknown[]) => ({
    verified: [...candidates],
    dropped: [],
  }),
}))

const FAKE_SECRET = ['Kp4', 'Mw7', 'Nc2', 'Vb9', 'Xs3'].join('')
const MASKED_SECRET = `${FAKE_SECRET[0]}…${FAKE_SECRET[FAKE_SECRET.length - 1]}`

const APP_TEXT = `const apiKey = "${FAKE_SECRET}"\nconst retry = 1\n`
const SECRET_START = APP_TEXT.indexOf('"')
const SECRET_END = APP_TEXT.indexOf('"', SECRET_START + 1) + 1
const RETRY_START = APP_TEXT.indexOf('const retry = 1')
const RETRY_END = RETRY_START + 'const retry = 1'.length

const STATS: ArchiveReadStats = {
  walkedRecords: 1,
  producedBytes: APP_TEXT.length,
  entries: 1,
  skipped: 0,
  durationMs: 3,
  peakEntryBytes: APP_TEXT.length,
}

const SOURCE: ArchiveEntry = {
  name: 'src/app.ts',
  text: APP_TEXT,
  language: 'typescript',
  languageSource: 'extension',
  encoding: 'utf-8',
  bytes: APP_TEXT.length,
}

const SECRET_FINDING: AnalyzerFinding = {
  id: 'f-secret-a2',
  ruleId: 'bugpilot/secret/credential-assignment',
  analyzer: 'bugpilot-rules',
  tier: 'pattern',
  severity: 'High',
  confidence: { level: 'high', reason: 'The assignment names a credential.' },
  file: 'src/app.ts',
  range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 20 },
  evidence: [],
  message: 'Credential assigned to a literal.',
  explanation: 'A credential value is written in the source.',
  fix: null,
  verificationSteps: [],
  limitations: [],
}

const RETRY_FINDING: AnalyzerFinding = {
  id: 'f-retry-a2',
  ruleId: 'bugpilot/generic/retry-literal',
  analyzer: 'bugpilot-rules',
  tier: 'pattern',
  severity: 'Low',
  confidence: { level: 'medium', reason: 'The retry count is a literal.' },
  file: 'src/app.ts',
  range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 16 },
  evidence: [],
  message: 'Retry count is hard-coded.',
  explanation: 'A fixed retry count may be too low.',
  fix: null,
  verificationSteps: [],
  limitations: [],
}

const SECRET_CANDIDATE: FixCandidate = {
  findingId: SECRET_FINDING.id,
  ruleId: SECRET_FINDING.ruleId,
  file: 'src/app.ts',
  targetStartLine: 1,
  targetEndLine: 1,
  edits: [{ file: 'src/app.ts', startOffset: SECRET_START, endOffset: SECRET_END, newText: 'process.env.API_KEY' }],
  description: 'Read the API key from process.env.API_KEY instead of a literal.',
  riskClass: 'needs-review',
  behaviourChange: true,
  warnings: ['Rotate this credential: removing it from the code does not revoke it.'],
  maskedSpans: [{ startOffset: SECRET_START, endOffset: SECRET_END, maskedText: MASKED_SECRET }],
}

const RETRY_CANDIDATE: FixCandidate = {
  findingId: RETRY_FINDING.id,
  ruleId: RETRY_FINDING.ruleId,
  file: 'src/app.ts',
  targetStartLine: 2,
  targetEndLine: 2,
  edits: [{ file: 'src/app.ts', startOffset: RETRY_START, endOffset: RETRY_END, newText: 'const retry = 2' }],
  description: 'Raise the fixed retry count from 1 to 2.',
  riskClass: 'safe',
  behaviourChange: true,
  warnings: [],
  maskedSpans: [],
}

const PLAN: FixPlan = { available: [SECRET_CANDIDATE, RETRY_CANDIDATE], unavailable: new Map(), dropped: [] }

const COVERAGE: FileCoverage = {
  file: 'src/app.ts',
  status: 'analysed',
  language: 'typescript',
  languageSource: 'extension',
  languageLabel: 'TypeScript',
  encoding: 'utf-8',
  bytes: APP_TEXT.length,
  findings: 2,
  tiers: [
    { tier: 'syntax', available: true, ran: true, reason: 'Syntax diagnostics ran.' },
    { tier: 'pattern', available: true, ran: true, reason: 'BugPilot pattern rules.' },
  ],
  skipReason: null,
  notes: [],
}

const REPORT: AnalyzerReport = {
  schemaVersion: 1,
  generatedAt: '2026-11-03T10:00:00.000Z',
  includeSnippets: false,
  session: { archiveBytes: APP_TEXT.length, fileCount: 1, analysedCount: 1, skippedCount: 0, skipped: [] },
  summary: {
    findings: 2,
    bySeverity: { Low: 1, Medium: 0, High: 1, Critical: 0 },
    byTier: { syntax: 0, pattern: 2, 'type-or-dataflow': 0 },
  },
  findings: [SECRET_FINDING, RETRY_FINDING],
  coverage: [COVERAGE],
  limitations: [],
}

async function completedAnalyze(): Promise<AnalysisSessionResult> {
  return { status: 'completed', message: null, report: REPORT, stats: STATS, sources: [SOURCE] }
}

const analyze: (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult> =
  () => completedAnalyze()
const prepare: (findings: readonly AnalyzerFinding[], sources: readonly ArchiveEntry[]) => Promise<FixPlan> =
  async () => PLAN

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

function seedSavedWork(): Array<[string, string]> {
  localStorage.setItem('bugpilot:keep', 'local value')
  sessionStorage.setItem('bugpilot:session', 'session value')
  return storageSnapshot()
}

interface PrivacySpies {
  writes: ReturnType<typeof vi.fn>[]
  requests: ReturnType<typeof vi.fn>[]
  socket: ReturnType<typeof vi.fn>
  xhrOpen: ReturnType<typeof vi.fn>
  xhrSend: ReturnType<typeof vi.fn>
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
  vi.stubGlobal('XMLHttpRequest', class { open = xhrOpen; send = xhrSend })

  const beacon = vi.fn()
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })

  const indexedOpen = vi.fn()
  vi.stubGlobal('indexedDB', { open: indexedOpen })

  const socket = vi.fn()
  vi.stubGlobal('WebSocket', class { constructor() { socket() } })

  return {
    writes: [setItem, removeItem, clear],
    requests: [fetchSpy, beacon],
    socket,
    xhrOpen,
    xhrSend,
    indexedOpen,
  }
}

function expectQuiet(spies: PrivacySpies): void {
  for (const write of spies.writes) expect(write).not.toHaveBeenCalled()
  for (const request of spies.requests) expect(request).not.toHaveBeenCalled()
  expect(spies.socket).not.toHaveBeenCalled()
  expect(spies.xhrOpen).not.toHaveBeenCalled()
  expect(spies.xhrSend).not.toHaveBeenCalled()
  expect(spies.indexedOpen).not.toHaveBeenCalled()
}

beforeEach(() => {
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'sendBeacon')
})

async function selectAndReview(): Promise<{ user: ReturnType<typeof userEvent.setup> }> {
  const user = userEvent.setup()
  render(
    <AnalyzePage
      analyze={analyze}
      readFile={async () => new Uint8Array([1])}
      downloadReportFile={vi.fn()}
      prepareFixPlan={prepare}
    />,
  )
  selectFiles([new File([APP_TEXT], 'app.ts', { type: 'text/plain' })])
  await screen.findByRole('heading', { name: 'Results for 1 file' })
  await screen.findByText('1 change selected in 1 file')
  return { user }
}

describe('Analyze page privacy for fixes and clean export', () => {
  it('selects, reviews, builds and downloads without storage writes or network requests', async () => {
    const before = seedSavedWork()
    const spies = installPrivacySpies()
    const { user } = await selectAndReview()

    await user.click(
      screen.getByRole('checkbox', {
        name: /Include this change for bugpilot\/secret\/credential-assignment/,
      }),
    )
    expect(screen.getByText('2 changes selected in 1 file')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Review changes' }))
    const review = await screen.findByRole('region', { name: 'Diff of 2 proposed changes in 1 file' })
    expect(review).toBeInTheDocument()
    await screen.findByRole('table', { name: 'Unified diff for src/app.ts' })
    expect(document.body.textContent).toContain(MASKED_SECRET)
    expect(document.body.textContent).not.toContain(FAKE_SECRET)

    await user.click(screen.getByRole('button', { name: 'Build clean export' }))
    const cleanExport = await screen.findByRole('region', { name: 'Clean export' })
    await within(cleanExport).findByRole('button', { name: 'Download changes.patch' })
    expect(cleanExport.textContent).toContain('Built 5 files from 1 fixed file.')

    for (const name of ['changes.patch', 'clean.zip', 'CHANGELOG.md', 'report.md', 'report.json']) {
      await user.click(within(cleanExport).getByRole('button', { name: `Download ${name}` }))
    }
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(5))
    expect(await within(cleanExport).findByText('report.json download started.')).toBeInTheDocument()

    expectQuiet(spies)
    expect(storageSnapshot()).toEqual(before)
  })

  it('drops the report, review and source text when the results are cleared', async () => {
    const before = seedSavedWork()
    const spies = installPrivacySpies()
    const { user } = await selectAndReview()

    await user.click(screen.getByRole('button', { name: 'Review changes' }))
    await screen.findByRole('region', { name: 'Diff of 1 proposed change in 1 file' })
    expect(document.body.textContent).toContain('const retry = 2')

    await user.click(screen.getByRole('button', { name: 'Clear results' }))

    expect(screen.queryByRole('heading', { name: 'Results for 1 file' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Diff of/ })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('const retry')
    expect(document.body.textContent).not.toContain(FAKE_SECRET)
    expect(document.body.textContent).not.toContain(MASKED_SECRET)
    expectQuiet(spies)
    expect(storageSnapshot()).toEqual(before)
  })

  it('drops everything when the route changes', async () => {
    const before = seedSavedWork()
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/analyze']}>
        <Link to="/elsewhere">Leave the analyzer</Link>
        <Routes>
          <Route
            path="/analyze"
            element={
              <AnalyzePage
                analyze={analyze}
                readFile={async () => new Uint8Array([1])}
                downloadReportFile={vi.fn()}
                prepareFixPlan={prepare}
              />
            }
          />
          <Route path="/elsewhere" element={<p>Another page</p>} />
        </Routes>
      </MemoryRouter>,
    )

    selectFiles([new File([APP_TEXT], 'app.ts', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 1 file' })
    await screen.findByText('1 change selected in 1 file')
    await user.click(screen.getByRole('button', { name: 'Review changes' }))
    await screen.findByRole('region', { name: 'Diff of 1 proposed change in 1 file' })

    const spies = installPrivacySpies()
    await user.click(screen.getByRole('link', { name: 'Leave the analyzer' }))

    expect(await screen.findByText('Another page')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Results for 1 file' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Diff of/ })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('const retry')
    expect(document.body.textContent).not.toContain(FAKE_SECRET)
    expect(document.body.textContent).not.toContain(MASKED_SECRET)
    expectQuiet(spies)
    expect(storageSnapshot()).toEqual(before)
  })
})
