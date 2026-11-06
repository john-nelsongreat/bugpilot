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

/** Which 32-bit fields of an entry are too small to hold their own number. */
export type Zip64Field = 'uncompressed' | 'compressed' | 'offset' | 'disk'

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
  /** Forge only the local header compression method. */
  localMethodOverride?: number
  /** Forge only the local header general-purpose flags. */
  localFlagsOverride?: number
  /** Set the general-purpose bit 0 (encrypted). */
  encrypted?: boolean
  /** Set general-purpose bit 11 even when the name is plain ASCII, as Java's writer does. */
  utf8Flag?: boolean
  /** Clear bit 11 for a name given as raw CP437 bytes, the way old DOS-era writers do. */
  cp437Name?: boolean
  /** Forge the external attributes word; otherwise it is derived from the other flags. */
  externalAttrsOverride?: number
  /** Mark the entry as a symlink in the external attributes. */
  symlink?: boolean
  directory?: boolean
  /** Set general-purpose bit 3 (size follows in a data descriptor). */
  dataDescriptor?: boolean
  /** Bit 3 only: omit the `0x08074b50` signature that most writers put first. */
  descriptorSignature?: boolean
  /** Bit 3 only: write the two size fields as eight bytes, as zip64 entries do. */
  descriptorZip64Sizes?: boolean
  /** Bit 3 only: keep the real checksum and sizes in the local header as well. */
  descriptorLocalHonest?: boolean
  /** Bit 3 only: advertise the descriptor but write no bytes for it. */
  descriptorOmitted?: boolean
  /** Bit 3 only: forge the value the descriptor stores. */
  descriptorCrcOverride?: number
  descriptorCompressedOverride?: number
  descriptorUncompressedOverride?: number
  /** Write a different (longer) name in the local header than in the central directory. */
  localNameOverride?: string
  /** Forge only the central-directory local-header offset, leaving the real records in place. */
  localHeaderOffsetOverride?: number
  /**
   * Store the entry's sizes or offset as zip64 all-ones markers, with the real numbers in a
   * `0x0001` extra field. `true` marks uncompressed, compressed and offset.
   */
  zip64?: true | 'sizes' | Zip64Field | Zip64Field[]
  /** Forge the values written inside the `0x0001` extra field. */
  zip64Uncompressed?: number | bigint
  zip64Compressed?: number | bigint
  zip64LocalOffset?: number | bigint
  zip64Disk?: number
  /** Write the markers but no `0x0001` field, so nothing resolves them. */
  zip64ExtraOmitted?: boolean
  /** Forge the `0x0001` body length so the field runs past the end of the record. */
  zip64ExtraSizeOverride?: number
  /** Raw bytes written as the local header's extra field, after the name. */
  localExtra?: Uint8Array
  /** Info-ZIP unicode path extra field (`0x7855`) carrying the real UTF-8 name. */
  unicodePathName?: string
  /** Forge the checksum that guards the unicode path extra field. */
  unicodePathCrcOverride?: number
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
  /** `sparse` stores only the marked fields, as the specification says; `dense` always stores all. */
  zip64ExtraShape?: 'sparse' | 'dense'
  /** Forge the entry count, central-directory size or offset inside the zip64 end record. */
  zip64EntryCount?: number | bigint
  zip64CdSize?: number | bigint
  zip64CdOffset?: number | bigint
  /** Forge where the locator claims the zip64 end record starts, or how large it is. */
  zip64RecordOffset?: number
  zip64RecordSize?: number | bigint
  /** Forge the zip64 disk numbers: a nonzero start volume or more than one volume is a split set. */
  zip64DiskNumber?: number
  zip64TotalDisks?: number
  /** Keep the real numbers in the ordinary end record as well as the zip64 one. */
  zip64EocdHonest?: boolean
  /** Entry name encoding: bytes are used verbatim when given as a Uint8Array spec. */
  rawNames?: Record<string, Uint8Array>
  /** Append an end-of-directory comment and declare its real length. */
  comment?: string
  /** Bytes written after the EOCD: junk a real tail scanner has to step over. */
  append?: Uint8Array
  /** Forge the disk numbers: the archive is split across volumes when either is nonzero. */
  diskNumber?: number
  centralDirectoryDisk?: number
}

const SIG_LFH = 0x04034b50
const SIG_CD = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_DATA_DESCRIPTOR = 0x08074b50
const EXTRA_ZIP64 = 0x0001
const EXTRA_UNICODE_PATH = 0x7855
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

/** Little-endian eight-byte field: how zip64 stores every size and offset. */
function pushU64(value: number | bigint) {
  const wide = BigInt(value)
  pushU32(Number(wide & 0xffffffffn))
  pushU32(Number((wide >> 32n) & 0xffffffffn))
}

function nameBytes(spec: ZipEntrySpec, raw?: Uint8Array): Uint8Array {
  if (raw) return raw
  return utf8Encode(spec.name)
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function entryBody(spec: ZipEntrySpec): { raw: Uint8Array; bytes: Uint8Array; method: number } {
  const text = typeof spec.content === 'string' ? utf8Encode(spec.content) : (spec.content ?? new Uint8Array(0))
  if (spec.method === undefined || spec.method === 0) return { raw: text, bytes: text, method: 0 }
  if (spec.method === 8) return { raw: text, bytes: deflateSync(text), method: 8 }
  return { raw: text, bytes: text, method: spec.method }
}

function zip64Fields(spec: ZipEntrySpec): Zip64Field[] {
  if (!spec.zip64) return []
  if (spec.zip64 === true) return ['uncompressed', 'compressed', 'offset']
  if (spec.zip64 === 'sizes') return ['uncompressed', 'compressed']
  if (Array.isArray(spec.zip64)) return spec.zip64
  return [spec.zip64]
}

function frame(headerId: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + body.length)
  const view = new DataView(out.buffer)
  view.setUint16(0, headerId, true)
  view.setUint16(2, body.length, true)
  out.set(body, 4)
  return out
}

/**
 * The `0x0001` field. The specification keeps only the fields whose 32-bit copy was the all-ones
 * marker, in the order uncompressed size, compressed size, offset, disk; some writers always emit
 * the full set. Both shapes are produced here so a reader that mixes them up is caught.
 */
function extraZip64(
  fields: Zip64Field[],
  shape: 'sparse' | 'dense',
  values: { uncompressed: number; compressed: number; offset: number; disk: number },
  spec: ZipEntrySpec,
): Uint8Array {
  const wide = shape === 'dense'
  const list = wide
    ? fields.includes('disk')
      ? (['uncompressed', 'compressed', 'offset', 'disk'] as Zip64Field[])
      : (['uncompressed', 'compressed', 'offset'] as Zip64Field[])
    : fields
  const body = new Uint8Array(list.reduce((n, f) => n + (f === 'disk' ? 4 : 8), 0))
  const view = new DataView(body.buffer)
  let at = 0
  for (const field of list) {
    if (field === 'disk') {
      view.setUint32(at, spec.zip64Disk ?? values.disk, true)
      at += 4
      continue
    }
    const value =
      field === 'uncompressed'
        ? (spec.zip64Uncompressed ?? values.uncompressed)
        : field === 'compressed'
          ? (spec.zip64Compressed ?? values.compressed)
          : (spec.zip64LocalOffset ?? values.offset)
    const asBigInt = BigInt(value)
    if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER) || asBigInt < 0n) {
      // Values past safe range still have to be written little-endian, byte by byte.
      for (let byte = 0; byte < 8; byte += 1) body[at + byte] = Number((asBigInt >> BigInt(8 * byte)) & 0xffn)
    } else {
      view.setBigUint64(at, asBigInt, true)
    }
    at += 8
  }
  return frame(EXTRA_ZIP64, body)
}

function extraUnicodePath(spec: ZipEntrySpec, nameBytes: Uint8Array): Uint8Array {
  const name = utf8Encode(spec.unicodePathName as string)
  const body = new Uint8Array(4 + name.length)
  new DataView(body.buffer).setUint32(0, spec.unicodePathCrcOverride ?? crc32(nameBytes), true)
  body.set(name, 4)
  return frame(EXTRA_UNICODE_PATH, body)
}

export function buildZip(entries: ZipEntrySpec[], options: ZipBuildOptions = {}): Uint8Array {
  parts.length = 0
  if (options.prepend) pushBytes(options.prepend)

  const records: Uint8Array[] = []
  const sizes: number[] = []
  const shape = options.zip64ExtraShape ?? 'sparse'

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
      (spec.cp437Name ? 0 : spec.utf8Flag || raw ? 0x0800 : 0)
    const externalAttrs =
      spec.externalAttrsOverride ??
      (spec.symlink
        ? ((0o120777 << 16) | S_IFLNK >>> 0) & 0xffffffff
        : spec.directory
          ? ((0o40755 << 16) | S_IFDIR) & 0xffffffff
          : ((0o100644 << 16) | 0) & 0xffffffff)
    const versionMadeBy = spec.symlink || spec.directory ? 0x031e : 0x0014

    const offset = parts.length
    // A writer that cannot seek back leaves these three fields empty and repeats them after the
    // data; Explorer, `zip -r -`, PowerShell and Java's ZipOutputStream all do exactly that.
    const inDescriptor = spec.dataDescriptor === true && spec.descriptorLocalHonest !== true
    const localExtra = spec.localExtra ?? new Uint8Array(0)
    pushU32(SIG_LFH)
    pushU16(spec.zip64 ? 45 : 20)
    pushU16(spec.localFlagsOverride ?? flags)
    pushU16(spec.localMethodOverride ?? body.method)
    pushU16(0) // time
    pushU16(0x2821) // date
    pushU32(inDescriptor ? 0 : crc)
    pushU32(inDescriptor ? 0 : (spec.localDeclaredCompressed ?? spec.declaredCompressed ?? body.bytes.length) >>> 0)
    pushU32(inDescriptor ? 0 : (spec.localDeclaredUncompressed ?? spec.declaredUncompressed ?? uncompressed) >>> 0)
    pushU16(localName.length)
    pushU16(localExtra.length)
    pushBytes(localName)
    pushBytes(localExtra)
    if (!spec.directory) pushBytes(body.bytes)
    if (spec.dataDescriptor && !spec.descriptorOmitted) {
      if (spec.descriptorSignature !== false) pushU32(SIG_DATA_DESCRIPTOR)
      pushU32(spec.descriptorCrcOverride ?? crc)
      const compressedValue = spec.descriptorCompressedOverride ?? body.bytes.length
      const uncompressedValue = spec.descriptorUncompressedOverride ?? uncompressed
      if (spec.descriptorZip64Sizes) {
        pushU64(compressedValue)
        pushU64(uncompressedValue)
      } else {
        pushU32(compressedValue >>> 0)
        pushU32(uncompressedValue >>> 0)
      }
    }
    sizes.push(parts.length - offset)

    const fields = zip64Fields(spec)
    const marked = (field: Zip64Field): boolean => fields.includes(field)
    const extraParts: Uint8Array[] = []
    if (fields.length > 0 && !spec.zip64ExtraOmitted) {
      const zip64Extra = extraZip64(fields, shape, {
        uncompressed,
        compressed: body.bytes.length,
        offset,
        disk: 0,
      }, spec)
      if (spec.zip64ExtraSizeOverride !== undefined) {
        new DataView(zip64Extra.buffer).setUint16(2, spec.zip64ExtraSizeOverride, true)
      }
      extraParts.push(zip64Extra)
    }
    if (spec.unicodePathName !== undefined) extraParts.push(extraUnicodePath(spec, name))
    const extra = concatBytes(extraParts)

    const cd = new Uint8Array(46 + name.length + extra.length)
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
    putU16(fields.length > 0 ? 45 : 20)
    putU16(flags)
    putU16(body.method)
    putU16(0)
    putU16(0x2821)
    putU32(crc)
    putU32(marked('compressed') ? 0xffffffff : (spec.declaredCompressed ?? body.bytes.length) >>> 0)
    putU32(marked('uncompressed') ? 0xffffffff : (spec.declaredUncompressed ?? uncompressed) >>> 0)
    putU16(name.length)
    putU16(extra.length)
    putU16(0)
    putU16(marked('disk') ? 0xffff : 0)
    putU16(0)
    putU32(externalAttrs)
    putU32(marked('offset') ? 0xffffffff : (spec.localHeaderOffsetOverride ?? offset) >>> 0)
    cd.set(name, p)
    cd.set(extra, p + name.length)
    records.push(cd)
  }

  const cdOffset = parts.length
  for (const record of records) pushBytes(record)
  const cdSize = parts.length - cdOffset

  if (options.zip64) {
    const z64 = parts.length
    pushU32(SIG_ZIP64_EOCD)
    pushU64(options.zip64RecordSize ?? 44)
    pushU16(45)
    pushU16(0)
    pushU32(options.zip64DiskNumber ?? 0)
    pushU32(0)
    pushU32(entries.length >>> 0)
    pushU32(0)
    pushU64(options.zip64EntryCount ?? entries.length)
    pushU64(options.zip64CdSize ?? cdSize)
    pushU64(options.zip64CdOffset ?? cdOffset)
    pushU32(SIG_ZIP64_LOCATOR)
    pushU32(options.zip64DiskNumber ?? 0)
    pushU64(options.zip64RecordOffset ?? z64)
    pushU32(options.zip64TotalDisks ?? 1)
  }

  if (!options.omitEocd) {
    const comment = options.comment === undefined ? new Uint8Array(0) : utf8Encode(options.comment)
    const useZip64Markers = options.zip64 === true && options.zip64EocdHonest !== true
    pushU32(SIG_EOCD)
    pushU16(options.diskNumber ?? 0)
    pushU16(options.centralDirectoryDisk ?? 0)
    pushU16(useZip64Markers ? 0xffff : (options.declaredEntryCount ?? entries.length) & 0xffff)
    pushU16(useZip64Markers ? 0xffff : (options.declaredEntryCount ?? entries.length) & 0xffff)
    pushU32(useZip64Markers ? 0xffffffff : (options.declaredCdSize ?? cdSize) >>> 0)
    pushU32(useZip64Markers ? 0xffffffff : (options.declaredCdOffset ?? cdOffset) >>> 0)
    pushU16(comment.length)
    pushBytes(comment)
  }
  if (options.append) pushBytes(options.append)

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
