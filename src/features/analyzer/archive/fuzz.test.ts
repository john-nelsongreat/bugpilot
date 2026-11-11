import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildTar } from '../../../test/tarFixtures'
import { buildZip } from '../../../test/zipFixtures'
import { readContainer, type ContainerReadResult } from './container'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'
import { relativePathRefusal } from './paths'

/**
 * Mutation fuzzing with a fixed seed: every run checks the same 1,500 inputs (300 mutations per
 * format plus the honest base), so a failure is reproducible. The reader is allowed to refuse
 * anything, but it may never throw, retain bytes behind a refusal, exceed a ceiling or hand back
 * an unsafe path.
 */

const SEED = 0xb06f1170
const MUTATIONS_PER_FORMAT = 300
const INTERESTING_BYTES = [0x00, 0x01, 0x0a, 0x0d, 0x1f, 0x50, 0x4b, 0x7f, 0x80, 0xfe, 0xff]

function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function insertBytes(source: Uint8Array, at: number, insert: Uint8Array): Uint8Array {
  const next = new Uint8Array(source.length + insert.length)
  next.set(source.subarray(0, at), 0)
  next.set(insert, at)
  next.set(source.subarray(at), at + insert.length)
  return next
}

function deleteBytes(source: Uint8Array, at: number, length: number): Uint8Array {
  const head = source.subarray(0, at)
  const tail = source.subarray(Math.min(source.length, at + length))
  const next = new Uint8Array(head.length + tail.length)
  next.set(head, 0)
  next.set(tail, head.length)
  return next
}

function mutate(base: Uint8Array, random: () => number): Uint8Array {
  let bytes: Uint8Array = base.slice()
  const operations = 1 + Math.floor(random() * 5)
  for (let operation = 0; operation < operations; operation += 1) {
    if (bytes.length === 0) bytes = new Uint8Array([0])
    const kind = Math.floor(random() * 5)
    const at = Math.floor(random() * bytes.length)
    if (kind === 0) {
      bytes[at] ^= 1 << Math.floor(random() * 8)
    } else if (kind === 1) {
      bytes[at] = INTERESTING_BYTES[Math.floor(random() * INTERESTING_BYTES.length)]
    } else if (kind === 2) {
      bytes = bytes.slice(0, at)
    } else if (kind === 3) {
      const insert = new Uint8Array(1 + Math.floor(random() * 8))
      for (let index = 0; index < insert.length; index += 1) insert[index] = Math.floor(random() * 256)
      bytes = insertBytes(bytes, Math.floor(random() * (bytes.length + 1)), insert)
    } else {
      bytes = deleteBytes(bytes, at, 1 + Math.floor(random() * 16))
    }
  }
  return bytes
}

const ZIP_BASE = buildZip([
  { name: 'src/a.js', content: 'const a = 1\n' },
  { name: 'src/b.py', content: 'print(1)\n' },
  { name: 'src/data.json', content: '{"a":1}\n' },
])
// Streaming writers (PowerShell, Java) emit bit-3 entries with the sizes in a trailing
// descriptor; the zip64 base exercises the wide-record path. Mutating both guards the
// descriptor and zip64 parsing that ordinary zips never reach.
const ZIP_DESCRIPTOR_BASE = buildZip([
  { name: 'src/a.js', content: 'const a = 1\n', dataDescriptor: true },
  { name: 'src/b.py', content: 'print(1)\n', dataDescriptor: true, descriptorSignature: false },
  { name: 'src/data.json', content: '{"a":1}\n', dataDescriptor: true, descriptorZip64Sizes: true },
])
const ZIP_ZIP64_BASE = buildZip(
  [{ name: 'src/a.js', content: 'const a = 1\n', zip64: true }, { name: 'src/b.py', content: 'print(1)\n' }],
  { zip64: true },
)
const TAR_BASE = buildTar([
  { name: 'src/a.js', content: 'const a = 1\n' },
  { name: 'src/b.py', content: 'print(1)\n' },
])
const TAR_GZ_BASE = gzipSync(TAR_BASE)
// Entries the reader skips from the index (nested archive, symlink, encrypted) beside ordinary
// ones: mutating this base guards the per-entry skip policy and the all-encrypted note.
const ZIP_SKIPS_BASE = buildZip([
  { name: 'src/a.js', content: 'const a = 1\n' },
  { name: 'bundles/inner.zip', content: ZIP_BASE, method: 8 },
  { name: 'src/b.py', content: 'print(1)\n' },
  { name: 'link.js', content: '/etc/passwd', symlink: true },
  { name: 'locked.js', content: 'secret', encrypted: true },
])

function checkInvariants(result: ContainerReadResult): void {
  const limits = DEFAULT_ARCHIVE_LIMITS
  expect(result.stats.walkedRecords).toBeLessThanOrEqual(limits.maxParsedEntryCount)
  expect(result.stats.producedBytes).toBeLessThanOrEqual(limits.maxTotalUncompressedBytes)
  if (result.refusal) {
    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([])
    return
  }
  expect(result.entries.length).toBeLessThanOrEqual(limits.maxEntryCount)
  let entryBytes = 0
  for (const entry of result.entries) {
    expect(relativePathRefusal(entry.name)).toBeNull()
    expect(entry.name.includes('\u0000')).toBe(false)
    expect(entry.bytes).toBeLessThanOrEqual(limits.maxSingleFileUncompressedBytes)
    entryBytes += entry.bytes
  }
  expect(entryBytes).toBeLessThanOrEqual(limits.maxTotalUncompressedBytes)
}

// A self-extracting stub in front of a zip whose offsets are relative to the zip part: mutating
// this base guards the prefix derivation and the shifted-offset validation.
const SFX_STUB = new TextEncoder().encode('MZ\x90\x00' + 'self-extracting stub padding\n'.repeat(24))
const ZIP_SFX_BASE = buildZip(
  [{ name: 'src/a.js', content: 'const a = 1\n' }, { name: 'src/b.py', content: 'print(1)\n' }],
  { prepend: SFX_STUB, zipRelativeOffsets: true },
)

describe('seeded mutation fuzz', () => {
  it.each([
    ['zip', ZIP_BASE, 'upload.zip'],
    ['zip-descriptors', ZIP_DESCRIPTOR_BASE, 'upload.zip'],
    ['zip-zip64', ZIP_ZIP64_BASE, 'upload.zip'],
    ['zip-skips', ZIP_SKIPS_BASE, 'upload.zip'],
    ['tar', TAR_BASE, 'upload.tar'],
    ['tar.gz', TAR_GZ_BASE, 'upload.tar.gz'],
    ['zip-sfx', ZIP_SFX_BASE, 'upload.zip'],
  ] as const)('survives %s mutations without throwing or exceeding a ceiling', async (format, base, name) => {
    const random = prng(SEED)
    let successful = 0
    let refused = 0
    let sawExpectedFormat = 0
    const expectedFormat = format.startsWith('zip') ? 'zip' : format === 'tar.gz' ? 'gzip' : format

    for (let index = 0; index <= MUTATIONS_PER_FORMAT; index += 1) {
      const bytes = index === 0 ? base : mutate(base, random)
      let result: ContainerReadResult
      try {
        result = await readContainer(bytes, name)
      } catch (error) {
        throw new Error(
          `${format} mutation ${index} threw instead of refusing: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      checkInvariants(result)
      if (result.refusal) refused += 1
      else successful += 1
      if (result.format === expectedFormat) sawExpectedFormat += 1
      if (index === 0) {
        expect(result.refusal).toBeNull()
        expect(result.entries.length).toBeGreaterThan(0)
      }
    }

    expect(successful).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(0)
    expect(sawExpectedFormat).toBeGreaterThan(0)
  })
})
