import { extensionOf } from './classify'
import { looksBinary } from './decode'
import type { ArchiveRefusalCode } from './reasons'

/**
 * The formats BugPilot can open, decided from the bytes. The name only ever adds a claim that
 * this module checks, never a decision: an archive that is named `.txt` is still read as what
 * its signature says it is, and an archive named `.zip` that holds something else is refused.
 */
export type ContainerFormat = 'zip' | 'tar' | 'gzip' | 'text'

export interface FormatDetection {
  /** The container the bytes are, or null when BugPilot will not open the file at all. */
  format: ContainerFormat | null
  /** Set exactly when `format` is null: the code the plain-language message comes from. */
  refusalCode: ArchiveRefusalCode | null
  /** Which family the signature showed (`'7z'`, `'rar'`…), empty when nothing matched. */
  refusalSubject: string
  /** Set when the name and the contents disagree. Never blocks the read. */
  note: string | null
}

/**
 * How far from each end a signature may be found. A self-extracting stub puts the zip headers
 * tens of kilobytes in, and the end-of-directory record sits at the tail, so both ends are
 * scanned — but only these bounded windows, so a megabyte of text costs a fixed amount of work.
 */
const HEAD_SCAN_BYTES = 65_536
const TAIL_SCAN_BYTES = 65_535 + 22

/** POSIX tar puts the magic at 257; 512 is one header block, the smallest real archive record. */
const TAR_MAGIC_OFFSET = 257
const TAR_HEADER_BYTES = 512
/** `tar` writes its trailer as a whole blocking factor, which is what an empty archive is. */
const TAR_BLOCKING_BYTES = 512 * 20

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]
const ZIP_END_OF_CENTRAL = [0x50, 0x4b, 0x05, 0x06]
const GZIP_MAGIC = [0x1f, 0x8b]

/** Compressors BugPilot refuses outright: no decoder ships, so nothing is ever decoded. */
const REFUSED_SIGNATURES: readonly { kind: string; bytes: number[] }[] = [
  { kind: '7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { kind: 'rar', bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { kind: 'bz2', bytes: [0x42, 0x5a, 0x68] },
  { kind: 'xz', bytes: [0xfd, 0x37, 0x5a, 0x58, 0x5a, 0x00] },
  { kind: 'zst', bytes: [0x28, 0xb5, 0x2f, 0xfd] },
]

/** Zip containers that arrive under a different name: the contents are still zip records. */
export const PACKAGE_ARCHIVE_EXTENSIONS: readonly string[] = ['whl', 'nupkg', 'vsix', 'jar', 'war', 'aar', 'apk']

/** Every extension that claims a container BugPilot opens. */
export const CONTAINER_EXTENSIONS: readonly string[] = ['zip', 'tar', 'gz', 'tgz', ...PACKAGE_ARCHIVE_EXTENSIONS]

const CLAIMED_FORMAT: Record<string, ContainerFormat> = {
  zip: 'zip',
  tar: 'tar',
  gz: 'gzip',
  tgz: 'gzip',
  ...Object.fromEntries(PACKAGE_ARCHIVE_EXTENSIONS.map((extension) => [extension, 'zip' as ContainerFormat])),
}

function matchesAt(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (offset < 0 || offset + signature.length > bytes.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

function containsSignature(bytes: Uint8Array, signature: number[], from: number, to: number): boolean {
  const start = Math.max(0, from)
  const end = Math.min(bytes.length - signature.length, to)
  for (let at = start; at <= end; at += 1) {
    if (matchesAt(bytes, at, signature)) return true
  }
  return false
}

function isAllZero(bytes: Uint8Array, length: number): boolean {
  for (let i = 0; i < length; i += 1) if (bytes[i] !== 0) return false
  return true
}

/**
 * The tar magic is five ASCII bytes, which prose can contain, so a header only counts when its
 * own checksum adds up. That arithmetic lives here rather than in the reader because both need
 * it and neither can trust the other: the reader re-checks every header it walks.
 */
function tarHeaderLooksReal(bytes: Uint8Array): boolean {
  if (bytes.length < TAR_HEADER_BYTES) return false
  if (!matchesAt(bytes, TAR_MAGIC_OFFSET, [0x75, 0x73, 0x74, 0x61, 0x72])) return false
  const magic = bytes[TAR_MAGIC_OFFSET + 5]
  if (magic !== 0 && magic !== 0x20) return false

  let sum = 0
  for (let i = 0; i < TAR_HEADER_BYTES; i += 1) {
    // The checksum field itself is read as spaces, exactly as `tar` writes it.
    sum += i >= 148 && i < 156 ? 0x20 : bytes[i]
  }
  const declared = octalField(bytes, 148, 8)
  return declared !== null && declared === sum
}

/** Octal ASCII field, trimmed of the NUL and space terminators tar uses. Empty means damaged. */
export function octalField(bytes: Uint8Array, offset: number, length: number): number | null {
  let text = ''
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[offset + i]
    if (byte === 0 || byte === 0x20) break
    const char = String.fromCharCode(byte)
    if (!/[0-7]/.test(char)) return null
    text += char
  }
  if (text === '') return null
  if (text.length > 11) return null
  const value = Number.parseInt(text, 8)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * Base-256 (high bit set) is how GNU tar stores sizes over 8 GiB. Refusing a value that will not
 * fit a JavaScript integer is safer than letting the reader arithmetic silently wrap.
 */
export function base256Field(bytes: Uint8Array, offset: number, length: number): number | null {
  if ((bytes[offset] & 0x80) === 0) return null
  let value = 0
  for (let i = offset + 1; i < offset + length; i += 1) {
    value = value * 256 + bytes[i]
    if (value > Number.MAX_SAFE_INTEGER) return null
  }
  return value
}

/** The dotted suffix a name carries, so `project.tar.gz` claims `tar.gz` rather than `gz`. */
function suffixOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const first = base.indexOf('.')
  if (first <= 0) return ''
  return base.slice(first + 1).toLowerCase()
}

/** Which container a name claims, or null when the name says nothing about the format. */
export function claimedFormatOf(name: string): ContainerFormat | null {
  const extension = extensionOf(name)
  if (extension === '') return null
  return CLAIMED_FORMAT[extension] ?? null
}

/**
 * Whether a name is worth reading as a container at all. The reader still decides from the bytes;
 * this only picks which pipeline a top-level upload enters.
 */
export function isContainerName(name: string): boolean {
  return claimedFormatOf(name) !== null
}

function contentsLabel(format: ContainerFormat, refusedKind: string): string {
  if (refusedKind !== '') return `a .${refusedKind} archive`
  if (format === 'text') return 'a plain text file'
  return `a ${format} archive`
}

function mismatchNote(name: string, detected: ContainerFormat | null, refusedKind: string): string | null {
  const suffix = suffixOf(name)
  if (suffix === '') return null
  // A name that already says which refused family it holds is not a disagreement: the reader is
  // about to explain the same thing in the refusal message.
  if (refusedKind !== '' && suffix.split('.').at(-1) === refusedKind) return null
  const claimed = claimedFormatOf(name)
  const isContainer = detected === 'zip' || detected === 'tar' || detected === 'gzip'
  if (claimed === null) {
    // A name that claims nothing only disagrees when the bytes are an archive or a refused one.
    if (!isContainer && refusedKind === '') return null
  } else if (claimed === detected) {
    return null
  }
  const base = name.slice(name.lastIndexOf('/') + 1)
  const label = detected === null ? `a .${refusedKind || 'unrecognised'} archive` : contentsLabel(detected, refusedKind)
  return (
    `This file is named "${base}" (a .${suffix} file) but its contents are ${label}. ` +
    'BugPilot works out the format from the contents, not from the name.'
  )
}

export function detectFormat(bytes: Uint8Array, name = ''): FormatDetection {
  const refuse = (kind: string): FormatDetection => ({
    format: null,
    refusalCode: 'unsupported_format',
    refusalSubject: kind,
    note: mismatchNote(name, null, kind),
  })

  if (matchesAt(bytes, 0, GZIP_MAGIC)) {
    return { format: 'gzip', refusalCode: null, refusalSubject: '', note: mismatchNote(name, 'gzip', '') }
  }
  if (tarHeaderLooksReal(bytes)) {
    return { format: 'tar', refusalCode: null, refusalSubject: '', note: mismatchNote(name, 'tar', '') }
  }
  // A tar with no entries is only zero blocks: nothing here would look like a signature.
  if (bytes.length >= TAR_BLOCKING_BYTES && bytes.length % TAR_BLOCKING_BYTES === 0 && isAllZero(bytes, TAR_BLOCKING_BYTES)) {
    return { format: 'tar', refusalCode: null, refusalSubject: '', note: mismatchNote(name, 'tar', '') }
  }
  if (containsSignature(bytes, ZIP_LOCAL_HEADER, 0, HEAD_SCAN_BYTES) || containsSignature(bytes, ZIP_END_OF_CENTRAL, bytes.length - TAIL_SCAN_BYTES, bytes.length)) {
    return { format: 'zip', refusalCode: null, refusalSubject: '', note: mismatchNote(name, 'zip', '') }
  }
  for (const signature of REFUSED_SIGNATURES) {
    if (matchesAt(bytes, 0, signature.bytes)) return refuse(signature.kind)
  }
  if (looksBinary(bytes)) return refuse('')
  return { format: 'text', refusalCode: null, refusalSubject: '', note: mismatchNote(name, 'text', '') }
}
