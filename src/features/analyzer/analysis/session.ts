import type {
  ArchiveEntry,
  ArchiveReadProgress,
  ArchiveReadResult,
  ArchiveReadStats,
  ArchiveSkippedEntry,
} from '../archive/guard'
import {
  DEFAULT_ARCHIVE_LIMITS,
  MAX_RETAINED_TEXT_BYTES,
  type ArchiveLimits,
} from '../archive/limits'
import { readLooseFiles, type IntakeSource, type ReadLooseFilesOptions } from '../archive/readLooseFiles'
import { createArchiveClient, type ArchiveClientReadOptions } from '../archive/workerClient'
import { ENGINES_UNAVAILABLE_MESSAGE } from '../engines/featureProbe'
import type { EngineClient, EngineRunOutcome } from '../engines/engineClient'
import type { EngineHit, EngineParseStatus } from '../engines/protocol'
import { AST_SUPERSEDES } from '../engines/supersede'
import { hasDeepEngine, isTsFamily } from '../languages'
import type { AnalyzerFinding, AnalyzerReport, FileCoverage } from '../types'
import type { AnalyzerClient } from './analyzerClient'
import { createAnalyzerClient } from './analyzerClient'
import { buildCoverage, ENGINES_NOT_RUN_REASON, type EngineStatus, type TypeScriptStatus } from './coverage'
import type { FileAnalysis } from './engine'
import { makeFinding } from './finding'
import { buildReport } from './reportModel'
import { createDefaultTsClient, TS_FILE_TIMEOUT_MS, type TsSyntaxClient } from './typescript/tsClient'

export type SessionPhase = 'reading' | 'rules' | 'typescript' | 'engines'

export interface SessionProgress {
  phase: SessionPhase
  filesDone: number
  filesTotal: number
  findings: number
  detail: string
}

export type SessionStatus = 'completed' | 'cancelled' | 'refused' | 'error'

/** `'all'` keeps every analysed file; `'findings'` keeps only the files a finding points at. */
export type Retention = 'all' | 'findings'

export interface AnalysisSessionResult {
  status: SessionStatus
  message: string | null
  report: AnalyzerReport | null
  /** Archive reader counters; kept for the coverage panel even when a refusal stopped the run. */
  stats: ArchiveReadStats | null
  /**
   * In-memory copy of the analysed text so the fix review can build edits after the run.
   * It lives only in this result object: nothing is written to storage, and the page
   * replaces the result on Clear or route change so the strings become collectable.
   */
  sources?: readonly ArchiveEntry[]
  /**
   * Which of the two retention rules produced `sources`. The page needs it to know whether the
   * text it is holding can stand in for the upload when a browser handle goes stale.
   */
  retention?: Retention
  /** Entries the reader set aside, kept beside `sources` so a re-run can rebuild the same coverage. */
  skipped?: readonly ArchiveSkippedEntry[]
  /**
   * Set when the read stopped because the browser would not re-open a file this tab picked earlier.
   * The page reads it to decide whether the pass can continue on text it still holds instead of
   * ending in a dead end the user cannot act on.
   */
  handleStale?: boolean
}

export interface UploadArchiveInput {
  kind: 'archive'
  bytes: Uint8Array
  /**
   * The name the file was picked or dropped under. The reader decides the format from the bytes and
   * uses the name only to tell the user when the two disagree.
   */
  name?: string
}

export interface UploadFilesInput {
  kind: 'files'
  sources: readonly IntakeSource[]
  /**
   * Uploads the intake layer left out before anything was read. They are reported as skipped files
   * so the coverage table accounts for the whole selection, and they are never handed to a reader.
   */
  notes?: readonly ArchiveSkippedEntry[]
}

/**
 * Text this tab already read. Used when a second pass cannot re-open the original handle (the
 * browser reports `NotReadableError` once a file is moved, deleted or its tab is restored), so the
 * deep pass can still run on exactly the bytes the first pass saw rather than failing outright.
 */
export interface UploadPreReadInput {
  kind: 'pre-read'
  entries: readonly ArchiveEntry[]
  skipped: readonly ArchiveSkippedEntry[]
  stats: ArchiveReadStats
}

export type UploadInput = UploadArchiveInput | UploadFilesInput | UploadPreReadInput

export interface AnalyzeUploadOptions {
  /** Bytes handed to the reader; used for the report header. */
  archiveBytes: number
  signal?: AbortSignal
  onProgress?: (progress: SessionProgress) => void
  generatedAt?: Date
  /**
   * Deep engines download several megabytes, so they only run when the page has shown the
   * plan and the user agreed. `'off'` keeps the slice A behaviour exactly.
   */
  engines?: 'off' | 'approved'
  /** Ceilings for this machine; the page passes the device-scaled set. */
  limits?: ArchiveLimits
  /** How much analysed text may stay in memory for the fix review. */
  maxRetainedBytes?: number
}

export interface SessionDeps {
  readArchive?: (bytes: Uint8Array, options: ArchiveClientReadOptions) => Promise<ArchiveReadResult>
  readLoose?: (sources: readonly IntakeSource[], options: ReadLooseFilesOptions) => Promise<ArchiveReadResult>
  analyzer?: AnalyzerClient
  createTsClient?: () => Promise<TsSyntaxClient>
  createEngineClient?: () => Promise<EngineClient>
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

/**
 * The engine worker is the only script loaded from `assets/engines/`, which is the only
 * place the CSP allows WebAssembly. Importing the client lazily keeps the engine glue out
 * of the page chunk until a run actually asks for it.
 */
async function loadDefaultEngineClient(): Promise<EngineClient> {
  const module = await import('../engines/engineClient')
  return module.createEngineClient(
    () => new Worker(new URL('../engines/engineWorkerEntry.ts', import.meta.url), { type: 'module' }),
  )
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
 * A handle the browser will not open again. `DOMException` does not extend `Error` everywhere, so
 * the name is the only reliable signal that a file was moved or deleted after it was picked.
 */
export function isStaleHandleError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { name?: unknown }).name === 'NotReadableError'
}

/** What a stale handle means for the user, and what they can do about it. */
export const STALE_HANDLE_MESSAGE =
  'The browser would not re-open a file from this upload — it was probably moved or deleted after you picked it. ' +
  'Nothing new was read and nothing was kept. Choose the same folder or archive again.'

/**
 * A refusal, in the order the user needs it: first that the file was not what its name said, then
 * what BugPilot decided to do about it.
 */
function describeRefusal(read: ArchiveReadResult): string {
  const refusal = read.refusal
  if (!refusal) return ''
  return read.note ? `${read.note} ${refusal.message}` : refusal.message
}

/**
 * Reads the upload, runs the pattern rules in the analyzer worker, then the optional TypeScript
 * syntax check, and returns a report. The analysed text is returned only as in-memory sources
 * so the fix review can compute edits; nothing is stored and Clear drops the whole result.
 */
export async function analyzeUpload(
  input: UploadInput,
  options: AnalyzeUploadOptions,
  deps: SessionDeps = {},
): Promise<AnalysisSessionResult> {
  const signal = options.signal
  const emit = (progress: SessionProgress): void => options.onProgress?.(progress)
  const readOptions = {
    limits: options.limits ?? DEFAULT_ARCHIVE_LIMITS,
    signal,
    onProgress: (progress: ArchiveReadProgress) => emit(readingProgress(progress)),
  }

  if (signal?.aborted) return cancelled()

  let entries: readonly ArchiveEntry[]
  let skipped: readonly ArchiveSkippedEntry[]
  let stats: ArchiveReadStats
  let note: string | null = null

  if (input.kind === 'pre-read') {
    entries = input.entries
    skipped = input.skipped
    stats = input.stats
  } else {
    let read: ArchiveReadResult
    try {
      read =
        input.kind === 'archive'
          ? await (deps.readArchive ?? defaultReadArchive)(input.bytes, { ...readOptions, name: input.name ?? '' })
          : await (deps.readLoose ?? readLooseFiles)(input.sources, readOptions)
    } catch (error) {
      if (isStaleHandleError(error)) {
        return { status: 'error', message: STALE_HANDLE_MESSAGE, report: null, stats: null, handleStale: true }
      }
      return failed('error', describeStartError(error), null)
    }
    if (signal?.aborted) return cancelled()
    if (read.refusal) {
      if (read.refusal.code === 'cancelled') return cancelled()
      return failed('refused', describeRefusal(read), read.stats)
    }
    entries = read.entries
    skipped = input.kind === 'files' ? [...(input.notes ?? []), ...read.skipped] : read.skipped
    stats = read.stats
    note = read.note ?? null
  }

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

  const engineFiles = entries.filter((entry) => hasDeepEngine(entry.language))
  const engineStatus = new Map<string, EngineStatus>()
  // The reader's note travels into the report so the result page states, in its own words, that
  // the file was not the format its name claimed.
  const extraLimitations: string[] = note ? [note] : []

  if (engineFiles.length > 0 && options.engines === 'approved') {
    const createClient = deps.createEngineClient ?? loadDefaultEngineClient
    let client: EngineClient | null = null
    try {
      client = await createClient()
    } catch (error) {
      const reason = `The deep-engine worker could not start (${describeStartError(error)}).`
      for (const entry of engineFiles) {
        engineStatus.set(entry.name, { enginesRan: [], parse: 'engine-unavailable', reason, notes: [] })
      }
    }

    if (client) {
      emit({
        phase: 'engines',
        filesDone: 0,
        filesTotal: engineFiles.length,
        findings: countFindings(analyses),
        detail: 'Deep engines: probing WebAssembly support.',
      })
      const outcome = await client.run(engineFiles, {
        signal,
        onProgress: (done, total, currentFile) =>
          emit({
            phase: 'engines',
            filesDone: done,
            filesTotal: total,
            findings: countFindings(analyses),
            detail: `Deep engines: checking ${currentFile}.`,
          }),
      })
      applyEngineOutcome(outcome, analyses, engineStatus)
      if (outcome.cancelled) return cancelled()
      if (outcome.error) extraLimitations.push(`The deep engines stopped early: ${outcome.error}`)
      if (outcome.unavailable) extraLimitations.push(ENGINES_UNAVAILABLE_MESSAGE)
      // A blocked browser has already been described by the sentence above; blaming its time
      // budget would be a second, untrue reason for the same missing coverage.
      if (outcome.filesNotRun.length > 0 && !outcome.unavailable) {
        extraLimitations.push(
          `${outcome.filesNotRun.length} file(s) were not reached by the deep engines because the time budget ran out.`,
        )
      }
    }
  } else if (engineFiles.length > 0) {
    for (const entry of engineFiles) {
      engineStatus.set(entry.name, {
        enginesRan: [],
        parse: 'not-attempted',
        reason: ENGINES_NOT_RUN_REASON,
        notes: [],
      })
    }
  }

  const coverage: FileCoverage[] = buildCoverage(entries, skipped, analyses, tsStatus, engineStatus)
  const report = buildReport({
    generatedAt: options.generatedAt ?? new Date(),
    archiveBytes: options.archiveBytes,
    entries,
    skipped,
    analyses,
    coverage,
    extraLimitations,
  })

  const retained = retainedSources(entries, analyses, options.maxRetainedBytes ?? MAX_RETAINED_TEXT_BYTES)

  return {
    status: 'completed',
    message: null,
    report,
    stats,
    sources: retained.sources,
    retention: retained.retention,
    skipped,
  }
}

/**
 * How much of the analysed text stays in memory for the fix review. Below the budget every file is
 * kept, so a deep pass can reuse what the first pass read; above it only the files a finding points
 * at are kept, because a 100 MiB folder held in full would cost more than the tab can spare.
 */
function retainedSources(
  entries: readonly ArchiveEntry[],
  analyses: readonly FileAnalysis[],
  maxRetainedBytes: number,
): { sources: readonly ArchiveEntry[]; retention: Retention } {
  let held = 0
  for (const entry of entries) held += entry.bytes
  if (held <= maxRetainedBytes) return { sources: entries, retention: 'all' }

  const implicated = new Set<string>()
  for (const analysis of analyses) {
    for (const finding of analysis.findings) implicated.add(finding.file)
  }
  return { sources: entries.filter((entry) => implicated.has(entry.name)), retention: 'findings' }
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

function engineFindingFromHit(file: string, hit: EngineHit): AnalyzerFinding {
  return makeFinding({
    ruleId: hit.ruleId,
    analyzer: hit.engine,
    tier: hit.tier,
    severity: hit.severity,
    confidence: hit.confidence,
    file,
    range: hit.range,
    evidence: hit.evidence,
    message: hit.message,
    explanation: hit.explanation,
    fix: hit.fix,
    verificationSteps: hit.verificationSteps,
    limitations: hit.limitations,
  })
}

/** One honest coverage sentence per parse status; the panel shows it instead of guessing. */
function engineReason(status: EngineParseStatus, enginesRan: readonly string[]): string {
  if (status === 'parsed') {
    const ran = enginesRan.length > 0 ? enginesRan.join(' and ') : 'no engine'
    return `The deep engines ran (${ran}). The grammar only reports nodes it could not match; no compiler or type checker ran.`
  }
  if (status === 'no-grammar') return 'No grammar is bundled for this language, so the deep engines skipped it.'
  if (status === 'grammar-did-not-understand') {
    return 'The grammar could not make sense of this file as a whole, so BugPilot recorded missing coverage instead of syntax findings.'
  }
  if (status === 'engine-stopped-early') {
    return 'The engine time budget stopped before this file was fully checked.'
  }
  if (status === 'engine-unavailable') {
    return 'The engine binary for this language could not be loaded, so only the built-in rules checked it.'
  }
  return ENGINES_NOT_RUN_REASON
}

/**
 * Engine hits become findings, and a regex rule that the syntax tree confirms on the same
 * line is dropped: the tree-sitter empty-handler result replaces the pattern match rather
 * than doubling it up.
 */
function applyEngineOutcome(
  outcome: EngineRunOutcome,
  analyses: FileAnalysis[],
  engineStatus: Map<string, EngineStatus>,
): void {
  for (const result of outcome.files) {
    const findings = result.hits.map((hit) => engineFindingFromHit(result.file, hit))
    mergeFindings(analyses, result.file, findings)

    const analysis = analyses.find((item) => item.file === result.file)
    if (analysis) {
      const supersededLines = new Map<string, Set<number>>()
      for (const hit of result.hits) {
        const replaced = AST_SUPERSEDES[hit.ruleId]
        if (!replaced) continue
        const lines = supersededLines.get(replaced) ?? new Set<number>()
        lines.add(hit.range.startLine)
        supersededLines.set(replaced, lines)
      }
      if (supersededLines.size > 0) {
        const before = analysis.findings.length
        analysis.findings = analysis.findings.filter(
          (finding) => !supersededLines.get(finding.ruleId)?.has(finding.range.startLine),
        )
        const dropped = before - analysis.findings.length
        if (dropped > 0) {
          analysis.notes.push(
            `${dropped} pattern match(es) on this file were replaced by the syntax-tree result for the same line.`,
          )
        }
      }
    }

    engineStatus.set(result.file, {
      enginesRan: result.enginesRan,
      parse: result.parse,
      reason: engineReason(result.parse, result.enginesRan),
      notes: result.notes,
    })
  }

  for (const name of outcome.filesNotRun) {
    engineStatus.set(name, {
      enginesRan: [],
      parse: 'engine-stopped-early',
      reason:
        outcome.unavailable !== null
          ? 'WebAssembly was refused by this browser or its security policy, so no deep engine ran on this file.'
          : 'The time budget for the deep engines ran out before this file was reached.',
      notes: [],
    })
  }
}
