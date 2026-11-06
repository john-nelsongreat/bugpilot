import { describe, expect, it } from 'vitest'
import { buildTar } from '../../../test/tarFixtures'
import { buildZip } from '../../../test/zipFixtures'
import type { ArchiveEntry, ArchiveLimits, ArchiveReadResult, ArchiveSkippedEntry } from '../archive/guard'
import { DEFAULT_ARCHIVE_LIMITS, readArchive } from '../archive/guard'
import { readLooseFiles, type IntakeSource } from '../archive/readLooseFiles'
import { readTar } from '../archive/tar'
import type { ArchiveClientReadOptions } from '../archive/workerClient'
import type { AnalyzerClient } from './analyzerClient'
import { makeFinding } from './finding'
import type { FileAnalysis } from './engine'
import { capStoredFindings, findingsTruncationNote, isTruncationNote } from './reportModel'
import {
  analyzeUpload,
  CANCELLED_CONTINUATION_MESSAGE,
  mergeSessionResults,
  RESUME_NO_PROGRESS_MESSAGE,
  resumeNamesFrom,
  STALE_HANDLE_MESSAGE,
  type AnalysisSessionResult,
} from './session'
import type { AnalyzerFinding } from '../types'
import { renderReportMarkdown } from '../export/reportFiles'

const ARCHIVE_BYTES = buildZip([{ name: 'src/a.js', content: 'const a = 1\n' }]).length

function cappedLimits(maxEntryCount: number): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, maxEntryCount, maxChunkWallClockMs: 60_000 }
}

/** One deterministic finding per analysed file, so passes and unions can be compared by id. */
function findingAnalyzer(): AnalyzerClient & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    async analyze(entries) {
      seen.push(...entries.map((item) => item.name))
      const files: FileAnalysis[] = entries.map((item) => ({
        file: item.name,
        findings: [
          makeFinding({
            ruleId: 'bugpilot/test/marker',
            analyzer: 'bugpilot-rules',
            tier: 'pattern',
            severity: 'Low',
            confidence: { level: 'high', reason: 'the test rule always fires' },
            file: item.name,
            range: { startLine: 1, endLine: 1 },
            evidence: [],
            message: `test finding in ${item.name}`,
            explanation: 'A deterministic finding the tests can compare by id.',
            fix: null,
            verificationSteps: [],
            limitations: [],
          }),
        ],
        notes: [],
        rulesRan: ['bugpilot/test/marker'],
        stoppedEarly: false,
      }))
      return { files, cancelled: false, error: null }
    },
  }
}

const REAL_READERS = {
  readArchive: (input: Uint8Array | Blob, options: ArchiveClientReadOptions) => readArchive(input as Uint8Array, options),
}

const ZIP_NAMES = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']
const zipBytes = buildZip([
  { name: 'src/a.js', content: 'const a = 1\n' },
  { name: 'src/b.js', content: 'const b = 2\n' },
  { name: 'src/c.js', content: 'const c = 3\n' },
  { name: 'src/d.js', content: 'const d = 4\n' },
])

describe('a zip upload resumed from the original file', () => {
  it('produces the same union as one uninterrupted run', async () => {
    const first = findingAnalyzer()
    const pass1 = await analyzeUpload(
      { kind: 'archive', bytes: zipBytes, name: 'upload.zip' },
      { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(2) },
      { ...REAL_READERS, analyzer: first },
    )
    expect(pass1.status).toBe('partial')
    expect(pass1.partial?.code).toBe('entry_count_exceeded')
    expect(first.seen.sort()).toEqual(['src/a.js', 'src/b.js'])

    const resumeSet = resumeNamesFrom(pass1)
    expect([...resumeSet].sort()).toEqual(['src/a.js', 'src/b.js'])

    const second = findingAnalyzer()
    const pass2 = await analyzeUpload(
      { kind: 'archive', bytes: zipBytes, name: 'upload.zip' },
      { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(2), resumeProcessedNames: resumeSet },
      { ...REAL_READERS, analyzer: second },
    )
    expect(pass2.status).toBe('completed')
    expect(second.seen.sort()).toEqual(['src/c.js', 'src/d.js'])

    const merged = mergeSessionResults(pass1, pass2)
    expect(merged.status).toBe('completed')
    expect(merged.partial).toBeNull()

    const full = findingAnalyzer()
    const uninterrupted = await analyzeUpload(
      { kind: 'archive', bytes: zipBytes, name: 'upload.zip' },
      { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(4) },
      { ...REAL_READERS, analyzer: full },
    )
    expect(full.seen.sort()).toEqual(ZIP_NAMES)

    expect(merged.report?.findings.map((finding) => finding.id).sort()).toEqual(
      uninterrupted.report?.findings.map((finding) => finding.id).sort(),
    )
    expect(merged.report?.summary.findings).toBe(uninterrupted.report?.summary.findings)
    expect(merged.report?.session).toMatchObject({ analysedCount: 4, skippedCount: 0, fileCount: 4 })
    const mergedFiles = merged.report?.coverage.map((row) => [row.file, row.status]).sort()
    const fullFiles = uninterrupted.report?.coverage.map((row) => [row.file, row.status]).sort()
    expect(mergedFiles).toEqual(fullFiles)
    expect(merged.report?.coverage.every((row) => row.status === 'analysed')).toBe(true)
    expect(merged.report?.limitations.some((line) => /not reached|partial/i.test(line))).toBe(false)
  })

  it('keeps the earlier report when the continuation cannot open the file again', async () => {
    const pass1 = await analyzeUpload(
      { kind: 'archive', bytes: zipBytes, name: 'upload.zip' },
      { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(2) },
      { ...REAL_READERS, analyzer: findingAnalyzer() },
    )
    const stale: AnalysisSessionResult = {
      status: 'error',
      message: STALE_HANDLE_MESSAGE,
      report: null,
      stats: null,
      handleStale: true,
    }
    const merged = mergeSessionResults(pass1, stale)

    expect(merged.status).toBe('error')
    expect(merged.message).toBe(STALE_HANDLE_MESSAGE)
    expect(merged.handleStale).toBe(true)
    expect(merged.report?.findings).toEqual(pass1.report?.findings)
    expect(merged.report?.coverage).toEqual(pass1.report?.coverage)
  })

  it('keeps the earlier report and says what happened when the continuation is cancelled', async () => {
    const pass1 = await analyzeUpload(
      { kind: 'archive', bytes: zipBytes, name: 'upload.zip' },
      { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(2) },
      { ...REAL_READERS, analyzer: findingAnalyzer() },
    )
    const merged = mergeSessionResults(pass1, { status: 'cancelled', message: null, report: null, stats: null })

    expect(merged.status).toBe('cancelled')
    expect(merged.message).toBe(CANCELLED_CONTINUATION_MESSAGE)
    expect(merged.report?.findings).toEqual(pass1.report?.findings)
  })
})

describe('a tar upload resumed from the original file', () => {
  it('re-streams from the start but skips the members an earlier pass read', async () => {
    const bytes = buildTar([
      { name: 'src/a.js', content: 'const a = 1\n' },
      { name: 'src/b.js', content: 'const b = 2\n' },
      { name: 'src/c.js', content: 'const c = 3\n' },
    ])

    const pass1 = await readTar(bytes, { limits: cappedLimits(2), keepPartial: true })
    expect(pass1.refusal).toBeNull()
    expect(pass1.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
    expect(pass1.partial?.code).toBe('entry_count_exceeded')

    const settled: ReadonlySet<string> = new Set(['src/a.js', 'src/b.js'])
    const pass2 = await readTar(bytes, { limits: cappedLimits(2), resumeProcessedNames: settled })
    expect(pass2.refusal).toBeNull()
    expect(pass2.partial).toBeNull()
    expect(pass2.entries.map((entry) => entry.name)).toEqual(['src/c.js'])
    // The re-stream skipped the bodies of the two members it had already read, so it produced
    // only the third member's bytes.
    expect(pass2.stats.producedBytes).toBe('const c = 3\n'.length)
  })

  it('merges into the same coverage one uninterrupted run reports', async () => {
    const bytes = buildTar([
      { name: 'src/a.js', content: 'const a = 1\n' },
      { name: 'src/b.js', content: 'const b = 2\n' },
      { name: 'src/c.js', content: 'const c = 3\n' },
    ])
    const asArchive = (input: Uint8Array | Blob, options: ArchiveClientReadOptions) => readTar(input as Uint8Array, options)

    const pass1 = await analyzeUpload(
      { kind: 'archive', bytes, name: 'upload.tar' },
      { archiveBytes: bytes.length, limits: cappedLimits(2) },
      { readArchive: asArchive, analyzer: findingAnalyzer() },
    )
    expect(pass1.status).toBe('partial')
    expect(pass1.partial?.code).toBe('entry_count_exceeded')

    const pass2 = await analyzeUpload(
      { kind: 'archive', bytes, name: 'upload.tar' },
      { archiveBytes: bytes.length, limits: cappedLimits(2), resumeProcessedNames: resumeNamesFrom(pass1) },
      { readArchive: asArchive, analyzer: findingAnalyzer() },
    )
    expect(pass2.status).toBe('completed')

    const merged = mergeSessionResults(pass1, pass2)
    expect(merged.status).toBe('completed')
    expect(merged.report?.session).toMatchObject({ analysedCount: 3, skippedCount: 0, fileCount: 3 })
    // The sequential reader's "(rest of the archive)" marker from the earlier pass is retired:
    // the continuation walked the whole tar, so nothing is unreached any more.
    expect(merged.report?.coverage.map((row) => row.status)).toEqual(['analysed', 'analysed', 'analysed'])
    expect(merged.skipped?.map((item) => item.name)).not.toContain('(rest of the archive)')
  })
})

describe('loose files resumed from the original selection', () => {
  it('re-enumerates the drop and reads only the files an earlier pass did not', async () => {
    const body = (letter: string): string => `const ${letter} = 1\n`
    const files: IntakeSource[] = ['a', 'b', 'c'].map((letter) => ({
      path: `src/${letter}.js`,
      size: body(letter).length,
      read: async () => new TextEncoder().encode(body(letter)),
    }))

    const pass1 = await readLooseFiles(files, { limits: cappedLimits(1), keepPartial: true })
    expect(pass1.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(pass1.partial?.code).toBe('entry_count_exceeded')

    const pass2 = await readLooseFiles(files, {
      limits: cappedLimits(2),
      resumeProcessedNames: new Set(['src/a.js']),
    })
    expect(pass2.partial ?? null).toBeNull()
    expect(pass2.entries.map((entry) => entry.name)).toEqual(['src/b.js', 'src/c.js'])
  })
})

describe('merging session results', () => {
  function readResult(entries: ArchiveEntry[], skippedEntries: ArchiveSkippedEntry[] = []): ArchiveReadResult {
    return {
      refusal: null,
      entries,
      skipped: skippedEntries,
      stats: {
        walkedRecords: entries.length,
        producedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        inflatedBytes: 0,
        entries: entries.length,
        skipped: skippedEntries.length,
        durationMs: 1,
        peakEntryBytes: 10,
      },
    }
  }

  function textEntry(name: string): ArchiveEntry {
    const text = `const x = 1\n`
    return { name, text, language: 'javascript', languageSource: 'extension', encoding: 'utf-8', bytes: text.length }
  }

  it('dedupes findings by id and coverage by file when the same pass is merged twice', async () => {
    const options = { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(4) }
    const reader = async () => readResult([textEntry('src/a.js'), textEntry('src/b.js')])
    const first = await analyzeUpload({ kind: 'archive', bytes: new Uint8Array([1]) }, options, {
      readArchive: reader,
      analyzer: findingAnalyzer(),
    })
    const replay = await analyzeUpload({ kind: 'archive', bytes: new Uint8Array([1]) }, options, {
      readArchive: reader,
      analyzer: findingAnalyzer(),
    })
    const merged = mergeSessionResults(first, replay)
    expect(merged.report?.findings).toHaveLength(2)
    expect(merged.report?.coverage).toHaveLength(2)

    const mergedAgain = mergeSessionResults(merged, replay)
    expect(mergedAgain.report?.findings).toHaveLength(2)
    expect(mergedAgain.report?.coverage).toHaveLength(2)
    expect(mergedAgain.report?.summary.findings).toBe(2)
  })

  it('upgrades a not-reached coverage row when the continuation analysed the file', async () => {
    const options = { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(2) }
    const pass1 = await analyzeUpload({ kind: 'archive', bytes: zipBytes, name: 'upload.zip' }, options, {
      ...REAL_READERS,
      analyzer: findingAnalyzer(),
    })
    const pass2 = await analyzeUpload(
      { kind: 'archive', bytes: zipBytes, name: 'upload.zip' },
      { ...options, resumeProcessedNames: resumeNamesFrom(pass1) },
      { ...REAL_READERS, analyzer: findingAnalyzer() },
    )
    const merged = mergeSessionResults(pass1, pass2)
    const row = merged.report?.coverage.find((item) => item.file === 'src/c.js')
    expect(row?.status).toBe('analysed')
    expect(row?.findings).toBe(1)
  })

  it('says a continuation that reached nothing new made no progress', async () => {
    const partialRead: ArchiveReadResult = {
      refusal: null,
      entries: [],
      skipped: [{ name: 'src/a.js', code: 'not_reached', message: 'not reached in the test' }],
      stats: {
        walkedRecords: 1,
        producedBytes: 0,
        inflatedBytes: 0,
        entries: 0,
        skipped: 1,
        durationMs: 1,
        peakEntryBytes: 0,
      },
      partial: {
        code: 'wall_clock_exceeded',
        message: 'The pass ran out of time.',
        analysedFiles: 0,
        plannedFiles: 1,
        unreachedFiles: 1,
        producedBytes: 0,
        plannedBytes: 10,
      },
    }
    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]) },
      { archiveBytes: ARCHIVE_BYTES, limits: cappedLimits(4), resumeProcessedNames: new Set(['src/a.js']) },
      { readArchive: async () => partialRead, analyzer: findingAnalyzer() },
    )

    expect(result.status).toBe('partial')
    expect(result.message).toBe(RESUME_NO_PROGRESS_MESSAGE)
    expect(result.report?.limitations).toContain(RESUME_NO_PROGRESS_MESSAGE)
  })
})

describe('the findings store cap', () => {
  function finding(line: number, ruleId: string): AnalyzerFinding {
    return makeFinding({
      ruleId,
      analyzer: 'bugpilot-rules',
      tier: 'pattern',
      severity: 'Low',
      confidence: { level: 'high', reason: 'the test rule always fires' },
      file: 'src/a.js',
      range: { startLine: line, endLine: line },
      evidence: [],
      message: `finding ${line}`,
      explanation: 'A deterministic finding the tests can compare by id.',
      fix: null,
      verificationSteps: [],
      limitations: [],
    })
  }

  it('keeps a deterministic prefix and counts the suppressed findings per rule', () => {
    const findings = [
      finding(1, 'bugpilot/test/a'),
      finding(2, 'bugpilot/test/b'),
      finding(3, 'bugpilot/test/a'),
      finding(4, 'bugpilot/test/b'),
      finding(5, 'bugpilot/test/a'),
    ]
    const { findings: kept, truncation } = capStoredFindings(findings, 2)

    expect(kept.map((item) => item.id)).toEqual([findings[0].id, findings[1].id])
    expect(truncation).toEqual({
      stored: 2,
      suppressed: 3,
      perRule: { 'bugpilot/test/a': 2, 'bugpilot/test/b': 1 },
    })
    const note = findingsTruncationNote(truncation!)
    expect(note).toContain('first 2 findings')
    expect(note).toContain('3 more matched but are not stored')
    expect(note).toContain('bugpilot/test/a: 2')
    expect(note).toContain('bugpilot/test/b: 1')
    expect(isTruncationNote(note)).toBe(true)
    expect(isTruncationNote('An unrelated limitation.')).toBe(false)
  })

  it('leaves a report under the cap untouched', () => {
    const { findings: kept, truncation } = capStoredFindings([finding(1, 'bugpilot/test/a')], 2)
    expect(kept).toHaveLength(1)
    expect(truncation).toBeNull()
  })

  it('states the truncation at the top of the markdown export', () => {
    const report = {
      schemaVersion: 1 as const,
      generatedAt: '2026-01-01T00:00:00.000Z',
      includeSnippets: true,
      session: { archiveBytes: 10, fileCount: 1, analysedCount: 1, skippedCount: 0, skipped: [] },
      summary: { findings: 3, bySeverity: { Low: 3, Medium: 0, High: 0, Critical: 0 }, byTier: { syntax: 0, pattern: 3, 'type-or-dataflow': 0 } },
      findings: [finding(1, 'bugpilot/test/a'), finding(2, 'bugpilot/test/a')],
      coverage: [],
      limitations: [],
      truncated: { stored: 2, suppressed: 1, perRule: { 'bugpilot/test/a': 1 } },
    }
    const markdown = renderReportMarkdown(report)

    expect(markdown).toContain('**TRUNCATED FINDINGS LIST.**')
    expect(markdown).toContain('1 more matched but are not stored')
    expect(markdown).toContain('`bugpilot/test/a`: 1')
  })
})
