import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './limits'
import { archiveReasonMessage, type ArchiveRefusalCode, type ArchiveSkipCode } from './reasons'
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
}

export interface ArchiveReadStats {
  /** Records actually read, never the count the archive declares. */
  walkedRecords: number
  /** Uncompressed bytes actually held after the read. */
  producedBytes: number
  entries: number
  skipped: number
  durationMs: number
  /** Largest number of bytes one entry accumulated before it was accepted or refused. */
  peakEntryBytes: number
}

export interface ArchiveReadResult {
  refusal: ArchiveRefusal | null
  entries: ArchiveEntry[]
  skipped: ArchiveSkippedEntry[]
  stats: ArchiveReadStats
  /**
   * Which container the bytes turned out to be, as decided from the signature. A reader that does
   * not look at containers at all (loose files) leaves it unset rather than claiming a format.
   */
  format?: ContainerFormat | null
  /** Set when the uploaded name and the contents disagree. It explains; it never blocks a read. */
  note?: string | null
}

export interface ReadOptions {
  limits?: ArchiveLimits
  signal?: AbortSignal
  onProgress?: (progress: ArchiveReadProgress) => void
  /** Read generated and vendored folders too. `.git` is skipped at every setting. */
  includeGenerated?: boolean
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

export function refuse(code: ArchiveRefusalCode, subject: string | number = '', extra?: string): never {
  throw new RefuseArchive(code, subject, extra)
}

export function skipEntry(code: ArchiveSkipCode): never {
  throw new SkipSingle(code)
}

export function toRefusal(error: unknown): ArchiveRefusal {
  if (error instanceof RefuseArchive) {
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
  return Date.now() - started >= limits.maxWallClockMs
}

export function wallClockSeconds(limits: ArchiveLimits): number {
  return Math.round(limits.maxWallClockMs / 1000)
}

export interface ReadRun {
  limits: ArchiveLimits
  stats: ArchiveReadStats
  signal?: AbortSignal
  started: number
  sliceStarted: number
  onProgress?: (progress: ArchiveReadProgress) => void
  includeGenerated: boolean
}

export function createRun(options: ReadOptions): ReadRun {
  const now = Date.now()
  return {
    limits: options.limits ?? DEFAULT_ARCHIVE_LIMITS,
    stats: { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 },
    signal: options.signal,
    started: now,
    sliceStarted: now,
    onProgress: options.onProgress,
    includeGenerated: options.includeGenerated === true,
  }
}

export function finishRun(run: ReadRun, refusal: ArchiveRefusal | null, entries: ArchiveEntry[], skipped: ArchiveSkippedEntry[]): ArchiveReadResult {
  run.stats.durationMs = Date.now() - run.started
  return {
    refusal,
    entries: refusal ? [] : entries,
    skipped: refusal ? [] : skipped,
    stats: run.stats,
  }
}

export async function breathe(run: ReadRun): Promise<void> {
  if (run.signal?.aborted) refuse('cancelled')
  if (isWallClockSpent(run.limits, run.started)) refuse('wall_clock_exceeded', wallClockSeconds(run.limits))
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
export function enforceChunkBounds(run: ReadRun, input: ChunkBoundsInput, totalProduced: number): void {
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
  if (totalProduced + next > limits.maxTotalUncompressedBytes) {
    refuse('total_uncompressed_exceeded', limits.maxTotalUncompressedBytes)
  }
}
