import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult } from '../archive/guard'
import type { AnalyzerClient } from './analyzerClient'
import type { FileAnalysis } from './engine'
import { analyzeUpload, type SessionDeps } from './session'

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
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: text.length,
  }
}

function fakeAnalyzer(files: FileAnalysis[]): AnalyzerClient {
  return {
    async analyze() {
      return { files, cancelled: false, error: null }
    },
  }
}

function readResult(entries: ArchiveEntry[]): ArchiveReadResult {
  return { refusal: null, entries, skipped: [], stats: { ...STATS, entries: entries.length } }
}

describe('a container read inside the analysis session', () => {
  it('hands the uploaded name to the reader', async () => {
    const entries = [entry('src/a.js', 'export const a = 1\n')]
    const readArchive = vi.fn<NonNullable<SessionDeps['readArchive']>>(async () => readResult(entries))

    await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1, 2, 3]), name: 'project.tar.gz' },
      { archiveBytes: 3 },
      { readArchive, analyzer: fakeAnalyzer([{ file: 'src/a.js', findings: [], notes: [], rulesRan: [], stoppedEarly: false }]) },
    )

    expect(readArchive.mock.calls[0][1]).toMatchObject({ name: 'project.tar.gz' })
  })

  it('shows the reader note about a name that disagrees with the bytes', async () => {
    const entries = [entry('src/a.js', 'export const a = 1\n')]
    const withNote: ArchiveReadResult = {
      ...readResult(entries),
      format: 'zip',
      note: 'This file is named "backup.tar" but its contents are a zip archive.',
    }

    const result = await analyzeUpload(
      { kind: 'archive', bytes: new Uint8Array([1]), name: 'backup.tar' },
      { archiveBytes: 1 },
      {
        readArchive: async () => withNote,
        analyzer: fakeAnalyzer([{ file: 'src/a.js', findings: [], notes: [], rulesRan: [], stoppedEarly: false }]),
      },
    )

    expect(result.status).toBe('completed')
    expect(result.report?.limitations.some((line) => line.includes('named "backup.tar"'))).toBe(true)
  })

  it('adds nothing when the name and the contents agree', async () => {
    const entries = [entry('src/a.js', 'export const a = 1\n')]
    const honest: ArchiveReadResult = { ...readResult(entries), format: 'tar', note: null }
    const baseline: ArchiveReadResult = readResult(entries)

    const runWith = async (read: ArchiveReadResult) =>
      analyzeUpload(
        { kind: 'archive', bytes: new Uint8Array([1]), name: 'project.tar' },
        { archiveBytes: 1 },
        {
          readArchive: async () => read,
          analyzer: fakeAnalyzer([{ file: 'src/a.js', findings: [], notes: [], rulesRan: [], stoppedEarly: false }]),
        },
      )

    const noted = await runWith(honest)
    const plain = await runWith(baseline)

    expect(noted.report?.limitations).toEqual(plain.report?.limitations)
  })

  it('keeps the note in front of a refusal message', async () => {
    const refused: ArchiveReadResult = {
      refusal: { code: 'unsupported_format', message: 'This is a .7z archive, which BugPilot cannot open.' },
      entries: [],
      skipped: [],
      stats: { ...STATS, entries: 0, producedBytes: 0 },
      format: null,
      note: 'This file is named "app.zip" but its contents are a .7z archive.',
    }

    const result = await analyzeUpload({ kind: 'archive', bytes: new Uint8Array([1]), name: 'app.zip' }, { archiveBytes: 1 }, {
      readArchive: async () => refused,
    })

    expect(result.status).toBe('refused')
    expect(result.message).toContain('named "app.zip"')
    expect(result.message).toContain('cannot open')
  })

  it('never invents a note for loose files', async () => {
    const readLoose = vi.fn<NonNullable<SessionDeps['readLoose']>>(async () => readResult([entry('notes.txt', 'hello\n')]))

    const result = await analyzeUpload(
      { kind: 'files', sources: [{ path: 'notes.txt', size: 6, read: async () => new Uint8Array() }] },
      { archiveBytes: 6 },
      { readLoose, analyzer: fakeAnalyzer([{ file: 'notes.txt', findings: [], notes: [], rulesRan: [], stoppedEarly: false }]) },
    )

    expect(result.report?.limitations.some((line) => line.includes('named'))).toBe(false)
    expect(readLoose.mock.calls[0][1]).not.toHaveProperty('name')
  })
})
