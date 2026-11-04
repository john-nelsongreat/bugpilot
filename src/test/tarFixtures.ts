/**
 * Test-only TAR writer. Every archive in the tests is generated at runtime so no archive binary
 * is ever committed and so one field can be forged while every other byte stays correct. The
 * reader ships its own header arithmetic; the two agreeing on a normal archive is evidence, and
 * the two disagreeing on a forged one is the point.
 */

const encoder = new TextEncoder()
const BLOCK = 512

/** Header typeflags, exactly as POSIX and GNU define them. */
export const TAR_TYPE = {
  file: '0',
  hardLink: '1',
  symlink: '2',
  charDevice: '3',
  blockDevice: '4',
  directory: '5',
  fifo: '6',
  contiguous: '7',
  gnuLongName: 'L',
  gnuLongLink: 'K',
  paxExtended: 'x',
  paxGlobal: 'g',
  gnuSparse: 'S',
  volumeLabel: 'V',
  volumeContinuation: 'M',
} as const

export interface TarEntrySpec {
  name: string
  /** Stored bytes for the entry. A string is UTF-8 encoded. */
  content?: Uint8Array | string
  typeFlag?: string
  linkName?: string
  mode?: number
  /** Bytes written after the header, independent of `content`. */
  rawBody?: Uint8Array
  /** Forge the size field so the header lies about how much data follows. */
  sizeOverride?: number
  /** Write the 12-byte size field verbatim, so a base-256 field can be spelled exactly. */
  sizeRaw?: number[]
  /** Write a checksum that does not match the header. */
  breakChecksum?: boolean
  /** ustar `prefix` field, used for the 155+100 split long path. */
  prefix?: string
  /** 'ustar\0' (POSIX) or 'ustar ' (pre-POSIX). Anything else is a damaged magic. */
  magicOverride?: string
  /** PAX extended-header records emitted for this entry (typeflag x). */
  pax?: Record<string, string>
  /** Global PAX records emitted before the entry (typeflag g). */
  paxGlobal?: Record<string, string>
  /** GNU long name (typeflag L) emitted before the entry, overriding `name`. */
  gnuLongName?: string
  /** GNU long link name (typeflag K) paired with a symlink/hardlink. */
  gnuLongLink?: string
  /** Raw bytes for the 100-byte name field, bypassing string encoding. */
  rawName?: Uint8Array
}

export interface TarBuildOptions {
  /** Omit the two zero blocks that close an archive. */
  omitEndOfArchive?: boolean
  /** Zero blocks written at the end; defaults to the standard two. */
  endBlocks?: number
  /** Keep only the first N bytes of the finished archive. */
  truncateTo?: number
  /** Bytes of junk written before the first header. */
  prepend?: Uint8Array
  /** Total bytes the archive is padded to, so a reader cannot rely on the length. */
  padTo?: number
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value)
}

function contentBytes(spec: TarEntrySpec): Uint8Array {
  if (spec.rawBody) return spec.rawBody
  if (typeof spec.content === 'string') return bytes(spec.content)
  return spec.content ?? new Uint8Array(0)
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0')
}

function writeString(block: Uint8Array, offset: number, length: number, value: string): void {
  const encoded = bytes(value)
  block.set(encoded.subarray(0, Math.min(length, encoded.length)), offset)
}

function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  writeString(block, offset, length, octal(value, length))
  block[offset + length - 1] = 0
}

/**
 * Base-256 encoding (high bit set on the first byte), which GNU tar uses for sizes over 8 GiB.
 * Used by the tests to prove the reader bounds it instead of trusting it. Arithmetic is done with
 * division rather than bit masks so a value past 2^32 is spelled correctly rather than wrapped.
 */
function writeBase256(block: Uint8Array, offset: number, length: number, value: number): void {
  block[offset] = 0x80
  let remaining = value
  for (let i = offset + length - 1; i > offset; i -= 1) {
    block[i] = remaining % 256
    remaining = Math.floor(remaining / 256)
  }
}

/** A PAX record is `<length> <key>=<value>\n`, where length counts itself. */
function paxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`
  const bodyBytes = bytes(body).length
  let length = bodyBytes + 2
  for (let guard = 0; guard < 32; guard += 1) {
    const total = bodyBytes + String(length).length + 1
    if (total === length) break
    length = total
  }
  return `${length} ${body}`
}

function pad(body: Uint8Array): Uint8Array {
  const remainder = body.length % BLOCK
  if (remainder === 0) return body
  const out = new Uint8Array(body.length + (BLOCK - remainder))
  out.set(body)
  return out
}

function headerChecksum(block: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < BLOCK; i += 1) {
    // The checksum field is read as spaces while the sum is taken.
    sum += i >= 148 && i < 156 ? 0x20 : block[i]
  }
  return sum
}

function writeHeader(spec: TarEntrySpec, name: string, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK)
  writeString(block, 0, 100, name)
  if (spec.rawName) block.set(spec.rawName.subarray(0, Math.min(100, spec.rawName.length)), 0)
  writeOctal(block, 100, 8, spec.mode ?? 0o644)
  writeOctal(block, 108, 8, 1000)
  writeOctal(block, 116, 8, 1000)
  if (spec.sizeRaw) {
    block.set(spec.sizeRaw.slice(0, 12), 124)
  } else if (spec.sizeOverride === undefined) {
    writeOctal(block, 124, 12, size)
  } else if (spec.sizeOverride > 0o77777777777) {
    writeBase256(block, 124, 12, spec.sizeOverride)
  } else {
    writeOctal(block, 124, 12, spec.sizeOverride)
  }
  writeOctal(block, 136, 12, 1_700_000_000)
  block[148] = 0x20
  block[155] = 0x20
  block[156] = (spec.typeFlag ?? TAR_TYPE.file).charCodeAt(0)
  writeString(block, 157, 100, spec.linkName ?? '')
  writeString(block, 257, 6, spec.magicOverride ?? 'ustar\0')
  writeString(block, 263, 2, '00')
  writeString(block, 265, 32, 'tester')
  writeString(block, 297, 32, 'group')
  writeOctal(block, 329, 8, 0)
  writeOctal(block, 337, 8, 0)
  writeString(block, 345, 155, spec.prefix ?? '')

  const sum = headerChecksum(block)
  const field = spec.breakChecksum ? octal(sum ^ 0o35, 6) : octal(sum, 6)
  for (let i = 0; i < 6; i += 1) block[148 + i] = field.charCodeAt(i)
  block[154] = 0
  block[155] = 0x20
  return block
}

function writeMetaSize(block: Uint8Array, size: number): void {
  writeOctal(block, 124, 12, size)
  // The checksum still has to be right, or the forge is caught by the header check instead of
  // the size check, which would prove the wrong thing.
  const sum = headerChecksum(block)
  const field = octal(sum, 6)
  for (let i = 0; i < 6; i += 1) block[148 + i] = field.charCodeAt(i)
  block[154] = 0
  block[155] = 0x20
}

/** A GNU long-link or PAX extended header plus its body, as whole blocks. */
function metaBlocks(typeFlag: string, body: Uint8Array, sizeOverride?: number): Uint8Array[] {
  const name =
    typeFlag === TAR_TYPE.gnuLongName || typeFlag === TAR_TYPE.gnuLongLink ? '././@LongLink' : 'PaxHeaders.0/record'
  // A meta header names itself; the reader never uses it for the entry it describes.
  const header = writeHeader({ name, typeFlag, mode: 0o644 }, name, body.length)
  if (sizeOverride !== undefined) writeMetaSize(header, sizeOverride)
  const out = [header]
  const padded = pad(body)
  for (let at = 0; at < padded.length; at += BLOCK) out.push(padded.subarray(at, at + BLOCK))
  return out
}

function paxBody(records: Record<string, string>): Uint8Array {
  return bytes(Object.entries(records).map(([key, value]) => paxRecord(key, value)).join(''))
}

export function buildTarBlocks(entries: TarEntrySpec[], options: TarBuildOptions = {}): Uint8Array[] {
  const blocks: Uint8Array[] = []
  for (const spec of entries) {
    if (spec.paxGlobal) blocks.push(...metaBlocks(TAR_TYPE.paxGlobal, paxBody(spec.paxGlobal)))
    if (spec.gnuLongName) blocks.push(...metaBlocks(TAR_TYPE.gnuLongName, bytes(`${spec.gnuLongName}\0`)))
    if (spec.gnuLongLink) blocks.push(...metaBlocks(TAR_TYPE.gnuLongLink, bytes(`${spec.gnuLongLink}\0`)))
    if (spec.pax) blocks.push(...metaBlocks(TAR_TYPE.paxExtended, paxBody(spec.pax)))

    const body = contentBytes(spec)
    blocks.push(writeHeader(spec, spec.name, spec.sizeOverride ?? body.length))
    const padded = pad(body)
    for (let at = 0; at < padded.length; at += BLOCK) blocks.push(padded.subarray(at, at + BLOCK))
  }
  if (!options.omitEndOfArchive) {
    const count = options.endBlocks ?? 2
    for (let i = 0; i < count; i += 1) blocks.push(new Uint8Array(BLOCK))
    // `tar` finishes the archive on a whole blocking factor, so the zero run continues until the
    // block count is a multiple of 20. A reader must not be surprised by it.
    if (count > 0) while (blocks.length % 20 !== 0) blocks.push(new Uint8Array(BLOCK))
  }
  return blocks
}

export function buildTar(entries: TarEntrySpec[], options: TarBuildOptions = {}): Uint8Array {
  const blocks = buildTarBlocks(entries, options)
  let total = 0
  for (const block of blocks) total += block.length
  let size = total
  if (options.prepend) size += options.prepend.length
  if (options.padTo !== undefined && options.padTo > size) size = options.padTo

  const out = new Uint8Array(size)
  let at = 0
  if (options.prepend) {
    out.set(options.prepend, at)
    at += options.prepend.length
  }
  for (const block of blocks) {
    out.set(block, at)
    at += block.length
  }

  const finished = options.truncateTo === undefined ? out : out.subarray(0, options.truncateTo)
  return finished
}

/** An archive that holds no entries: the blocking factor of a `tar` run over an empty folder. */
export function emptyTar(): Uint8Array {
  return new Uint8Array(BLOCK * 20)
}

/** The smallest honest archive: one text file, a correct trailer, a verifiable header. */
export function tarOf(name: string, body: string): Uint8Array {
  return buildTar([{ name, content: body }])
}

/** An archive whose only header carries a checksum that does not match its own bytes. */
export function tarWithBadChecksum(): Uint8Array {
  return buildTar([{ name: 'src/app.js', content: 'export const a = 1\n', breakChecksum: true }])
}

/** A PAX or GNU long-name header with a forged size, for the lying-meta-header tests. */
export function tarMetaBlocks(typeFlag: string, records: Record<string, string>, sizeOverride?: number): Uint8Array[] {
  return metaBlocks(typeFlag, paxBody(records), sizeOverride)
}

/** A GNU long-name ('L') header whose declared size does not match its body. */
export function tarLongNameBlocks(name: string, sizeOverride?: number): Uint8Array[] {
  return metaBlocks(TAR_TYPE.gnuLongName, bytes(`${name}\0`), sizeOverride)
}

export { BLOCK as TAR_BLOCK, bytes as tarBytes }
