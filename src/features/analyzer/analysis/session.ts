import type { ArchiveEntry, ArchiveReadProgress, ArchiveReadResult, ArchiveReadStats } from '../archive/guard'
import { DEFAULT_ARCHIVE_LIMITS } from '../archive/limits'
import { readLooseFiles, type IntakeSource, type ReadLooseFilesOptions } from '../archive/readLooseFiles'
import { createArchiveClient, type ArchiveClientReadOptions } from '../archive/workerClient'
import { isTsFamily } from '../languages'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../types'
import type { AnalyzerClient } from './analyzerClient'
import { createAnalyzerClient } from './analyzerClient'
import { buildCoverage, type TypeScriptStatus } from './coverage'
import type { FileAnalysis } from './engine'
import { buildReport } from './reportModel'
import { createDefaultTsClient, TS_FILE_TIMEOUT_MS, type TsSyntaxClient } from './typescript/tsClient'

export type SessionPhase = 'reading' | 'rules' | 'typescript'

export interface SessionProgress {
  phase: SessionPhase
  filesDone: number
  filesTotal: number
  findings: number
  detail: string
}

export type SessionStatus = 'completed' | 'cancelled' | 'refused' | 'error'

export interface AnalysisSessionResult {
  status: SessionStatus
  message: string | null
  report: AnalyzerReport | null
  /** Archive reader counters; kept for the coverage panel even when a refusal stopped the run. */
  stats: ArchiveReadStats | null
}

export interface UploadArchiveInput {
  kind: 'archive'
  bytes: Uint8Array
}

export interface UploadFilesInput {
  kind: 'files'
  sources: readonly IntakeSource[]
}

export type UploadInput = UploadArchiveInput | UploadFilesInput

export interface AnalyzeUploadOptions {
  /** Bytes handed to the reader; used for the report header. */
  archiveBytes: number
  signal?: AbortSignal
  onProgress?: (progress: SessionProgress) => void
  generatedAt?: Date
}

export interface SessionDeps {
  readArchive?: (bytes: Uint8Array, options: ArchiveClientReadOptions) => Promise<ArchiveReadResult>
  readLoose?: (sources: readonly IntakeSource[], options: ReadLooseFilesOptions) => Promise<ArchiveReadResult>
  analyzer?: AnalyzerClient
  createTsClient?: () => Promise<TsSyntaxClient>
}

function defaultReadArchive(bytes: Uint8Array, options: ArchiveClientReadOptions): Promise<ArchiveReadResult> {
  const client = createArchiveClient(
    () => new Worker(new URL('../archive/worker.ts', import.meta.url), { type: 'module' }),
  )
  return client.read(bytes, options)
}

function defaultAnalyzer(): AnalyzerClient {
  return createAnalyzerClient(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))
}

const EMPTY_RESULT: AnalysisSessionResult = { status: 'cancelled', message: null, report: null, stats: null }

function cancelled(): AnalysisSessionResult {
  return { ...EMPTY_RESULT }
}

function failed(status: 'refused' | 'error', message: string, stats: ArchiveReadStats | null): AnalysisSessionResult {
  return { status, message, report: null, stats }
}

function readingProgress(progress: ArchiveReadProgress): SessionProgress {
  return {
    phase: 'reading',
    filesDone: progress.extractedEntries,
    filesTotal: 0,
    findings: 0,
    detail:
      progress.phase === 'walk'
        ? `Checking archive entries: ${progress.walkedRecords} record(s) read.`
        : `Extracting: ${progress.extractedEntries} file(s) read, ${progress.producedBytes} bytes decoded.`,
  }
}

function describeStartError(error: unknown): string {
  return error instanceof Error ? error.message : 'The analyzer could not start.'
}

/**
 * Reads the upload, runs the pattern rules in the analyzer worker, then the optional TypeScript
 * syntax check, and returns a report. Decoded file text is not kept in the result, so the page
 * never holds source after the run ends.
 */
export async function analyzeUpload(
  input: UploadInput,
  options: AnalyzeUploadOptions,
  deps: SessionDeps = {},
): Promise<AnalysisSessionResult> {
  const signal = options.signal
  const emit = (progress: SessionProgress): void => options.onProgress?.(progress)
  const readOptions = {
    limits: DEFAULT_ARCHIVE_LIMITS,
    signal,
    onProgress: (progress: ArchiveReadProgress) => emit(readingProgress(progress)),
  }

  if (signal?.aborted) return cancelled()

  let read: ArchiveReadResult
  try {
    read =
      input.kind === 'archive'
        ? await (deps.readArchive ?? defaultReadArchive)(input.bytes, readOptions)
        : await (deps.readLoose ?? readLooseFiles)(input.sources, readOptions)
  } catch (error) {
    return failed('error', describeStartError(error), null)
  }
  if (signal?.aborted) return cancelled()
  if (read.refusal) {
    if (read.refusal.code === 'cancelled') return cancelled()
    return failed('refused', read.refusal.message, read.stats)
  }

  const entries: ArchiveEntry[] = read.entries
  const skipped = read.skipped
  const stats = read.stats

  let analyses: FileAnalysis[] = []
  if (entries.length > 0) {
    const analyzer = deps.analyzer ?? defaultAnalyzer()
    const rules = await analyzer.analyze(entries, {
      signal,
      onProgress: (progress) =>
        emit({
          phase: 'rules',
          filesDone: progress.filesDone,
          filesTotal: progress.filesTotal,
          findings: progress.findings,
          detail: `Pattern rules: ${progress.filesDone} of ${progress.filesTotal} file(s) checked.`,
        }),
    })
    if (rules.cancelled || signal?.aborted) return cancelled()
    if (rules.error) return failed('error', rules.error, stats)
    analyses = rules.files
  }

  const tsEntries = entries.filter((entry) => isTsFamily(entry.language))
  const tsStatus = new Map<string, TypeScriptStatus>()
  if (tsEntries.length > 0) {
    const createClient = deps.createTsClient ?? createDefaultTsClient
    let client: TsSyntaxClient | null = null
    try {
      client = await createClient()
    } catch (error) {
      const reason = `The TypeScript syntax checker could not start (${describeStartError(error)}), so no syntax diagnostics ran.`
      for (const entry of tsEntries) tsStatus.set(entry.name, { ran: false, reason })
    }

    if (client) {
      try {
        for (let index = 0; index < tsEntries.length; index += 1) {
          if (signal?.aborted) return cancelled()
          const entry = tsEntries[index]
          emit({
            phase: 'typescript',
            filesDone: index,
            filesTotal: tsEntries.length,
            findings: countFindings(analyses),
            detail: `TypeScript syntax: checking ${entry.name}.`,
          })

          const check = await client.check({ name: entry.name, text: entry.text }, { signal })
          if (check.cancelled || signal?.aborted) return cancelled()
          if (check.timedOut) {
            tsStatus.set(entry.name, {
              ran: false,
              reason: `The syntax check did not finish within ${TS_FILE_TIMEOUT_MS} ms, so it was stopped for this file.`,
            })
            continue
          }
          if (check.error) {
            tsStatus.set(entry.name, { ran: false, reason: check.error })
            continue
          }

          tsStatus.set(entry.name, {
            ran: true,
            reason: 'TypeScript syntax diagnostics ran for this file; type checking was not run.',
          })
          mergeFindings(analyses, entry.name, check.findings)
        }
      } finally {
        client.dispose()
      }
      emit({
        phase: 'typescript',
        filesDone: tsEntries.length,
        filesTotal: tsEntries.length,
        findings: countFindings(analyses),
        detail: `TypeScript syntax: ${tsEntries.length} file(s) checked.`,
      })
    }
  }

  if (signal?.aborted) return cancelled()

  const coverage: FileCoverage[] = buildCoverage(entries, skipped, analyses, tsStatus)
  const report = buildReport({
    generatedAt: options.generatedAt ?? new Date(),
    archiveBytes: options.archiveBytes,
    entries,
    skipped,
    analyses,
    coverage,
  })

  return { status: 'completed', message: null, report, stats }
}

function countFindings(analyses: readonly FileAnalysis[]): number {
  let total = 0
  for (const analysis of analyses) total += analysis.findings.length
  return total
}

function mergeFindings(analyses: FileAnalysis[], file: string, findings: readonly AnalyzerFinding[]): void {
  if (findings.length === 0) return
  const analysis = analyses.find((item) => item.file === file)
  if (!analysis) {
    analyses.push({ file, findings: [...findings], notes: [], rulesRan: [], stoppedEarly: false })
    return
  }
  analysis.findings.push(...findings)
  analysis.findings.sort((left, right) => {
    if (left.range.startLine !== right.range.startLine) return left.range.startLine - right.range.startLine
    return (left.range.startColumn ?? 0) - (right.range.startColumn ?? 0)
  })
}
