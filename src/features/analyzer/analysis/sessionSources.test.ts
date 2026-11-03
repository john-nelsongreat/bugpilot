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
    const entries = [entry('data/config.json', '{"a": 1,}\n')]
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
