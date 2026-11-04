import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveReadStats, ArchiveSkippedEntry } from '../archive/guard'
import { archiveReasonMessage } from '../archive/reasons'
import type { AnalyzerClient } from './analyzerClient'
import { analyzeUpload } from './session'
import type { IntakeSource } from '../archive/readLooseFiles'

const STATS: ArchiveReadStats = {
  walkedRecords: 2,
  producedBytes: 12,
  entries: 1,
  skipped: 0,
  durationMs: 2,
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

/**
 * The intake layer sets an unsafe upload aside before the reader ever sees it. The session still has
 * to account for it, because a run that quietly dropped half the selection would report a coverage
 * list the user cannot check.
 */
describe('a run over several uploads', () => {
  it('carries the upload the intake set aside into the coverage report', async () => {
    const kept = entry('upload-1/src/a.js', 'const a = 1\n')
    const note: ArchiveSkippedEntry = {
      name: 'upload-2',
      code: 'source_set_aside',
      message: archiveReasonMessage('source_set_aside', 'upload-2', archiveReasonMessage('path_traversal')),
    }
    const readLoose = async (): Promise<ArchiveReadResult> => ({
      refusal: null,
      entries: [kept],
      skipped: [],
      stats: STATS,
    })
    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item) => ({
            file: item.name,
            findings: [],
            notes: [],
            rulesRan: ['bugpilot/generic/todo-marker'],
            stoppedEarly: false,
          })),
          cancelled: false,
          error: null,
        }
      },
    }

    const result = await analyzeUpload(
      { kind: 'files', sources: [kept] as unknown as IntakeSource[], notes: [note] },
      { archiveBytes: 12 },
      { readLoose, analyzer },
    )

    expect(result.status).toBe('completed')
    expect(result.skipped).toEqual([note])
    expect(result.report?.session.skipped).toEqual([{ file: 'upload-2', reason: note.message }])
    expect(result.report?.coverage.map((file) => [file.file, file.status])).toEqual([
      ['upload-1/src/a.js', 'analysed'],
      ['upload-2', 'skipped'],
    ])
    expect(result.report?.summary.findings).toBe(0)
  })
})
