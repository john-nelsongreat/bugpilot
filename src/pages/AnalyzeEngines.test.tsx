import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadInput,
} from '../features/analyzer/analysis/session'
import type { ArchiveReadStats } from '../features/analyzer/archive/guard'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../features/analyzer/types'
import { ENGINES_UNAVAILABLE_MESSAGE } from '../features/analyzer/engines/featureProbe'
import { ENGINES_NOT_RUN_REASON } from '../features/analyzer/analysis/coverage'
import { resetEngineManifestCache } from '../features/analyzer/engines/downloadPlan'
import { makeBug, makeSavedDiagnosis } from '../test/factories'
import { BUGS_STORAGE_KEY, saveBugs } from '../features/bugs/storage'
import { getAxeViolations } from '../test/axe'
import { AnalyzePage } from './AnalyzePage'

type AnalyzeFunction = (
  input: UploadInput,
  options: AnalyzeUploadOptions,
) => Promise<AnalysisSessionResult>

/** The page calls this prop once per pass; `calls` holds the options each pass was given. */
type MockAnalyze = AnalyzeFunction & { calls: AnalyzeUploadOptions[] }

/** Assembled at run time so no repository file holds a credential-shaped literal. */
const SENTINEL = ['hunt', 'er2'].join('')

const STATS: ArchiveReadStats = {
  walkedRecords: 1,
  producedBytes: 24,
  entries: 1,
  skipped: 0,
  durationMs: 3,
  peakEntryBytes: 24,
}

const MANIFEST = {
  schemaVersion: 1,
  files: [
    {
      path: '/assets/engines/engineWorkerEntry-abc.js',
      kind: 'engine-worker',
      language: null,
      rawBytes: 132_893,
      gzipBytes: 36_981,
    },
    {
      path: '/assets/engines/engineClient-def.js',
      kind: 'engine-client',
      language: null,
      rawBytes: 2_411,
      gzipBytes: 940,
    },
    {
      path: '/assets/engines/web-tree-sitter-ghi.wasm',
      kind: 'tree-sitter-core',
      language: null,
      rawBytes: 200_000,
      gzipBytes: 60_000,
    },
    {
      path: '/assets/engines/tree-sitter-python-jkl.wasm',
      kind: 'grammar',
      language: 'python',
      rawBytes: 456_587,
      gzipBytes: 150_000,
    },
    {
      path: '/assets/engines/ruff_wasm_bg-mno.wasm',
      kind: 'ruff',
      language: null,
      rawBytes: 10_038_888,
      gzipBytes: 3_733_660,
    },
  ],
}

const FINDING: AnalyzerFinding = {
  id: 'f-abcdef12-3',
  ruleId: 'tree-sitter/syntax-error',
  analyzer: 'tree-sitter',
  tier: 'syntax',
  severity: 'High',
  confidence: { level: 'medium', reason: 'An ERROR node is what the parser reports.' },
  range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 9 },
  file: 'app.py',
  evidence: [{ source: 'code snippet', label: 'Line 2', quote: 'def load(:', lineNumber: 2 }],
  message: 'Syntax error near "def" at line 2.',
  explanation: 'The python grammar could not fit this text into any rule.',
  fix: null,
  verificationSteps: ['Run the official interpreter.'],
  limitations: ["This is the grammar's view of the text, not a compiler."],
}

/** A file the deep engines actually read: both tiers ran and the engine notes are present. */
function coverage(overrides: Partial<FileCoverage> = {}): FileCoverage {
  return {
    file: 'app.py',
    status: 'analysed',
    language: 'python',
    languageSource: 'extension',
    languageLabel: 'Python',
    encoding: 'utf-8',
    bytes: 24,
    findings: 1,
    tiers: [
      {
        tier: 'syntax',
        available: true,
        ran: true,
        reason: 'The deep engines ran (tree-sitter and ruff). The grammar only reports nodes it could not match; no compiler or type checker ran.',
      },
      {
        tier: 'pattern',
        available: true,
        ran: true,
        reason: 'BugPilot generic and secret pattern rules and tree-sitter AST rules and Ruff lint rules.',
      },
    ],
    skipReason: null,
    notes: ['Ruff reads one file at a time and does not follow values.'],
    ...overrides,
  }
}

/** The same file after the basic pass only, before the user approves the engines. */
function basicCoverage(overrides: Partial<FileCoverage> = {}): FileCoverage {
  return coverage({
    tiers: [
      { tier: 'syntax', available: true, ran: false, reason: ENGINES_NOT_RUN_REASON },
      {
        tier: 'pattern',
        available: true,
        ran: true,
        reason: 'BugPilot generic and secret pattern rules.',
      },
    ],
    notes: [],
    ...overrides,
  })
}

function report(overrides: Partial<AnalyzerReport> = {}): AnalyzerReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-02-03T04:05:06.000Z',
    includeSnippets: true,
    session: { archiveBytes: 24, fileCount: 1, analysedCount: 1, skippedCount: 0, skipped: [] },
    summary: {
      findings: 1,
      bySeverity: { Low: 0, Medium: 0, High: 1, Critical: 0 },
      byTier: { syntax: 1, pattern: 0, 'type-or-dataflow': 0 },
    },
    findings: [FINDING],
    coverage: [basicCoverage()],
    limitations: ['This is a static analysis.'],
    ...overrides,
  }
}

function analyzeWith(results: AnalysisSessionResult[]): MockAnalyze {
  let index = 0
  const calls: AnalyzeUploadOptions[] = []
  const fn = vi.fn(async (_input: UploadInput, options: AnalyzeUploadOptions) => {
    calls.push(options)
    options.onProgress?.({ phase: 'rules', filesDone: 1, filesTotal: 1, findings: 1, detail: 'rules' })
    const next = results[Math.min(index, results.length - 1)]
    index += 1
    return next
  })
  return Object.assign(fn, { calls })
}

/** Serves only the engine manifest, and keeps its arguments so the assertions can read them. */
function manifestFetch(fails = false) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: !fails,
    status: fails ? 404 : 200,
    json: async () => (fails ? null : MANIFEST),
  }))
}

function completed(theReport: AnalyzerReport): AnalysisSessionResult {
  return { status: 'completed', message: null, report: theReport, stats: STATS }
}

function selectFiles(files: File[]): void {
  const input = screen.getByLabelText('Choose files to analyse') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

const BASIC = completed(report())
const DEEP = completed(
  report({
    findings: [FINDING],
    coverage: [coverage({ findings: 2 })],
  }),
)
const BLOCKED = completed(
  report({ limitations: ['This is a static analysis.', ENGINES_UNAVAILABLE_MESSAGE] }),
)

function storageSnapshot(): Array<[string, string]> {
  const collect = (storage: Storage) =>
    Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? ''
      return [key, storage.getItem(key) ?? ''] as [string, string]
    }).sort(([left], [right]) => left.localeCompare(right))
  return [...collect(localStorage), ...collect(sessionStorage)]
}

afterEach(() => {
  resetEngineManifestCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('engine gate', () => {
  it('offers the deep pass only after a basic run, and quotes the build sizes', async () => {
    const fetchSpy = manifestFetch()
    vi.stubGlobal('fetch', fetchSpy)

    render(
      <AnalyzePage analyze={analyzeWith([BASIC])} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />,
    )

    expect(screen.queryByRole('button', { name: /Run deep analysis/ })).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()

    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])
    const gate = await screen.findByRole('region', { name: 'Deep analysis engines' })

    // The sizes come from the manifest request, so the list lands one tick after the panel.
    expect(await within(gate).findByText('146 KiB compressed')).toBeVisible()
    expect(within(gate).getByText('Python grammar')).toBeVisible()
    expect(within(gate).getByText('Ruff (Python linter)')).toBeVisible()
    expect(within(gate).getByText('3.6 MiB compressed')).toBeVisible()
    expect(within(gate).getByText('3.8 MiB')).toBeVisible()
    // Only the tiny manifest was read; no engine binary moved before the user agreed.
    expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual(['/assets/engines/manifest.json'])
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).endsWith('.wasm'))).toBe(false)
  })

  it('runs the approved pass and does not offer it twice', async () => {
    vi.stubGlobal('fetch', manifestFetch())
    const analyze = analyzeWith([BASIC, DEEP])
    const user = userEvent.setup()

    render(<AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />)
    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])
    await screen.findByRole('button', { name: /Run deep analysis/ })

    await user.click(screen.getByRole('button', { name: /Run deep analysis/ }))
    await screen.findByRole('heading', { name: 'Results for 1 file' })

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(analyze.calls[0].engines).toBeUndefined()
    expect(analyze.calls[1].engines).toBe('approved')
    expect(screen.queryByRole('button', { name: /Run deep analysis/ })).not.toBeInTheDocument()
  })

  it('keeps the pattern-rule report when the user cancels the download', async () => {
    vi.stubGlobal('fetch', manifestFetch())
    const analyze = analyzeWith([BASIC])
    const user = userEvent.setup()

    render(<AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />)
    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])
    await screen.findByRole('button', { name: /Run deep analysis/ })

    await user.click(screen.getByRole('button', { name: /Cancel, keep the pattern-rule report/ }))

    expect(analyze).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'Deep analysis engines' })).not.toBeInTheDocument()
    expect(screen.getByText('Syntax error near "def" at line 2.')).toBeVisible()
    // Dismissing moves focus back to the upload panel heading so the keyboard user is not stranded.
    expect(document.activeElement?.textContent).toContain('Upload code to check')
  })

  it('quotes no size when the build published no manifest', async () => {
    vi.stubGlobal('fetch', manifestFetch(true))

    render(<AnalyzePage analyze={analyzeWith([BASIC])} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />)
    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])

    const gate = await screen.findByRole('region', { name: 'Deep analysis engines' })
    expect(await within(gate).findByText(/did not publish an engine manifest/)).toBeVisible()
    expect(within(gate).getByRole('button', { name: /Run deep analysis/ })).toBeEnabled()
  })

  it('stays hidden for an upload no engine can read', async () => {
    const fetchSpy = manifestFetch()
    vi.stubGlobal('fetch', fetchSpy)
    const theReport = report({ coverage: [basicCoverage({ language: 'markdown', languageLabel: 'Markdown' })] })

    render(<AnalyzePage analyze={analyzeWith([completed(theReport)])} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />)
    selectFiles([new File(['# hi\n'], 'notes.md', { type: 'text/plain' })])
    await screen.findByRole('heading', { name: 'Results for 1 file' })

    expect(screen.queryByRole('region', { name: 'Deep analysis engines' })).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is reachable and operable with the keyboard alone', async () => {
    vi.stubGlobal('fetch', manifestFetch())
    const analyze = analyzeWith([BASIC, DEEP])
    const user = userEvent.setup()

    render(<AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />)
    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])

    const run = await screen.findByRole('button', { name: /Run deep analysis/ })
    run.focus()
    expect(run).toHaveFocus()
    await user.keyboard('{Enter}')

    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2))
    expect(analyze.calls[1].engines).toBe('approved')
  })

  it('has no axe violations with the gate open', async () => {
    vi.stubGlobal('fetch', manifestFetch())

    const { container } = render(
      <AnalyzePage analyze={analyzeWith([BASIC])} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />,
    )
    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])
    await screen.findByRole('region', { name: 'Deep analysis engines' })

    expect(await getAxeViolations(container)).toEqual([])
  })

  it('has no axe violations in the engines-did-not-run state', async () => {
    vi.stubGlobal('fetch', manifestFetch())
    const analyze = analyzeWith([BASIC, BLOCKED])
    const user = userEvent.setup()

    const { container } = render(
      <AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />,
    )
    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])
    await user.click(await screen.findByRole('button', { name: /Run deep analysis/ }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(ENGINES_UNAVAILABLE_MESSAGE)).toBeVisible()
    expect(within(alert).getByText(/cover all 1 analysed file/)).toBeVisible()
    // The gate must not invite a download that just failed.
    expect(screen.queryByRole('button', { name: /Run deep analysis/ })).not.toBeInTheDocument()
    expect(await getAxeViolations(container)).toEqual([])
  })

  it('has no axe violations in the coverage panel with engine tiers and notes', async () => {
    vi.stubGlobal('fetch', manifestFetch())
    const theReport = report({
      coverage: [
        coverage(),
        coverage({
          file: 'service.yml',
          language: 'yaml',
          languageLabel: 'YAML',
          findings: 0,
          notes: ['The yaml grammar reported 1 construct it could not match, starting at line 3.'],
        }),
        coverage({
          file: 'legacy.pas',
          language: 'unknown',
          languageLabel: 'Unrecognised file type',
          findings: 0,
          tiers: [
            { tier: 'syntax', available: false, ran: false, reason: 'The deep engines were not used for this upload; only the built-in rules ran.' },
            { tier: 'pattern', available: true, ran: true, reason: 'BugPilot pattern rules.' },
          ],
        }),
      ],
    })

    const { container } = render(
      <AnalyzePage analyze={analyzeWith([completed(theReport)])} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />,
    )
    selectFiles([new File(['def load(:\n'], 'app.py', { type: 'text/plain' })])

    const panel = await screen.findByRole('heading', { name: 'What was and was not checked' })
    const coveragePanel = panel.closest('section') as HTMLElement

    // A tier that ran prints only "ran"; the engine detail lives in the per-file notes.
    const pythonRow = within(coveragePanel).getByText('app.py').closest('li') as HTMLElement
    expect(within(pythonRow).getAllByText('— ran')).toHaveLength(2)
    expect(
      within(pythonRow).getByText('Ruff reads one file at a time and does not follow values.'),
    ).toBeVisible()

    const yamlRow = within(coveragePanel).getByText('service.yml').closest('li') as HTMLElement
    expect(
      within(yamlRow).getByText(/grammar reported 1 construct it could not match/),
    ).toBeVisible()

    const legacyRow = within(coveragePanel).getByText('legacy.pas').closest('li') as HTMLElement
    expect(
      within(legacyRow).getByText(/not available: The deep engines were not used/),
    ).toBeVisible()
    expect(await getAxeViolations(container)).toEqual([])
  })
})

describe('deep pass privacy', () => {
  it('writes nothing and asks only this site for engine files', async () => {
    const saved = makeBug({ diagnosis: makeSavedDiagnosis() })
    expect(saveBugs([saved]).ok).toBe(true)
    const before = storageSnapshot()
    const bugLog = localStorage.getItem(BUGS_STORAGE_KEY)

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const fetchSpy = manifestFetch()
    vi.stubGlobal('fetch', fetchSpy)

    const analyze = analyzeWith([BASIC, DEEP])
    const user = userEvent.setup()

    render(<AnalyzePage analyze={analyze} readFile={async () => new Uint8Array([1])} downloadReportFile={vi.fn()} />)
    selectFiles([new File([`def load(: secret = "${SENTINEL}"\n`], 'app.py', { type: 'text/plain' })])
    await screen.findByRole('button', { name: /Run deep analysis/ })

    await user.click(screen.getByRole('button', { name: /Run deep analysis/ }))
    await screen.findByRole('heading', { name: 'Results for 1 file' })

    expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual(['/assets/engines/manifest.json'])
    expect(fetchSpy.mock.calls.some((call) => String(call[1] ?? '').includes(SENTINEL))).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
    expect(storageSnapshot()).toEqual(before)
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(bugLog)
  })
})
