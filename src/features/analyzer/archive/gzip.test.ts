// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deflateSync, gzipSync, strToU8 } from 'fflate'
import { readGzipPayload } from './gzip'
import { crc32, crc32Finish } from './crc32'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'

const body = 'export const a = 1\nconsole.log("hello")\n'

function compress(text: string, options: Parameters<typeof gzipSync>[1] = {}): Uint8Array {
  return gzipSync(strToU8(text), options)
}

const FLAG_FEXTRA = 0x04
const FLAG_FNAME = 0x08
const FLAG_FCOMMENT = 0x10

/**
 * fflate 0.8 writes a file name but never a comment or an extra field, so the optional header
 * fields are assembled here: the reader bounds each one against the bytes that are really there,
 * and that only gets tested with bytes a library would not produce.
 */
function gzipWithFields(
  text: string,
  fields: { extra?: Uint8Array; filename?: string; comment?: string; extraLengthOverride?: number },
): Uint8Array {
  const raw = strToU8(text)
  let flags = 0
  const head: number[] = []
  if (fields.extra) {
    flags |= FLAG_FEXTRA
    const declared = fields.extraLengthOverride ?? fields.extra.length
    head.push(declared & 0xff, (declared >>> 8) & 0xff, ...fields.extra)
  }
  if (fields.filename) {
    flags |= FLAG_FNAME
    head.push(...strToU8(fields.filename), 0)
  }
  if (fields.comment) {
    flags |= FLAG_FCOMMENT
    head.push(...strToU8(fields.comment), 0)
  }
  const crc = crc32Finish(crc32(raw))
  const trailer = [
    crc & 0xff,
    (crc >>> 8) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 24) & 0xff,
    raw.length & 0xff,
    (raw.length >>> 8) & 0xff,
    (raw.length >>> 16) & 0xff,
    (raw.length >>> 24) & 0xff,
  ]
  return Uint8Array.from([0x1f, 0x8b, 0x08, flags, 0, 0, 0, 0, 0, 0x03, ...head, ...deflateSync(raw), ...trailer])
}

/**
 * A seeded stream of letters barely compresses — measured 1.7:1 — so it stays under the expansion
 * ceiling and a test can exercise the thing it names. Built at runtime: no archive binary is
 * committed and the bytes are the same on every machine.
 */
function pseudoRandomLetters(length: number): string {
  let state = 0x2f_6e_2b_13
  const out = new Array<string>(length)
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0
    out[i] = String.fromCharCode(97 + (state % 26))
  }
  return out.join('')
}

describe('readGzipPayload: an honest stream', () => {
  it('inflates a single member', async () => {
    const result = await readGzipPayload(compress(body))

    expect(result.refusal).toBeNull()
    expect(result.payload).toEqual(strToU8(body))
    expect(result.stats.producedBytes).toBe(strToU8(body).length)
    expect(result.stats.walkedRecords).toBe(1)
  })

  it('inflates an empty member', async () => {
    const result = await readGzipPayload(compress(''))

    expect(result.refusal).toBeNull()
    expect(result.payload).toEqual(new Uint8Array(0))
  })

  it('inflates a stream whose header carries a file name', async () => {
    const packed = compress(body, { filename: 'notes.txt' })

    expect(packed[3] & FLAG_FNAME).toBe(FLAG_FNAME)
    const result = await readGzipPayload(packed)
    expect(result.refusal).toBeNull()
    expect(result.payload).toEqual(strToU8(body))
  })

  it('inflates a stream carrying an extra field, a name and a comment', async () => {
    const packed = gzipWithFields(body, {
      extra: strToU8('BC'),
      filename: 'notes.txt',
      comment: 'written by tester',
    })

    expect(packed[3] & (FLAG_FEXTRA | FLAG_FNAME | FLAG_FCOMMENT)).toBe(FLAG_FEXTRA | FLAG_FNAME | FLAG_FCOMMENT)
    const result = await readGzipPayload(packed)
    expect(result.refusal).toBeNull()
    expect(result.payload).toEqual(strToU8(body))
  })

  it('inflates a stream pushed in small chunks', async () => {
    const wide = pseudoRandomLetters(80_000)
    const packed = compress(wide)
    // The premise the other tests lean on: this body is barely compressible, so the expansion
    // ceiling is not what stops a read of it.
    expect(packed.length * 300).toBeGreaterThan(wide.length)

    const result = await readGzipPayload(packed, { limits: { ...DEFAULT_ARCHIVE_LIMITS, inflateChunkBytes: 512 } })

    expect(result.refusal).toBeNull()
    expect(result.payload).toEqual(strToU8(wide))
  })

  it('refuses a cancelled read and hands back nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await readGzipPayload(compress(body), { signal: controller.signal })

    expect(result.refusal?.code).toBe('cancelled')
    expect(result.payload).toEqual(new Uint8Array(0))
  })
})

describe('readGzipPayload: damaged and hostile streams', () => {
  it('refuses a stream whose stored checksum is wrong', async () => {
    const packed = compress(body)
    packed[packed.length - 8] ^= 0xff
    const result = await readGzipPayload(packed)

    expect(result.refusal?.code).toBe('crc_mismatch')
    expect(result.payload).toEqual(new Uint8Array(0))
  })

  it('refuses a stream whose stored length is wrong', async () => {
    const packed = compress(body)
    packed[packed.length - 4] ^= 0xff
    const result = await readGzipPayload(packed)

    expect(result.refusal?.code).toBe('corrupt_gzip_stream')
    expect(result.refusal?.message).toContain('length')
    expect(result.payload).toEqual(new Uint8Array(0))
  })

  it('refuses a stream cut off in the middle of its data', async () => {
    const packed = compress(pseudoRandomLetters(60_000))
    const result = await readGzipPayload(packed.subarray(0, Math.floor(packed.length / 2)))

    // A cut stream cannot be pinned to one field: the trailer is no longer where it should be,
    // so it is refused for one of these specific reasons rather than accepted.
    expect(['corrupt_gzip_stream', 'crc_mismatch', 'archive_truncated']).toContain(result.refusal?.code)
    expect(result.payload).toEqual(new Uint8Array(0))
    expect(result.stats.producedBytes).toBe(0)
  })

  it('refuses two gzip streams joined into one file', async () => {
    const first = compress(body)
    const joined = new Uint8Array(first.length * 2)
    joined.set(first)
    joined.set(first, first.length)
    const result = await readGzipPayload(joined)

    expect(result.refusal?.code).toBe('multi_member_gzip')
    expect(result.payload).toEqual(new Uint8Array(0))
  })

  it('refuses a compression method that is not deflate', async () => {
    const packed = compress(body)
    packed[2] = 0x01
    const result = await readGzipPayload(packed)

    expect(result.refusal?.code).toBe('corrupt_gzip_stream')
    expect(result.refusal?.message).toContain('method')
  })

  it('refuses a header with its reserved bits set', async () => {
    const packed = compress(body)
    packed[3] = 0x20
    const result = await readGzipPayload(packed)

    expect(result.refusal?.code).toBe('corrupt_gzip_stream')
  })

  it('refuses a header whose name field never ends', async () => {
    const packed = compress(body, { filename: 'notes.txt' })
    // Wipe every NUL after the magic so the FNAME scan runs to the end of the file.
    for (let i = 10; i < packed.length; i += 1) if (packed[i] === 0) packed[i] = 0x41
    const result = await readGzipPayload(packed)

    expect(result.refusal?.code).toBe('corrupt_gzip_stream')
  })

  it('refuses a header whose extra field runs past the end of the file', async () => {
    const packed = gzipWithFields(body, { extra: strToU8('BC'), extraLengthOverride: 60_000 })

    const result = await readGzipPayload(packed)
    expect(result.refusal?.code).toBe('corrupt_gzip_stream')
    expect(result.refusal?.message).toContain('extra field')
    expect(result.payload).toEqual(new Uint8Array(0))
    expect(result.stats.producedBytes).toBe(0)
  })

  it('refuses a file too short to hold a header and a trailer', async () => {
    const result = await readGzipPayload(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))

    expect(result.refusal?.code).toBe('corrupt_gzip_stream')
    expect(result.payload).toEqual(new Uint8Array(0))
  })

  it('refuses data that is not gzip at all', async () => {
    const result = await readGzipPayload(strToU8('this is plain text, not a compressed stream at all'))

    expect(result.refusal?.code).toBe('corrupt_gzip_stream')
  })

  it('refuses a stream that expands past the ratio ceiling', async () => {
    const packed = compress('A'.repeat(100_000))
    const result = await readGzipPayload(packed)

    expect(result.refusal?.code).toBe('actual_ratio_exceeded')
    expect(result.payload).toEqual(new Uint8Array(0))
    // The ceiling runs on each chunk the decoder hands over, so a read stops somewhere inside the
    // expansion rather than after it: never more than the payload, and nothing kept.
    expect(result.stats.peakEntryBytes).toBeGreaterThan(0)
    expect(result.stats.peakEntryBytes).toBeLessThanOrEqual(100_000)
  })

  it('refuses a stream that expands past the total ceiling', async () => {
    const packed = compress('abcdefghijklmnopqrstuvwxyz'.repeat(800))
    const limits = { ...DEFAULT_ARCHIVE_LIMITS, maxTotalUncompressedBytes: 8 * 1024 }
    const result = await readGzipPayload(packed, { limits })

    expect(result.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(result.payload).toEqual(new Uint8Array(0))
    expect(result.stats.producedBytes).toBe(0)
  })

  it('bounds the archive before inflating a byte', async () => {
    const packed = compress(body)
    const result = await readGzipPayload(packed, { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxArchiveBytes: 8 } })

    expect(result.refusal?.code).toBe('archive_too_large')
    expect(result.stats.producedBytes).toBe(0)
  })
})

describe('readGzipPayload: progress', () => {
  it('reports the bytes it has produced as the stream inflates', async () => {
    const wide = pseudoRandomLetters(200_000)
    const seen: number[] = []
    const result = await readGzipPayload(compress(wide), {
      limits: { ...DEFAULT_ARCHIVE_LIMITS, inflateChunkBytes: 4096 },
      onProgress: (progress) => seen.push(progress.producedBytes),
    })

    // The barely-compressible body spans tens of slices, so progress is a series of growing
    // numbers rather than one final jump.
    expect(result.refusal).toBeNull()
    expect(seen.length).toBeGreaterThan(1)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen.at(-1)).toBe(200_000)
  })
})
