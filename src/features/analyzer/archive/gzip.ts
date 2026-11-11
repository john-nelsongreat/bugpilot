import { Gunzip } from 'fflate'
import {
  PartialStop,
  RefuseArchive,
  SkipSingle,
  breathe,
  createRun,
  enforceChunkBounds,
  notReachedEntry,
  partialReadResult,
  refuse,
  reportProgress,
  toRefusal,
  type ArchivePartialStop,
  type ArchiveRefusal,
  type ArchiveReadStats,
  type ArchiveSkippedEntry,
  type PartialStopCode,
  type ReadOptions,
  type ReadRun,
} from './bounds'
import { crc32, crc32Finish } from './crc32'

/**
 * The gzip reader. fflate does the deflate work; everything that decides whether the stream may be
 * trusted is decided here, because fflate's streaming decoder does not verify the trailer: a wrong
 * CRC and a wrong length both pass silently. So the header fields are bounded before use, the
 * trailer is checked against the bytes that were really produced, and the byte ceilings are the
 * same shared ones the zip and tar readers use.
 */

const HEADER_BYTES = 10
const TRAILER_BYTES = 8
/** A stream cannot be shorter than an empty header plus a trailer. */
const MIN_STREAM_BYTES = HEADER_BYTES + TRAILER_BYTES
const GZIP_SECOND_BYTE = 0x8b
const METHOD_DEFLATE = 8
const FLAG_FHCRC = 0x02
const FLAG_FEXTRA = 0x04
const FLAG_FNAME = 0x08
const FLAG_FCOMMENT = 0x10
const FLAG_RESERVED = 0xe0
/** `ISIZE` is the uncompressed length modulo 2^32. */
const ISIZE_MODULO = 0x1_0000_0000

export interface GzipReadOptions extends ReadOptions {
  /** The uploaded file's own name, used only to make a refusal readable. */
  sourceName?: string
}

export interface GzipPayloadResult {
  refusal: ArchiveRefusal | null
  /** The decompressed bytes, or nothing at all when the stream was refused or stopped early. */
  payload: Uint8Array
  stats: ArchiveReadStats
  /** Set when a budget or the clock stopped the decompression and the caller asked to keep it. */
  partial?: ArchivePartialStop | null
  skipped?: ArchiveSkippedEntry[]
}

const NO_PAYLOAD = new Uint8Array(0)

function readLittleEndian(view: DataView, offset: number): number {
  return view.getUint32(offset, true) >>> 0
}

/**
 * The gzip header is fixed for ten bytes and then carries optional fields, each of which has to be
 * bounded against the file that is really there before the offset moves past it. fflate parses this
 * header too, so the check is not there to find the data — it is there because nothing the header
 * claims (a name, a comment, an extra field) may be trusted or followed past the end of the file,
 * and a malformed header must be refused before a single byte is inflated.
 */
function checkGzipHeader(bytes: Uint8Array): void {
  if (bytes.length < MIN_STREAM_BYTES) {
    refuse('corrupt_gzip_stream', '', 'it is shorter than a gzip header and its trailer')
  }
  if (bytes[0] !== 0x1f || bytes[1] !== GZIP_SECOND_BYTE) {
    refuse('corrupt_gzip_stream', '', 'it does not start with the gzip signature')
  }
  if (bytes[2] !== METHOD_DEFLATE) {
    refuse('corrupt_gzip_stream', '', `its compression method is ${bytes[2]}, not deflate`)
  }
  const flags = bytes[3]
  if (flags & FLAG_RESERVED) refuse('corrupt_gzip_stream', '', 'its header has reserved bits set')

  let at = HEADER_BYTES
  if (flags & FLAG_FEXTRA) {
    if (at + 2 > bytes.length) refuse('corrupt_gzip_stream', '', 'its extra field is cut off')
    const span = bytes[at] + (bytes[at + 1] << 8)
    // The length is two bytes of untrusted data: bound it before the offset uses it.
    if (at + 2 + span > bytes.length) refuse('corrupt_gzip_stream', '', 'its extra field runs past the end of the file')
    at += 2 + span
  }
  const skipTerminated = (from: number, field: string): number => {
    let cursor = from
    while (cursor < bytes.length && bytes[cursor] !== 0) cursor += 1
    if (cursor >= bytes.length) refuse('corrupt_gzip_stream', '', `its ${field} is not terminated`)
    return cursor + 1
  }
  // The stored file name and comment are ignored on purpose: an archive cannot name what it
  // contains, so only the uploaded name is ever shown or analysed.
  if (flags & FLAG_FNAME) at = skipTerminated(at, 'file name')
  if (flags & FLAG_FCOMMENT) at = skipTerminated(at, 'comment')
  if (flags & FLAG_FHCRC) at += 2
  if (at + TRAILER_BYTES > bytes.length) {
    refuse('corrupt_gzip_stream', '', 'its header leaves no room for the compressed data')
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function finish(run: ReadRun, refusal: ArchiveRefusal | null, payload: Uint8Array): GzipPayloadResult {
  run.stats.durationMs = Date.now() - run.started
  if (refusal) {
    // Nothing is kept when the stream is refused, so the reported retention is honestly zero.
    run.stats.producedBytes = 0
    run.stats.entries = 0
    return { refusal, payload: NO_PAYLOAD, stats: run.stats }
  }
  return { refusal: null, payload, stats: run.stats }
}

export async function readGzipPayload(bytes: Uint8Array, options: GzipReadOptions = {}): Promise<GzipPayloadResult> {
  const baseLimits = options.limits
  // What comes out of a gzip stream is a container rather than one file, so the per-file ceiling
  // does not apply to it — but the total ceiling still does, through the same shared bounds.
  const run = createRun(
    baseLimits
      ? { ...options, limits: { ...baseLimits, maxSingleFileUncompressedBytes: baseLimits.maxTotalUncompressedBytes } }
      : options,
  )
  const sourceName = options.sourceName ?? 'this file'

  try {
    if (run.signal?.aborted) refuse('cancelled')
    const ceiling = Math.min(run.limits.maxArchiveBytes, run.limits.maxTarArchiveBytes)
    if (bytes.length > ceiling) refuse('archive_too_large', bytes.length)
    checkGzipHeader(bytes)

    const chunks: Uint8Array[] = []
    let produced = 0
    let crc = 0xffffffff
    let members = 0
    const gunzip = new Gunzip((chunk) => {
      if (chunk.length === 0) return
      // The whole file is the compressed side of the ratio, because a gzip stream is one member.
      // Nothing precedes it, so the bytes already held are the ones being added to right now.
      enforceChunkBounds(run, { produced, chunkLength: chunk.length, declaredSize: null, compressedSize: bytes.length })
      produced += chunk.length
      crc = crc32(chunk, crc)
      chunks.push(chunk)
      run.stats.producedBytes = produced
    })
    gunzip.onmember = () => {
      members += 1
    }
    run.stats.walkedRecords = 1

    // Handed over whole, header and trailer included, because that is the stream the decoder owns.
    // A second member only shows up once the bytes after the first trailer reach it.
    for (let cursor = 0; cursor < bytes.length; cursor += run.limits.inflateChunkBytes) {
      const slice = bytes.subarray(cursor, Math.min(cursor + run.limits.inflateChunkBytes, bytes.length))
      const last = cursor + run.limits.inflateChunkBytes >= bytes.length
      try {
        gunzip.push(slice, last)
      } catch (error) {
        if (error instanceof RefuseArchive || error instanceof PartialStop) throw error
        // The bounds only ever raise a skip for a ceiling a produced chunk crossed, and a gzip
        // stream is not an entry that can be dropped: the whole read stops instead, so a skip
        // can never surface as an unexplained worker error.
        if (error instanceof SkipSingle) {
          if (run.keepPartial) throw new PartialStop('total_uncompressed_exceeded', run.limits.maxTotalUncompressedBytes)
          refuse('total_uncompressed_exceeded', run.limits.maxTotalUncompressedBytes)
        }
        refuse('corrupt_gzip_stream', '', 'the compressed data could not be read')
      }
      if (members > 0) refuse('multi_member_gzip')
      // The gzip layer walks one stream rather than producing entries, so it reports the phase
      // the inner reader will not overwrite.
      reportProgress(run, 'walk')
      await breathe(run)
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const storedSize = readLittleEndian(view, bytes.length - 4)
    if (storedSize !== produced % ISIZE_MODULO) {
      refuse('corrupt_gzip_stream', '', `its stored length is ${storedSize} but ${produced} bytes were produced`)
    }
    const storedCrc = readLittleEndian(view, bytes.length - TRAILER_BYTES)
    if (crc32Finish(crc) !== storedCrc) refuse('gzip_crc_mismatch', sourceName)

    return finish(run, null, concat(chunks, produced))
  } catch (error) {
    if (error instanceof PartialStop) {
      // A truncated deflate stream is never handed to the inner reader: its trailer and CRC were
      // never reached, so no file inside it can be trusted or even named. The stop itself is kept
      // and reported as one unreached file rather than as a refusal that claims nothing happened.
      const skipped = [notReachedEntry(sourceName, error.code)]
      run.stats.plannedEntries = 1
      run.stats.plannedBytes = run.stats.producedBytes
      run.stats.durationMs = Date.now() - run.started
      const result = partialReadResult(run.stats, error.code as PartialStopCode, error.subject, [], skipped)
      return { refusal: null, payload: NO_PAYLOAD, stats: run.stats, partial: result.partial ?? null, skipped }
    }
    return finish(run, toRefusal(error), NO_PAYLOAD)
  }
}
