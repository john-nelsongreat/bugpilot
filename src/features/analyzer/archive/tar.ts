import {
  PartialStop,
  SkipSingle,
  breathe,
  createRun,
  enforceChunkBounds,
  finishRun,
  notReachedEntry,
  partialReadResult,
  refuse,
  reportProgress,
  skipEntry,
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
import { archiveReasonMessage, type ArchiveSkipCode } from './reasons'
import { base256Field, octalField } from './format'
import { detectLanguage } from './classify'
import { decodeBytes, looksBinary } from './decode'
import { hasBinaryExtension, isIgnoredPath, isNestedArchive, isOsMetadataFile } from './paths'

/**
 * A strictly bounded tar reader. Nothing here trusts a header: every length field is checked
 * before it is used, every header re-verifies its own checksum, and the byte ceilings come from
 * the same shared guard code the zip reader uses. Links, devices and volume records are skipped
 * with a reason, and a link target is never quoted, because the only safe thing to do with a link
 * found inside an archive is to ignore it.
 */

const BLOCK_BYTES = 512
const NAME_OFFSET = 0
const NAME_BYTES = 100
const SIZE_OFFSET = 124
const SIZE_BYTES = 12
const CHECKSUM_OFFSET = 148
const CHECKSUM_BYTES = 8
/** The checksum field is read as spaces while the header sum is taken, exactly as `tar` writes it. */
const CHECKSUM_BLIND_START = 148
const CHECKSUM_BLIND_END = 156
const TYPE_FLAG_OFFSET = 156
const MAGIC_OFFSET = 257
const PREFIX_OFFSET = 345
const PREFIX_BYTES = 155

/**
 * A PAX or GNU meta header above this size cannot describe a path or a length BugPilot would ever
 * accept, so it is refused on the number rather than copied and searched.
 */
const MAX_META_BODY_BYTES = 64 * 1024

/** Digits past this many cannot survive as a safe JavaScript integer. */
const MAX_DECIMAL_DIGITS = 15

const FLAG = {
  old: 0x00,
  regular: 0x30,
  hardLink: 0x31,
  symlink: 0x32,
  charDevice: 0x33,
  blockDevice: 0x34,
  directory: 0x35,
  fifo: 0x36,
  contiguous: 0x37,
  gnuLongLink: 0x4b,
  gnuLongName: 0x4c,
  volumeContinuation: 0x4d,
  gnuSparse: 0x53,
  volumeLabel: 0x56,
  paxGlobal: 0x67,
  paxExtended: 0x78,
} as const

const SPECIAL_LABELS: Readonly<Record<number, string>> = {
  [FLAG.hardLink]: 'hard link',
  [FLAG.symlink]: 'symbolic link',
  [FLAG.charDevice]: 'character device',
  [FLAG.blockDevice]: 'block device',
  [FLAG.fifo]: 'FIFO',
  [FLAG.gnuSparse]: 'sparse file',
  [FLAG.volumeLabel]: 'volume label',
  [FLAG.volumeContinuation]: 'volume continuation',
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('iso-8859-1')
const nameEncoder = new TextEncoder()

function decodeTextField(bytes: Uint8Array): string {
  try {
    return utf8Strict.decode(bytes)
  } catch {
    return latin1.decode(bytes)
  }
}

/** The offending prefix of a hostile name, with NULs spelled out so the message stays printable. */
function printable(value: string): string {
  let out = ''
  for (const char of value.slice(0, 32)) out += char === '\u0000' ? '\\0' : char
  return out
}

function printableBytes(bytes: Uint8Array): string {
  return printable(decodeTextField(bytes))
}

function isAllZero(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i += 1) if (block[i] !== 0) return false
  return true
}

function specialLabel(typeFlag: number): string | null {
  const label = SPECIAL_LABELS[typeFlag]
  return typeof label === 'string' ? label : null
}

function hasTarMagic(block: Uint8Array): boolean {
  const magic = [0x75, 0x73, 0x74, 0x61, 0x72]
  for (let i = 0; i < magic.length; i += 1) if (block[MAGIC_OFFSET + i] !== magic[i]) return false
  // 'ustar\0' is POSIX and 'ustar ' is the pre-POSIX GNU variant; anything else is a false claim.
  const terminator = block[MAGIC_OFFSET + magic.length]
  return terminator === 0x00 || terminator === 0x20
}

/**
 * A tar header is only real if it adds up. The checksum is the one field a writer cannot rewrite
 * without re-deriving it, so a mismatch means the block is damage or a trap, never a file.
 */
function verifyHeader(block: Uint8Array, isFirstBlock: boolean): void {
  const declared = octalField(block, CHECKSUM_OFFSET, CHECKSUM_BYTES)
  let sum = 0
  for (let i = 0; i < BLOCK_BYTES; i += 1) {
    sum += i >= CHECKSUM_BLIND_START && i < CHECKSUM_BLIND_END ? 0x20 : block[i]
  }
  if (declared === null || declared !== sum) {
    refuse('corrupt_tar_header', '', 'its checksum does not match its own bytes')
  }
  if (!hasTarMagic(block)) {
    if (isFirstBlock) refuse('not_a_tar')
    refuse('corrupt_tar_header', '', 'it is missing the ustar signature')
  }
}

/** The size field, octal or base-256, bounded before the reader ever uses it. */
function readSizeField(block: Uint8Array): number {
  if ((block[SIZE_OFFSET] & 0x80) !== 0) {
    const wide = base256Field(block, SIZE_OFFSET, SIZE_BYTES)
    if (wide === null) refuse('corrupt_tar_header', '', 'its declared size is too large to count')
    return wide
  }
  const octal = octalField(block, SIZE_OFFSET, SIZE_BYTES)
  if (octal === null) refuse('corrupt_tar_header', '', 'its declared size is not a number')
  return octal
}

/**
 * Fixed-width string fields are NUL terminated, so a NUL with more bytes behind it is the classic
 * way to hide a second, hostile name from a reader that stops early.
 */
function readNameField(block: Uint8Array, offset: number, length: number): string {
  let end = 0
  while (end < length && block[offset + end] !== 0) end += 1
  for (let i = end; i < length; i += 1) {
    if (block[offset + i] !== 0) refuse('null_byte_in_name', printableBytes(block.subarray(offset, offset + end)))
  }
  return decodeTextField(block.subarray(offset, offset + end))
}

interface PaxOverrides {
  path: string | null
  size: number | null
}

function parsePaxValue(key: string, value: Uint8Array): string | number | null {
  if (key === 'path') {
    const text = decodeTextField(value)
    if (text.includes('\u0000')) refuse('null_byte_in_name', printable(text))
    return text
  }
  if (key !== 'size') return null
  let total = 0
  let digits = 0
  for (const byte of value) {
    if (byte < 0x30 || byte > 0x39) return null
    digits += 1
    if (digits > MAX_DECIMAL_DIGITS) return null
    total = total * 10 + (byte - 0x30)
  }
  if (digits === 0 || !Number.isSafeInteger(total)) return null
  return total
}

/**
 * PAX records are `<length> <key>=<value>\n`, where the length counts itself and the body may be
 * followed by NUL padding. Only `path` and `size` are honoured, and a record that does not parse
 * ends the scan: an unreadable tail cannot smuggle a name in, because nothing after it is used.
 */
function parsePaxRecords(body: Uint8Array, overrides: PaxOverrides): void {
  let at = 0
  while (at < body.length) {
    if (body[at] === 0) break
    let digits = 0
    while (at + digits < body.length && body[at + digits] >= 0x30 && body[at + digits] <= 0x39) digits += 1
    if (digits === 0 || digits > MAX_DECIMAL_DIGITS || body[at + digits] !== 0x20) break
    const length = Number.parseInt(decodeTextField(body.subarray(at, at + digits)), 10)
    // Bound the record against the body that is really there before a byte of it is copied.
    if (!Number.isSafeInteger(length) || length <= digits + 2 || at + length > body.length) break
    const record = body.subarray(at, at + length)
    at += length
    if (record[record.length - 1] !== 0x0a) break
    const separator = record.indexOf(0x3d, digits + 1)
    if (separator < 0) break
    const value = parsePaxValue(decodeTextField(record.subarray(digits + 1, separator)), record.subarray(separator + 1, record.length - 1))
    if (typeof value === 'string') overrides.path = value
    if (typeof value === 'number') overrides.size = value
  }
}

/** A GNU long name is the name itself plus a NUL and block padding; a second name is a trap. */
function readLongName(body: Uint8Array): string {
  let end = 0
  while (end < body.length && body[end] !== 0) end += 1
  for (let i = end; i < body.length; i += 1) {
    if (body[i] !== 0) refuse('null_byte_in_name', printableBytes(body.subarray(0, end)))
  }
  const text = decodeTextField(body.subarray(0, end))
  if (text === '') refuse('corrupt_tar_header', '', 'its long-name record is empty')
  return text
}

function paddedBodyBytes(size: number): number {
  return Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES
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

async function readBody(run: ReadRun, bytes: Uint8Array, start: number, size: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let produced = 0
  // Walking the member in slices keeps the shared ceilings in charge of the peak, so a member that
  // lies about its own length is caught on the slice that crosses the line rather than at the end.
  for (let cursor = start; cursor < start + size; cursor += run.limits.inflateChunkBytes) {
    const slice = bytes.subarray(cursor, Math.min(cursor + run.limits.inflateChunkBytes, start + size))
    enforceChunkBounds(run, { produced, chunkLength: slice.length, declaredSize: size, compressedSize: null })
    produced += slice.length
    chunks.push(slice)
    await breathe(run)
  }
  return concat(chunks, produced)
}

function skipFor(code: ArchiveSkipCode, name: string, extra?: string): ArchiveSkippedEntry {
  return { name, code, message: archiveReasonMessage(code, name, extra) }
}

/** Skips decided from the header alone, so an oversized member is never accumulated at all. */
function declaredSkip(typeFlag: number, label: string | null, name: string, size: number, run: ReadRun): ArchiveSkipCode | null {
  if (label) return 'special_entry'
  if (typeFlag === FLAG.directory) return 'directory_entry'
  if (isIgnoredPath(name, run.includeGenerated)) return 'ignored_folder'
  if (!run.includeGenerated && isOsMetadataFile(name)) return 'generated_file'
  if (hasBinaryExtension(name)) return 'binary_content'
  if (size === 0) return 'empty_entry'
  if (size > run.limits.maxSingleFileUncompressedBytes) return 'single_file_too_large'
  return null
}

export async function readTar(bytes: Uint8Array, options: ReadOptions = {}): Promise<ArchiveReadResult> {
  const run = createRun(options)
  const entries: ArchiveEntry[] = []
  const skipped: ArchiveSkippedEntry[] = []
  const finish = (refusal: ArchiveRefusal | null): ArchiveReadResult => finishRun(run, refusal, entries, skipped)
  const seen = new Set<string>()
  const pax: PaxOverrides = { path: null, size: null }

  let pendingLongName: string | null = null
  let declaredBudget = 0
  let sawEndOfArchive = false
  let at = 0
  /** The record being read, so a stop inside it can name the file that was cut off. */
  let currentName: string | null = null
  let currentSize = 0

  /**
   * A tar is sequential, so the names after the stop are unknown. The record that was cut off is
   * named, and one marker accounts for everything behind it; the planned count is what the report
   * shows, so it is kept to files the reader can actually name.
   */
  const partialAt = (code: PartialStopCode, subject: string | number): ArchiveReadResult => {
    if (currentName !== null) skipped.push(notReachedEntry(currentName, code))
    skipped.push(notReachedEntry('(rest of the archive)', code))
    run.stats.plannedEntries = entries.length + (currentName !== null ? 2 : 1)
    run.stats.plannedBytes = run.stats.producedBytes + currentSize
    run.stats.durationMs = Date.now() - run.started
    return partialReadResult(run.stats, code, subject, entries, skipped)
  }

  try {
    // The byte ceiling runs before a single header is parsed, so an oversized upload costs one
    // comparison rather than a walk.
    if (run.signal?.aborted) refuse('cancelled')
    const ceiling = Math.min(run.limits.maxArchiveBytes, run.limits.maxTarArchiveBytes)
    if (bytes.length > ceiling) refuse('archive_too_large', bytes.length)

    while (at + BLOCK_BYTES <= bytes.length) {
      const block = bytes.subarray(at, at + BLOCK_BYTES)
      // Two zero blocks close an archive, and `tar` pads that run out to a whole blocking factor,
      // so a zero block means the records are over rather than an entry with no name.
      if (isAllZero(block)) {
        sawEndOfArchive = true
        break
      }
      verifyHeader(block, at === 0)
      run.stats.walkedRecords += 1
      if (run.stats.walkedRecords > run.limits.maxParsedEntryCount) {
        refuse('entry_count_exceeded', run.limits.maxParsedEntryCount)
      }

      const headerSize = readSizeField(block)
      const typeFlag = block[TYPE_FLAG_OFFSET]
      const isMeta =
        typeFlag === FLAG.paxExtended || typeFlag === FLAG.paxGlobal || typeFlag === FLAG.gnuLongName || typeFlag === FLAG.gnuLongLink

      if (isMeta) {
        // A forged metadata length is the first thing an attacker rewrites, so it is bounded twice:
        // against a cap that makes no sense for metadata, then against the bytes that exist.
        if (headerSize > MAX_META_BODY_BYTES) {
          const kind = typeFlag === FLAG.gnuLongName ? 'long-name' : 'extended'
          refuse('corrupt_tar_header', '', `its ${kind} header claims ${headerSize} bytes of metadata`)
        }
        const metadataBytes = paddedBodyBytes(headerSize)
        if (at + BLOCK_BYTES + metadataBytes > bytes.length) {
          refuse('corrupt_tar_header', '', 'its metadata runs past the end of the archive')
        }
        const body = bytes.subarray(at + BLOCK_BYTES, at + BLOCK_BYTES + headerSize)
        if (typeFlag === FLAG.paxExtended) parsePaxRecords(body, pax)
        if (typeFlag === FLAG.gnuLongName) pendingLongName = readLongName(body)
        // Global PAX records describe the archive rather than the entry that follows, so a single
        // `path` in one cannot rename every member and the records are dropped. Long link names
        // point at links, which are never followed, so those bodies are skipped unread as well.
        at += BLOCK_BYTES + metadataBytes
        await breathe(run)
        continue
      }

      const nameField = readNameField(block, NAME_OFFSET, NAME_BYTES)
      const prefix = readNameField(block, PREFIX_OFFSET, PREFIX_BYTES)
      const label = specialLabel(typeFlag)
      // The metadata applies to this entry only, so it is taken before the reset below.
      const longName = pendingLongName
      const paxPath = pax.path
      const paxSize = pax.size
      pendingLongName = null
      pax.path = null
      pax.size = null
      const name = longName ?? paxPath ?? (prefix === '' ? nameField : `${prefix}/${nameField}`)
      // A special entry is named so the user can see what was skipped, but an ordinary entry with
      // no name at all is a damaged header, not a file.
      if (name === '') refuse('corrupt_tar_header', printable(`${nameField}${prefix}`), 'it carries no file name')

      if (nameEncoder.encode(name).length > run.limits.maxEntryNameBytes) refuse('name_too_long', name)
      validateName(name)
      if (isNestedArchive(name)) refuse('nested_archive', name)
      if (seen.has(name)) refuse('duplicate_name', name)
      seen.add(name)

      const size = paxSize ?? headerSize
      const bodyBytes = paddedBodyBytes(size)
      // Every length the reader is about to use has to exist in the file before it is used.
      if (at + BLOCK_BYTES + bodyBytes > bytes.length) refuse('archive_truncated', printable(name))

      // A previous pass already read this entry. Walk past its body without decoding it: the
      // bytes still cost I/O here, and re-inflate for a .tar.gz at the gzip layer, but they are
      // not analysed again and do not count against this pass's budgets.
      if (run.resumeProcessedNames?.has(name)) {
        at += BLOCK_BYTES + bodyBytes
        await breathe(run)
        continue
      }

      currentName = name
      currentSize = size
      const skipCode = declaredSkip(typeFlag, label, name, size, run)
      if (skipCode) {
        skipped.push(skipFor(skipCode, name, label ?? undefined))
        run.stats.skipped = skipped.length
      } else {
        if (entries.length >= run.limits.maxEntryCount) {
          // The cap counts files analysed, not records walked, so a tar full of directories and
          // skipped binaries can still hold far more records than this cap.
          if (!run.keepPartial) refuse('entry_count_exceeded', run.limits.maxEntryCount)
          return partialAt('entry_count_exceeded', run.limits.maxEntryCount)
        }
        if (declaredBudget + size > run.limits.maxTotalUncompressedBytes) {
          if (!run.keepPartial) refuse('total_uncompressed_exceeded', run.limits.maxTotalUncompressedBytes)
          return partialAt('total_uncompressed_exceeded', run.limits.maxTotalUncompressedBytes)
        }
        const bodyStart = at + BLOCK_BYTES
        try {
          const body = await readBody(run, bytes, bodyStart, size)
          if (looksBinary(body)) skipEntry('binary_content')
          const decoded = decodeBytes(body)
          const detection = detectLanguage(name, decoded.text)
          run.stats.producedBytes += body.length
          declaredBudget += body.length
          entries.push({
            name,
            text: decoded.text,
            language: detection.language,
            languageSource: detection.source,
            encoding: decoded.encoding,
            bytes: body.length,
          })
          run.stats.entries = entries.length
          run.stats.skipped = skipped.length
          reportProgress(run, 'extract')
        } catch (error) {
          if (error instanceof PartialStop) return partialAt(error.code as PartialStopCode, error.subject)
          if (!(error instanceof SkipSingle)) throw error
          skipped.push(skipFor(error.code, name))
          run.stats.skipped = skipped.length
        }
      }

      at += BLOCK_BYTES + bodyBytes
      // The record is complete, so a stop in the yield below is about the records behind it.
      currentName = null
      currentSize = 0
      await breathe(run)
    }

    // Reaching the end of the bytes without meeting the closing zero blocks means the archive was
    // cut off, so what it did contain is not trustworthy.
    if (!sawEndOfArchive) refuse('archive_truncated')
  } catch (error) {
    if (error instanceof PartialStop) return partialAt(error.code as PartialStopCode, error.subject)
    return finish(toRefusal(error))
  }

  return finish(null)
}
