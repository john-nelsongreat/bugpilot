import { describe, expect, it } from 'vitest'
import { buildZip } from '../../../test/zipFixtures'
import { readArchive } from './guard'

/**
 * Self-extracting zips: a stub sits in front of the first local header. Writers either store every
 * offset relative to the start of the zip part or already count the stub, and the reader derives
 * the prefix from where the central directory actually is versus where the index claims it is.
 */
const STUB = new TextEncoder().encode(
  'MZ\x90\x00' + 'this is a self-extracting stub, not part of the zip\n'.repeat(20),
)

describe('readArchive: self-extracting zip prefixes', () => {
  it('reads a stub-prefixed zip whose offsets are relative to the zip part', async () => {
    const bytes = buildZip(
      [
        { name: 'src/a.js', content: 'export const a = 1\n' },
        { name: 'src/b.js', content: 'export const b = 2\n' },
      ],
      { prepend: STUB, zipRelativeOffsets: true },
    )
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
    expect(result.skipped).toEqual([])
  })

  it('reads a stub-prefixed zip whose offsets already count the stub', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'export const a = 1\n' }], { prepend: STUB })
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
  })

  it('reads a zip64 archive behind a stub', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'export const a = 1\n', zip64: true }], {
      prepend: STUB,
      zipRelativeOffsets: true,
      zip64: true,
    })
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
  })

  it('refuses a stub-prefixed zip whose index claims to start past the real index', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'export const a = 1\n' }], {
      prepend: STUB,
      zipRelativeOffsets: true,
      declaredCdOffset: STUB.length + 1_000_000,
    })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses a stub-prefixed zip whose entry offset points into the stub', async () => {
    const bytes = buildZip(
      [{ name: 'src/a.js', content: 'export const a = 1\n', localHeaderOffsetOverride: 4 }],
      { prepend: STUB, zipRelativeOffsets: true },
    )
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_local_header')
  })

  it('refuses a zip64 locator that disagrees with where its record really is', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'export const a = 1\n', zip64: true }], {
      prepend: STUB,
      zipRelativeOffsets: true,
      zip64: true,
      zip64RecordOffset: 0,
    })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })
})
