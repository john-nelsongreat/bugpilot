import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveReadStats } from '../archive/guard'
import type { AnalyzerFinding } from '../types'
import type { AnalyzerClient } from './analyzerClient'
import { analyzeEntries, type FileAnalysis } from './engine'
import { makeFinding } from './finding'
import { analyzeUpload } from './session'
import type { IntakeSource } from '../archive/readLooseFiles'

const STATS: ArchiveReadStats = {
  walkedRecords: 2,
  producedBytes: 40,
  entries: 2,
  skipped: 0,
  durationMs: 2,
  peakEntryBytes: 40,
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
 * Assembled at runtime: a notebook is exactly the kind of file that carries real credentials, so no
 * committed fixture may contain a credential-shaped literal, not even a fake one inside output text.
 */
const KEY_NAME = ['api', '_', 'key'].join('')
const KEY_VALUE = ['Qz4', 'Wp8', 'Rt2', 'Lm6'].join('')
const OUTPUT_TEXT = ['printed log line\n', KEY_NAME, ' = "', KEY_VALUE, '"\n'].join('')

function notebookText(): string {
  return JSON.stringify({
    cells: [
      { cell_type: 'code', execution_count: 1, metadata: {}, source: ['import os\n'], outputs: [{ output_type: 'stream', name: 'stdout', text: [OUTPUT_TEXT] }] },
      { cell_type: 'code', execution_count: 2, metadata: {}, source: ['print("done")\n'], outputs: [] },
      { cell_type: 'markdown', metadata: {}, source: ['# Notes\n'], outputs: [] },
    ],
    metadata: { kernelspec: { name: 'python' } },
    nbformat: 4,
    nbformat_minor: 5,
  })
}

function finding(ruleId: string, file: string, quote: string): AnalyzerFinding {
  return makeFinding({
    ruleId,
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: ruleId.startsWith('bugpilot/secret/') ? 'Critical' : 'Low',
    confidence: { level: 'high', reason: 'the fake rule said so' },
    file,
    range: { startLine: 1, endLine: 1 },
    evidence: [{ source: 'code snippet', label: 'line 1', quote, lineNumber: 1 }],
    message: 'The rule matched something.',
    explanation: 'This is a test finding.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

/**
 * The notebook pipeline in the session: a `.ipynb` file is never analysed as one blob. Its cells
 * become files of their own, its stored output is a file only the credential rules may read, and
 * the output text itself never reaches the report, the retained sources or an export.
 */
describe('a run over a Jupyter notebook', () => {
  it('hands the rules one file per cell plus one output file, never the raw notebook', async () => {
    const notebook = entry('nb.ipynb', notebookText())
    const seen: string[] = []
    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        seen.push(...entries.map((item) => item.name))
        return { files: entries.map((item): FileAnalysis => ({ file: item.name, findings: [], notes: [], rulesRan: [], stoppedEarly: false })), cancelled: false, error: null }
      },
    }
    const readLoose = async (): Promise<ArchiveReadResult> => ({
      refusal: null,
      entries: [notebook],
      skipped: [],
      stats: STATS,
    })

    const result = await analyzeUpload({ kind: 'files', sources: [notebook] as unknown as IntakeSource[] }, { archiveBytes: 40 }, { readLoose, analyzer })

    expect(result.status).toBe('completed')
    expect(seen).toEqual(['nb.ipynb#cell-1', 'nb.ipynb#cell-2', 'nb.ipynb#cell-1.output-1'])
    expect(result.report?.coverage.map((file) => file.file)).toEqual([
      'nb.ipynb#cell-1',
      'nb.ipynb#cell-2',
      'nb.ipynb#cell-1.output-1',
    ])
    expect(result.report?.session.fileCount).toBe(3)
  })

  it('keeps only credential findings from stored output and quotes no output text', async () => {
    const notebook = entry('nb.ipynb', notebookText())
    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item): FileAnalysis => {
            if (item.name.includes('.output-')) {
              return {
                file: item.name,
                findings: [
                  finding('bugpilot/secret/credential-assignment', item.name, OUTPUT_TEXT),
                  finding('bugpilot/generic/todo-marker', item.name, OUTPUT_TEXT),
                ],
                notes: [],
                rulesRan: [],
                stoppedEarly: false,
              }
            }
            return { file: item.name, findings: [], notes: [], rulesRan: [], stoppedEarly: false }
          }),
          cancelled: false,
          error: null,
        }
      },
    }
    const readLoose = async (): Promise<ArchiveReadResult> => ({
      refusal: null,
      entries: [notebook],
      skipped: [],
      stats: STATS,
    })

    const result = await analyzeUpload({ kind: 'files', sources: [notebook] as unknown as IntakeSource[] }, { archiveBytes: 40 }, { readLoose, analyzer })

    const outputFindings = (result.report?.findings ?? []).filter((item) => item.file.includes('.output-'))
    expect(outputFindings).toHaveLength(1)
    expect(outputFindings[0]?.ruleId).toBe('bugpilot/secret/credential-assignment')
    expect(outputFindings[0]?.evidence).toEqual([])
    expect(JSON.stringify(result.report)).not.toContain(KEY_VALUE)
    expect(JSON.stringify(result.report)).not.toContain('printed log line')
  })

  it('never keeps stored output text in memory, even when a credential was found in it', async () => {
    const notebook = entry('nb.ipynb', notebookText())
    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item): FileAnalysis => ({
            file: item.name,
            findings: item.name.includes('.output-')
              ? [finding('bugpilot/secret/credential-assignment', item.name, OUTPUT_TEXT)]
              : [],
            notes: [],
            rulesRan: [],
            stoppedEarly: false,
          })),
          cancelled: false,
          error: null,
        }
      },
    }
    const readLoose = async (): Promise<ArchiveReadResult> => ({
      refusal: null,
      entries: [notebook],
      skipped: [],
      stats: STATS,
    })

    const result = await analyzeUpload({ kind: 'files', sources: [notebook] as unknown as IntakeSource[] }, { archiveBytes: 40 }, { readLoose, analyzer })

    expect(result.retention).toBe('all')
    expect(result.sources?.map((item) => item.name)).toEqual(['nb.ipynb#cell-1', 'nb.ipynb#cell-2'])
    expect(result.sources?.some((item) => item.text.includes(KEY_VALUE))).toBe(false)
  })

  it('turns a broken notebook into a JSON syntax finding, never a silent skip', async () => {
    const broken = entry('broken.ipynb', '{"cells": [')
    const healthy = entry('src/a.py', 'import os\n')
    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        const batch = analyzeEntries(entries)
        return { files: batch.files, cancelled: false, error: null }
      },
    }
    const readLoose = async (): Promise<ArchiveReadResult> => ({
      refusal: null,
      entries: [broken, healthy],
      skipped: [],
      stats: STATS,
    })

    const result = await analyzeUpload(
      { kind: 'files', sources: [broken, healthy] as unknown as IntakeSource[] },
      { archiveBytes: 40 },
      { readLoose, analyzer },
    )

    expect(result.status).toBe('completed')
    expect(result.skipped).toEqual([])
    const syntax = result.report?.findings.find((item) => item.file === 'broken.ipynb')
    expect(syntax?.ruleId).toBe('bugpilot/syntax/json')
    expect(syntax?.fix).toBeNull()
    expect(syntax?.evidence).toEqual([])
    expect(result.report?.coverage.map((file) => [file.file, file.status, file.language])).toEqual([
      ['broken.ipynb', 'analysed', 'json'],
      ['src/a.py', 'analysed', 'python'],
    ])
    const row = result.report?.coverage.find((file) => file.file === 'broken.ipynb')
    expect(row?.notes.join(' ')).toMatch(/notebook/i)
  })

  it('marks notebook cell findings as manual-only, even when a fixer offered an edit', async () => {
    const notebook = entry('nb.ipynb', notebookText())
    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item): FileAnalysis =>
            item.name === 'nb.ipynb#cell-1'
              ? {
                  file: item.name,
                  findings: [
                    makeFinding({
                      ruleId: 'bugpilot/generic/todo-marker',
                      analyzer: 'bugpilot-rules',
                      tier: 'pattern',
                      severity: 'Low',
                      confidence: { level: 'high', reason: 'the fake rule said so' },
                      file: item.name,
                      range: { startLine: 1, endLine: 1 },
                      evidence: [],
                      message: 'The rule matched something.',
                      explanation: 'This is a test finding.',
                      fix: {
                        explanation: 'A fixer offered an edit.',
                        whereItMayApply: 'The first line.',
                        exampleCode: '',
                        riskClass: 'safe',
                        riskReason: 'The fake fixer said so.',
                      },
                      verificationSteps: [],
                      limitations: [],
                    }),
                  ],
                  notes: [],
                  rulesRan: [],
                  stoppedEarly: false,
                }
              : { file: item.name, findings: [], notes: [], rulesRan: [], stoppedEarly: false },
          ),
          cancelled: false,
          error: null,
        }
      },
    }
    const readLoose = async (): Promise<ArchiveReadResult> => ({
      refusal: null,
      entries: [notebook],
      skipped: [],
      stats: STATS,
    })

    const result = await analyzeUpload({ kind: 'files', sources: [notebook] as unknown as IntakeSource[] }, { archiveBytes: 40 }, { readLoose, analyzer })

    const cellFinding = result.report?.findings.find((item) => item.file === 'nb.ipynb#cell-1')
    expect(cellFinding?.ruleId).toBe('bugpilot/generic/todo-marker')
    expect(cellFinding?.fix?.riskClass).toBe('manual-only')
    expect(cellFinding?.fix?.riskReason).toMatch(/notebook/i)
  })

  it('says that a re-run from kept text could not look at the outputs again', async () => {
    const cells = [entry('nb.ipynb#cell-1', 'import os\n')]
    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return { files: entries.map((item): FileAnalysis => ({ file: item.name, findings: [], notes: [], rulesRan: [], stoppedEarly: false })), cancelled: false, error: null }
      },
    }

    const result = await analyzeUpload(
      { kind: 'pre-read', entries: cells, skipped: [], stats: STATS },
      { archiveBytes: 10 },
      { analyzer },
    )

    expect(result.status).toBe('completed')
    expect(result.report?.limitations.join('\n')).toMatch(/notebook output.*not.*scanned/i)
  })
})
