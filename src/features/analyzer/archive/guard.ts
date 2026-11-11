import { Inflate } from 'fflate'
import {
  PartialStop,
  RefuseArchive,
  SkipSingle,
  breathe,
  createRun,
  enforceChunkBounds,
  finishRun,
  isAbortError,
  notReachedEntry,
  partialReadResult,
  refuse,
  reportProgress,
  skipEntry,
  spendWorkBudget,
  toRefusal,
  validateName,
  type ArchiveEntry,
  type ArchiveReadResult,
  type ArchiveRefusal,
  type ArchiveSkippedEntry,
  type PartialStopCode,
  type ReadOptions,
  type ReadRun,
} from './bounds'
import { crc32, crc32Finish } from './crc32'
import { detectLanguage } from './classify'
import { decodeBytes, looksBinary } from './decode'
import { archiveReasonMessage, type ArchiveSkipCode } from './reasons'
import { hasBinaryExtension, isIgnoredPath, isNestedArchive, isOsMetadataFile, normalizeEntryName } from './paths'
import { createMemorySource, type ByteSource } from './source'

export { DEFAULT_ARCHIVE_LIMITS } from './limits'
export { createBlobSource, createMemorySource } from './source'
export type { ArchiveLimits } from './limits'
export type { ByteSource } from './source'
export type {
  ArchiveEntry,
  ArchivePartialStop,
  ArchiveReadProgress,
  ArchiveReadResult,
  ArchiveReadStats,
  ArchiveRefusal,
  ArchiveSkippedEntry,
  LanguageSource,
  SourceLanguage,
  TextEncoding,
} from './bounds'

const SIG_LOCAL_HEADER = 0x04034b50
const SIG_CENTRAL_HEADER = 0x02014b50
const SIG_END_OF_CENTRAL = 0x06054b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_DATA_DESCRIPTOR = 0x08074b50
const END_OF_CENTRAL_MIN_SIZE = 22
const END_OF_CENTRAL_SCAN_WINDOW = 65_535 + END_OF_CENTRAL_MIN_SIZE
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const ZIP64_LOCATOR_SIZE = 20
const ZIP64_EOCD_MIN_SIZE = 56
/** A descriptor is 12 or 20 bytes, plus the optional 4-byte signature it may start with. */
const DATA_DESCRIPTOR_MAX_BYTES = 24
/** The 32-bit fields a zip64 archive marks as "the real number is in the extra field". */
const UINT32_MAX = 0xffffffff
const UINT16_MAX = 0xffff
const EXTRA_ZIP64 = 0x0001
const EXTRA_UNICODE_PATH = 0x7855

const FLAG_ENCRYPTED = 0x0001
const FLAG_DATA_DESCRIPTOR = 0x0008
const FLAG_NAME_IS_UTF8 = 0x0800
const UNIX_FILE_TYPE_MASK = 0xf000
const UNIX_SYMBOLIC_LINK = 0xa000
const UNIX_DIRECTORY = 0x4000
const DOS_DIRECTORY_BIT = 0x0010
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** Deflate can make a file slightly bigger; anything past this is not a 2 MiB text file. */
const COMPRESSED_OVERHEAD_BYTES = 65_536

function unixFileType(externalAttrs: number): number {
  return (externalAttrs >>> 16) & UNIX_FILE_TYPE_MASK
}

function isSymbolicLink(externalAttrs: number): boolean {
  return unixFileType(externalAttrs) === UNIX_SYMBOLIC_LINK
}

function isDirectoryEntry(externalAttrs: number): boolean {
  return unixFileType(externalAttrs) === UNIX_DIRECTORY || (externalAttrs & DOS_DIRECTORY_BIT) === DOS_DIRECTORY_BIT
}

function rejectNullBytes(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) refuse('null_byte_in_name', asciiPrefix(bytes))
  }
}

function decodeEntryName(bytes: Uint8Array, flags: number): string {
  rejectNullBytes(bytes)
  if (flags & FLAG_NAME_IS_UTF8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      refuse('corrupt_central_directory')
    }
  }
  return new TextDecoder('iso-8859-1').decode(bytes)
}

/**
 * Decode a name that is UTF-8 where the header's own bytes are not. Info-ZIP stores a CP437
 * rendering of the name in the two headers and the real spelling in a `0x7855` field, guarded by
 * the checksum of the bytes it replaces. A field whose checksum does not match is ignored rather
 * than trusted: the header bytes it claims to describe are the ones the offsets were built from.
 */
function unicodePathName(body: Uint8Array | null, nameBytes: Uint8Array): string | null {
  if (body === null || body.length < 5) return null
  if (viewOf(body).getUint32(0, true) !== crc32Finish(crc32(nameBytes))) return null
  rejectNullBytes(nameBytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(4))
  } catch {
    return null
  }
}

function asciiPrefix(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < Math.min(bytes.length, 32); i += 1) {
    out += bytes[i] === 0 ? '\\0' : String.fromCharCode(bytes[i])
  }
  return out
}

function messageName(bytes: Uint8Array, flags: number): string {
  try {
    return decodeEntryName(bytes, flags)
  } catch {
    return '(unreadable name)'
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
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

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

interface CentralRecord {
  name: string
  nameBytes: Uint8Array
  flags: number
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  externalAttrs: number
  localHeaderOffset: number
  /** The volume the entry's local header starts on; a nonzero value is a split archive. */
  startDisk: number
  /** General-purpose bit 3: this entry's crc and sizes also live in a data descriptor. */
  dataDescriptor: boolean
  /** The sizes or the offset came from a zip64 extra field. */
  zip64: boolean
  /** General-purpose bit 0: the entry cannot be read without a password. */
  encrypted: boolean
  /** The external attributes mark the entry as a symbolic link. */
  symlink: boolean
}

interface PlannedEntry {
  record: CentralRecord
  dataStart: number
  dataEnd: number
  /** `dataEnd` plus the data descriptor, so the alias check sees every byte the entry owns. */
  rangeEnd: number
}

/**
 * The end record is found by scanning back only the window a comment can occupy. A file that was
 * transferred badly, mailed with a footer or produced by a streaming writer can carry bytes past
 * the comment, so a record whose comment does not reach the end of the file is accepted when no
 * exact fit exists. Both passes take the rightmost record they can, which is the one a writer
 * appended last.
 */
function findEndOfCentralDirectory(tail: Uint8Array): number {
  const view = viewOf(tail)
  let trailing = -1
  for (let pos = tail.length - END_OF_CENTRAL_MIN_SIZE; pos >= 0; pos -= 1) {
    if (view.getUint32(pos, true) !== SIG_END_OF_CENTRAL) continue
    const commentLength = view.getUint16(pos + 20, true)
    if (pos + END_OF_CENTRAL_MIN_SIZE + commentLength === tail.length) return pos
    if (trailing < 0 && pos + END_OF_CENTRAL_MIN_SIZE + commentLength < tail.length) trailing = pos
  }
  return trailing
}

/** A zip64 eight-byte field, refused rather than wrapped when no JS integer can hold it. */
function readU64(view: DataView, at: number, subject: string): number {
  if (at + 8 > view.byteLength) refuse('corrupt_central_directory', subject)
  const wide = view.getBigUint64(at, true)
  if (wide > BigInt(Number.MAX_SAFE_INTEGER)) refuse('corrupt_central_directory', subject)
  return Number(wide)
}

/**
 * Resolve the zip64 extra field (0x0001). The specification stores only the fields whose 32-bit
 * copy was the all-ones marker, in the order uncompressed size, compressed size, header offset,
 * disk number — but writers that always emit the full set exist too, and a 24 or 28 byte body is
 * that shape. Both readings are decided from the body length before anything is read, so a value
 * is never taken from the wrong slot. A marker neither reading resolves is a size the reader can
 * only guess, so it costs the archive rather than the truth of every later byte range.
 */
function applyZip64Extra(record: CentralRecord, body: Uint8Array): void {
  const view = viewOf(body)
  const dense = view.byteLength === 24 || view.byteLength === 28
  let at = 0
  const sizeAt = (where: number): number => readU64(view, where, record.name)
  const diskAt = (where: number): number => {
    if (where + 4 > view.byteLength) refuse('corrupt_central_directory', record.name)
    return view.getUint32(where, true)
  }
  if (record.uncompressedSize === UINT32_MAX) {
    record.uncompressedSize = sizeAt(dense ? 0 : at)
    if (!dense) at += 8
  }
  if (record.compressedSize === UINT32_MAX) {
    record.compressedSize = sizeAt(dense ? 8 : at)
    if (!dense) at += 8
  }
  if (record.localHeaderOffset === UINT32_MAX) {
    record.localHeaderOffset = sizeAt(dense ? 16 : at)
    if (!dense) at += 8
  }
  if (record.startDisk === UINT16_MAX) {
    record.startDisk = diskAt(dense ? 24 : at)
    if (!dense) at += 4
  }
  record.zip64 = true
  if (
    record.uncompressedSize === UINT32_MAX ||
    record.compressedSize === UINT32_MAX ||
    record.localHeaderOffset === UINT32_MAX ||
    record.startDisk === UINT16_MAX
  ) {
    refuse('corrupt_central_directory', record.name)
  }
}

/** Walk one entry's extra fields, which is where zip64 hides its real numbers. */
function applyExtraFields(record: CentralRecord, extra: Uint8Array): Uint8Array | null {
  let zip64Body: Uint8Array | null = null
  let unicodeBody: Uint8Array | null = null
  let cursor = 0
  while (cursor + 4 <= extra.length) {
    const head = viewOf(extra.subarray(cursor, cursor + 4))
    const headerId = head.getUint16(0, true)
    const size = head.getUint16(2, true)
    if (cursor + 4 + size > extra.length) refuse('corrupt_central_directory', record.name)
    if (headerId === EXTRA_ZIP64 && zip64Body === null) zip64Body = extra.subarray(cursor + 4, cursor + 4 + size)
    if (headerId === EXTRA_UNICODE_PATH && unicodeBody === null) {
      unicodeBody = size >= 4 ? extra.subarray(cursor + 4, cursor + 4 + size) : null
    }
    cursor += 4 + size
  }
  if (zip64Body === null) {
    if (
      record.uncompressedSize === UINT32_MAX ||
      record.compressedSize === UINT32_MAX ||
      record.localHeaderOffset === UINT32_MAX ||
      record.startDisk === UINT16_MAX
    ) {
      refuse('corrupt_central_directory', record.name)
    }
    return unicodeBody
  }
  applyZip64Extra(record, zip64Body)
  return unicodeBody
}

/**
 * The zip64 end record, reached through the twenty-byte locator that sits in front of the
 * ordinary one. Returns null when no locator is there, which is the archive everyone expects.
 * Every number here decides where the index is read from, so each is bounded before it is used.
 */
async function readZip64EndRecord(
  source: ByteSource,
  tail: Uint8Array,
  tailStart: number,
  eocd: number,
  signal?: AbortSignal,
): Promise<{ centralSize: number; centralOffset: number } | null> {
  const locatorStart = eocd - ZIP64_LOCATOR_SIZE
  if (locatorStart < 0) return null
  const locatorRel = locatorStart - tailStart
  const locator = locatorRel >= 0 && locatorRel + ZIP64_LOCATOR_SIZE <= tail.length
    ? tail.subarray(locatorRel, locatorRel + ZIP64_LOCATOR_SIZE)
    : await source.read(locatorStart, eocd, signal)
  const head = viewOf(locator)
  if (head.getUint32(0, true) !== SIG_ZIP64_LOCATOR) return null
  // A locator or a record that names a second volume describes a split archive. BugPilot reads
  // one file and says so plainly rather than guessing which volume it was given.
  if (head.getUint32(4, true) !== 0 || head.getUint32(16, true) !== 1) refuse('multi_disk_not_supported')
  const recordStart = readU64(head, 8, '')
  if (recordStart + ZIP64_EOCD_MIN_SIZE > locatorStart) refuse('corrupt_central_directory')
  const record = viewOf(await source.read(recordStart, recordStart + ZIP64_EOCD_MIN_SIZE, signal))
  if (record.getUint32(0, true) !== SIG_ZIP64_EOCD) refuse('corrupt_central_directory')
  const recordSize = readU64(record, 4, '')
  if (recordSize < ZIP64_EOCD_MIN_SIZE - 12) refuse('corrupt_central_directory')
  if (recordStart + 12 + recordSize > locatorStart) refuse('corrupt_central_directory')
  if (record.getUint32(16, true) !== 0 || record.getUint32(20, true) !== 0) refuse('multi_disk_not_supported')
  return { centralSize: readU64(record, 40, ''), centralOffset: readU64(record, 48, '') }
}

async function walkCentralDirectory(
  source: ByteSource,
  centralOffset: number,
  centralSize: number,
  run: ReadRun,
): Promise<CentralRecord[]> {
  if (centralSize > run.limits.maxCentralDirectoryBytes) {
    refuse('central_directory_too_large', centralSize)
  }
  const bytes = await source.read(centralOffset, centralOffset + centralSize, run.signal)
  const view = viewOf(bytes)
  const records: CentralRecord[] = []
  let pos = 0
  while (pos < bytes.length) {
    if (pos + CENTRAL_HEADER_SIZE > bytes.length) refuse('corrupt_central_directory')
    if (view.getUint32(pos, true) !== SIG_CENTRAL_HEADER) refuse('corrupt_central_directory')
    // The cap is measured on records actually walked, never on the declared total.
    run.stats.walkedRecords += 1
    if (run.stats.walkedRecords > run.limits.maxParsedEntryCount) {
      refuse('entry_count_exceeded', run.limits.maxParsedEntryCount)
    }

    const flags = view.getUint16(pos + 8, true)
    const method = view.getUint16(pos + 10, true)
    const crc = view.getUint32(pos + 16, true)
    const compressedSize = view.getUint32(pos + 20, true)
    const uncompressedSize = view.getUint32(pos + 24, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const startDisk = view.getUint16(pos + 34, true)
    const externalAttrs = view.getUint32(pos + 38, true)
    const localHeaderOffset = view.getUint32(pos + 42, true)
    const recordEnd = pos + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
    if (recordEnd > bytes.length) refuse('corrupt_central_directory')

    const record: CentralRecord = {
      name: '',
      nameBytes: bytes.subarray(pos + CENTRAL_HEADER_SIZE, pos + CENTRAL_HEADER_SIZE + nameLength),
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      externalAttrs,
      localHeaderOffset,
      startDisk,
      dataDescriptor: (flags & FLAG_DATA_DESCRIPTOR) !== 0,
      zip64: false,
      encrypted: (flags & FLAG_ENCRYPTED) !== 0,
      symlink: isSymbolicLink(externalAttrs),
    }
    // Zip64 replaces the all-ones markers in this record's own extra field, so the real sizes and
    // offset are settled before anything is judged from them.
    const unicodeBody = applyExtraFields(
      record,
      bytes.subarray(pos + CENTRAL_HEADER_SIZE + nameLength, pos + CENTRAL_HEADER_SIZE + nameLength + extraLength),
    )

    // A foreign volume is diagnosed before the name is judged, so a hostile name cannot hide the
    // more serious property. Encryption and symlinks are recorded here and skipped per entry
    // below; both are judged from the same early fields.
    if (record.startDisk !== 0) refuse('multi_disk_not_supported', messageName(record.nameBytes, flags))

    if (nameLength > run.limits.maxEntryNameBytes) refuse('name_too_long', nameLength)
    if (unicodeBody !== null && unicodeBody.length > run.limits.maxEntryNameBytes) {
      refuse('name_too_long', unicodeBody.length)
    }
    const name = unicodePathName(unicodeBody, record.nameBytes) ?? decodeEntryName(record.nameBytes, flags)
    if (name.length === 0) refuse('corrupt_central_directory')
    record.name = normalizeEntryName(name)

    records.push(record)
    pos = recordEnd
    await breathe(run)
  }
  if (pos !== bytes.length) refuse('corrupt_central_directory')
  return records
}

/**
 * Every decision that can be made from the index is made here, before a compressed byte is read.
 * Ignored trees, media and oversized files are skipped without ever being inflated, which is what
 * makes a multi-gigabyte zip full of node_modules cheap. The return value is the skip reason,
 * `'candidate'` for an entry this pass should analyse, or `'already_processed'` for an entry a
 * previous pass settled, which the caller walks past without recording.
 */
function classifyDeclared(record: CentralRecord, run: ReadRun): ArchiveSkipCode | 'candidate' | 'already_processed' {
  const { limits } = run
  validateName(record.name)
  if (run.resumeProcessedNames?.has(record.name)) return 'already_processed'
  // A hostile name still refuses above; encryption and symlinks are ordinary archive contents a
  // user legitimately zips, so they are skipped per entry rather than costing the upload.
  if (record.encrypted) return 'encrypted_entry'
  if (record.symlink) return 'symlink_entry'
  if (isNestedArchive(record.name)) return 'nested_archive'
  if (isDirectoryEntry(record.externalAttrs)) return 'directory_entry'
  if (isIgnoredPath(record.name, run.includeGenerated)) return 'ignored_folder'
  if (!run.includeGenerated && isOsMetadataFile(record.name)) return 'generated_file'
  if (hasBinaryExtension(record.name)) return 'binary_content'
  if (record.method !== METHOD_STORE && record.method !== METHOD_DEFLATE) return 'unsupported_compression'
  if (record.uncompressedSize === 0) return 'empty_entry'
  if (record.compressedSize === 0 || record.uncompressedSize / record.compressedSize > limits.maxDeclaredRatio) {
    return 'declared_ratio_exceeded'
  }
  if (record.uncompressedSize > limits.maxSingleFileUncompressedBytes) return 'single_file_too_large'
  if (record.compressedSize > limits.maxSingleFileUncompressedBytes + COMPRESSED_OVERHEAD_BYTES) return 'single_file_too_large'
  return 'candidate'
}

/**
 * The local header's copy of a number the index already gave. Bit 3 legitimately zeroes these
 * fields, and a zip64 entry marks them with all-ones because 32 bits cannot hold them, so either
 * spelling counts as "not stated here" rather than as a disagreement. Any other difference means
 * two records claim to be the same file and say different things about it.
 */
function agreesWithIndex(local: number, central: number, indexOnly: boolean): boolean {
  if (local === central) return true
  return indexOnly && (local === 0 || local === UINT32_MAX || local === UINT16_MAX)
}

/** A size field is four bytes, or eight when the entry stores it the zip64 way. */
function readSizeField(view: DataView, at: number, width: number): number {
  if (width === 4) return view.getUint32(at, true)
  const wide = view.getBigUint64(at, true)
  if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return Number.NaN
  return Number(wide)
}

/**
 * A bit-3 entry repeats its checksum and sizes after its data, which is how writers that could not
 * seek back — streaming downloads, `zip -r -`, Explorer's own copy step — produce a readable
 * archive. The index already carries the true values, so the descriptor is checked against them
 * and never trusted on its own. The signature is optional and the size fields are four or eight
 * bytes, so every layout is tried and only one that agrees on all three numbers is accepted.
 * A descriptor that is missing or lies costs this entry; the rest of the index stays sound.
 */
async function checkDataDescriptor(
  source: ByteSource,
  record: CentralRecord,
  dataEnd: number,
  signal?: AbortSignal,
): Promise<number> {
  const available = Math.min(DATA_DESCRIPTOR_MAX_BYTES, source.size - dataEnd)
  if (available < 12) skipEntry('data_descriptor_mismatch')
  const view = viewOf(await source.read(dataEnd, dataEnd + available, signal))
  const signed = view.getUint32(0, true) === SIG_DATA_DESCRIPTOR
  const starts = signed ? [4, 0] : [0]
  for (const start of starts) {
    for (const width of [4, 8]) {
      const length = start + 4 + width * 2
      if (length > available) continue
      if (
        view.getUint32(start, true) === record.crc &&
        readSizeField(view, start + 4, width) === record.compressedSize &&
        readSizeField(view, start + 4 + width, width) === record.uncompressedSize
      ) {
        return length
      }
    }
  }
  skipEntry('data_descriptor_mismatch')
}

async function validateLocalHeader(
  source: ByteSource,
  record: CentralRecord,
  centralOffset: number,
  signal?: AbortSignal,
): Promise<PlannedEntry> {
  const at = record.localHeaderOffset
  if (at < 0 || at + LOCAL_HEADER_SIZE > source.size || at >= centralOffset) refuse('corrupt_local_header', record.name)
  const head = await source.read(at, at + LOCAL_HEADER_SIZE, signal)
  const headView = viewOf(head)
  if (headView.getUint32(0, true) !== SIG_LOCAL_HEADER) refuse('corrupt_local_header', record.name)

  const localFlags = headView.getUint16(6, true)
  const localMethod = headView.getUint16(8, true)
  const localCrc = headView.getUint32(14, true)
  const localCompressed = headView.getUint32(18, true)
  const localUncompressed = headView.getUint32(22, true)
  const localNameLength = headView.getUint16(26, true)
  const localExtraLength = headView.getUint16(28, true)

  // The index did not mark this entry encrypted, but its own local header does: the data itself
  // is what needs the password, so the entry is skipped rather than inflated against its will.
  if (localFlags & FLAG_ENCRYPTED) skipEntry('encrypted_entry')
  // Bit 3 is the only flag whose absence in one header changes how many bytes follow the data,
  // so the two headers have to agree about it before anything else is trusted.
  if (((localFlags & FLAG_DATA_DESCRIPTOR) !== 0) !== record.dataDescriptor) {
    refuse('local_central_disagreement', record.name)
  }
  const indexOnly = record.dataDescriptor || record.zip64
  if (
    localMethod !== record.method ||
    !agreesWithIndex(localCrc, record.crc, indexOnly) ||
    !agreesWithIndex(localCompressed, record.compressedSize, indexOnly) ||
    !agreesWithIndex(localUncompressed, record.uncompressedSize, indexOnly)
  ) {
    refuse('local_central_disagreement', record.name)
  }
  if (localNameLength !== record.nameBytes.length) refuse('corrupt_local_header', record.name)
  const nameEnd = at + LOCAL_HEADER_SIZE + localNameLength
  const dataStart = nameEnd + localExtraLength
  const dataEnd = dataStart + record.compressedSize
  if (dataEnd > source.size) refuse('corrupt_local_header', record.name)
  const localName = await source.read(at + LOCAL_HEADER_SIZE, nameEnd, signal)
  if (!sameBytes(localName, record.nameBytes)) refuse('corrupt_local_header', record.name)
  if (!record.dataDescriptor) return { record, dataStart, dataEnd, rangeEnd: dataEnd }
  const descriptorBytes = await checkDataDescriptor(source, record, dataEnd, signal)
  return { record, dataStart, dataEnd, rangeEnd: dataEnd + descriptorBytes }
}

/**
 * Two index records may not describe the same compressed bytes. Without this, a small archive
 * can list thousands of entries that all inflate the same range, multiplying decompression work
 * by the entry count. Ranges that reach into the index are refused for the same reason. The range
 * ends after the data descriptor when an entry has one, because those bytes belong to this entry
 * and cannot be the next entry's header.
 */
function checkRanges(planned: PlannedEntry[], centralOffset: number): void {
  const sorted = [...planned].sort((a, b) => a.record.localHeaderOffset - b.record.localHeaderOffset)
  let previousEnd = -1
  for (const item of sorted) {
    if (item.dataStart < item.record.localHeaderOffset) refuse('overlapping_entries', item.record.name)
    if (item.rangeEnd > centralOffset) refuse('overlapping_entries', item.record.name, 'runs into the archive index')
    if (item.record.localHeaderOffset < previousEnd || item.dataStart < previousEnd) {
      refuse('overlapping_entries', item.record.name)
    }
    previousEnd = Math.max(previousEnd, item.rangeEnd)
  }
}

async function extractRecord(source: ByteSource, planned: PlannedEntry, run: ReadRun): Promise<ArchiveEntry> {
  const { record } = planned
  const compressed = await source.read(planned.dataStart, planned.dataEnd, run.signal)

  let out: Uint8Array
  if (record.method === METHOD_STORE) {
    out = compressed
    if (out.length > record.uncompressedSize) refuse('declared_size_understated')
    if (out.length < record.uncompressedSize) refuse('local_central_disagreement', record.name)
    spendWorkBudget(run, out.length)
  } else {
    const chunks: Uint8Array[] = []
    let produced = 0
    let finished = false
    // The bounds are checked inside the inflate callback, so a bomb stops on the byte that
    // crosses the line instead of after the stream ends.
    const inflate = new Inflate((chunk, final) => {
      if (chunk.length > 0) {
        enforceChunkBounds(run, {
          produced,
          chunkLength: chunk.length,
          declaredSize: record.uncompressedSize,
          compressedSize: record.compressedSize,
        })
        produced += chunk.length
        chunks.push(chunk)
      }
      if (final) finished = true
    })
    for (let at = 0; at < compressed.length; at += run.limits.inflateChunkBytes) {
      try {
        inflate.push(
          compressed.subarray(at, Math.min(at + run.limits.inflateChunkBytes, compressed.length)),
          at + run.limits.inflateChunkBytes >= compressed.length,
        )
      } catch (error) {
        if (error instanceof RefuseArchive || error instanceof SkipSingle || error instanceof PartialStop) throw error
        refuse('corrupt_deflate_stream', record.name)
      }
      await breathe(run)
    }
    if (!finished) refuse('corrupt_deflate_stream', record.name)
    if (produced !== record.uncompressedSize) refuse('corrupt_deflate_stream', record.name)
    out = concat(chunks, produced)
  }

  if (crc32Finish(crc32(out)) !== record.crc) skipEntry('crc_mismatch')
  if (looksBinary(out)) skipEntry('binary_content')
  const decoded = decodeBytes(out)
  const detection = detectLanguage(record.name, decoded.text)
  run.stats.peakEntryBytes = Math.max(run.stats.peakEntryBytes, out.length)
  run.stats.producedBytes += out.length
  return {
    name: record.name,
    text: decoded.text,
    language: detection.language,
    languageSource: detection.source,
    encoding: decoded.encoding,
    bytes: out.length,
  }
}

function finishPartial(
  run: ReadRun,
  code: PartialStopCode,
  subject: string | number,
  entries: ArchiveEntry[],
  skipped: ArchiveSkippedEntry[],
): ArchiveReadResult {
  run.stats.durationMs = Date.now() - run.started
  return partialReadResult(run.stats, code, subject, entries, skipped)
}

async function readArchiveFromSource(source: ByteSource, options: ReadOptions = {}): Promise<ArchiveReadResult> {
  const run = createRun(options)
  const entries: ArchiveEntry[] = []
  const skipped: ArchiveSkippedEntry[] = []
  let note: string | null = null
  const finish = (refusal: ArchiveRefusal | null): ArchiveReadResult => ({
    ...finishRun(run, refusal, entries, skipped),
    note,
  })
  let records: CentralRecord[] = []

  try {
    if (run.signal?.aborted) {
      if (run.keepPartial) return finishPartial(run, 'cancelled', '', entries, skipped)
      refuse('cancelled')
    }
    if (source.size > run.limits.maxArchiveBytes) refuse('archive_too_large', source.size)

    const tailStart = Math.max(0, source.size - END_OF_CENTRAL_SCAN_WINDOW)
    const tail = await source.read(tailStart, source.size, run.signal)
    const tailView = viewOf(tail)
    const eocdRel = findEndOfCentralDirectory(tail)
    if (eocdRel < 0) refuse('not_a_zip')
    const eocd = tailStart + eocdRel
    const diskNumber = tailView.getUint16(eocdRel + 4, true)
    const centralDisk = tailView.getUint16(eocdRel + 6, true)
    if (diskNumber !== 0 || centralDisk !== 0) refuse('multi_disk_not_supported')

    let centralSize = tailView.getUint32(eocdRel + 12, true)
    let centralOffset = tailView.getUint32(eocdRel + 16, true)
    const marked =
      tailView.getUint16(eocdRel + 8, true) === UINT16_MAX ||
      tailView.getUint16(eocdRel + 10, true) === UINT16_MAX ||
      centralSize === UINT32_MAX ||
      centralOffset === UINT32_MAX

    // A zip64 archive keeps its real index position in a second end record, reached through the
    // twenty-byte locator that sits in front of the ordinary one. The ordinary record's all-ones
    // fields only promise that number, so a promise with no locator behind it is a lie.
    if (marked || eocd >= ZIP64_LOCATOR_SIZE) {
      const zip64 = await readZip64EndRecord(source, tail, tailStart, eocd, run.signal)
      if (zip64 === null) {
        if (marked) refuse('corrupt_central_directory')
      } else {
        if (centralSize === UINT32_MAX) centralSize = zip64.centralSize
        else if (centralSize !== zip64.centralSize) refuse('corrupt_central_directory')
        if (centralOffset === UINT32_MAX) centralOffset = zip64.centralOffset
        else if (centralOffset !== zip64.centralOffset) refuse('corrupt_central_directory')
      }
    }
    if (centralSize === UINT32_MAX || centralOffset === UINT32_MAX) refuse('corrupt_central_directory')
    if (centralOffset + centralSize > eocd) refuse('corrupt_central_directory')

    records = await walkCentralDirectory(source, centralOffset, centralSize, run)
    reportProgress(run, 'walk')

    const seen = new Set<string>()
    const candidates: CentralRecord[] = []
    for (const record of records) {
      if (seen.has(record.name)) refuse('duplicate_name', record.name)
      seen.add(record.name)
      const verdict = classifyDeclared(record, run)
      if (verdict === 'candidate') {
        candidates.push(record)
        continue
      }
      // An entry a previous pass settled is neither read nor recorded here: the earlier pass
      // already reported it, and this pass's coverage is only ever merged beside that one.
      if (verdict === 'already_processed') continue
      // The method number matters in the unsupported-compression reason, so it rides along as the
      // message's second detail; every other skip reason is built from the name alone.
      const message =
        verdict === 'unsupported_compression'
          ? archiveReasonMessage(verdict, record.name, String(record.method))
          : archiveReasonMessage(verdict, record.name)
      skipped.push({ name: record.name, code: verdict, message })
    }
    // An archive where every entry is encrypted reads as an empty report. The per-entry skips say
    // why, and this note says it once, in the report's own limitations.
    if (records.length > 0 && records.every((record) => record.encrypted)) {
      note =
        'Every entry in this archive is encrypted. BugPilot does not ask for or handle archive passwords, so nothing was unpacked.'
    }
    run.stats.plannedEntries = candidates.length
    run.stats.plannedBytes = candidates.reduce((sum, record) => sum + record.uncompressedSize, 0)

    // The analysed cap bounds the files this pass may take. Everything past it is named as not
    // reached and the pass ends as a partial the user can continue; all-or-nothing callers get
    // the refusal instead, because they asked to keep nothing. The capped set is still validated
    // and extracted, so a pass always analyses up to the cap and never stalls at zero.
    let capStopped = false
    if (candidates.length > run.limits.maxEntryCount) {
      const rest = candidates.splice(run.limits.maxEntryCount)
      if (!run.keepPartial) refuse('entry_count_exceeded', run.limits.maxEntryCount)
      for (const record of rest) skipped.push(notReachedEntry(record.name, 'entry_count_exceeded'))
      capStopped = true
    }

    const planned: PlannedEntry[] = []
    for (const record of candidates) {
      await breathe(run)
      try {
        planned.push(await validateLocalHeader(source, record, centralOffset, run.signal))
      } catch (error) {
        // An entry whose own header or descriptor does not add up is dropped with a reason.
        if (error instanceof SkipSingle) {
          skipped.push({ name: record.name, code: error.code, message: archiveReasonMessage(error.code, record.name) })
          run.stats.skipped = skipped.length
          continue
        }
        if (isAbortError(error)) {
          if (run.keepPartial) throw error
          refuse('cancelled')
        }
        throw error
      }
    }

    checkRanges(planned, centralOffset)

    let stoppedCode: PartialStopCode | null = null
    let stoppedSubject: string | number = ''
    let stoppedAt = 0
    for (let index = 0; index < planned.length; index += 1) {
      const item = planned[index]
      stoppedAt = index
      await breathe(run)
      try {
        entries.push(await extractRecord(source, item, run))
        run.stats.entries = entries.length
        run.stats.skipped = skipped.length
        reportProgress(run, 'extract')
      } catch (error) {
        if (error instanceof SkipSingle) {
          skipped.push({ name: item.record.name, code: error.code, message: archiveReasonMessage(error.code, item.record.name) })
          run.stats.skipped = skipped.length
          continue
        }
        if (error instanceof PartialStop) {
          stoppedCode = error.code as PartialStopCode
          stoppedSubject = error.subject
        } else if (run.keepPartial && isAbortError(error)) {
          stoppedCode = 'cancelled'
          stoppedSubject = ''
        } else {
          return finish(toRefusal(error))
        }
        break
      }
    }
    if (stoppedCode !== null) {
      // A stop inside the pass: this entry and everything behind it are named as not reached.
      for (const rest of planned.slice(stoppedAt)) {
        skipped.push(notReachedEntry(rest.record.name, stoppedCode))
      }
      return finishPartial(run, stoppedCode, stoppedSubject, entries, skipped)
    }
    if (capStopped) {
      return finishPartial(run, 'entry_count_exceeded', run.limits.maxEntryCount, entries, skipped)
    }
  } catch (error) {
    if (error instanceof PartialStop || (run.keepPartial && isAbortError(error))) {
      const code = error instanceof PartialStop ? error.code : 'cancelled'
      const subject = error instanceof PartialStop ? error.subject : ''
      // A linear `skipped.some` per record is O(records × skipped) — minutes of pure scanning
      // when a stop leaves tens of thousands of names on both sides. Names are unique here
      // (duplicates are refused during the walk), so a set decides membership.
      const skippedNames = new Set(skipped.map((entry) => entry.name))
      for (const record of records) {
        if (run.resumeProcessedNames?.has(record.name)) continue
        if (!skippedNames.has(record.name)) {
          skipped.push(notReachedEntry(record.name, code))
          skippedNames.add(record.name)
        }
      }
      run.stats.plannedEntries = Math.max(run.stats.plannedEntries ?? 0, records.length)
      return finishPartial(run, code as PartialStopCode, subject, entries, skipped)
    }
    return finish(toRefusal(error))
  }

  return finish(null)
}

/** Read an archive through a seekable source. This is the reader the worker uses. */
export async function readArchiveSource(source: ByteSource, options: ReadOptions = {}): Promise<ArchiveReadResult> {
  try {
    return await readArchiveFromSource(source, options)
  } catch (error) {
    // readArchiveFromSource converts its own failures; this is the last line before a worker error.
    const run = createRun(options)
    return finishRun(run, toRefusal(error), [], [])
  }
}

/** The byte-array entry point kept for tests, plain files and callers that already hold bytes. */
export async function readArchive(bytes: Uint8Array, options: ReadOptions = {}): Promise<ArchiveReadResult> {
  return readArchiveSource(createMemorySource(bytes), options)
}
