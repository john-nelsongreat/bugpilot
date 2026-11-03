import type { ArchiveEntry, ArchiveReadProgress, ArchiveReadResult, ArchiveReadStats } from '../archive/guard'
import { DEFAULT_ARCHIVE_LIMITS } from '../archive/limits'
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
  /**
   * Deep engines download several megabytes, so they only run when the page has shown the
   * plan and the user agreed. `'off'` keeps the slice A behaviour exactly.
   */
  engines?: 'off' | 'approved'
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

  const engineFiles = entries.filter((entry) => hasDeepEngine(entry.language))
  const engineStatus = new Map<string, EngineStatus>()
  const extraLimitations: string[] = []

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

  return { status: 'completed', message: null, report, stats, sources: entries }
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
