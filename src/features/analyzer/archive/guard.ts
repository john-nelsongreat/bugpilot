import { Inflate } from 'fflate'
import {
  RefuseArchive,
  SkipSingle,
  breathe,
  createRun,
  enforceChunkBounds,
  finishRun,
  refuse,
  reportProgress,
  skipEntry,
  toRefusal,
  validateName,
  type ArchiveEntry,
  type ArchiveReadResult,
  type ArchiveRefusal,
  type ArchiveSkippedEntry,
  type ReadOptions,
  type ReadRun,
} from './bounds'
import { crc32, crc32Finish } from './crc32'
import { detectLanguage } from './classify'
import { decodeBytes, looksBinary } from './decode'
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './limits'
import { archiveReasonMessage, type ArchiveSkipCode } from './reasons'
import { hasBinaryExtension, isIgnoredPath, isNestedArchive } from './paths'

export { DEFAULT_ARCHIVE_LIMITS }
export type { ArchiveLimits }
export type {
  ArchiveEntry,
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
const SIG_ZIP64_LOCATOR = 0x07064b50
const END_OF_CENTRAL_MIN_SIZE = 22
const END_OF_CENTRAL_SCAN_WINDOW = 65_535 + END_OF_CENTRAL_MIN_SIZE
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const ZIP64_LOCATOR_SIZE = 20

const FLAG_ENCRYPTED = 0x0001
const FLAG_DATA_DESCRIPTOR = 0x0008
const FLAG_NAME_IS_UTF8 = 0x0800
const UNIX_FILE_TYPE_MASK = 0xf000
const UNIX_SYMBOLIC_LINK = 0xa000
const UNIX_DIRECTORY = 0x4000
const DOS_DIRECTORY_BIT = 0x0010
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

function unixFileType(externalAttrs: number): number {
  return (externalAttrs >>> 16) & UNIX_FILE_TYPE_MASK
}

function isSymbolicLink(externalAttrs: number): boolean {
  return unixFileType(externalAttrs) === UNIX_SYMBOLIC_LINK
}

function isDirectoryEntry(externalAttrs: number): boolean {
  return unixFileType(externalAttrs) === UNIX_DIRECTORY || (externalAttrs & DOS_DIRECTORY_BIT) === DOS_DIRECTORY_BIT
}

function decodeEntryName(bytes: Uint8Array, flags: number): string {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) refuse('null_byte_in_name', asciiPrefix(bytes))
  }
  if (flags & FLAG_NAME_IS_UTF8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      refuse('corrupt_central_directory')
    }
  }
  return new TextDecoder('iso-8859-1').decode(bytes)
}

function asciiPrefix(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < Math.min(bytes.length, 32); i += 1) {
    out += bytes[i] === 0 ? '\\0' : String.fromCharCode(bytes[i])
  }
  return out
}

function findEndOfCentralDirectory(view: DataView, size: number): number {
  const lowest = Math.max(0, size - END_OF_CENTRAL_SCAN_WINDOW)
  for (let pos = size - END_OF_CENTRAL_MIN_SIZE; pos >= lowest; pos -= 1) {
    if (view.getUint32(pos, true) !== SIG_END_OF_CENTRAL) continue
    const commentLength = view.getUint16(pos + 20, true)
    if (pos + END_OF_CENTRAL_MIN_SIZE + commentLength === size) return pos
  }
  return -1
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
}

function report(run: ReadRun, phase: 'walk' | 'extract'): void {
  reportProgress(run, phase)
}

async function walkCentralDirectory(bytes: Uint8Array, view: DataView, centralOffset: number, centralSize: number, run: ReadRun): Promise<CentralRecord[]> {
  const { limits } = run
  const records: CentralRecord[] = []
  const end = centralOffset + centralSize
  let pos = centralOffset
  while (pos + CENTRAL_HEADER_SIZE <= end) {
    if (view.getUint32(pos, true) !== SIG_CENTRAL_HEADER) refuse('corrupt_central_directory')
    // Leak A: the cap is measured on records actually walked, never on the declared total.
    run.stats.walkedRecords += 1
    if (run.stats.walkedRecords > limits.maxEntryCount) refuse('entry_count_exceeded', limits.maxEntryCount)

    const flags = view.getUint16(pos + 8, true)
    const method = view.getUint16(pos + 10, true)
    const crc = view.getUint32(pos + 16, true)
    const compressedSize = view.getUint32(pos + 20, true)
    const uncompressedSize = view.getUint32(pos + 24, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const externalAttrs = view.getUint32(pos + 38, true)
    const localHeaderOffset = view.getUint32(pos + 42, true)

    // Leak B: encryption and symlinks are diagnosed before the name is judged.
    if (flags & FLAG_ENCRYPTED) refuse('encrypted_entry', printableName(bytes, pos, nameLength, flags))
    if (flags & FLAG_DATA_DESCRIPTOR) refuse('data_descriptor_not_supported', printableName(bytes, pos, nameLength, flags))
    if (isSymbolicLink(externalAttrs)) refuse('symlink_entry', printableName(bytes, pos, nameLength, flags))

    if (pos + CENTRAL_HEADER_SIZE + nameLength > bytes.length) refuse('corrupt_central_directory')
    if (nameLength > limits.maxEntryNameBytes) refuse('name_too_long', nameLength)
    const nameBytes = bytes.subarray(pos + CENTRAL_HEADER_SIZE, pos + CENTRAL_HEADER_SIZE + nameLength)
    const name = decodeEntryName(nameBytes, flags)
    if (name.length === 0) refuse('corrupt_central_directory')

    records.push({ name, nameBytes, flags, method, crc, compressedSize, uncompressedSize, externalAttrs, localHeaderOffset })
    pos += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
    await breathe(run)
  }
  if (pos !== end) refuse('corrupt_central_directory')
  return records
}

function printableName(bytes: Uint8Array, centralPos: number, nameLength: number, flags: number): string {
  const start = centralPos + CENTRAL_HEADER_SIZE
  if (start + nameLength > bytes.length) return '(unreadable name)'
  try {
    return decodeEntryName(bytes.subarray(start, start + nameLength), flags)
  } catch {
    return '(unreadable name)'
  }
}

function classifyDeclared(record: CentralRecord, run: ReadRun, declaredBudget: number): 'skip' | 'accept' {
  const { limits } = run
  validateName(record.name)
  if (isNestedArchive(record.name)) refuse('nested_archive', record.name)
  if (isDirectoryEntry(record.externalAttrs)) return 'skip'
  if (isIgnoredPath(record.name)) return 'skip'
  if (hasBinaryExtension(record.name)) return 'skip'
  if (record.method !== METHOD_STORE && record.method !== METHOD_DEFLATE) refuse('unsupported_compression', record.name, String(record.method))
  if (record.uncompressedSize === 0) return 'skip'
  if (record.compressedSize === 0 || record.uncompressedSize / record.compressedSize > limits.maxDeclaredRatio) {
    refuse('declared_ratio_exceeded')
  }
  if (record.uncompressedSize > limits.maxSingleFileUncompressedBytes) return 'skip'
  if (declaredBudget + record.uncompressedSize > limits.maxTotalUncompressedBytes) {
    refuse('total_uncompressed_exceeded', limits.maxTotalUncompressedBytes)
  }
  return 'accept'
}

function skipCodeFor(record: CentralRecord): ArchiveSkipCode {
  if (isDirectoryEntry(record.externalAttrs)) return 'directory_entry'
  if (isIgnoredPath(record.name)) return 'ignored_folder'
  if (hasBinaryExtension(record.name)) return 'binary_content'
  if (record.uncompressedSize === 0) return 'empty_entry'
  return 'single_file_too_large'
}

function localDataRange(bytes: Uint8Array, view: DataView, record: CentralRecord): [number, number] {
  const at = record.localHeaderOffset
  if (at + LOCAL_HEADER_SIZE > bytes.length) refuse('corrupt_local_header', record.name)
  if (view.getUint32(at, true) !== SIG_LOCAL_HEADER) refuse('corrupt_local_header', record.name)
  const localNameLength = view.getUint16(at + 26, true)
  const localExtraLength = view.getUint16(at + 28, true)
  if (at + LOCAL_HEADER_SIZE + localNameLength > bytes.length) refuse('corrupt_local_header', record.name)
  const localName = bytes.subarray(at + LOCAL_HEADER_SIZE, at + LOCAL_HEADER_SIZE + localNameLength)
  if (!sameBytes(localName, record.nameBytes)) refuse('corrupt_local_header', record.name)
  const dataStart = at + LOCAL_HEADER_SIZE + localNameLength + localExtraLength
  if (dataStart + record.compressedSize > bytes.length) refuse('corrupt_local_header', record.name)
  return [dataStart, record.compressedSize]
}

async function extractRecord(bytes: Uint8Array, view: DataView, record: CentralRecord, run: ReadRun): Promise<ArchiveEntry> {
  const { limits } = run
  const [dataStart, compressedSize] = localDataRange(bytes, view, record)
  const source = bytes.subarray(dataStart, dataStart + compressedSize)

  let out: Uint8Array
  if (record.method === METHOD_STORE) {
    out = source
    if (out.length > record.uncompressedSize) refuse('declared_size_understated')
  } else {
    const chunks: Uint8Array[] = []
    let produced = 0
    let finished = false
    // The bounds are checked inside the inflate callback, so a bomb stops on the byte that
    // crosses the line instead of after the stream ends.
    const inflate = new Inflate((chunk, final) => {
      if (chunk.length > 0) {
        enforceChunkBounds(
          run,
          { produced, chunkLength: chunk.length, declaredSize: record.uncompressedSize, compressedSize },
          run.stats.producedBytes,
        )
        produced += chunk.length
        chunks.push(chunk)
      }
      if (final) finished = true
    })
    for (let at = 0; at < source.length; at += limits.inflateChunkBytes) {
      try {
        inflate.push(source.subarray(at, Math.min(at + limits.inflateChunkBytes, source.length)), at + limits.inflateChunkBytes >= source.length)
      } catch (error) {
        if (error instanceof RefuseArchive || error instanceof SkipSingle) throw error
        refuse('corrupt_deflate_stream', record.name)
      }
      await breathe(run)
    }
    if (!finished) refuse('corrupt_deflate_stream', record.name)
    if (produced !== record.uncompressedSize) refuse('corrupt_deflate_stream', record.name)
    out = concat(chunks, produced)
  }

  if (crc32Finish(crc32(out)) !== record.crc) refuse('crc_mismatch', record.name)
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

export async function readArchive(bytes: Uint8Array, options: ReadOptions = {}): Promise<ArchiveReadResult> {
  const run = createRun(options)
  const entries: ArchiveEntry[] = []
  const skipped: ArchiveSkippedEntry[] = []
  const finish = (refusal: ArchiveRefusal | null): ArchiveReadResult => finishRun(run, refusal, entries, skipped)

  try {
    // The size ceiling is checked before a single header is parsed, so an oversized upload
    // costs one comparison rather than a walk.
    if (run.signal?.aborted) refuse('cancelled')
    if (bytes.length > run.limits.maxArchiveBytes) refuse('archive_too_large', bytes.length)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const eocd = findEndOfCentralDirectory(view, bytes.length)
    if (eocd < 0) refuse('not_a_zip')
    const hasLocator = eocd - ZIP64_LOCATOR_SIZE >= 0 && view.getUint32(eocd - ZIP64_LOCATOR_SIZE, true) === SIG_ZIP64_LOCATOR
    const overflowedFields = view.getUint16(eocd + 10, true) === 0xffff || view.getUint32(eocd + 16, true) === 0xffffffff
    if (hasLocator || overflowedFields) refuse('zip64_not_supported')
    const centralSize = view.getUint32(eocd + 12, true)
    const centralOffset = view.getUint32(eocd + 16, true)
    if (centralOffset + centralSize > bytes.length) refuse('corrupt_central_directory')

    const records = await walkCentralDirectory(bytes, view, centralOffset, centralSize, run)
    report(run, 'walk')

    const accepted: CentralRecord[] = []
    const seen = new Set<string>()
    let declaredBudget = 0
    for (const record of records) {
      if (seen.has(record.name)) refuse('duplicate_name', record.name)
      seen.add(record.name)
      if (classifyDeclared(record, run, declaredBudget) === 'skip') {
        const code = skipCodeFor(record)
        skipped.push({ name: record.name, code, message: archiveReasonMessage(code, record.name) })
        continue
      }
      declaredBudget += record.uncompressedSize
      accepted.push(record)
    }

    for (const record of accepted) {
      await breathe(run)
      try {
        entries.push(await extractRecord(bytes, view, record, run))
        run.stats.entries = entries.length
        run.stats.skipped = skipped.length
        report(run, 'extract')
      } catch (error) {
        if (error instanceof SkipSingle) {
          skipped.push({ name: record.name, code: error.code, message: archiveReasonMessage(error.code, record.name) })
          run.stats.skipped = skipped.length
          continue
        }
        return finish(toRefusal(error))
      }
    }
  } catch (error) {
    return finish(toRefusal(error))
  }

  return finish(null)
}
