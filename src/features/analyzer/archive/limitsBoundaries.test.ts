import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildTar } from '../../../test/tarFixtures'
import { buildZip } from '../../../test/zipFixtures'
import { readContainer } from './container'
import { readArchive } from './guard'
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './limits'
import { readTar } from './tar'

const MIB = 1024 * 1024

function limits(overrides: Partial<ArchiveLimits>): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, ...overrides }
}

/** The central directory size and offset, read from the end record of an archive with no comment. */
function centralSizes(bytes: Uint8Array): { size: number; offset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    size: view.getUint32(bytes.length - 10, true),
    offset: view.getUint32(bytes.length - 6, true),
  }
}

describe('zip ceilings at their exact boundary', () => {
  it('accepts exactly maxArchiveBytes and refuses one byte more', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'const a = 1\n' }])

    const atCeiling = await readArchive(bytes, { limits: limits({ maxArchiveBytes: bytes.length }) })
    const oneLess = await readArchive(bytes, { limits: limits({ maxArchiveBytes: bytes.length - 1 }) })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(oneLess.refusal?.code).toBe('archive_too_large')
    expect(oneLess.stats.producedBytes).toBe(0)
  })

  it('accepts exactly maxEntryCount records and refuses one more', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a\n' },
      { name: 'src/b.js', content: 'b\n' },
      { name: 'src/c.js', content: 'c\n' },
    ])

    const atCeiling = await readArchive(bytes, { limits: limits({ maxEntryCount: 3 }) })
    const oneLess = await readArchive(bytes, { limits: limits({ maxEntryCount: 2 }) })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries).toHaveLength(3)
    expect(atCeiling.stats.walkedRecords).toBe(3)
    expect(oneLess.refusal?.code).toBe('entry_count_exceeded')
    expect(oneLess.stats.walkedRecords).toBe(3)
  })

  it('accepts a file exactly at maxSingleFileUncompressedBytes and skips one byte more', async () => {
    const cap = 1_024
    const bytes = buildZip([
      { name: 'src/exact.js', content: 'a'.repeat(cap) },
      { name: 'src/over.js', content: 'b'.repeat(cap + 1) },
    ])

    const result = await readArchive(bytes, {
      limits: limits({ maxSingleFileUncompressedBytes: cap }),
    })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/exact.js'])
    expect(result.entries[0].bytes).toBe(cap)
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['src/over.js', 'single_file_too_large'],
    ])
  })

  it('accepts exactly maxAnalysableTextBytes and stops one byte short', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(100) },
    ])

    const atCeiling = await readArchive(bytes, {
      limits: limits({ maxAnalysableTextBytes: 200, maxTotalUncompressedBytes: 10_000 }),
    })
    const oneShort = await readArchive(bytes, {
      limits: limits({ maxAnalysableTextBytes: 199, maxTotalUncompressedBytes: 10_000 }),
    })
    const keptPartial = await readArchive(bytes, {
      limits: limits({ maxAnalysableTextBytes: 199, maxTotalUncompressedBytes: 10_000 }),
      keepPartial: true,
    })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries).toHaveLength(2)
    expect(oneShort.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(oneShort.entries).toHaveLength(0)
    expect(keptPartial.refusal).toBeNull()
    expect(keptPartial.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(keptPartial.partial?.code).toBe('analysable_budget_exceeded')
    expect(keptPartial.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['src/b.js', 'not_reached'],
    ])
  })

  it('accepts exactly maxTotalUncompressedBytes of real work and stops one byte short', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(100) },
    ])
    const base = { maxAnalysableTextBytes: 10_000, keepPartial: true as const }

    const atCeiling = await readArchive(bytes, {
      ...base,
      limits: limits({ ...base, maxTotalUncompressedBytes: 200 }),
    })
    const oneShort = await readArchive(bytes, {
      ...base,
      limits: limits({ ...base, maxTotalUncompressedBytes: 199 }),
    })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries).toHaveLength(2)
    expect(atCeiling.stats.inflatedBytes).toBe(200)
    expect(oneShort.refusal).toBeNull()
    expect(oneShort.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(oneShort.partial?.code).toBe('total_uncompressed_exceeded')
    // `inflatedBytes` records the chunk that crossed the ceiling before it was refused, the same
    // high-water rule `peakEntryBytes` uses; only the retained bytes are held at the end.
    expect(oneShort.stats.producedBytes).toBe(100)
  })

  it('accepts exactly maxCentralDirectoryBytes and refuses one byte less', async () => {
    const bytes = buildZip([{ name: 'a.js', content: 'x\n' }])
    const central = centralSizes(bytes)
    expect(central.size).toBe(46 + 'a.js'.length)

    const atCeiling = await readArchive(bytes, {
      limits: limits({ maxCentralDirectoryBytes: central.size }),
    })
    const oneLess = await readArchive(bytes, {
      limits: limits({ maxCentralDirectoryBytes: central.size - 1 }),
    })

    expect(atCeiling.refusal).toBeNull()
    expect(oneLess.refusal?.code).toBe('central_directory_too_large')
  })

  it('accepts a name exactly at maxEntryNameBytes and refuses one byte more', async () => {
    const name = `${'n'.repeat(12)}.js`
    expect(name.length).toBe(15)
    const bytes = buildZip([{ name, content: 'x\n' }])

    const atCeiling = await readArchive(bytes, { limits: limits({ maxEntryNameBytes: 15 }) })
    const oneLess = await readArchive(bytes, { limits: limits({ maxEntryNameBytes: 14 }) })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries.map((entry) => entry.name)).toEqual([name])
    expect(oneLess.refusal?.code).toBe('name_too_long')
  })
})

describe('tar ceilings at their exact boundary', () => {
  it('accepts exactly maxTarArchiveBytes and refuses one byte more', async () => {
    const bytes = buildTar([{ name: 'src/a.js', content: 'const a = 1\n' }])
    const base = { maxArchiveBytes: MIB }

    const atCeiling = await readTar(bytes, { limits: limits({ ...base, maxTarArchiveBytes: bytes.length }) })
    const oneLess = await readTar(bytes, { limits: limits({ ...base, maxTarArchiveBytes: bytes.length - 1 }) })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(oneLess.refusal?.code).toBe('archive_too_large')
    expect(oneLess.stats.walkedRecords).toBe(0)
  })

  it('accepts exactly maxEntryCount headers and refuses one more', async () => {
    const bytes = buildTar([
      { name: 'src/a.js', content: 'a\n' },
      { name: 'src/b.js', content: 'b\n' },
    ])

    const atCeiling = await readTar(bytes, { limits: limits({ maxEntryCount: 2 }) })
    const oneLess = await readTar(bytes, { limits: limits({ maxEntryCount: 1 }) })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries).toHaveLength(2)
    expect(oneLess.refusal?.code).toBe('entry_count_exceeded')
    expect(oneLess.stats.walkedRecords).toBe(2)
  })

  it('accepts a member exactly at maxSingleFileUncompressedBytes and skips one byte more', async () => {
    const cap = 1_024
    const bytes = buildTar([
      { name: 'src/exact.js', content: 'a'.repeat(cap) },
      { name: 'src/over.js', content: 'b'.repeat(cap + 1) },
    ])

    const result = await readTar(bytes, { limits: limits({ maxSingleFileUncompressedBytes: cap }) })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/exact.js'])
    expect(result.entries[0].bytes).toBe(cap)
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['src/over.js', 'single_file_too_large'],
    ])
  })

  it('accepts exactly the total budget and stops one byte short', async () => {
    const bytes = buildTar([
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(100) },
    ])

    const atCeiling = await readTar(bytes, { limits: limits({ maxTotalUncompressedBytes: 200 }) })
    const oneShort = await readTar(bytes, { limits: limits({ maxTotalUncompressedBytes: 199 }) })
    const keptPartial = await readTar(bytes, {
      limits: limits({ maxTotalUncompressedBytes: 199 }),
      keepPartial: true,
    })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries).toHaveLength(2)
    expect(oneShort.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(oneShort.entries).toHaveLength(0)
    expect(keptPartial.refusal).toBeNull()
    expect(keptPartial.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(keptPartial.partial?.code).toBe('total_uncompressed_exceeded')
  })

  it('applies the tar ceiling to the compressed stream at the same boundary', async () => {
    const tar = buildTar([{ name: 'src/a.js', content: 'const a = 1\n' }])
    const packed = gzipSync(tar)
    const base = { maxArchiveBytes: MIB }

    // The tar ceiling bounds the uploaded (.tar.gz) bytes; the inner tar is already decompressed
    // and is bounded by the work budget instead, as `innerLimits` documents.
    const atCeiling = await readContainer(packed, 'upload.tar.gz', {
      limits: limits({ ...base, maxTarArchiveBytes: packed.length }),
    })
    const oneLess = await readContainer(packed, 'upload.tar.gz', {
      limits: limits({ ...base, maxTarArchiveBytes: packed.length - 1 }),
    })

    expect(atCeiling.refusal).toBeNull()
    expect(atCeiling.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(oneLess.refusal?.code).toBe('archive_too_large')
  })
})
