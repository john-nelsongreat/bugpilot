import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult } from '../archive/guard'
import type { AnalyzerClient } from './analyzerClient'
import { analyzeEntries } from './engine'
import { analyzeUpload } from './session'

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

function readResult(entries: ArchiveEntry[]): ArchiveReadResult {
  return {
    refusal: null,
    entries,
    skipped: [],
    stats: {
      walkedRecords: entries.length,
      producedBytes: entries.reduce((total, item) => total + item.bytes, 0),
      entries: entries.length,
      skipped: 0,
      durationMs: 1,
      peakEntryBytes: Math.max(...entries.map((item) => item.bytes)),
    },
  }
}

const analyzer: AnalyzerClient = {
  async analyze(entries) {
    return { files: analyzeEntries(entries).files, cancelled: false, error: null }
  },
}

describe('session sources', () => {
  it('returns the analysed text in memory so fixes can be proposed later', async () => {
    const entries = [entry('data/config.json', '{"a": 1,,}\n')]
    const result = await analyzeUpload(
      { kind: 'files', sources: [{ path: 'data/config.json', size: 12, read: async () => new Uint8Array() }] },
      { archiveBytes: 12 },
      {
        readLoose: async () => readResult(entries),
        analyzer,
      },
    )

    expect(result.status).toBe('completed')
    expect(result.sources).toEqual(entries)
    expect(result.report?.findings.some((finding) => finding.ruleId === 'bugpilot/syntax/json')).toBe(true)
  })

  it('does not return sources when the run is refused', async () => {
    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      { archiveBytes: 0 },
      {
        readLoose: async () => ({
          refusal: { code: 'archive_too_large', message: 'No files were found in the upload.' },
          entries: [],
          skipped: [],
          stats: {
            walkedRecords: 0,
            producedBytes: 0,
            entries: 0,
            skipped: 0,
            durationMs: 1,
            peakEntryBytes: 0,
          },
        }),
      },
    )

    expect(result.status).toBe('refused')
    expect(result.sources).toBeUndefined()
  })

  it('labels a report partial and keeps the files the reader reached', async () => {
    const entries = [entry('src/a.js', 'export const a = 1\n')]
    const result = await analyzeUpload(
      { kind: 'files', sources: [{ path: 'src/a.js', size: 19, read: async () => new Uint8Array() }] },
      { archiveBytes: 19 },
      {
        readLoose: async () => ({
          ...readResult(entries),
          skipped: [{ name: 'src/b.js', code: 'not_reached', message: 'src/b.js was not reached.' }],
          partial: {
            code: 'wall_clock_exceeded',
            message: 'BugPilot reached its 300 second reading limit.',
            analysedFiles: 1,
            plannedFiles: 2,
            unreachedFiles: 1,
            producedBytes: 19,
            plannedBytes: 19,
          },
        }),
        analyzer,
      },
    )

    expect(result.status).toBe('partial')
    expect(result.partial?.code).toBe('wall_clock_exceeded')
    expect(result.report?.session.partial).toMatchObject({ analysedFiles: 1, plannedFiles: 2 })
    expect(result.report?.limitations).toContain('BugPilot reached its 300 second reading limit.')
    expect(result.sources).toEqual(entries)
  })

  it('keeps a partial report when the cancel lands while the reader still had files to read', async () => {
    const controller = new AbortController()
    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      { archiveBytes: 2, signal: controller.signal },
      {
        readLoose: async () => {
          controller.abort()
          return {
            refusal: null,
            entries: [entry('src/a.js', 'x\n')],
            skipped: [{ name: 'src/b.js', code: 'not_reached', message: 'src/b.js was not reached.' }],
            stats: {
              walkedRecords: 2,
              producedBytes: 2,
              entries: 1,
              skipped: 1,
              durationMs: 1,
              peakEntryBytes: 2,
            },
            partial: {
              code: 'cancelled',
              message: 'You cancelled the upload.',
              analysedFiles: 1,
              plannedFiles: 2,
              unreachedFiles: 1,
              producedBytes: 2,
              plannedBytes: 2,
            },
          }
        },
      },
    )

    expect(result.status).toBe('partial')
    expect(result.report?.session.analysedCount).toBe(0)
    // Nothing was run under an aborted signal: both files are listed as skipped, with the
    // cancellation explained instead of a findings section that looks complete.
    expect(result.report?.coverage.map((item) => [item.file, item.status])).toEqual([
      ['src/b.js', 'skipped'],
      ['src/a.js', 'skipped'],
    ])
    expect(result.report?.coverage[1].skipReason).toContain('cancelled before analysis')
    expect(result.sources).toEqual([])
  })

  it('does not return sources when the run is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      { archiveBytes: 0, signal: controller.signal },
      {},
    )
    expect(result.status).toBe('cancelled')
    expect(result.sources).toBeUndefined()
  })
})
