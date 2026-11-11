import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './limits'
import { archiveReasonMessage, partialReasonMessage, type ArchiveRefusalCode, type ArchiveSkipCode } from './reasons'
import { relativePathRefusal } from './paths'
import type { LanguageSource, SourceLanguage } from './classify'
import type { TextEncoding } from './decode'
import type { ContainerFormat } from './format'

export type { LanguageSource, SourceLanguage } from './classify'
export type { TextEncoding } from './decode'

/**
 * The rules every container reader shares: how a refusal is raised, how a single entry is
 * skipped, how much work may happen between awaits, and which byte ceilings a produced chunk
 * has to clear. Extracted from the zip reader so the tar and gzip readers enforce the same
 * numbers from the same code — two copies of a cap are two chances to disagree about it.
 */

export interface ArchiveRefusal {
  code: ArchiveRefusalCode
  message: string
}

export interface ArchiveEntry {
  name: string
  text: string
  language: SourceLanguage
  languageSource: LanguageSource
  encoding: TextEncoding
  bytes: number
}

export interface ArchiveSkippedEntry {
  name: string
  code: ArchiveSkipCode
  message: string
}

export interface ArchiveReadProgress {
  phase: 'walk' | 'extract'
  walkedRecords: number
  extractedEntries: number
  producedBytes: number
  /** How many analysable entries the index planned, and how many bytes they declared. */
  plannedEntries?: number
  plannedBytes?: number
}

export interface ArchiveReadStats {
  /** Records actually read, never the count the archive declares. */
  walkedRecords: number
  /** Uncompressed bytes actually held after the read. */
  producedBytes: number
  /** Every byte produced from a compressed stream, including entries later skipped as binary. */
  inflatedBytes?: number
  /** Analysable entries the index planned before extraction, including cap-stopped ones. */
  plannedEntries?: number
  plannedBytes?: number
  entries: number
  skipped: number
  durationMs: number
  /** Largest number of bytes one entry accumulated before it was accepted or refused. */
  peakEntryBytes: number
}

/**
 * A read that stopped early but kept what it had. The report built from it must say partial:
 * `plannedFiles > analysedFiles` and every unreached file appears in `skipped` with `not_reached`.
 */
export interface ArchivePartialStop {
  code: ArchiveRefusalCode
  message: string
  analysedFiles: number
  plannedFiles: number
  unreachedFiles: number
  producedBytes: number
  plannedBytes: number
}

export interface ArchiveReadResult {
  refusal: ArchiveRefusal | null
  entries: ArchiveEntry[]
  skipped: ArchiveSkippedEntry[]
  stats: ArchiveReadStats
  /** Set only when the consumer asked to keep partial results and the read stopped early. */
  partial?: ArchivePartialStop | null
  /**
   * Which container the bytes turned out to be, as decided from the signature. A reader that does
   * not look at containers at all (loose files) leaves it unset rather than claiming a format.
   */
  format?: ContainerFormat | null
  /**
   * An explanation for the whole read: the uploaded name disagreed with the contents, or nothing
   * could be analysed even though the read succeeded (for example, every entry was encrypted). It
   * explains; it never blocks a read.
   */
  note?: string | null
}

export interface ReadOptions {
  limits?: ArchiveLimits
  signal?: AbortSignal
  onProgress?: (progress: ArchiveReadProgress) => void
  /** Read generated and vendored folders too. `.git` is skipped at every setting. */
  includeGenerated?: boolean
  /**
   * Keep the entries read before a wall-clock, work-budget or cancel stop and return them with
   * a `partial` marker instead of refusing with nothing. Default is all-or-nothing.
   */
  keepPartial?: boolean
  /**
   * Names an earlier pass already analysed or decided to skip. Entries on this list are walked
   * past without being read, so a continuation pass spends its budget only on new files. Names
   * the earlier pass never reached are deliberately absent: they are this pass's work.
   */
  resumeProcessedNames?: ReadonlySet<string>
}

export class RefuseArchive extends Error {
  readonly code: ArchiveRefusalCode
  readonly subject: string | number
  readonly extra?: string

  constructor(code: ArchiveRefusalCode, subject: string | number = '', extra?: string) {
    super(code)
    this.code = code
    this.subject = subject
    this.extra = extra
  }
}

export class SkipSingle extends Error {
  readonly code: ArchiveSkipCode

  constructor(code: ArchiveSkipCode) {
    super(code)
    this.code = code
  }
}

/** Stops a read that is allowed to keep what it already produced. Never leaves this module. */
export class PartialStop extends Error {
  readonly code: ArchiveRefusalCode
  readonly subject: string | number
  readonly extra?: string

  constructor(code: ArchiveRefusalCode, subject: string | number = '', extra?: string) {
    super(code)
    this.code = code
    this.subject = subject
    this.extra = extra
  }
}

export function refuse(code: ArchiveRefusalCode, subject: string | number = '', extra?: string): never {
  throw new RefuseArchive(code, subject, extra)
}

export function skipEntry(code: ArchiveSkipCode): never {
  throw new SkipSingle(code)
}

/** A source read that lost its race with the cancel button, before the next `breathe` could see it. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

export function toRefusal(error: unknown): ArchiveRefusal {
  if (error instanceof RefuseArchive) {
    return { code: error.code, message: archiveReasonMessage(error.code, error.subject, error.extra) }
  }
  if (error instanceof PartialStop) {
    return { code: error.code, message: archiveReasonMessage(error.code, error.subject, error.extra) }
  }
  return { code: 'worker_error', message: archiveReasonMessage('worker_error') }
}

/**
 * Names come from an untrusted archive, so every path decision is made on the decoded string
 * before any byte of that entry is unpacked.
 */
export function validateName(name: string): void {
  const code = relativePathRefusal(name)
  if (code) refuse(code)
}

/** Work the loops may do between awaits; long enough that 2 000 records stay fast. */
const SLICE_MS = 12

/** Whether the read has used up its wall clock. Readers that cannot throw ask this directly. */
export function isWallClockSpent(limits: ArchiveLimits, started: number): boolean {
  return Date.now() - started >= limits.maxChunkWallClockMs
}

export function wallClockSeconds(limits: ArchiveLimits): number {
  return Math.round(limits.maxChunkWallClockMs / 1000)
}

export interface ReadRun {
  limits: ArchiveLimits
  stats: ArchiveReadStats
  signal?: AbortSignal
  started: number
  sliceStarted: number
  onProgress?: (progress: ArchiveReadProgress) => void
  includeGenerated: boolean
  keepPartial: boolean
  resumeProcessedNames: ReadonlySet<string> | null
}

export function createRun(options: ReadOptions): ReadRun {
  const now = Date.now()
  return {
    limits: options.limits ?? DEFAULT_ARCHIVE_LIMITS,
    stats: {
      walkedRecords: 0,
      producedBytes: 0,
      inflatedBytes: 0,
      plannedEntries: 0,
      plannedBytes: 0,
      entries: 0,
      skipped: 0,
      durationMs: 0,
      peakEntryBytes: 0,
    },
    signal: options.signal,
    started: now,
    sliceStarted: now,
    onProgress: options.onProgress,
    includeGenerated: options.includeGenerated === true,
    keepPartial: options.keepPartial === true,
    resumeProcessedNames: options.resumeProcessedNames ?? null,
  }
}

export function finishRun(run: ReadRun, refusal: ArchiveRefusal | null, entries: ArchiveEntry[], skipped: ArchiveSkippedEntry[]): ArchiveReadResult {
  run.stats.durationMs = Date.now() - run.started
  return {
    refusal,
    entries: refusal ? [] : entries,
    skipped: refusal ? [] : skipped,
    stats: run.stats,
    partial: null,
  }
}

export async function breathe(run: ReadRun): Promise<void> {
  if (run.signal?.aborted) {
    if (run.keepPartial) throw new PartialStop('cancelled')
    refuse('cancelled')
  }
  if (isWallClockSpent(run.limits, run.started)) {
    if (run.keepPartial) throw new PartialStop('wall_clock_exceeded', wallClockSeconds(run.limits))
    refuse('wall_clock_exceeded', wallClockSeconds(run.limits))
  }
  if (Date.now() - run.sliceStarted < SLICE_MS) return
  await new Promise((resolve) => setTimeout(resolve, 0))
  run.sliceStarted = Date.now()
}

export function reportProgress(run: ReadRun, phase: 'walk' | 'extract'): void {
  run.onProgress?.({
    phase,
    walkedRecords: run.stats.walkedRecords,
    extractedEntries: run.stats.entries,
    producedBytes: run.stats.producedBytes,
    plannedEntries: run.stats.plannedEntries,
    plannedBytes: run.stats.plannedBytes,
  })
}

export interface ChunkBoundsInput {
  /** Bytes accumulated for this entry before the chunk. */
  produced: number
  chunkLength: number
  /** The size the entry declared, or null when the container does not declare one. */
  declaredSize: number | null
  /** Compressed bytes behind the entry, or null when the entry is not compressed. */
  compressedSize: number | null
}

/**
 * The four ceilings a produced chunk has to clear, in the order the zip reader has always used
 * them: expansion ratio, then the header's own lie, then the per-file cap, then the total. The
 * totals are compared against the bytes already held, so an archive that is mostly skipped still
 * cannot smuggle a bomb through the last entry.
 */
export function enforceChunkBounds(run: ReadRun, input: ChunkBoundsInput): void {
  const { limits } = run
  const next = input.produced + input.chunkLength
  // The high-water mark is recorded before the ceilings run, so a refusal still reports the bytes
  // that were really accumulated instead of claiming nothing happened.
  run.stats.peakEntryBytes = Math.max(run.stats.peakEntryBytes, next)
  if (input.compressedSize !== null && next > limits.maxActualRatio * input.compressedSize) {
    refuse('actual_ratio_exceeded')
  }
  if (input.declaredSize !== null && next > input.declaredSize) refuse('declared_size_understated')
  if (next > limits.maxSingleFileUncompressedBytes) skipEntry('single_file_too_large')
  spendWorkBudget(run, input.chunkLength)
}

/**
 * The decompression work budget counts every produced byte, including bytes of an entry that is
 * later skipped as binary. Counting only kept text would let an archive full of binary entries
 * spend unbounded CPU while reporting zero retention.
 */
export function spendWorkBudget(run: ReadRun, bytes: number): void {
  const spent = (run.stats.inflatedBytes ?? 0) + bytes
  run.stats.inflatedBytes = spent
  if (spent > run.limits.maxTotalUncompressedBytes) {
    if (run.keepPartial) throw new PartialStop('total_uncompressed_exceeded', run.limits.maxTotalUncompressedBytes)
    refuse('total_uncompressed_exceeded', run.limits.maxTotalUncompressedBytes)
  }
}

/** The stops a read may keep its partial result for. */
export type PartialStopCode =
  | 'cancelled'
  | 'wall_clock_exceeded'
  | 'total_uncompressed_exceeded'
  | 'entry_count_exceeded'

/** Why the rest of a container was not reached, in words that fit inside a coverage row. */
export function partialStopPhrase(code: string): string {
  if (code === 'cancelled') return 'you cancelled the upload'
  if (code === 'wall_clock_exceeded') return 'the wall clock ran out'
  if (code === 'entry_count_exceeded') return 'the analysed-entry cap for one pass was reached'
  return 'the unpacking work budget ran out'
}

export function notReachedEntry(name: string, code: string, phrase = partialStopPhrase(code)): ArchiveSkippedEntry {
  return { name, code: 'not_reached', message: archiveReasonMessage('not_reached', name, phrase) }
}

/**
 * The one shape of a kept partial read. Callers set `plannedEntries` and `plannedBytes` on the
 * stats before calling; a reader that cannot know the plan marks the unreached remainder as one
 * named placeholder instead of guessing a file count.
 */
export function partialReadResult(
  stats: ArchiveReadStats,
  code: PartialStopCode,
  subject: string | number,
  entries: ArchiveEntry[],
  skipped: ArchiveSkippedEntry[],
): ArchiveReadResult {
  stats.entries = entries.length
  stats.skipped = skipped.length
  const planned = Math.max(stats.plannedEntries ?? entries.length, entries.length)
  return {
    refusal: null,
    entries,
    skipped,
    stats,
    partial: {
      code,
      message: partialReasonMessage(code, subject),
      analysedFiles: entries.length,
      plannedFiles: planned,
      unreachedFiles: Math.max(0, planned - entries.length),
      producedBytes: stats.producedBytes,
      plannedBytes: stats.plannedBytes ?? 0,
    },
  }
}
