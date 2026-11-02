import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveSkippedEntry } from '../archive/guard'
import type { AnalyzerFinding } from '../types'
import type { AnalyzerClient } from './analyzerClient'
import type { FileAnalysis } from './engine'
import { makeFinding } from './finding'
import { analyzeUpload, type SessionProgress } from './session'
import type { TsCheckResult, TsSyntaxClient } from './typescript/tsClient'

const STATS = {
  walkedRecords: 1,
  producedBytes: 10,
  entries: 1,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 10,
}

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return { name, text, language: detection.language, languageSource: detection.source, encoding: 'utf-8', bytes: text.length }
}

function readResult(entries: ArchiveEntry[], skipped: ArchiveSkippedEntry[] = []): ArchiveReadResult {
  return { refusal: null, entries, skipped, stats: { ...STATS, entries: entries.length, skipped: skipped.length } }
}

function finding(file: string, ruleId = 'bugpilot/generic/todo-marker'): AnalyzerFinding {
  return makeFinding({
    ruleId,
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

function analysis(file: string, findings: AnalyzerFinding[] = []): FileAnalysis {
  return { file, findings, notes: [], rulesRan: ['bugpilot/generic/todo-marker'], stoppedEarly: false }
}

function fakeAnalyzer(result: FileAnalysis[]): AnalyzerClient {
  return {
    async analyze(entries, options) {
      options?.onProgress?.({ phase: 'rules', filesDone: 0, filesTotal: entries.length, findings: 0 })
      options?.onProgress?.({ phase: 'rules', filesDone: entries.length, filesTotal: entries.length, findings: 0 })
      return { files: result, cancelled: false, error: null }
    },
  }
}

function tsResult(overrides: Partial<TsCheckResult>): TsCheckResult {
  return { findings: [], timedOut: false, cancelled: false, error: null, ...overrides }
}

function fakeTsClient(check: (file: { name: string; text: string }) => TsCheckResult) {
  const checked: string[] = []
  const dispose = vi.fn()
  const client: TsSyntaxClient = {
    async check(file) {
      checked.push(file.name)
      return check(file)
    },
    dispose,
  }
  return { client, checked, dispose }
}

describe('analysis session', () => {
  it('runs pattern rules, merges TypeScript findings and builds the report', async () => {
    const entries = [entry('src/app.ts', 'const x = ;\n'), entry('data/config.json', '{"a":1}\n')]
    const analyzer = fakeAnalyzer([analysis('src/app.ts'), analysis('data/config.json', [finding('data/config.json')])])
    const tsFinding = { ...finding('src/app.ts', 'bugpilot/typescript/syntax'), analyzer: 'typescript' as const, tier: 'syntax' as const }
    const ts = fakeTsClient(() => tsResult({ findings: [tsFinding] }))
    const readArchive = vi.fn(async () => readResult(entries))

    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1, 2, 3]) },
      { archiveBytes: 3, generatedAt: new Date('2026-01-02T03:04:05Z') },
      { readArchive, analyzer, createTsClient: async () => ts.client },
    )

    expect(result.status).toBe('completed')
    expect(result.report?.findings).toHaveLength(2)
    expect(result.report?.findings.some((item) => item.analyzer === 'typescript')).toBe(true)
    expect(result.report?.generatedAt).toBe('2026-01-02T03:04:05.000Z')
    expect(result.report?.session.archiveBytes).toBe(3)
    expect(result.report?.session.analysedCount).toBe(2)
    expect(ts.checked).toEqual(['src/app.ts'])
    expect(ts.dispose).toHaveBeenCalledTimes(1)

    const appCoverage = result.report?.coverage.find((file) => file.file === 'src/app.ts')
    expect(appCoverage?.findings).toBe(1)
    expect(appCoverage?.tiers.find((tier) => tier.tier === 'syntax')?.ran).toBe(true)
    const jsonCoverage = result.report?.coverage.find((file) => file.file === 'data/config.json')
    expect(jsonCoverage?.findings).toBe(1)
    expect(readArchive).toHaveBeenCalledTimes(1)
  })

  it('reads loose files through the injected reader', async () => {
    const readLoose = vi.fn(async () => readResult([entry('notes.txt', 'hello\n')]))
    const result = await analyzeUpload(
      { kind: 'files', sources: [{ path: 'notes.txt', size: 6, read: async () => new Uint8Array() }] },
      { archiveBytes: 6 },
      { readLoose, analyzer: fakeAnalyzer([analysis('notes.txt')]), createTsClient: async () => fakeTsClient(() => tsResult({})).client },
    )

    expect(result.status).toBe('completed')
    expect(result.report?.session.fileCount).toBe(1)
    expect(result.report?.coverage[0].languageLabel).toBe('Plain text')
  })

  it('refuses the upload with the reader message and keeps the stats', async () => {
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      {
        readArchive: async () => ({
          refusal: { code: 'declared_ratio_exceeded', message: 'This archive expands far beyond its compressed size.' },
          entries: [],
          skipped: [],
          stats: { ...STATS, walkedRecords: 400 },
        }),
      },
    )

    expect(result.status).toBe('refused')
    expect(result.message).toMatch(/expands far beyond/)
    expect(result.report).toBeNull()
    expect(result.stats?.walkedRecords).toBe(400)
  })

  it('turns an analyzer failure into an error without a report', async () => {
    const analyzer: AnalyzerClient = {
      analyze: async () => ({ files: [], cancelled: false, error: 'The analyzer stopped unexpectedly.' }),
    }
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      { readArchive: async () => readResult([entry('a.ts', 'const a = 1\n')]), analyzer },
    )

    expect(result.status).toBe('error')
    expect(result.message).toMatch(/stopped unexpectedly/)
    expect(result.report).toBeNull()
  })

  it('does nothing when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const readArchive = vi.fn(async () => readResult([]))

    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1, signal: controller.signal },
      { readArchive },
    )

    expect(result.status).toBe('cancelled')
    expect(readArchive).not.toHaveBeenCalled()
  })

  it('cancels mid-run and keeps no report', async () => {
    const controller = new AbortController()
    const analyzer: AnalyzerClient = {
      analyze: async () => {
        controller.abort()
        return { files: [], cancelled: true, error: null }
      },
    }

    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1, signal: controller.signal },
      { readArchive: async () => readResult([entry('a.js', 'const a = 1\n')]), analyzer },
    )

    expect(result.status).toBe('cancelled')
    expect(result.report).toBeNull()
  })

  it('marks a TypeScript timeout as a syntax tier that did not run', async () => {
    const ts = fakeTsClient(() => tsResult({ timedOut: true }))
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      {
        readArchive: async () => readResult([entry('src/app.tsx', 'export const App = () => <div />\n')]),
        analyzer: fakeAnalyzer([analysis('src/app.tsx')]),
        createTsClient: async () => ts.client,
      },
    )

    expect(result.status).toBe('completed')
    const syntax = result.report?.coverage[0].tiers.find((tier) => tier.tier === 'syntax')
    expect(syntax?.available).toBe(true)
    expect(syntax?.ran).toBe(false)
    expect(syntax?.reason).toMatch(/5000 ms/)
  })

  it('keeps the run completed when the TypeScript worker cannot start', async () => {
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      {
        readArchive: async () => readResult([entry('src/app.ts', 'const a = 1\n')]),
        analyzer: fakeAnalyzer([analysis('src/app.ts')]),
        createTsClient: async () => {
          throw new Error('worker blocked')
        },
      },
    )

    expect(result.status).toBe('completed')
    const syntax = result.report?.coverage[0].tiers.find((tier) => tier.tier === 'syntax')
    expect(syntax?.ran).toBe(false)
    expect(syntax?.reason).toMatch(/could not start.*worker blocked/)
  })

  it('never loads the TypeScript checker when no JS/TS file exists', async () => {
    const createTsClient = vi.fn(async () => fakeTsClient(() => tsResult({})).client)
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      {
        readArchive: async () => readResult([entry('README.md', '# Title\n')]),
        analyzer: fakeAnalyzer([analysis('README.md')]),
        createTsClient,
      },
    )

    expect(result.status).toBe('completed')
    expect(createTsClient).not.toHaveBeenCalled()
  })

  it('reports progress for reading, rules and TypeScript phases', async () => {
    const phases: SessionProgress['phase'][] = []
    const entries = [entry('src/app.ts', 'const a = 1\n'), entry('src/other.ts', 'const b = 2\n')]
    const ts = fakeTsClient(() => tsResult({}))

    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      {
        archiveBytes: 1,
        onProgress: (progress) => {
          phases.push(progress.phase)
        },
      },
      {
        readArchive: async (_bytes, options) => {
          options?.onProgress?.({ phase: 'walk', walkedRecords: 1, extractedEntries: 0, producedBytes: 0 })
          options?.onProgress?.({ phase: 'extract', walkedRecords: 1, extractedEntries: 2, producedBytes: 20 })
          return readResult(entries)
        },
        analyzer: fakeAnalyzer([analysis('src/app.ts'), analysis('src/other.ts')]),
        createTsClient: async () => ts.client,
      },
    )

    expect(result.status).toBe('completed')
    expect(phases).toContain('reading')
    expect(phases).toContain('rules')
    expect(phases).toContain('typescript')
    expect(phases.filter((phase) => phase === 'typescript')).toHaveLength(3)
  })

  it('counts skipped files in the session and marks their tiers as not run', async () => {
    const skipped: ArchiveSkippedEntry[] = [
      { name: 'assets/logo.png', code: 'binary_content', message: 'Binary file skipped.' },
    ]
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      {
        readArchive: async () => readResult([entry('notes.txt', 'hi\n')], skipped),
        analyzer: fakeAnalyzer([analysis('notes.txt')]),
        createTsClient: async () => fakeTsClient(() => tsResult({})).client,
      },
    )

    expect(result.report?.session.fileCount).toBe(2)
    expect(result.report?.session.skipped).toEqual([{ file: 'assets/logo.png', reason: 'Binary file skipped.' }])
    const skippedCoverage = result.report?.coverage.find((file) => file.file === 'assets/logo.png')
    expect(skippedCoverage?.status).toBe('skipped')
    expect(skippedCoverage?.tiers.every((tier) => !tier.ran)).toBe(true)
  })

  it('stops between TypeScript files when cancellation arrives', async () => {
    const controller = new AbortController()
    const ts = fakeTsClient(() => {
      controller.abort()
      return tsResult({ cancelled: true })
    })

    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1, signal: controller.signal },
      {
        readArchive: async () => readResult([entry('a.ts', 'const a = 1\n'), entry('b.ts', 'const b = 2\n')]),
        analyzer: fakeAnalyzer([analysis('a.ts'), analysis('b.ts')]),
        createTsClient: async () => ts.client,
      },
    )

    expect(result.status).toBe('cancelled')
    expect(result.report).toBeNull()
    expect(ts.dispose).toHaveBeenCalledTimes(1)
  })
})
