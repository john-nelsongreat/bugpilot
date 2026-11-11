import {
  createRun,
  finishRun,
  isAbortError,
  refuse,
  toRefusal,
  validateName,
  type ArchiveEntry,
  type ArchiveReadResult,
  type ArchiveReadStats,
  type ArchiveRefusal,
  type ArchiveSkippedEntry,
  type ReadOptions,
} from './bounds'
import { archiveReasonMessage, type ArchiveRefusalCode, type ArchiveSkipCode } from './reasons'
import { detectFormat, type ContainerFormat } from './format'
import { detectLanguage } from './classify'
import { decodeBytes, looksBinary } from './decode'
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './limits'
import { readArchive, readArchiveSource } from './guard'
import { readTar } from './tar'
import { readGzipPayload } from './gzip'
import type { ByteSource } from './source'

/**
 * Which reader a set of bytes needs. The name is only ever a claim: it is compared with the
 * signature and reported when they disagree, and the reader is chosen from the bytes. A `.gz` is
 * opened exactly one layer, because what comes out of it is either a tar, a plain file, or an
 * archive that stays rejected.
 */

export interface ContainerReadResult extends ArchiveReadResult {
  /** The container the bytes turned out to be, or null when BugPilot will not open it. */
  format: ContainerFormat | null
  /** Set when the name and the contents disagree. Never blocks a read. */
  note: string | null
  /** Bytes after the outermost layer: the archive or text the reader actually walked. */
  payloadBytes: number
}

const GZIP_SUFFIX = /\.(gz|tgz)$/i

/** The same bounded windows the memory reader scans, so a source and its bytes agree. */
const HEAD_SAMPLE_BYTES = 65_536
const TAIL_SAMPLE_BYTES = 65_535 + 22

/** `notes.txt.gz` becomes `notes.txt`; a name that claims no gzip is left alone. */
export function gzipBaseName(name: string): string {
  const match = GZIP_SUFFIX.exec(name)
  return match ? name.slice(0, match.index) : name
}

/**
 * What comes out of a gzip stream is bounded by the total ceiling, not by the ceiling for an
 * archive handed over on its own, so the inner reader gets that number instead of double-bound.
 */
function innerLimits(limits: ArchiveLimits): ArchiveLimits {
  // The inner tar is already decompressed, so its byte ceiling is the work budget rather than
  // the compressed-upload ceiling that bounded the gzip stream itself.
  return {
    ...limits,
    maxArchiveBytes: limits.maxTotalUncompressedBytes,
    maxTarArchiveBytes: limits.maxTotalUncompressedBytes,
  }
}

function refusalFor(code: ArchiveRefusalCode, subject: string): ArchiveRefusal {
  return { code, message: archiveReasonMessage(code, subject) }
}

/**
 * A refusal hands back nothing: not the entries, not the skipped list and not a byte count that
 * would suggest something was kept. The timing is kept because it was really measured.
 */
function withNoRetention(refusal: ArchiveRefusal, stats: ArchiveReadStats): ArchiveReadResult {
  return { refusal, entries: [], skipped: [], stats: { ...stats, producedBytes: 0, entries: 0, skipped: 0 } }
}

/** One file that is not a container: the smallest result the rest of the pipeline expects. */
async function readSingle(bytes: Uint8Array, name: string, options: ReadOptions): Promise<ArchiveReadResult> {
  const run = createRun(options)
  const entries: ArchiveEntry[] = []
  const skipped: ArchiveSkippedEntry[] = []
  try {
    if (run.signal?.aborted) refuse('cancelled')
    if (bytes.length > run.limits.maxTotalUncompressedBytes) {
      refuse('total_uncompressed_exceeded', run.limits.maxTotalUncompressedBytes)
    }
    validateName(name)
    run.stats.walkedRecords = 1
    if (bytes.length === 0) {
      skipped.push({ name, code: 'empty_entry', message: archiveReasonMessage('empty_entry', name) })
    } else if (bytes.length > run.limits.maxSingleFileUncompressedBytes) {
      skipped.push({ name, code: 'single_file_too_large', message: archiveReasonMessage('single_file_too_large', name) })
    } else if (looksBinary(bytes)) {
      skipped.push({ name, code: 'binary_content', message: archiveReasonMessage('binary_content', name) })
    } else {
      const decoded = decodeBytes(bytes)
      const detection = detectLanguage(name, decoded.text)
      entries.push({
        name,
        text: decoded.text,
        language: detection.language,
        languageSource: detection.source,
        encoding: decoded.encoding,
        bytes: bytes.length,
      })
      run.stats.entries = entries.length
      run.stats.producedBytes = bytes.length
      run.stats.peakEntryBytes = bytes.length
    }
    run.stats.skipped = skipped.length
  } catch (error) {
    return finishRun(run, toRefusal(error), entries, skipped)
  }
  return finishRun(run, null, entries, skipped)
}

export async function readContainer(
  bytes: Uint8Array,
  name: string,
  options: ReadOptions = {},
): Promise<ContainerReadResult> {
  const limits = options.limits ?? DEFAULT_ARCHIVE_LIMITS
  const detection = detectFormat(bytes, name)
  const note = detection.note

  if (detection.format === null) {
    const code = detection.refusalCode ?? 'unsupported_format'
    return { ...withNoRetention(refusalFor(code, detection.refusalSubject), createRun(options).stats), format: null, note, payloadBytes: 0 }
  }
  if (detection.format === 'zip') {
    const result = await readArchive(bytes, options)
    return { ...result, format: 'zip', note: result.note ?? note, payloadBytes: bytes.length }
  }
  if (detection.format === 'tar') {
    return { ...(await readTar(bytes, options)), format: 'tar', note, payloadBytes: bytes.length }
  }
  if (detection.format === 'text') {
    return { ...(await readSingle(bytes, name, options)), format: 'text', note, payloadBytes: bytes.length }
  }

  const inflated = await readGzipPayload(bytes, { ...options, sourceName: name })
  if (inflated.refusal) {
    return { ...withNoRetention(inflated.refusal, inflated.stats), format: 'gzip', note, payloadBytes: 0 }
  }
  if (inflated.partial) {
    // Nothing inside an unfinished stream was analysed; the partial marker says so and the
    // coverage table names the file whose contents were not reached.
    return {
      refusal: null,
      entries: [],
      skipped: inflated.skipped ?? [],
      stats: inflated.stats,
      partial: inflated.partial,
      format: 'gzip',
      note,
      payloadBytes: 0,
    }
  }

  const innerName = gzipBaseName(name)
  const payload = inflated.payload
  const inner = detectFormat(payload, innerName)
  if (inner.format === 'tar') {
    const result = await readTar(payload, { ...options, limits: innerLimits(limits) })
    result.stats.durationMs += inflated.stats.durationMs
    return { ...result, format: 'gzip', note, payloadBytes: result.refusal ? 0 : payload.length }
  }
  if (inner.format === 'text') {
    const result = await readSingle(payload, innerName, options)
    result.stats.durationMs += inflated.stats.durationMs
    return { ...result, format: 'gzip', note, payloadBytes: result.refusal ? 0 : payload.length }
  }
  // A zip, another gzip, or a format BugPilot refuses outright: an archive never opens an archive,
  // and nothing is decoded from a family the browser has no decoder for.
  if (inner.format === null) {
    const code = inner.refusalCode ?? 'unsupported_format'
    return { ...withNoRetention(refusalFor(code, inner.refusalSubject), inflated.stats), format: 'gzip', note, payloadBytes: 0 }
  }
  // The inner zip or gzip is skipped with a reason instead of costing the upload: the inflate work
  // stays in the stats, and nothing from inside the inner archive is read or kept.
  return {
    refusal: null,
    entries: [],
    skipped: [{ name: innerName, code: 'nested_archive' as const, message: archiveReasonMessage('nested_archive', innerName) }],
    stats: { ...inflated.stats, entries: 0, skipped: 1 },
    format: 'gzip',
    note,
    payloadBytes: 0,
  }
}

/**
 * Format detection over a file that is never fully in memory: the same head and tail windows the
 * byte reader scans, joined into one bounded sample. A zip is then opened by the random-access
 * reader; tar and gzip stay sequential, so they are loaded once their own ceiling allows it.
 */
async function detectSourceFormat(source: ByteSource, name: string, signal?: AbortSignal) {
  const head = await source.read(0, Math.min(source.size, HEAD_SAMPLE_BYTES), signal)
  if (source.size <= head.length) return detectFormat(head, name)
  const tail = await source.read(Math.max(0, source.size - TAIL_SAMPLE_BYTES), source.size, signal)
  const sample = new Uint8Array(head.length + tail.length)
  sample.set(head, 0)
  sample.set(tail, head.length)
  return detectFormat(sample, name)
}

/** One oversized text file, reported without reading a byte of it. */
function skippedSingle(name: string, code: ArchiveSkipCode, options: ReadOptions): ArchiveReadResult {
  const run = createRun(options)
  const skipped: ArchiveSkippedEntry[] = []
  try {
    if (run.signal?.aborted) refuse('cancelled')
    validateName(name)
    run.stats.walkedRecords = 1
    skipped.push({ name, code, message: archiveReasonMessage(code, name) })
    run.stats.skipped = 1
  } catch (error) {
    return finishRun(run, toRefusal(error), [], [])
  }
  return finishRun(run, null, [], skipped)
}

export async function readContainerSource(
  source: ByteSource,
  name: string,
  options: ReadOptions = {},
): Promise<ContainerReadResult> {
  const limits = options.limits ?? DEFAULT_ARCHIVE_LIMITS
  let detection: Awaited<ReturnType<typeof detectSourceFormat>>
  try {
    detection = await detectSourceFormat(source, name, options.signal)
  } catch (error) {
    if (options.signal?.aborted) {
      return {
        ...withNoRetention(refusalFor('cancelled', ''), createRun(options).stats),
        format: null,
        note: null,
        payloadBytes: 0,
      }
    }
    throw error
  }
  const note = detection.note

  if (detection.format === null) {
    const code = detection.refusalCode ?? 'unsupported_format'
    return {
      ...withNoRetention(refusalFor(code, detection.refusalSubject), createRun(options).stats),
      format: null,
      note,
      payloadBytes: 0,
    }
  }
  if (detection.format === 'zip') {
    const result = await readArchiveSource(source, options)
    return { ...result, format: 'zip', note: result.note ?? note, payloadBytes: source.size }
  }
  // The whole-file read is where a cancel lands for the sequential formats; a source that throws
  // `AbortError` is the same stop as one that sees the signal on its next check.
  const readWhole = async (): Promise<Uint8Array | null> => {
    try {
      return await source.read(0, source.size, options.signal)
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) return null
      throw error
    }
  }
  const cancelledResult = (format: ContainerFormat | null): ContainerReadResult => ({
    ...withNoRetention(refusalFor('cancelled', ''), createRun(options).stats),
    format,
    note,
    payloadBytes: 0,
  })

  if (detection.format === 'text') {
    if (source.size > limits.maxSingleFileUncompressedBytes) {
      return { ...skippedSingle(name, 'single_file_too_large', options), format: 'text', note, payloadBytes: 0 }
    }
    const bytes = await readWhole()
    if (!bytes) return cancelledResult('text')
    return { ...(await readSingle(bytes, name, options)), format: 'text', note, payloadBytes: source.size }
  }

  const ceiling = Math.min(limits.maxArchiveBytes, limits.maxTarArchiveBytes)
  if (source.size > ceiling) {
    return {
      ...withNoRetention(refusalFor('archive_too_large', String(source.size)), createRun(options).stats),
      format: detection.format,
      note,
      payloadBytes: 0,
    }
  }
  const bytes = await readWhole()
  if (!bytes) return cancelledResult(detection.format)
  const result = await readContainer(bytes, name, options)
  return {
    ...result,
    format: result.format ?? detection.format,
    note: result.note ?? note,
    payloadBytes: result.payloadBytes,
  }
}
