import type {
  ArchiveEntry,
  ArchivePartialStop,
  ArchiveReadProgress,
  ArchiveReadResult,
  ArchiveReadStats,
  ArchiveSkippedEntry,
} from '../archive/guard'
import { archiveReasonMessage } from '../archive/reasons'
import {
  DEFAULT_ARCHIVE_LIMITS,
  MAX_RETAINED_TEXT_BYTES,
  type ArchiveLimits,
} from '../archive/limits'
import type { IntakeSource, ReadLooseFilesOptions } from '../archive/readLooseFiles'
import { expandNotebooks, isNotebookCellName, isNotebookName, isNotebookOutputName } from '../archive/notebook'
import { createArchiveClient, type ArchiveClientReadOptions } from '../archive/workerClient'
import type { WorkerIntakeSource } from '../archive/workerProtocol'
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
import { splitGeneratedEntries } from './generated'
import { sensitiveFindings } from '../rules/sensitiveFiles'
import {
  buildReport,
  capStoredFindings,
  findingsTruncationNote,
  isTruncationNote,
  sortReportFindings,
  summarizeFindings,
} from './reportModel'
import { createDefaultTsClient, TS_FILE_TIMEOUT_MS, type TsSyntaxClient } from './typescript/tsClient'

export type SessionPhase = 'reading' | 'rules' | 'typescript' | 'engines'

export interface SessionProgress {
  phase: SessionPhase
  filesDone: number
  filesTotal: number
  findings: number
  detail: string
}

export type SessionStatus = 'completed' | 'partial' | 'cancelled' | 'refused' | 'error'

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
  /** Set when the result is a labelled partial read rather than a complete one. */
  partial?: ArchivePartialStop | null
}

export interface UploadArchiveInput {
  kind: 'archive'
  /**
   * The picked file. The zip reader seeks inside it, so the page never has to copy the whole
   * archive into memory before the worker starts.
   */
  file?: Blob
  /** Bytes already in memory, kept for tests and callers that hold them. */
  bytes?: Uint8Array
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
  /** Read generated and vendored files too. `.git` is skipped at every setting. */
  includeGenerated?: boolean
  /**
   * Names an earlier pass already analysed or decided to skip, for a continuation pass on the
   * same upload. The reader walks past them, so this pass spends its budget only on new files;
   * the page then merges the two results with `mergeSessionResults`.
   */
  resumeProcessedNames?: ReadonlySet<string>
}

export interface SessionDeps {
  readArchive?: (input: Uint8Array | Blob, options: ArchiveClientReadOptions) => Promise<ArchiveReadResult>
  readLoose?: (sources: readonly IntakeSource[], options: ReadLooseFilesOptions) => Promise<ArchiveReadResult>
  analyzer?: AnalyzerClient
  createTsClient?: () => Promise<TsSyntaxClient>
  createEngineClient?: () => Promise<EngineClient>
}

function defaultReadArchive(input: Uint8Array | Blob, options: ArchiveClientReadOptions): Promise<ArchiveReadResult> {
  const client = createArchiveClient(
    () => new Worker(new URL('../archive/worker.ts', import.meta.url), { type: 'module' }),
  )
  return client.read(input, options)
}

/**
 * The loose-file pass runs in the same worker as an archive read: a picked folder is decoded,
 * screened and language-detected off the main thread, with the page receiving the result in
 * batches. Pasted text has no handle, so its bytes are read here first — at most 1 MiB.
 */
async function defaultReadFiles(
  sources: readonly IntakeSource[],
  options: ReadLooseFilesOptions,
): Promise<ArchiveReadResult> {
  const client = createArchiveClient(
    () => new Worker(new URL('../archive/worker.ts', import.meta.url), { type: 'module' }),
  )
  const payloads: WorkerIntakeSource[] = []
  for (const source of sources) {
    if (source.file) {
      payloads.push({ path: source.path, size: source.size, file: source.file })
      continue
    }
    payloads.push({ path: source.path, size: source.size, bytes: await source.read() })
  }
  return client.readFiles(payloads, {
    limits: options.limits ?? DEFAULT_ARCHIVE_LIMITS,
    signal: options.signal,
    onProgress: options.onProgress,
    includeGenerated: options.includeGenerated === true,
    keepPartial: options.keepPartial === true,
    resumeProcessedNames: options.resumeProcessedNames,
  })
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

function formatDecodedBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KiB`
  const mebibytes = bytes / 1_048_576
  return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`
}

function readingProgress(progress: ArchiveReadProgress): SessionProgress {
  const planned = progress.phase === 'extract' ? progress.plannedEntries ?? 0 : 0
  return {
    phase: 'reading',
    filesDone: progress.extractedEntries,
    filesTotal: planned,
    findings: 0,
    detail:
      progress.phase === 'walk'
        ? `Checking archive entries: ${progress.walkedRecords} record(s) read.`
        : planned > 0
          ? `Extracting: ${progress.extractedEntries} of ${planned} file(s), ${formatDecodedBytes(progress.producedBytes)} decoded.`
          : `Extracting: ${progress.extractedEntries} file(s) read, ${formatDecodedBytes(progress.producedBytes)} decoded.`,
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
 * A deep pass that runs from text this tab still holds has no notebook output to look at: output is
 * dropped the moment it has been scanned, precisely because it is the part of a notebook that holds
 * whatever the kernel printed. Saying so is better than silently reporting fewer files.
 */
export const NOTEBOOK_OUTPUT_REPLAY_NOTE =
  'This pass reused notebook cells this tab still held; stored notebook output (which is never kept) was not scanned again.'

const NOTEBOOK_OUTPUT_MESSAGE = 'A credential-shaped value appears in this cell’s stored output.'

/**
 * A refusal, in the order the user needs it: first that the file was not what its name said, then
 * what BugPilot decided to do about it.
 */
function describeRefusal(read: ArchiveReadResult): string {
  const refusal = read.refusal
  if (!refusal) return ''
  return read.note ? `${read.note} ${refusal.message}` : refusal.message
}

const CANCELLED_BEFORE_ANALYSIS =
  'You cancelled before the pattern rules ran, so the files that had already been read are listed below as not analysed.'

/**
 * A cancel that lands while the reader is still working keeps the files it had read, but running
 * rules on an aborted signal would produce a half-filled report that looks complete. The honest
 * result lists those files as read-but-not-analysed and says why.
 */
function partialBeforeAnalysis(
  entries: readonly ArchiveEntry[],
  skipped: readonly ArchiveSkippedEntry[],
  stats: ArchiveReadStats,
  partial: ArchivePartialStop,
  options: AnalyzeUploadOptions,
  note: string | null,
): AnalysisSessionResult {
  const unanalysed: ArchiveSkippedEntry[] = entries.map((entry) => ({
    name: entry.name,
    code: 'not_reached',
    message: archiveReasonMessage('not_reached', entry.name, 'you cancelled before analysis started'),
  }))
  const allSkipped = [...skipped, ...unanalysed]
  const report = buildReport({
    generatedAt: options.generatedAt ?? new Date(),
    archiveBytes: options.archiveBytes,
    entries: [],
    skipped: allSkipped,
    analyses: [],
    coverage: buildCoverage([], allSkipped, []),
    extraLimitations: [...(note ? [note] : []), partial.message, CANCELLED_BEFORE_ANALYSIS],
    partial,
  })
  return {
    status: 'partial',
    message: partial.message,
    report,
    stats,
    sources: [],
    retention: 'findings',
    skipped: allSkipped,
    partial,
  }
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
    includeGenerated: options.includeGenerated === true,
    keepPartial: true,
    resumeProcessedNames: options.resumeProcessedNames,
    onProgress: (progress: ArchiveReadProgress) => emit(readingProgress(progress)),
  }

  if (signal?.aborted) return cancelled()

  let entries: readonly ArchiveEntry[]
  let skipped: readonly ArchiveSkippedEntry[]
  let stats: ArchiveReadStats
  let note: string | null = null
  let partial: ArchivePartialStop | null = null

  if (input.kind === 'pre-read') {
    entries = input.entries
    skipped = input.skipped
    stats = input.stats
  } else {
    let read: ArchiveReadResult
    try {
      if (input.kind === 'archive') {
        const payload = input.file ?? input.bytes
        if (!payload) return failed('error', 'The upload held no file to read.', null)
        read = await (deps.readArchive ?? defaultReadArchive)(payload, { ...readOptions, name: input.name ?? '' })
      } else {
        read = await (deps.readLoose ?? defaultReadFiles)(input.sources, readOptions)
      }
    } catch (error) {
      if (isStaleHandleError(error)) {
        return { status: 'error', message: STALE_HANDLE_MESSAGE, report: null, stats: null, handleStale: true }
      }
      return failed('error', describeStartError(error), null)
    }
    if (read.refusal) {
      if (read.refusal.code === 'cancelled') return cancelled()
      return failed('refused', describeRefusal(read), read.stats)
    }
    if (signal?.aborted && !read.partial) return cancelled()
    entries = read.entries
    skipped = input.kind === 'files' ? [...(input.notes ?? []), ...read.skipped] : read.skipped
    stats = read.stats
    note = read.note ?? null
    partial = read.partial ?? null
  }

  if (partial && signal?.aborted) return partialBeforeAnalysis(entries, skipped, stats, partial, options, note)

  // A continuation pass that reached no new file before its budget ran out is a real outcome,
  // not an error: sequential formats re-inflate everything before them on the way to new files.
  const resumedWithoutProgress =
    input.kind !== 'pre-read' && options.resumeProcessedNames !== undefined && entries.length === 0 && partial !== null

  // Sensitive names are judged before generated files are set aside: a credential file BugPilot
  // will not analyse is still worth reporting, and most of those rules need no content at all.
  // Holding the match here also means the finding is counted for a file that never reaches a rule.
  const sensitiveByFile = new Map<string, AnalyzerFinding[]>()
  const collectSensitive = (name: string, text: string | null): void => {
    const findings = sensitiveFindings({ name, text })
    if (findings.length === 0) return
    const existing = sensitiveByFile.get(name)
    if (existing) existing.push(...findings)
    else sensitiveByFile.set(name, findings)
  }
  for (const entry of entries) collectSensitive(entry.name, entry.text)
  for (const item of skipped) collectSensitive(item.name, null)

  // Generated and vendored files are set aside before anything is analysed. The override reads
  // them too, but `.git` is never read at any setting.
  const generated = splitGeneratedEntries(entries, options.includeGenerated === true)
  entries = generated.kept
  skipped = [...skipped, ...generated.skipped]

  // A notebook is one JSON document holding many small programs plus whatever a kernel printed.
  // It is split before anything is analysed, so each cell reaches the rules, the TypeScript check
  // and the deep engines as a file of its own; that is also what makes a deep pass reach Python cells.
  let notebookNote: string | null = null
  if (input.kind === 'pre-read' && entries.some((entry) => isNotebookCellName(entry.name))) {
    notebookNote = NOTEBOOK_OUTPUT_REPLAY_NOTE
  }
  const expanded = expandNotebooks(entries, options.limits ?? DEFAULT_ARCHIVE_LIMITS)
  entries = expanded.entries
  skipped = [...skipped, ...expanded.skipped]

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
    analyses = [...rules.files]
  }

  // Findings that came from a name rather than from analysis join the report even when their file
  // was skipped, and they are merged before the notebook redaction so the same policy applies.
  for (const [file, findings] of sensitiveByFile) mergeFindings(analyses, file, findings)
  analyses = analyses.map(redactNotebookAnalysis)

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
  const extraLimitations: string[] = [
    ...(note ? [note] : []),
    ...(notebookNote ? [notebookNote] : []),
    ...(partial ? [partial.message] : []),
    ...(resumedWithoutProgress ? [RESUME_NO_PROGRESS_MESSAGE] : []),
  ]

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
    partial,
  })

  const retained = retainedSources(entries, implicatedFiles(analyses), options.maxRetainedBytes ?? MAX_RETAINED_TEXT_BYTES)

  return {
    status: partial ? 'partial' : 'completed',
    message: resumedWithoutProgress ? RESUME_NO_PROGRESS_MESSAGE : partial ? partial.message : null,
    report,
    stats,
    sources: retained.sources,
    retention: retained.retention,
    skipped,
    partial,
  }
}

/**
 * What a continuation pass that reached no new file means for the user, and what to do about it.
 */
export const RESUME_NO_PROGRESS_MESSAGE =
  'This continuation pass reached no new files before its budget ran out. A sequential format such as .tar.gz ' +
  're-inflates the files an earlier pass already read on its way to new ones, which can spend a whole pass; ' +
  'continuing again may make no more progress, and a .zip upload continues without the re-read.'

export const CANCELLED_CONTINUATION_MESSAGE =
  'You cancelled the continuation pass. The report below still covers the files the earlier passes analysed.'

function implicatedFiles(analyses: readonly FileAnalysis[]): ReadonlySet<string> {
  const files = new Set<string>()
  for (const analysis of analyses) {
    for (const finding of analysis.findings) files.add(finding.file)
  }
  return files
}

function mergeStats(previous: ArchiveReadStats | null, next: ArchiveReadStats | null): ArchiveReadStats | null {
  if (!previous) return next
  if (!next) return previous
  return {
    walkedRecords: previous.walkedRecords + next.walkedRecords,
    producedBytes: previous.producedBytes + next.producedBytes,
    inflatedBytes: (previous.inflatedBytes ?? 0) + (next.inflatedBytes ?? 0),
    entries: previous.entries + next.entries,
    skipped: previous.skipped + next.skipped,
    durationMs: previous.durationMs + next.durationMs,
    peakEntryBytes: Math.max(previous.peakEntryBytes, next.peakEntryBytes),
  }
}

/**
 * The names a continuation pass should walk past: every file an earlier pass analysed, plus every
 * skip it decided (with a reason) rather than left unreached. Not-reached names are deliberately
 * absent — they are exactly the work the next pass exists to do.
 */
export function resumeNamesFrom(previous: AnalysisSessionResult): ReadonlySet<string> {
  const names = new Set<string>()
  for (const row of previous.report?.coverage ?? []) {
    if (row.status === 'analysed') names.add(row.file)
  }
  for (const item of previous.skipped ?? []) {
    if (item.code !== 'not_reached') names.add(item.name)
  }
  return names
}

/**
 * Lines that narrate THIS report's partial state. A continuation that completes the upload retires
 * them: the merged report is complete, and a stale "this is a partial result" sentence would
 * contradict it.
 */
function isPartialNarrative(line: string): boolean {
  return (
    line.includes('clearly marked as a partial result') ||
    line === RESUME_NO_PROGRESS_MESSAGE ||
    line === CANCELLED_BEFORE_ANALYSIS
  )
}

/**
 * One continuation pass on top of the result it continues. Findings and coverage are unioned by
 * id and file (re-running the same pass changes nothing), the summary is recomputed from the
 * union, and the partial marker describes the whole upload: both passes' plans and both passes'
 * bytes. A pass that produced no report of its own — cancelled, refused, or a handle the browser
 * would not open again — leaves the earlier report standing and explains itself in the message.
 */
export function mergeSessionResults(
  previous: AnalysisSessionResult,
  next: AnalysisSessionResult,
  maxRetainedBytes: number = MAX_RETAINED_TEXT_BYTES,
): AnalysisSessionResult {
  const previousReport = previous.report
  if (!previousReport) return next
  if (!next.report) {
    // The pass produced no report of its own (cancelled, refused, or a handle the browser would
    // not open again): the earlier report stands and the pass's message explains what happened.
    const message =
      next.message ?? (next.status === 'cancelled' ? CANCELLED_CONTINUATION_MESSAGE : previous.message)
    return {
      ...previous,
      status: next.status,
      message,
      stats: next.stats ?? previous.stats,
      partial: next.partial ?? previous.partial,
      handleStale: next.handleStale === true || previous.handleStale === true,
    }
  }
  const byId = new Map<string, AnalyzerFinding>()
  for (const finding of previousReport.findings) byId.set(finding.id, finding)
  for (const finding of next.report.findings) byId.set(finding.id, finding)
  const allFindings = sortReportFindings([...byId.values()])
  const summary = summarizeFindings(allFindings)
  const { findings, truncation } = capStoredFindings(allFindings)

  // Coverage keeps the earlier row for a file both passes saw, EXCEPT when the earlier pass left
  // it not reached and the continuation analysed it: the analysed row is the truthful one. A
  // completed continuation settled the whole tail, so rows for names it never reported (including
  // the sequential readers' "(rest of the archive)" marker) are retired — the union then matches
  // what one uninterrupted run would have reported.
  const settled = next.partial === null
  const nextCoverage = new Map<string, FileCoverage>()
  for (const row of next.report.coverage) nextCoverage.set(row.file, row)
  const coverageByName = new Map<string, FileCoverage>()
  for (const row of previousReport.coverage) {
    if (
      settled &&
      row.status === 'skipped' &&
      row.skipReason?.includes('was not reached') &&
      !nextCoverage.has(row.file)
    ) {
      continue
    }
    coverageByName.set(row.file, row)
  }
  for (const row of next.report.coverage) {
    const earlier = coverageByName.get(row.file)
    if (earlier && !(earlier.status === 'skipped' && row.status === 'analysed')) continue
    coverageByName.set(row.file, row)
  }
  const coverage = [...coverageByName.values()]

  const skippedByName = new Map<string, ArchiveSkippedEntry>()
  for (const item of previous.skipped ?? []) {
    if (settled && item.code === 'not_reached') continue
    skippedByName.set(item.name, item)
  }
  for (const item of next.skipped ?? []) skippedByName.set(item.name, item)
  const skipped = [...skippedByName.values()]

  const analysedCount = coverage.filter((row) => row.status === 'analysed').length
  const skippedCount = coverage.filter((row) => row.status === 'skipped').length

  // The union plan: a pass plans only the files it was offered, so the plan after a pass is the
  // files already analysed plus the plan of the pass itself. The larger of the two passes'
  // cumulative plans is the honest total, and a completed earlier pass planned nothing unreached.
  const analysedBefore = previousReport.session.analysedCount
  const previousPlanned = previous.partial?.plannedFiles ?? analysedBefore
  const nextPlanned = next.partial ? analysedBefore + next.partial.plannedFiles : analysedBefore
  const plannedFiles = Math.max(previousPlanned, nextPlanned)
  const partial = next.partial
    ? {
        ...next.partial,
        analysedFiles: analysedBefore + next.partial.analysedFiles,
        plannedFiles,
        unreachedFiles: Math.max(0, plannedFiles - (analysedBefore + next.partial.analysedFiles)),
        producedBytes: (previous.stats?.producedBytes ?? 0) + next.partial.producedBytes,
        plannedBytes:
          (previous.partial?.plannedBytes ?? previous.stats?.plannedBytes ?? 0) + next.partial.plannedBytes,
      }
    : null

  const report: AnalyzerReport = {
    ...next.report,
    session: {
      archiveBytes: next.report.session.archiveBytes,
      fileCount: coverage.length,
      analysedCount,
      skippedCount,
      skipped: skipped.map((item) => ({ file: item.name, reason: item.message })),
      ...(partial ? { partial: { ...partial } } : {}),
    },
    summary,
    findings,
    coverage,
    limitations: [
      ...new Set(
        [
          ...(settled ? previousReport.limitations.filter((line) => !isPartialNarrative(line)) : previousReport.limitations),
          ...next.report.limitations,
        ].filter((line) => !isTruncationNote(line)),
      ),
      ...(truncation ? [findingsTruncationNote(truncation)] : []),
    ],
    ...(truncation ? { truncated: truncation } : {}),
  }

  const retained = retainedSources(
    [...(previous.sources ?? []), ...(next.sources ?? [])],
    implicatedFilesFromFindings(report.findings),
    maxRetainedBytes,
  )

  return {
    status: partial ? 'partial' : 'completed',
    message: next.message,
    report,
    stats: mergeStats(previous.stats, next.stats),
    sources: retained.sources,
    retention: retained.retention,
    skipped,
    partial,
  }
}

function implicatedFilesFromFindings(findings: readonly AnalyzerFinding[]): ReadonlySet<string> {
  const files = new Set<string>()
  for (const finding of findings) files.add(finding.file)
  return files
}

/**
 * Stored notebook output is read for credentials and nothing else. Every other finding it produced
 * is dropped, and what survives loses its evidence: the text of an output is exactly the material
 * the user asked BugPilot never to show, export, re-read or keep, so a finding may name the cell
 * and the rule but must not quote a character of it.
 */
function redactNotebookOutput(analysis: FileAnalysis): FileAnalysis {
  const findings = analysis.findings
    .filter((finding) => finding.ruleId.startsWith('bugpilot/secret/'))
    .map((finding) => ({
      ...finding,
      evidence: [],
      fix: null,
      message: NOTEBOOK_OUTPUT_MESSAGE,
      explanation:
        'BugPilot scans stored notebook output for credentials only. The output text itself is never shown, exported, re-read or kept, so this finding names the cell and the rule and nothing more.',
      verificationSteps: [
        'Open the notebook and look at the stored output of this cell.',
        'If the value is real, rotate it, then clear the stored output and re-save the notebook.',
      ],
      limitations: ['The output text is not quoted because notebook output is never kept or displayed.'],
    }))
  return { ...analysis, findings }
}

/**
 * A notebook cell is a virtual file that does not exist on disk, so no edit BugPilot can render
 * would apply to it. Every proposal keeps its explanation but is downgraded to manual work.
 */
function manualOnlyNotebookCell(analysis: FileAnalysis): FileAnalysis {
  return {
    ...analysis,
    findings: analysis.findings.map((finding) =>
      finding.fix && finding.fix.riskClass !== 'manual-only'
        ? {
            ...finding,
            fix: {
              ...finding.fix,
              riskClass: 'manual-only',
              riskReason:
                'This code lives in a notebook cell, which BugPilot never edits; make the change in Jupyter and re-save the notebook.',
            },
          }
        : finding,
    ),
  }
}

const NOTEBOOK_SYNTAX_NOTE =
  'BugPilot read this notebook as JSON to report its syntax error. Notebooks are never edited or exported, so fix it in Jupyter and upload it again.'

/**
 * A notebook whose JSON does not parse is handed to the JSON syntax rule instead of being dropped.
 * Only that finding survives: the raw document mixes code and stored output, and nothing in it may
 * be quoted or turned into an edit.
 */
function reportNotebookJsonSyntax(analysis: FileAnalysis): FileAnalysis {
  return {
    ...analysis,
    findings: analysis.findings
      .filter((finding) => finding.ruleId === 'bugpilot/syntax/json')
      .map((finding) => ({ ...finding, evidence: [], fix: null })),
    notes: [...analysis.notes, NOTEBOOK_SYNTAX_NOTE],
  }
}

function redactNotebookAnalysis(analysis: FileAnalysis): FileAnalysis {
  if (isNotebookOutputName(analysis.file)) return redactNotebookOutput(analysis)
  if (isNotebookCellName(analysis.file)) return manualOnlyNotebookCell(analysis)
  if (isNotebookName(analysis.file)) return reportNotebookJsonSyntax(analysis)
  return analysis
}

/**
 * How much of the analysed text stays in memory for the fix review. Below the budget every file is
 * kept, so a deep pass can reuse what the first pass read; above it only the files a finding points
 * at are kept, because a 100 MiB folder held in full would cost more than the tab can spare.
 */
function retainedSources(
  entries: readonly ArchiveEntry[],
  implicatedFiles: ReadonlySet<string>,
  maxRetainedBytes: number,
): { sources: readonly ArchiveEntry[]; retention: Retention } {
  // Notebook output is never retained, whether or not it produced a finding: the credential that
  // was found there must not outlive the report in this tab's memory.
  const keepable = entries.some((entry) => isNotebookOutputName(entry.name))
    ? entries.filter((entry) => !isNotebookOutputName(entry.name))
    : entries
  let held = 0
  for (const entry of keepable) held += entry.bytes
  if (held <= maxRetainedBytes) return { sources: keepable, retention: 'all' }
  return { sources: keepable.filter((entry) => implicatedFiles.has(entry.name)), retention: 'findings' }
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
