import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveReadStats } from '../archive/guard'
import type { AnalyzerClient } from './analyzerClient'
import type { FileAnalysis } from './engine'
import { makeFinding } from './finding'
import { analyzeUpload } from './session'
import type { IntakeSource } from '../archive/readLooseFiles'

const STATS: ArchiveReadStats = {
  walkedRecords: 2,
  producedBytes: 0,
  entries: 2,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 0,
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

function finding(file: string) {
  return makeFinding({
    ruleId: 'bugpilot/generic/todo-marker',
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: 'Low',
    confidence: { level: 'low', reason: 'Test finding.' },
    file,
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
    evidence: [{ source: 'code snippet', label: 'Line 1', quote: 'x', lineNumber: 1 }],
    message: 'Test finding.',
    explanation: 'Test finding.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

function analysis(file: string, findings: ReturnType<typeof finding>[] = []): FileAnalysis {
  return { file, findings, notes: [], rulesRan: ['bugpilot/generic/todo-marker'], stoppedEarly: false }
}

function sessionFor(entries: ArchiveEntry[], files: FileAnalysis[], maxRetainedBytes?: number) {
  const analyzer: AnalyzerClient = {
    async analyze() {
      return { files, cancelled: false, error: null }
    },
  }
  const readLoose = async (_sources: readonly IntakeSource[]): Promise<ArchiveReadResult> => ({
    refusal: null,
    entries,
    skipped: [],
    stats: { ...STATS, entries: entries.length, producedBytes: entries.reduce((total, item) => total + item.bytes, 0) },
  })
  return analyzeUpload(
    { kind: 'files', sources: [] },
    { archiveBytes: 1, maxRetainedBytes },
    {
      readLoose,
      analyzer,
      createTsClient: async () => ({
        async check() {
          return { findings: [], timedOut: false, cancelled: false, error: null }
        },
        dispose: () => {},
      }),
    },
  )
}

describe('what the session keeps of the analysed text', () => {
  it('keeps every file when the upload fits the memory budget', async () => {
    const entries = [entry('src/a.js', 'const a = 1\n'), entry('src/b.js', 'const b = 2\n')]
    const result = await sessionFor(entries, [analysis('src/a.js'), analysis('src/b.js')])

    expect(result.retention).toBe('all')
    expect(result.sources?.map((item) => item.name)).toEqual(['src/a.js', 'src/b.js'])
  })

  it('keeps only the files that produced findings once the upload is over budget', async () => {
    const big = 'x'.repeat(2_048)
    const entries = [entry('src/clean.js', big), entry('src/dirty.js', big), entry('src/other.js', big)]
    const result = await sessionFor(
      entries,
      [analysis('src/clean.js'), analysis('src/dirty.js', [finding('src/dirty.js')]), analysis('src/other.js')],
      4_096,
    )

    expect(result.status).toBe('completed')
    expect(result.retention).toBe('findings')
    expect(result.sources?.map((item) => item.name)).toEqual(['src/dirty.js'])
  })

  it('keeps nothing when the upload is over budget and nothing was found', async () => {
    const big = 'y'.repeat(4_096)
    const entries = [entry('src/a.js', big), entry('src/b.js', big)]
    const result = await sessionFor(entries, [analysis('src/a.js'), analysis('src/b.js')], 4_096)

    expect(result.status).toBe('completed')
    expect(result.retention).toBe('findings')
    expect(result.sources).toHaveLength(0)
  })

  it('counts the text it holds against the budget, not the size of the upload', async () => {
    const entries = [entry('src/a.js', 'const a = 1\n'), entry('src/b.js', 'const b = 2\n')]
    const files = [analysis('src/a.js', [finding('src/a.js')]), analysis('src/b.js')]

    const atBudget = await sessionFor(entries, files, 24)
    const overBudget = await sessionFor(entries, files, 23)

    expect(atBudget.retention).toBe('all')
    expect(overBudget.retention).toBe('findings')
    expect(overBudget.sources?.map((item) => item.name)).toEqual(['src/a.js'])
  })
})
