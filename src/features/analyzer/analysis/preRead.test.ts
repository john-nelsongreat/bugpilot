import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveReadStats, ArchiveSkippedEntry } from '../archive/guard'
import { DEFAULT_ARCHIVE_LIMITS } from '../archive/limits'
import type { AnalyzerClient } from './analyzerClient'
import { analyzeUpload, type SessionDeps } from './session'

const STATS: ArchiveReadStats = {
  walkedRecords: 2,
  producedBytes: 12,
  entries: 1,
  skipped: 1,
  durationMs: 3,
  peakEntryBytes: 12,
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

function skipped(name: string): ArchiveSkippedEntry {
  return { name, code: 'binary_content', message: `"${name}" is a binary file, not text.` }
}

function recorder(): { files: string[]; analyzer: AnalyzerClient } {
  const files: string[] = []
  return {
    files,
    analyzer: {
      async analyze(entries) {
        files.push(...entries.map((item) => item.name))
        return { files: entries.map((item) => ({ file: item.name, findings: [], notes: [], rulesRan: [], stoppedEarly: false })), cancelled: false, error: null }
      },
    },
  }
}

const noTs = {
  createTsClient: async () => ({
    async check() {
      return { findings: [], timedOut: false, cancelled: false, error: null }
    },
    dispose: () => {},
  }),
}

describe('a pass over text this tab already read', () => {
  it('analyses the handed-over entries without opening the upload again', async () => {
    const entries = [entry('src/a.js', 'const a = 1\n')]
    const readArchive = vi.fn(async (): Promise<ArchiveReadResult> => {
      throw new Error('the reader should not run')
    })
    const readLoose = vi.fn(async (): Promise<ArchiveReadResult> => {
      throw new Error('the reader should not run')
    })
    const seen = recorder()

    const result = await analyzeUpload(
      { kind: 'pre-read', entries, skipped: [skipped('assets/logo.png')], stats: STATS },
      { archiveBytes: 12 },
      { readArchive, readLoose, analyzer: seen.analyzer, ...noTs },
    )

    expect(result.status).toBe('completed')
    expect(readArchive).not.toHaveBeenCalled()
    expect(readLoose).not.toHaveBeenCalled()
    expect(seen.files).toEqual(['src/a.js'])
    expect(result.sources).toBe(entries)
    expect(result.retention).toBe('all')
    expect(result.stats).toMatchObject({ producedBytes: 12 })
    expect(result.report?.coverage.map((file) => [file.file, file.status])).toEqual([
      ['src/a.js', 'analysed'],
      ['assets/logo.png', 'skipped'],
    ])
  })

  it('marks the failure when the browser will not re-open the upload', async () => {
    const readLoose = vi.fn<NonNullable<SessionDeps['readLoose']>>(async () => {
      const error = new Error('A request to read a file was interrupted.')
      error.name = 'NotReadableError'
      throw error
    })
    const seen = recorder()

    const result = await analyzeUpload(
      { kind: 'files', sources: [{ path: 'src/a.js', size: 12, read: async () => new Uint8Array(12) }] },
      { archiveBytes: 12 },
      { readLoose, analyzer: seen.analyzer },
    )

    expect(result.status).toBe('error')
    expect(result.handleStale).toBe(true)
    expect(result.message).toContain('would not re-open')
  })

  it('applies the ceilings the page worked out for this machine', async () => {
    const small = { ...DEFAULT_ARCHIVE_LIMITS, maxEntryCount: 3 }
    const readLoose = vi.fn<NonNullable<SessionDeps['readLoose']>>(async (): Promise<ArchiveReadResult> => ({
      refusal: null,
      entries: [],
      skipped: [],
      stats: { ...STATS, entries: 0, producedBytes: 0 },
    }))
    const seen = recorder()

    await analyzeUpload({ kind: 'files', sources: [] }, { archiveBytes: 1, limits: small }, {
      readLoose,
      analyzer: seen.analyzer,
      ...noTs,
    })

    expect(readLoose.mock.calls[0][1]).toMatchObject({ limits: small })
  })
})
