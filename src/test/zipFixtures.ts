import { deflateSync } from 'fflate'

/**
 * Test-only ZIP writer. Hostile archives are generated at runtime so no zip binary is ever
 * committed and so a single field can be forged while every other byte stays correct.
 */

const encoder = new TextEncoder()

function utf8Encode(value: string): Uint8Array {
  return encoder.encode(value)
}

/**
 * Deliberately a slow bitwise implementation: the reader ships a table-driven CRC, and the two
 * agreeing is evidence rather than a tautology.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntrySpec {
  name: string
  /** Stored bytes for the entry. A string is UTF-8 encoded. */
  content?: Uint8Array | string
  /** 0 = stored, 8 = deflated. Anything else is an unsupported method. */
  method?: number
  /** Forge the CRC written into both headers. */
  crcOverride?: number
  /** Forge the uncompressed size (central directory and local header). */
  declaredUncompressed?: number
  /** Forge the compressed size. */
  declaredCompressed?: number
  /** Forge only the local header sizes, leaving the central directory honest. */
  localDeclaredUncompressed?: number
  localDeclaredCompressed?: number
  /** Set the general-purpose bit 0 (encrypted). */
  encrypted?: boolean
  /** Mark the entry as a symlink in the external attributes. */
  symlink?: boolean
  directory?: boolean
  /** Set general-purpose bit 3 (size follows in a data descriptor). */
  dataDescriptor?: boolean
  /** Write a different (longer) name in the local header than in the central directory. */
  localNameOverride?: string
  /** Forge only the central-directory local-header offset, leaving the real records in place. */
  localHeaderOffsetOverride?: number
}

export interface ZipBuildOptions {
  /** Forge the EOCD total-entry field only; the real records are still written. */
  declaredEntryCount?: number
  /** Forge the EOCD central-directory offset. */
  declaredCdOffset?: number
  /** Forge the EOCD central-directory size. */
  declaredCdSize?: number
  /** Omit the EOCD entirely. */
  omitEocd?: boolean
  /** Keep only the first N bytes of the finished archive. */
  truncateTo?: number
  /** Prefix junk, e.g. a self-extracting stub. */
  prepend?: Uint8Array
  /** Emit a ZIP64 end-of-central-directory record. */
  zip64?: boolean
  /** Entry name encoding: bytes are used verbatim when given as a Uint8Array spec. */
  rawNames?: Record<string, Uint8Array>
  /** Append an end-of-directory comment and declare its real length. */
  comment?: string
  /** Forge the disk numbers: the archive is split across volumes when either is nonzero. */
  diskNumber?: number
  centralDirectoryDisk?: number
}

const SIG_LFH = 0x04034b50
const SIG_CD = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const S_IFLNK = 0xa000
const S_IFDIR = 0x0010

const parts: number[] = []

function sink(): Uint8Array {
  return Uint8Array.from(parts)
}

function pushBytes(data: Uint8Array) {
  for (let i = 0; i < data.length; i += 1) parts.push(data[i])
}

function pushU16(value: number) {
  parts.push(value & 0xff, (value >>> 8) & 0xff)
}

function pushU32(value: number) {
  parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function nameBytes(spec: ZipEntrySpec, raw?: Uint8Array): Uint8Array {
  if (raw) return raw
  return utf8Encode(spec.name)
}

function entryBody(spec: ZipEntrySpec): { raw: Uint8Array; bytes: Uint8Array; method: number } {
  const text = typeof spec.content === 'string' ? utf8Encode(spec.content) : (spec.content ?? new Uint8Array(0))
  if (spec.method === undefined || spec.method === 0) return { raw: text, bytes: text, method: 0 }
  if (spec.method === 8) return { raw: text, bytes: deflateSync(text), method: 8 }
  return { raw: text, bytes: text, method: spec.method }
}

export function buildZip(entries: ZipEntrySpec[], options: ZipBuildOptions = {}): Uint8Array {
  parts.length = 0
  if (options.prepend) pushBytes(options.prepend)

  const records: Uint8Array[] = []
  const sizes: number[] = []

  for (const spec of entries) {
    const raw = options.rawNames?.[spec.name]
    const name = nameBytes(spec, raw)
    const localName = options.rawNames?.[spec.name] ?? (spec.localNameOverride ? utf8Encode(spec.localNameOverride) : name)
    const body = entryBody(spec)
    const uncompressed = body.raw.length
    const crc = spec.crcOverride ?? crc32(body.raw)
    const flags =
      (spec.encrypted ? 0x0001 : 0) |
      (spec.dataDescriptor ? 0x0008 : 0) |
      (raw ? 0x0800 : 0)
    const externalAttrs = spec.symlink
      ? ((0o120777 << 16) | S_IFLNK >>> 0) & 0xffffffff
      : spec.directory
        ? ((0o40755 << 16) | S_IFDIR) & 0xffffffff
        : ((0o100644 << 16) | 0) & 0xffffffff
    const versionMadeBy = spec.symlink || spec.directory ? 0x031e : 0x0014

    const offset = parts.length
    pushU32(SIG_LFH)
    pushU16(20)
    pushU16(flags)
    pushU16(body.method)
    pushU16(0) // time
    pushU16(0x2821) // date
    pushU32(crc)
    pushU32((spec.localDeclaredCompressed ?? spec.declaredCompressed ?? body.bytes.length) >>> 0)
    pushU32((spec.localDeclaredUncompressed ?? spec.declaredUncompressed ?? uncompressed) >>> 0)
    pushU16(localName.length)
    pushU16(0)
    pushBytes(localName)
    if (!spec.directory) pushBytes(body.bytes)
    sizes.push(parts.length - offset)

    const cd = new Uint8Array(46 + name.length)
    let p = 0
    const putU16 = (v: number) => {
      cd[p++] = v & 0xff
      cd[p++] = (v >>> 8) & 0xff
    }
    const putU32 = (v: number) => {
      cd[p++] = v & 0xff
      cd[p++] = (v >>> 8) & 0xff
      cd[p++] = (v >>> 16) & 0xff
      cd[p++] = (v >>> 24) & 0xff
    }
    putU32(SIG_CD)
    putU16(versionMadeBy)
    putU16(20)
    putU16(flags)
    putU16(body.method)
    putU16(0)
    putU16(0x2821)
    putU32(crc)
    putU32((spec.declaredCompressed ?? body.bytes.length) >>> 0)
    putU32((spec.declaredUncompressed ?? uncompressed) >>> 0)
    putU16(name.length)
    putU16(0)
    putU16(0)
    putU16(0)
    putU16(0)
    putU32(externalAttrs)
    putU32((spec.localHeaderOffsetOverride ?? offset) >>> 0)
    cd.set(name, p)
    records.push(cd)
  }

  const cdOffset = parts.length
  for (const record of records) pushBytes(record)
  const cdSize = parts.length - cdOffset

  if (options.zip64) {
    const z64 = parts.length
    pushU32(SIG_ZIP64_EOCD)
    pushU32(44)
    pushU32(0)
    pushU16(45)
    pushU16(0)
    pushU32(0)
    pushU32(0)
    pushU32(entries.length >>> 0)
    pushU32(0)
    pushU32(entries.length >>> 0)
    pushU32(0)
    pushU32(cdSize >>> 0)
    pushU32(0)
    pushU32(cdOffset >>> 0)
    pushU32(0)
    pushU32(SIG_ZIP64_LOCATOR)
    pushU32(0)
    pushU32(z64 >>> 0)
    pushU32(0)
    pushU32(1)
  }

  if (!options.omitEocd) {
    const comment = options.comment === undefined ? new Uint8Array(0) : utf8Encode(options.comment)
    pushU32(SIG_EOCD)
    pushU16(options.diskNumber ?? 0)
    pushU16(options.centralDirectoryDisk ?? 0)
    pushU16((options.declaredEntryCount ?? entries.length) & 0xffff)
    pushU16((options.declaredEntryCount ?? entries.length) & 0xffff)
    pushU32((options.declaredCdSize ?? cdSize) >>> 0)
    pushU32((options.declaredCdOffset ?? cdOffset) >>> 0)
    pushU16(comment.length)
    pushBytes(comment)
  }

  const bytes = sink()
  if (options.truncateTo !== undefined) return bytes.subarray(0, options.truncateTo)
  return bytes
}

/** Bytes for a zip64 end-of-central-directory locator, used to prove refusal. */
export function zip64Archive(): Uint8Array {
  return buildZip([{ name: 'a.txt', content: 'hello\n' }], { zip64: true })
}

export function textFile(body: string): Uint8Array {
  return utf8Encode(body)
}

export const FIXTURE_LIMITS = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxSingleFileUncompressedBytes: 2 * 1024 * 1024,
  maxEntryCount: 2_000,
} as const
