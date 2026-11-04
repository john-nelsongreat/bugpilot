import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveSkippedEntry } from '../archive/guard'
import type { IntakeSource, ReadLooseFilesOptions } from '../archive/readLooseFiles'
import type { ArchiveClientReadOptions } from '../archive/workerClient'
import type { AnalyzerClient } from './analyzerClient'
import type { FileAnalysis } from './engine'
import { analyzeUpload } from './session'

const STATS = {
  walkedRecords: 1,
  producedBytes: 10,
  entries: 1,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 10,
}

const NPM_TOKEN = ['npm', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8'].join('_')

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return { name, text, language: detection.language, languageSource: detection.source, encoding: 'utf-8', bytes: text.length }
}

function skipped(name: string, code: ArchiveSkippedEntry['code'] = 'single_file_too_large'): ArchiveSkippedEntry {
  return { name, code, message: `"${name}" was skipped in this test.` }
}

function readResult(entries: ArchiveEntry[], skippedEntries: ArchiveSkippedEntry[] = []): ArchiveReadResult {
  return {
    refusal: null,
    entries,
    skipped: skippedEntries,
    stats: { ...STATS, entries: entries.length, skipped: skippedEntries.length },
  }
}

/** Mirrors the real worker: one analysis per entry, so skipped entries never reach it. */
function fakeAnalyzer(): AnalyzerClient & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    async analyze(entries) {
      seen.push(...entries.map((item) => item.name))
      const files: FileAnalysis[] = entries.map((item) => ({
        file: item.name,
        findings: [],
        notes: [],
        rulesRan: ['bugpilot/generic/todo-marker'],
        stoppedEarly: false,
      }))
      return { files, cancelled: false, error: null }
    },
  }
}

describe('sensitive file names in the analysis session', () => {
  it('reports name-only findings for files the reader skipped, without reading or keeping them', async () => {
    const analyzer = fakeAnalyzer()
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      {
        readArchive: async () => readResult([entry('.env', 'A=1\n'), entry('src/app.py', 'print(1)\n')], [skipped('id_rsa')]),
        analyzer,
      },
    )

    expect(result.status).toBe('completed')
    expect(analyzer.seen).toEqual(['.env', 'src/app.py'])
    const byRule = new Map(result.report?.findings.map((finding) => [finding.ruleId, finding]))
    expect([...byRule.keys()].sort()).toEqual(['bugpilot/sensitive/env-file', 'bugpilot/sensitive/private-key-name'])
    for (const finding of byRule.values()) {
      expect(finding.fix?.riskClass).toBe('manual-only')
      expect(finding.evidence).toEqual([])
    }

    const envCoverage = result.report?.coverage.find((item) => item.file === '.env')
    expect([envCoverage?.status, envCoverage?.findings]).toEqual(['analysed', 1])
    const keyCoverage = result.report?.coverage.find((item) => item.file === 'id_rsa')
    expect([keyCoverage?.status, keyCoverage?.findings]).toEqual(['skipped', 1])
    expect(result.report?.session).toMatchObject({ analysedCount: 2, skippedCount: 1, fileCount: 3 })
    expect(result.sources?.map((item) => item.name)).toEqual(['.env', 'src/app.py'])
  })

  it('skips generated and vendored entries by default and names the override in the coverage reason', async () => {
    const analyzer = fakeAnalyzer()
    const entries = [
      entry('src/app.js', 'const x = 1\n'),
      entry('dist/app.min.js', 'var a=1\n'),
      entry('node_modules/leftpad/index.js', 'module.exports = 1\n'),
      entry('.git/config', '[core]\n'),
      entry('package-lock.json', '{"lockfileVersion":3}\n'),
    ]
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      { readArchive: async () => readResult(entries), analyzer },
    )

    expect(analyzer.seen).toEqual(['src/app.js'])
    expect(result.report?.session).toMatchObject({ analysedCount: 1, skippedCount: 4, fileCount: 5 })
    const skippedFiles = result.report?.coverage.filter((item) => item.status === 'skipped').map((item) => item.file)
    expect(skippedFiles?.sort()).toEqual(['.git/config', 'dist/app.min.js', 'node_modules/leftpad/index.js', 'package-lock.json'])
    for (const item of result.report?.coverage.filter((coverage) => coverage.status === 'skipped') ?? []) {
      expect(item.skipReason).toMatch(/Include generated and vendored files/)
    }
  })

  it('checks the heuristics on request but still refuses .git', async () => {
    const analyzer = fakeAnalyzer()
    const entries = [
      entry('dist/app.min.js', 'var a=1\n'),
      entry('package-lock.json', '{"lockfileVersion":3}\n'),
      entry('node_modules/leftpad/index.js', 'module.exports = 1\n'),
      entry('.idea/workspace.xml', '<project/>\n'),
      entry('.git/config', '[core]\n'),
    ]
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1, includeGenerated: true },
      { readArchive: async () => readResult(entries), analyzer },
    )

    expect(analyzer.seen.sort()).toEqual([
      '.idea/workspace.xml',
      'dist/app.min.js',
      'node_modules/leftpad/index.js',
      'package-lock.json',
    ])
    expect(result.report?.session).toMatchObject({ analysedCount: 4, skippedCount: 1 })
    expect(result.report?.coverage.find((item) => item.file === '.git/config')?.skipReason).toMatch(/generated or vendored/i)
  })

  it('still reports a sensitive file that the generated rule skipped, and never quotes it', async () => {
    const analyzer = fakeAnalyzer()
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1 },
      {
        readArchive: async () => readResult([entry('src/app.js', 'const x = 1\n'), entry('node_modules/pkg/.npmrc', `_authToken=${NPM_TOKEN}\n`)]),
        analyzer,
      },
    )

    expect(analyzer.seen).toEqual(['src/app.js'])
    const finding = result.report?.findings.find((item) => item.ruleId === 'bugpilot/sensitive/npmrc')
    expect(finding?.file).toBe('node_modules/pkg/.npmrc')
    expect(finding?.evidence).toEqual([])
    expect(JSON.stringify(result.report)).not.toContain(NPM_TOKEN)
    expect(result.report?.coverage.find((item) => item.file === 'node_modules/pkg/.npmrc')?.findings).toBe(1)
  })

  it('passes the override and the ceilings to both readers', async () => {
    const readArchive = vi.fn(async (_bytes: Uint8Array, _options: ArchiveClientReadOptions) =>
      readResult([entry('src/app.js', 'const x = 1\n')]),
    )
    const readLoose = vi.fn(async (_sources: readonly IntakeSource[], _options: ReadLooseFilesOptions) =>
      readResult([entry('src/app.js', 'const x = 1\n')]),
    )
    const limits = {
      maxArchiveBytes: 1,
      maxTotalUncompressedBytes: 2,
      maxSingleFileUncompressedBytes: 3,
      maxEntryCount: 4,
      maxEntryNameBytes: 5,
      maxDeclaredRatio: 6,
      maxActualRatio: 7,
      maxWallClockMs: 8,
      inflateChunkBytes: 9,
    }
    await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: 1, includeGenerated: true, limits },
      { readArchive, analyzer: fakeAnalyzer() },
    )
    await analyzeUpload(
      { kind: 'files', sources: [{ path: 'src/app.js', size: 1, read: async () => new Uint8Array([1]) }] },
      { archiveBytes: 1, includeGenerated: true, limits },
      { readLoose, analyzer: fakeAnalyzer() },
    )

    expect(readArchive.mock.calls[0]?.[1]).toMatchObject({ includeGenerated: true, limits })
    expect(readLoose.mock.calls[0]?.[1]).toMatchObject({ includeGenerated: true, limits })
  })
})
