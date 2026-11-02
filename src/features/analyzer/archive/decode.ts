export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be' | 'latin-1'

export interface DecodedText {
  text: string
  encoding: TextEncoding
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16_LE_BOM = [0xff, 0xfe]
const UTF16_BE_BOM = [0xfe, 0xff]

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false
  return true
}

/**
 * A BOM-less UTF-16 stream of mostly-ASCII text puts a NUL in every odd byte (LE) or every
 * even byte (BE). The sniff needs the sample bound because a real binary also has many NULs.
 */
function sniffUtf16WithoutBom(bytes: Uint8Array): 'utf-16-le' | 'utf-16-be' | null {
  const sample = Math.min(bytes.length - (bytes.length % 2), 4096)
  if (sample < 8) return null
  let nulOnOdd = 0
  let nulOnEven = 0
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i + 1] === 0) nulOnOdd += 1
    if (bytes[i] === 0) nulOnEven += 1
  }
  const units = sample / 2
  if (nulOnOdd >= units * 0.5 && nulOnEven <= units * 0.05) return 'utf-16-le'
  if (nulOnEven >= units * 0.5 && nulOnOdd <= units * 0.05) return 'utf-16-be'
  return null
}

/** UTF-16 source files are text even though every ASCII byte is followed by a NUL. */
export function isUtf16(bytes: Uint8Array): boolean {
  return startsWith(bytes, UTF16_LE_BOM) || startsWith(bytes, UTF16_BE_BOM) || sniffUtf16WithoutBom(bytes) !== null
}

function decodeUtf8(bytes: Uint8Array, encoding: TextEncoding): DecodedText | null {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding }
  } catch {
    return null
  }
}

export function decodeBytes(bytes: Uint8Array): DecodedText {
  if (startsWith(bytes, UTF16_LE_BOM)) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16-le',
    }
  }
  if (startsWith(bytes, UTF16_BE_BOM)) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16-be',
    }
  }
  const utf16 = sniffUtf16WithoutBom(bytes)
  if (utf16) {
    const decoder = new TextDecoder(utf16 === 'utf-16-le' ? 'utf-16le' : 'utf-16be')
    return { text: decoder.decode(bytes.subarray(bytes.length % 2)), encoding: utf16 }
  }
  if (startsWith(bytes, UTF8_BOM)) {
    const decoded = decodeUtf8(bytes.subarray(3), 'utf-8-bom')
    if (decoded) return decoded
  }
  const strict = decodeUtf8(bytes, 'utf-8')
  if (strict) return strict
  return { text: new TextDecoder('iso-8859-1').decode(bytes), encoding: 'latin-1' }
}

/** NUL bytes and a run of control characters are the reliable sign of a non-text payload. */
export function looksBinary(bytes: Uint8Array): boolean {
  if (isUtf16(bytes)) return false
  const sample = Math.min(bytes.length, 8000)
  if (sample === 0) return false
  let suspect = 0
  for (let i = 0; i < sample; i += 1) {
    const b = bytes[i]
    if (b === 0) return true
    if (b < 9 || (b > 13 && b < 32)) suspect += 1
  }
  return suspect / sample > 0.3
}
