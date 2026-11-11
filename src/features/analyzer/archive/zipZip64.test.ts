import { describe, expect, it } from 'vitest'
import { buildZip } from '../../../test/zipFixtures'
import { readArchive } from './guard'

/**
 * ZIP64: the ordinary 32-bit fields are marked all-ones and the real numbers are kept in an end
 * record and in each index record's `0x0001` field. Archives like this are what `zip -r` of a
 * large project, Java's ZipOutputStream with setUseZip64 and Python's allowZip64 produce, so the
 * reader resolves them rather than refusing — and every number it resolves is bounded before the
 * work that number promises.
 */

const SOURCE = 'export const value = 1\n'
const FOUR_GIB = 4 * 1024 * 1024 * 1024

function zip64Entry(extra: Record<string, unknown> = {}) {
  return buildZip([
    { name: 'src/a.js', content: SOURCE, zip64: true, ...extra },
    { name: 'src/b.js', content: 'const other = 2\n' },
  ])
}

describe('zip64 end records: the locator is followed, not refused', () => {
  it('reads an archive whose index position lives in the zip64 record', async () => {
    const result = await readArchive(buildZip([{ name: 'src/a.js', content: SOURCE }], { zip64: true }))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.text)).toEqual([SOURCE])
  })

  it('reads an archive that also keeps honest numbers in the ordinary end record', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], { zip64: true, zip64EocdHonest: true })
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
  })

  it('reads the records that exist when the archive declares more than 65,535 entries', async () => {
    const bytes = buildZip(
      [
        { name: 'src/a.js', content: SOURCE },
        { name: 'src/b.js', content: 'const other = 2\n' },
      ],
      { zip64: true, zip64EntryCount: 70_000 },
    )
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(2)
    expect(result.stats.entries).toBe(2)
  })

  it('refuses all-ones markers that promise an end record which is not there', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], { declaredCdOffset: 0xffffffff })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses an end record on a second volume', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], { zip64: true, zip64DiskNumber: 1 })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('multi_disk_not_supported')
  })

  it('refuses an end record that promises more than one volume', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], { zip64: true, zip64TotalDisks: 2 })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('multi_disk_not_supported')
  })

  it('refuses a locator pointing past the space it could describe', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], { zip64: true, zip64RecordOffset: 1 << 20 })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses an end record whose declared size would swallow the locator', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], { zip64: true, zip64RecordSize: 4_000 })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses an end record too small to hold its own fields', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], { zip64: true, zip64RecordSize: 20 })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses an end record and an ordinary record that disagree about the index', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], {
      zip64: true,
      zip64EocdHonest: true,
      zip64CdSize: 4_096,
    })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses an index position the file cannot hold', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: SOURCE }], {
      zip64: true,
      zip64CdOffset: 2n ** 40n,
    })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })
})

describe('zip64 per-entry extra fields', () => {
  it('reads an entry whose two sizes are markers resolved from its own record', async () => {
    const result = await readArchive(zip64Entry({ zip64: 'sizes' }))

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('reads an entry whose local header offset is a marker', async () => {
    const result = await readArchive(zip64Entry({ zip64: 'offset' }))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
  })

  it('reads an entry that marks its sizes, offset and disk', async () => {
    const result = await readArchive(zip64Entry({ zip64: ['uncompressed', 'compressed', 'offset', 'disk'] }))

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('reads a dense field that also carries numbers for fields which were not marked', async () => {
    const bytes = buildZip(
      [
        { name: 'src/a.js', content: SOURCE, zip64: 'offset' },
        { name: 'src/b.js', content: 'const other = 2\n' },
      ],
      { zip64ExtraShape: 'dense' },
    )
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('reads an entry whose local header marks the same fields with all-ones', async () => {
    const result = await readArchive(
      zip64Entry({ localDeclaredCompressed: 0xffffffff, localDeclaredUncompressed: 0xffffffff }),
    )

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('refuses markers that no extra field resolves', async () => {
    const result = await readArchive(zip64Entry({ zip64ExtraOmitted: true }))

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses an extra field whose declared length runs past the record', async () => {
    const result = await readArchive(zip64Entry({ zip64ExtraSizeOverride: 40 }))

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses a disk marker that resolves to another volume', async () => {
    const result = await readArchive(zip64Entry({ zip64: 'disk', zip64Disk: 1 }))

    expect(result.refusal?.code).toBe('multi_disk_not_supported')
  })

  it('reads a disk marker that resolves to this volume', async () => {
    const result = await readArchive(zip64Entry({ zip64: 'disk', zip64Disk: 0 }))

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('refuses a size no JavaScript integer can hold', async () => {
    const result = await readArchive(zip64Entry({ zip64Uncompressed: 2n ** 62n }))

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses a resolved size that disagrees with the local header', async () => {
    const result = await readArchive(zip64Entry({ zip64: 'compressed', zip64Compressed: 999 }))

    expect(result.refusal?.code).toBe('local_central_disagreement')
  })

  it('skips an entry whose zip64 sizes declare more than one file may hold and reads the rest', async () => {
    const result = await readArchive(
      zip64Entry({ zip64: 'sizes', zip64Uncompressed: 5 * FOUR_GIB, zip64Compressed: FOUR_GIB }),
    )

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/b.js'])
    expect(result.skipped.some((entry) => entry.name === 'src/a.js' && entry.code === 'single_file_too_large')).toBe(true)
  })

  it('sizes the overlap check from the zip64 number, not the marker', async () => {
    const bytes = buildZip([
      {
        name: 'src/a.js',
        content: SOURCE,
        zip64: 'sizes',
        zip64Compressed: SOURCE.length + 60,
        zip64Uncompressed: SOURCE.length,
        localDeclaredCompressed: SOURCE.length + 60,
      },
      { name: 'src/b.js', content: 'const other = 2\n' },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('overlapping_entries')
  })

  it('keeps the encrypted and symlink skips ahead of anything zip64 says', async () => {
    const encrypted = await readArchive(zip64Entry({ encrypted: true }))
    const symlink = await readArchive(
      buildZip([{ name: 'link.js', content: '/etc/passwd', symlink: true, zip64: true }]),
    )

    expect(encrypted.refusal).toBeNull()
    expect(encrypted.skipped.map((entry) => entry.code)).toEqual(['encrypted_entry'])
    expect(symlink.refusal).toBeNull()
    expect(symlink.skipped.map((entry) => entry.code)).toEqual(['symlink_entry'])
  })
})
