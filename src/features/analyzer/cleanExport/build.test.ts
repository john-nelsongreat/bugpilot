import { applyPatch, parsePatch, reversePatch } from 'diff'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyzerClient } from '../analysis/analyzerClient'
import type { ArchiveEntry } from '../archive/guard'
import type { FixCandidate } from '../fixes/types'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../types'
import { buildCleanExport, type CleanExportSelections } from './build'

const FAKE_SECRET = ['Q7m', 'Zb4', 'Nw9', 'Rt2', 'Vc6'].join('')

const APP_TEXT = `const apiKey = "${FAKE_SECRET}"\nconst port = 3000\n`
const APP_CLEAN = `const apiKey = process.env.API_KEY\nconst port = 3000\n`
const JSON_BEFORE = `{\n  "name": "demo",\n}\n`
const JSON_CLEAN = `{\n  "name": "demo"\n}\n`

const APP_QUOTE_START = APP_TEXT.indexOf('"')
const APP_QUOTE_END = APP_TEXT.indexOf('"', APP_QUOTE_START + 1) + 1
const JSON_COMMA = JSON_BEFORE.indexOf(',\n}')

const ALL: CleanExportSelections = { patch: true, zip: true, changelog: true, report: true }

function source(name: string, text: string, language: ArchiveEntry['language']): ArchiveEntry {
  return { name, text, language, languageSource: 'extension', encoding: 'utf-8', bytes: text.length }
}

function finding(
  overrides: Partial<AnalyzerFinding> & Pick<AnalyzerFinding, 'id' | 'file' | 'ruleId' | 'severity' | 'message'>,
): AnalyzerFinding {
  return {
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    confidence: { level: 'high', reason: 'Fixture.' },
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
    evidence: [],
    explanation: 'Fixture explanation.',
    fix: null,
    verificationSteps: [],
    limitations: [],
    ...overrides,
  }
}

const APP_FINDING = finding({
  id: 'f-app-1',
  file: 'src/app.js',
  ruleId: 'bugpilot/secret/credential-assignment',
  severity: 'High',
  message: 'Credential assigned to a literal.',
})
const JSON_FINDING = finding({
  id: 'f-json-2',
  file: 'src/config.json',
  ruleId: 'bugpilot/syntax/json',
  severity: 'Medium',
  message: 'Trailing comma before a closing brace.',
})

const APP_CANDIDATE: FixCandidate = {
  findingId: APP_FINDING.id,
  ruleId: APP_FINDING.ruleId,
  file: 'src/app.js',
  targetStartLine: 1,
  targetEndLine: 1,
  edits: [
    {
      file: 'src/app.js',
      startOffset: APP_QUOTE_START,
      endOffset: APP_QUOTE_END,
      newText: 'process.env.API_KEY',
    },
  ],
  description: 'Read the API key from process.env.API_KEY instead of a literal.',
  riskClass: 'needs-review',
  behaviourChange: true,
  warnings: ['Rotate this credential: removing it from the code does not revoke it.'],
  maskedSpans: [
    {
      startOffset: APP_QUOTE_START,
      endOffset: APP_QUOTE_END,
      maskedText: `${FAKE_SECRET[0]}…${FAKE_SECRET[FAKE_SECRET.length - 1]}`,
    },
  ],
}

const JSON_CANDIDATE: FixCandidate = {
  findingId: JSON_FINDING.id,
  ruleId: JSON_FINDING.ruleId,
  file: 'src/config.json',
  targetStartLine: 3,
  targetEndLine: 3,
  edits: [{ file: 'src/config.json', startOffset: JSON_COMMA, endOffset: JSON_COMMA + 1, newText: '' }],
  description: 'Remove the trailing comma before the closing brace.',
  riskClass: 'safe',
  behaviourChange: false,
  warnings: [],
  maskedSpans: [],
}

const SOURCES = [source('src/app.js', APP_TEXT, 'javascript'), source('src/config.json', JSON_BEFORE, 'json')]

function coverage(file: string, language: ArchiveEntry['language']): FileCoverage {
  return {
    file,
    status: 'analysed',
    language,
    languageSource: 'extension',
    languageLabel: language === 'json' ? 'JSON' : 'JavaScript',
    encoding: 'utf-8',
    bytes: 40,
    findings: 1,
    tiers: [],
    skipReason: null,
    notes: [],
  }
}

function report(): AnalyzerReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-03T10:00:00.000Z',
    includeSnippets: false,
    session: { archiveBytes: 80, fileCount: 2, analysedCount: 2, skippedCount: 0, skipped: [] },
    summary: {
      findings: 2,
      bySeverity: { Low: 0, Medium: 1, High: 1, Critical: 0 },
      byTier: { syntax: 1, pattern: 1, 'type-or-dataflow': 0 },
    },
    findings: [APP_FINDING, JSON_FINDING],
    coverage: [coverage('src/app.js', 'javascript'), coverage('src/config.json', 'json')],
    limitations: [],
  }
}

function analyzerStub(): AnalyzerClient {
  return {
    analyze: async (entries) => ({
      files: entries.map((entry) => ({
        file: entry.name,
        findings: [],
        notes: [],
        rulesRan: [],
        stoppedEarly: false,
      })),
      cancelled: false,
      error: null,
    }),
  }
}

const deps = {
  analyzer: analyzerStub(),
  createTsClient: async () => ({
    check: async () => ({ findings: [], timedOut: false, cancelled: false, error: null }),
    dispose: () => undefined,
  }),
}

async function build(selections: CleanExportSelections = ALL) {
  return buildCleanExport(
    { report: report(), sources: SOURCES, candidates: [APP_CANDIDATE, JSON_CANDIDATE] },
    selections,
    deps,
  )
}

describe('buildCleanExport', () => {
  it('builds every selected output and proves the patch round trip', async () => {
    const result = await build()
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    expect(result.files.map((file) => file.name)).toEqual([
      'changes.patch',
      'clean.zip',
      'CHANGELOG.md',
      'report.md',
      'report.json',
    ])
    expect(result.cleanFiles).toEqual([
      { file: 'src/app.js', text: APP_CLEAN },
      { file: 'src/config.json', text: JSON_CLEAN },
    ])

    const patch = result.files.find((file) => file.name === 'changes.patch')
    const patchText = strFromU8(patch?.bytes ?? new Uint8Array())
    expect(patchText).toContain('--- a/src/app.js')
    expect(patchText).toContain('+++ b/src/app.js')
    // The patch must quote the original line; that is exactly why the UI warns about it.
    expect(patchText).toContain(FAKE_SECRET)

    const sections = parsePatch(patchText)
    const appSection = sections.find((section) => section.oldFileName === 'a/src/app.js')
    const jsonSection = sections.find((section) => section.oldFileName === 'a/src/config.json')
    expect(appSection).toBeDefined()
    expect(jsonSection).toBeDefined()
    if (!appSection || !jsonSection) return
    expect(applyPatch(APP_TEXT, appSection)).toBe(APP_CLEAN)
    expect(applyPatch(JSON_BEFORE, jsonSection)).toBe(JSON_CLEAN)
    expect(applyPatch(APP_CLEAN, reversePatch(appSection))).toBe(APP_TEXT)
    expect(applyPatch(JSON_CLEAN, reversePatch(jsonSection))).toBe(JSON_BEFORE)
  })

  it('zips only the analysed text files plus a manifest', async () => {
    const result = await build()
    if (result.status !== 'ready') throw new Error('build failed')
    const zipFile = result.files.find((file) => file.name === 'clean.zip')
    const entries = unzipSync(zipFile?.bytes ?? new Uint8Array())

    expect(Object.keys(entries).sort()).toEqual(['MANIFEST.md', 'src/app.js', 'src/config.json'])
    expect(strFromU8(entries['src/app.js'])).toBe(APP_CLEAN)
    expect(strFromU8(entries['src/config.json'])).toBe(JSON_CLEAN)

    const manifest = strFromU8(entries['MANIFEST.md'])
    expect(manifest).toContain('only the text files BugPilot analysed')
    expect(manifest).toContain('not a full copy of your project')
    expect(manifest).toContain('changes.patch')
    expect(manifest).toContain('- src/app.js (fixed)')
    expect(manifest).toContain('- src/config.json (fixed)')
  })

  it('keeps every secret out of the changelog, report and manifest', async () => {
    const result = await build()
    if (result.status !== 'ready') throw new Error('build failed')

    const text = (name: string) => strFromU8(result.files.find((file) => file.name === name)?.bytes ?? new Uint8Array())
    const changelog = text('CHANGELOG.md')
    const reportMd = text('report.md')
    const reportJson = text('report.json')
    const zipBytes = result.files.find((file) => file.name === 'clean.zip')?.bytes ?? new Uint8Array()
    const manifest = strFromU8(unzipSync(zipBytes)['MANIFEST.md'])

    for (const content of [changelog, reportMd, reportJson, manifest]) {
      expect(content).not.toContain(FAKE_SECRET)
    }
    expect(changelog).toContain('f-app-1')
    expect(changelog).toContain('bugpilot/secret/credential-assignment')
    expect(changelog).toContain('needs-review')
    expect(changelog).toContain('Rotate this credential: removing it from the code does not revoke it.')
    expect(reportMd).toContain('## Included fixes')
    expect(reportMd).toContain('bugpilot/syntax/json')
    const json = JSON.parse(reportJson) as { includedFixes: unknown[] }
    expect(json.includedFixes).toHaveLength(2)
  })

  it('builds only the ticked outputs', async () => {
    const result = await build({ patch: false, zip: true, changelog: false, report: false })
    if (result.status !== 'ready') throw new Error('build failed')
    expect(result.files.map((file) => file.name)).toEqual(['clean.zip'])
  })

  it('blocks when no output is ticked', async () => {
    const result = await build({ patch: false, zip: false, changelog: false, report: false })
    expect(result).toEqual({ status: 'blocked', message: 'Tick at least one output to build.' })
  })

  it('blocks when the changes no longer verify', async () => {
    const regression = finding({
      id: 'f-new-9',
      file: 'src/app.js',
      ruleId: 'bugpilot/test/regression',
      severity: 'Critical',
      message: 'A regression the analysis found again.',
    })
    const result = await buildCleanExport(
      { report: report(), sources: SOURCES, candidates: [APP_CANDIDATE, JSON_CANDIDATE] },
      ALL,
      {
        analyzer: {
          analyze: async (entries) => ({
            files: entries.map((entry) => ({
              file: entry.name,
              findings: [regression],
              notes: [],
              rulesRan: [],
              stoppedEarly: false,
            })),
            cancelled: false,
            error: null,
          }),
        },
        createTsClient: deps.createTsClient,
      },
    )
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('did not verify again')
    expect(result.message).toContain('report only')
  })

  it('blocks a JSON fix that leaves invalid JSON', async () => {
    const broken: FixCandidate = {
      ...JSON_CANDIDATE,
      edits: [{ file: 'src/config.json', startOffset: JSON_BEFORE.indexOf('}'), endOffset: JSON_BEFORE.indexOf('}') + 1, newText: '' }],
    }
    const result = await buildCleanExport(
      { report: report(), sources: SOURCES, candidates: [broken] },
      ALL,
      deps,
    )
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toContain('valid JSON')
  })

  it('builds every output without writing storage, opening IndexedDB or making a request', async () => {
    localStorage.setItem('bugpilot:keep', 'local value')
    sessionStorage.setItem('bugpilot:session', 'session value')
    const snapshot = (): Array<[string, string]> => {
      const collect = (storage: Storage) =>
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index) ?? ''
          return [key, storage.getItem(key) ?? ''] as [string, string]
        }).sort(([left], [right]) => left.localeCompare(right))
      return [...collect(localStorage), ...collect(sessionStorage)]
    }
    const before = snapshot()

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

    try {
      const result = await build()
      expect(result.status).toBe('ready')
      if (result.status === 'ready') expect(result.files).toHaveLength(5)
      for (const spy of [setItem, removeItem, clear, fetchSpy, xhrOpen, xhrSend, beacon, indexedOpen, socket]) {
        expect(spy).not.toHaveBeenCalled()
      }
      expect(snapshot()).toEqual(before)
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
      Reflect.deleteProperty(navigator, 'sendBeacon')
    }
  })
})
