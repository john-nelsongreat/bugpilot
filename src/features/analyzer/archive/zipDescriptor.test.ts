import { describe, expect, it } from 'vitest'
import { buildZip } from '../../../test/zipFixtures'
import { readArchive } from './guard'

/**
 * General-purpose bit 3: the checksum and both sizes are repeated after the data. Writers that
 * cannot seek back (a streamed download, Explorer's copy step, `ZipOutputStream`) use it for every
 * entry, so the reader takes the sizes from the index and treats the descriptor as a check.
 */

const SOURCE = 'export const value = 1\n'

function descriptorArchive(extra: Record<string, unknown> = {}) {
  return buildZip([
    { name: 'src/a.js', content: SOURCE, ...extra },
    { name: 'src/b.js', content: 'const other = 2\n' },
  ])
}

describe('zip data descriptors: a bit-3 entry is read, not refused', () => {
  it('reads a stored entry whose descriptor carries the optional signature', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true }))

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].name).toBe('src/a.js')
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('reads a deflated entry whose descriptor carries the optional signature', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: SOURCE.repeat(20), method: 8, dataDescriptor: true },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE.repeat(20))
  })

  it('reads a descriptor written without its signature', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, descriptorSignature: false }))

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('reads a descriptor whose size fields are the eight-byte zip64 width', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, descriptorZip64Sizes: true }))

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('reads an entry whose writer also kept the true sizes in the local header', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, descriptorLocalHonest: true }))

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(SOURCE)
  })

  it('reads every entry of an archive that uses descriptors throughout', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'const a = 1\n', dataDescriptor: true },
      { name: 'src/b.js', content: 'const b = 2\n', dataDescriptor: true, method: 8 },
      { name: 'src/c.js', content: 'const c = 3\n', dataDescriptor: true, descriptorSignature: false },
      { name: 'src/d.js', content: 'const d = 4\n' },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(4)
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'])
  })
})

describe('zip data descriptors: a bad descriptor costs one entry', () => {
  it('skips an entry whose descriptor checksum lies and keeps the others', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, descriptorCrcOverride: 0xdeadbeef }))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/b.js'])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].code).toBe('data_descriptor_mismatch')
    expect(result.skipped[0].message).toContain('src/a.js')
  })

  it('skips an entry whose descriptor sizes lie', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, descriptorCompressedOverride: 999 }))

    expect(result.refusal).toBeNull()
    expect(result.skipped[0].code).toBe('data_descriptor_mismatch')
    expect(result.entries).toHaveLength(1)
  })

  it('skips an entry that advertises a descriptor and never writes one', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, descriptorOmitted: true }))

    expect(result.refusal).toBeNull()
    expect(result.skipped[0].code).toBe('data_descriptor_mismatch')
    expect(result.entries).toHaveLength(1)
  })

  it('never lets a skipped descriptor entry stop the archive', async () => {
    const bytes = buildZip([
      { name: 'src/bad.js', content: SOURCE, dataDescriptor: true, descriptorUncompressedOverride: 4_000_000 },
      { name: 'src/good.js', content: 'const good = 1\n' },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/good.js'])
  })

  it('counts the skipped entry against neither the analysed nor the planned total', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, descriptorCrcOverride: 1 }))

    expect(result.stats.entries).toBe(1)
    expect(result.stats.skipped).toBe(1)
    expect(result.stats.producedBytes).toBe(16)
  })
})

describe('zip data descriptors: the agreement rules stay narrow', () => {
  it('refuses an entry whose local header disagrees about a size it did not zero', async () => {
    const result = await readArchive(
      descriptorArchive({ dataDescriptor: true, descriptorLocalHonest: true, localDeclaredCompressed: 77 }),
    )

    expect(result.refusal?.code).toBe('local_central_disagreement')
  })

  it('refuses an archive whose central directory claims bit 3 but whose local header does not', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, localFlagsOverride: 0 }))

    expect(result.refusal?.code).toBe('local_central_disagreement')
  })

  it('skips an encrypted entry even when it also advertises a descriptor', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, encrypted: true }))

    expect(result.refusal).toBeNull()
    expect(result.skipped.map((entry) => entry.code)).toEqual(['encrypted_entry'])
  })

  it('skips an entry whose local header hides the encrypted flag the index does not show', async () => {
    const result = await readArchive(descriptorArchive({ dataDescriptor: true, localFlagsOverride: 0x0009 }))

    expect(result.refusal).toBeNull()
    expect(result.skipped.map((entry) => entry.code)).toEqual(['encrypted_entry'])
  })

  it('still checks the entry name bytes against the index', async () => {
    const result = await readArchive(
      buildZip([{ name: 'src/a.js', content: SOURCE, dataDescriptor: true, localNameOverride: 'src/zzzzz.js' }]),
    )

    expect(result.refusal?.code).toBe('corrupt_local_header')
  })

  it('still checks the compression method against the index', async () => {
    const result = await readArchive(
      buildZip([{ name: 'src/a.js', content: SOURCE, method: 8, dataDescriptor: true, localMethodOverride: 0 }]),
    )

    expect(result.refusal?.code).toBe('local_central_disagreement')
  })
})

describe('zip data descriptors: the descriptor bytes belong to the entry', () => {
  it('sizes each descriptor exactly, so back-to-back entries neither collide nor overrun the index', async () => {
    // Three widths meet here: 16, 20 and 12 bytes. Reading the last one too wide would make it
    // run into the central directory, and reading any of them too narrow would put the following
    // record's header inside bytes the previous entry already owns.
    const entries = Array.from({ length: 60 }, (_, i) => ({
      name: `src/mixed/file-${i}.js`,
      content: `export const n = ${i}\n`,
      dataDescriptor: true,
      descriptorSignature: i % 3 !== 0,
      descriptorZip64Sizes: i % 5 === 0,
      method: i % 4 === 0 ? 8 : 0,
    }))
    const result = await readArchive(buildZip(entries))

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(60)
    expect(result.entries[0].text).toBe('export const n = 0\n')
    expect(result.entries[59].text).toBe('export const n = 59\n')
  })

  it('treats a descriptor at the very end of the file as complete', async () => {
    const bytes = buildZip([{ name: 'src/last.js', content: SOURCE, dataDescriptor: true }])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
  })
})
