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
import { hasBinaryExtension, isIgnoredPath, isNestedArchive } from './paths'
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

/** Deflate can make a file slightly bigger; anything past this is not a 2 MiB text file. */
const COMPRESSED_OVERHEAD_BYTES = 65_536

/** Shown next to a file the analysis budget had no room for. */
const DID_NOT_FIT = 'it did not fit the analysis budget left for this upload'

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
}

interface PlannedEntry {
  record: CentralRecord
  dataStart: number
  dataEnd: number
}

/** The end record is found by scanning back only the window a comment can occupy. */
function findEndOfCentralDirectory(tail: Uint8Array): number {
  const view = viewOf(tail)
  for (let pos = tail.length - END_OF_CENTRAL_MIN_SIZE; pos >= 0; pos -= 1) {
    if (view.getUint32(pos, true) !== SIG_END_OF_CENTRAL) continue
    const commentLength = view.getUint16(pos + 20, true)
    if (pos + END_OF_CENTRAL_MIN_SIZE + commentLength === tail.length) return pos
  }
  return -1
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
    if (run.stats.walkedRecords > run.limits.maxEntryCount) refuse('entry_count_exceeded', run.limits.maxEntryCount)

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
    const recordEnd = pos + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
    if (recordEnd > bytes.length) refuse('corrupt_central_directory')

    // Encryption and symlinks are diagnosed before the name is judged, so a hostile name cannot
    // hide the more serious property.
    if (flags & FLAG_ENCRYPTED) {
      refuse('encrypted_entry', messageName(bytes.subarray(pos + CENTRAL_HEADER_SIZE, pos + CENTRAL_HEADER_SIZE + nameLength), flags))
    }
    if (flags & FLAG_DATA_DESCRIPTOR) {
      refuse('data_descriptor_not_supported', messageName(bytes.subarray(pos + CENTRAL_HEADER_SIZE, pos + CENTRAL_HEADER_SIZE + nameLength), flags))
    }
    if (isSymbolicLink(externalAttrs)) {
      refuse('symlink_entry', messageName(bytes.subarray(pos + CENTRAL_HEADER_SIZE, pos + CENTRAL_HEADER_SIZE + nameLength), flags))
    }

    if (nameLength > run.limits.maxEntryNameBytes) refuse('name_too_long', nameLength)
    const nameBytes = bytes.subarray(pos + CENTRAL_HEADER_SIZE, pos + CENTRAL_HEADER_SIZE + nameLength)
    const name = decodeEntryName(nameBytes, flags)
    if (name.length === 0) refuse('corrupt_central_directory')

    records.push({ name, nameBytes, flags, method, crc, compressedSize, uncompressedSize, externalAttrs, localHeaderOffset })
    pos = recordEnd
    await breathe(run)
  }
  if (pos !== bytes.length) refuse('corrupt_central_directory')
  return records
}

/**
 * Every decision that can be made from the index is made here, before a compressed byte is read.
 * Ignored trees, media and oversized files are skipped without ever being inflated, which is what
 * makes a 250 MiB zip full of node_modules cheap. The return value is the skip reason, or
 * `'candidate'` for an entry that should be analysed if the text budget still has room for it —
 * the budget itself is judged by the fill loop, not here, because a file that does not fit now
 * may fit again once another candidate proves not to be text.
 */
function classifyDeclared(record: CentralRecord, run: ReadRun): ArchiveSkipCode | 'candidate' {
  const { limits } = run
  validateName(record.name)
  if (isNestedArchive(record.name)) refuse('nested_archive', record.name)
  if (isDirectoryEntry(record.externalAttrs)) return 'directory_entry'
  if (isIgnoredPath(record.name, run.includeGenerated)) return 'ignored_folder'
  if (hasBinaryExtension(record.name)) return 'binary_content'
  if (record.method !== METHOD_STORE && record.method !== METHOD_DEFLATE) refuse('unsupported_compression', record.name, String(record.method))
  if (record.uncompressedSize === 0) return 'empty_entry'
  if (record.compressedSize === 0 || record.uncompressedSize / record.compressedSize > limits.maxDeclaredRatio) {
    refuse('declared_ratio_exceeded')
  }
  if (record.uncompressedSize > limits.maxSingleFileUncompressedBytes) return 'single_file_too_large'
  if (record.compressedSize > limits.maxSingleFileUncompressedBytes + COMPRESSED_OVERHEAD_BYTES) return 'single_file_too_large'
  return 'candidate'
}

function analysisBudget(run: ReadRun): number {
  if (run.keepPartial) return run.limits.maxAnalysableTextBytes
  // All-or-nothing callers keep the historical meaning of the total ceiling: the declared sum is
  // checked against it before anything is inflated.
  return Math.min(run.limits.maxAnalysableTextBytes, run.limits.maxTotalUncompressedBytes)
}

async function validateLocalHeader(source: ByteSource, record: CentralRecord, centralOffset: number): Promise<PlannedEntry> {
  const at = record.localHeaderOffset
  if (at < 0 || at + LOCAL_HEADER_SIZE > source.size || at >= centralOffset) refuse('corrupt_local_header', record.name)
  const head = await source.read(at, at + LOCAL_HEADER_SIZE)
  const headView = viewOf(head)
  if (headView.getUint32(0, true) !== SIG_LOCAL_HEADER) refuse('corrupt_local_header', record.name)

  const localFlags = headView.getUint16(4, true)
  const localMethod = headView.getUint16(8, true)
  const localCrc = headView.getUint32(14, true)
  const localCompressed = headView.getUint32(18, true)
  const localUncompressed = headView.getUint32(22, true)
  const localNameLength = headView.getUint16(26, true)
  const localExtraLength = headView.getUint16(28, true)

  if (localFlags & FLAG_ENCRYPTED) refuse('encrypted_entry', record.name)
  if (localFlags & FLAG_DATA_DESCRIPTOR) refuse('local_central_disagreement', record.name)
  if (
    localMethod !== record.method ||
    localCrc !== record.crc ||
    localCompressed !== record.compressedSize ||
    localUncompressed !== record.uncompressedSize
  ) {
    refuse('local_central_disagreement', record.name)
  }
  if (localNameLength !== record.nameBytes.length) refuse('corrupt_local_header', record.name)
  const nameEnd = at + LOCAL_HEADER_SIZE + localNameLength
  const dataStart = nameEnd + localExtraLength
  if (dataStart + record.compressedSize > source.size) refuse('corrupt_local_header', record.name)
  const localName = await source.read(at + LOCAL_HEADER_SIZE, nameEnd)
  if (!sameBytes(localName, record.nameBytes)) refuse('corrupt_local_header', record.name)
  return { record, dataStart, dataEnd: dataStart + record.compressedSize }
}

/**
 * Two index records may not describe the same compressed bytes. Without this, a small archive
 * can list thousands of entries that all inflate the same range, multiplying decompression work
 * by the entry count. Ranges that reach into the index are refused for the same reason.
 */
function checkRanges(planned: PlannedEntry[], centralOffset: number): void {
  const sorted = [...planned].sort((a, b) => a.record.localHeaderOffset - b.record.localHeaderOffset)
  let previousEnd = -1
  for (const item of sorted) {
    if (item.dataStart < item.record.localHeaderOffset) refuse('overlapping_entries', item.record.name)
    if (item.dataEnd > centralOffset) refuse('overlapping_entries', item.record.name, 'runs into the archive index')
    if (item.record.localHeaderOffset < previousEnd || item.dataStart < previousEnd) {
      refuse('overlapping_entries', item.record.name)
    }
    previousEnd = Math.max(previousEnd, item.dataEnd)
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

function finishPartial(
  run: ReadRun,
  code: 'cancelled' | 'wall_clock_exceeded' | 'total_uncompressed_exceeded' | 'analysable_budget_exceeded',
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
  const finish = (refusal: ArchiveRefusal | null): ArchiveReadResult => finishRun(run, refusal, entries, skipped)
  let planned: PlannedEntry[] = []
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

    if (eocd >= ZIP64_LOCATOR_SIZE) {
      const locatorRel = eocd - ZIP64_LOCATOR_SIZE - tailStart
      const locator = locatorRel >= 0 && locatorRel + ZIP64_LOCATOR_SIZE <= tail.length
        ? tail.subarray(locatorRel, locatorRel + ZIP64_LOCATOR_SIZE)
        : await source.read(eocd - ZIP64_LOCATOR_SIZE, eocd, run.signal)
      if (viewOf(locator).getUint32(0, true) === SIG_ZIP64_LOCATOR) refuse('zip64_not_supported')
    }
    const overflowedFields =
      tailView.getUint16(eocdRel + 8, true) === 0xffff ||
      tailView.getUint16(eocdRel + 10, true) === 0xffff ||
      tailView.getUint32(eocdRel + 12, true) === 0xffffffff ||
      tailView.getUint32(eocdRel + 16, true) === 0xffffffff
    if (overflowedFields) refuse('zip64_not_supported')

    const centralSize = tailView.getUint32(eocdRel + 12, true)
    const centralOffset = tailView.getUint32(eocdRel + 16, true)
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
      skipped.push({ name: record.name, code: verdict, message: archiveReasonMessage(verdict, record.name) })
    }

    let plannedBytes = 0
    let queue = candidates
    const unreached: CentralRecord[] = []
    for (;;) {
      const accepted: PlannedEntry[] = []
      const overBudget: CentralRecord[] = []
      for (const record of queue) {
        if (plannedBytes + record.uncompressedSize > analysisBudget(run)) {
          overBudget.push(record)
          continue
        }
        plannedBytes += record.uncompressedSize
        accepted.push({ record, dataStart: -1, dataEnd: -1 })
      }
      if (!run.keepPartial) {
        // All-or-nothing callers keep the historical meaning of the ceiling: one declared sum is
        // checked against it, and a plan that does not fit is refused instead of truncated.
        if (overBudget.length > 0) refuse('total_uncompressed_exceeded', analysisBudget(run))
      }
      if (accepted.length === 0) {
        unreached.push(...overBudget)
        break
      }
      planned.push(...accepted)
      run.stats.plannedEntries = planned.length + overBudget.length
      run.stats.plannedBytes = plannedBytes

      for (const item of accepted) {
        Object.assign(item, await validateLocalHeader(source, item.record, centralOffset))
      }
      checkRanges(planned, centralOffset)

      let freedBytes = 0
      let stoppedCode: PartialStopCode | null = null
      let stoppedSubject: string | number = ''
      let stoppedAt = 0
      for (let index = 0; index < accepted.length; index += 1) {
        const item = accepted[index]
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
            // The index charged this entry against the text budget and it turned out to hold no
            // text, so the charge is withdrawn and another round gets the files that did not fit.
            freedBytes += item.record.uncompressedSize
            plannedBytes -= item.record.uncompressedSize
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
        // A stop inside the round: the rest of this round, and everything still waiting for the
        // budget, are named as not reached. The refund above is not re-offered, because the run
        // stopped for a reason that has nothing to do with how full the budget was.
        for (const rest of accepted.slice(stoppedAt)) {
          skipped.push(notReachedEntry(rest.record.name, stoppedCode))
        }
        for (const rest of overBudget) {
          skipped.push(notReachedEntry(rest.name, stoppedCode))
        }
        run.stats.plannedEntries = planned.length + accepted.length - stoppedAt + overBudget.length
        return finishPartial(run, stoppedCode, stoppedSubject, entries, skipped)
      }
      if (freedBytes === 0 || overBudget.length === 0) {
        unreached.push(...overBudget)
        break
      }
      // The refund made room, so the files that did not fit this round are tried again. They are
      // only named as not reached once, in the round that finally cannot take anything more.
      queue = overBudget
    }

    for (const record of unreached) {
      skipped.push(notReachedEntry(record.name, 'analysable_budget_exceeded', DID_NOT_FIT))
    }
    run.stats.plannedEntries = planned.length + unreached.length
    run.stats.plannedBytes = plannedBytes
    if (unreached.length > 0) {
      return finishPartial(run, 'analysable_budget_exceeded', run.limits.maxAnalysableTextBytes, entries, skipped)
    }
  } catch (error) {
    if (error instanceof PartialStop || (run.keepPartial && isAbortError(error))) {
      const code = error instanceof PartialStop ? error.code : 'cancelled'
      const subject = error instanceof PartialStop ? error.subject : ''
      for (const record of records) {
        if (!skipped.some((entry) => entry.name === record.name)) {
          skipped.push(notReachedEntry(record.name, code))
        }
      }
      run.stats.plannedEntries = Math.max(run.stats.plannedEntries ?? 0, records.length)
      return finishPartial(run, code as 'cancelled' | 'wall_clock_exceeded', subject, entries, skipped)
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
