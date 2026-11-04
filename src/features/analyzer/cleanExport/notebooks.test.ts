import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { AnalyzerClient } from '../analysis/analyzerClient'
import type { ArchiveEntry } from '../archive/guard'
import type { FixCandidate } from '../fixes/types'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../types'
import { buildCleanExport } from './build'

const APP_TEXT = 'const port = 3000\n'
const APP_CLEAN = 'const port = 8080\n'
const CELL_TEXT = 'print("one")\n'

function source(name: string, text: string, language: ArchiveEntry['language']): ArchiveEntry {
  return { name, text, language, languageSource: 'extension', encoding: 'utf-8', bytes: text.length }
}

function finding(id: string, file: string, ruleId: string): AnalyzerFinding {
  return {
    id,
    file,
    ruleId,
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: 'Low',
    confidence: { level: 'high', reason: 'Fixture.' },
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
    evidence: [],
    message: 'Fixture finding.',
    explanation: 'Fixture explanation.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  }
}

const APP_FINDING = finding('f-app', 'src/app.js', 'bugpilot/generic/todo-marker')
const CELL_FINDING = finding('f-cell', 'nb.ipynb#cell-1', 'bugpilot/generic/todo-marker')

const APP_CANDIDATE: FixCandidate = {
  findingId: APP_FINDING.id,
  ruleId: APP_FINDING.ruleId,
  file: 'src/app.js',
  targetStartLine: 1,
  targetEndLine: 1,
  edits: [{ file: 'src/app.js', startOffset: 13, endOffset: 17, newText: '8080' }],
  description: 'Change the port.',
  riskClass: 'needs-review',
  behaviourChange: true,
  warnings: [],
  maskedSpans: [],
}

const CELL_CANDIDATE: FixCandidate = {
  ...APP_CANDIDATE,
  findingId: CELL_FINDING.id,
  file: 'nb.ipynb#cell-1',
  edits: [{ file: 'nb.ipynb#cell-1', startOffset: 6, endOffset: 11, newText: '"two"' }],
}

const SOURCES = [
  source('src/app.js', APP_TEXT, 'javascript'),
  source('nb.ipynb#cell-1', CELL_TEXT, 'python'),
]

function coverage(file: string, language: ArchiveEntry['language']): FileCoverage {
  return {
    file,
    status: 'analysed',
    language,
    languageSource: 'content',
    languageLabel: language === 'python' ? 'Python' : 'JavaScript',
    encoding: 'utf-8',
    bytes: 20,
    findings: 1,
    tiers: [],
    skipReason: null,
    notes: [],
  }
}

function report(): AnalyzerReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-04T10:00:00.000Z',
    includeSnippets: false,
    session: { archiveBytes: 40, fileCount: 2, analysedCount: 2, skippedCount: 0, skipped: [] },
    summary: {
      findings: 2,
      bySeverity: { Low: 2, Medium: 0, High: 0, Critical: 0 },
      byTier: { syntax: 0, pattern: 2, 'type-or-dataflow': 0 },
    },
    findings: [APP_FINDING, CELL_FINDING],
    coverage: [coverage('src/app.js', 'javascript'), coverage('nb.ipynb#cell-1', 'python')],
    limitations: [],
  }
}

const analyzer: AnalyzerClient = {
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

const deps = {
  analyzer,
  createTsClient: async () => ({
    check: async () => ({ findings: [], timedOut: false, cancelled: false, error: null }),
    dispose: () => undefined,
  }),
}

/**
 * Notebook cells are virtual files built from JSON this app may not have read completely, and the
 * brief keeps notebook fixes manual. The export must therefore leave every notebook name out of
 * the patch, the zip, the manifest and the changelog even if a candidate for one slips through.
 */
describe('a clean export beside a notebook', () => {
  it('keeps notebook cells out of every output and out of the applied changes', async () => {
    const result = await buildCleanExport(
      { report: report(), sources: SOURCES, candidates: [APP_CANDIDATE, CELL_CANDIDATE] },
      { patch: true, zip: true, changelog: true, report: true },
      deps,
    )

    expect(result.status, result.status === 'blocked' ? result.message : '').toBe('ready')
    if (result.status !== 'ready') return

    expect(result.cleanFiles).toEqual([{ file: 'src/app.js', text: APP_CLEAN }])
    expect(result.applied.map((change) => change.file)).toEqual(['src/app.js'])

    const text = (name: string) => strFromU8(result.files.find((file) => file.name === name)?.bytes ?? new Uint8Array())
    expect(text('changes.patch')).toContain('a/src/app.js')
    expect(text('changes.patch')).not.toContain('nb.ipynb')
    expect(text('CHANGELOG.md')).not.toContain('nb.ipynb')

    const entries = unzipSync(result.files.find((file) => file.name === 'clean.zip')?.bytes ?? new Uint8Array())
    expect(Object.keys(entries).sort()).toEqual(['MANIFEST.md', 'src/app.js'])
    expect(strFromU8(entries['src/app.js'])).toBe(APP_CLEAN)
    expect(strFromU8(entries['MANIFEST.md'])).not.toContain('nb.ipynb')
    expect(strFromU8(entries['MANIFEST.md'])).toContain('- src/app.js (fixed)')
  })

  it('blocks with a manual-only sentence when the only selected change is in a notebook', async () => {
    const result = await buildCleanExport(
      { report: report(), sources: SOURCES, candidates: [CELL_CANDIDATE] },
      { patch: true, zip: false, changelog: false, report: false },
      deps,
    )

    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.message).toMatch(/notebook/i)
    expect(result.message).toMatch(/by hand|manual/i)
  })
})
