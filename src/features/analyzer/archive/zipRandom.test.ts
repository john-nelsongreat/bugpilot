import { describe, expect, it } from 'vitest'
import { buildZip, zip64Archive } from '../../../test/zipFixtures'
import {
  createBlobSource,
  createMemorySource,
  readArchiveSource,
  readArchive,
  type ByteSource,
} from './guard'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'

const limits = (overrides: Partial<typeof DEFAULT_ARCHIVE_LIMITS> = {}) => ({ ...DEFAULT_ARCHIVE_LIMITS, ...overrides })

function tracking(source: ByteSource): { source: ByteSource; ranges: [number, number][]; bytesRead: number } {
  const state = { ranges: [] as [number, number][], bytesRead: 0 }
  return {
    get source() {
      return {
        size: source.size,
        async read(start: number, end: number, signal?: AbortSignal) {
          state.ranges.push([start, end])
          state.bytesRead += end - start
          return source.read(start, end, signal)
        },
      }
    },
    get ranges() {
      return state.ranges
    },
    get bytesRead() {
      return state.bytesRead
    },
  }
}

describe('random-access zip: locating the end of the central directory', () => {
  it('reads an archive whose end record carries a comment', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'const a = 1\n' }], { comment: 'built by the fixture' })
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
  })

  it('finds the end record at the far edge of the scan window', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }], { comment: 'z'.repeat(65_535) })
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
  })

  it('steps over trailing bytes after the end record instead of refusing the archive', async () => {
    const clean = buildZip([{ name: 'src/a.js', content: 'x\n' }])
    const bytes = new Uint8Array(clean.length + 12)
    bytes.set(clean, 0)
    bytes.fill(0x41, clean.length)
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
  })

  it('refuses an archive whose junk pushes the end record past the scan window', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }], { append: new Uint8Array(70_000).fill(0x41) })
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal?.code).toBe('not_a_zip')
  })

  it('refuses an end record whose comment is cut off, junk or no junk', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }], { comment: 'a tail that is not all there' })
    const truncated = bytes.subarray(0, bytes.length - 10)
    const result = await readArchiveSource(createMemorySource(truncated))

    expect(result.refusal?.code).toBe('not_a_zip')
  })

  it('does not trust a declared entry count that claims fewer records than exist', async () => {
    const bytes = buildZip(
      [
        { name: 'src/a.js', content: 'a\n' },
        { name: 'src/b.js', content: 'b\n' },
        { name: 'src/c.js', content: 'c\n' },
      ],
      { declaredEntryCount: 1 },
    )
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js', 'src/c.js'])
    expect(result.stats.walkedRecords).toBe(3)
  })

  it('does not trust a declared entry count that claims more records than exist', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'a\n' }], { declaredEntryCount: 50_000 })
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
    expect(result.stats.walkedRecords).toBe(1)
  })

  it('refuses a central directory that runs past the end record', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }], { declaredCdSize: 9_000 })
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses a central directory larger than the bounded read', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxCentralDirectoryBytes: 32 }),
    })

    expect(result.refusal?.code).toBe('central_directory_too_large')
    expect(result.stats.producedBytes).toBe(0)
  })
})

describe('random-access zip: records that lie about where they are', () => {
  it('refuses a local header offset outside the archive', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n', localHeaderOffsetOverride: 10_000_000 }])
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal?.code).toBe('corrupt_local_header')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses a local header whose sizes disagree with the index', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n', declaredCompressed: 10, localDeclaredCompressed: 11 }])
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal?.code).toBe('local_central_disagreement')
  })

  it('refuses two entries whose compressed ranges overlap', async () => {
    const a = 'a'.repeat(10)
    const b = 'export const b = 1\n'
    const span = a.length + 30 + 'src/b.js'.length + b.length
    const bytes = buildZip([
      { name: 'src/a.js', content: a, declaredCompressed: span, localDeclaredCompressed: span },
      { name: 'src/b.js', content: b },
    ])
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal?.code).toBe('overlapping_entries')
    expect(result.stats.producedBytes).toBe(0)
  })

  it('refuses the many-entries overlap bomb before inflating any of them', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `src/member-${i}.js`)
    const bodies = names.map((_, i) => `export const value${i} = ${i}\n`)
    const offsets: number[] = []
    let at = 0
    for (let i = 0; i < names.length; i += 1) {
      offsets.push(at)
      at += 30 + names[i].length + bodies[i].length
    }
    const lastEnd = at
    const bytes = buildZip(
      names.map((name, i) => {
        const dataStart = offsets[i] + 30 + name.length
        const declared = lastEnd - dataStart
        return { name, content: bodies[i], declaredCompressed: declared, localDeclaredCompressed: declared }
      }),
    )
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal?.code).toBe('overlapping_entries')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses a compressed range that runs into the central directory', async () => {
    const body = 'x'.repeat(10)
    const name = `src/${'a'.repeat(40)}.js`
    const centralOffset = 30 + name.length + body.length
    const bytes = buildZip([
      { name, content: body, declaredCompressed: body.length + 100, localDeclaredCompressed: body.length + 100 },
    ])
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(centralOffset).toBeLessThan(bytes.length)
    expect(result.refusal?.code).toBe('overlapping_entries')
    expect(result.stats.producedBytes).toBe(0)
  })

  it('refuses an entry aliased onto another entry local header', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a\n' },
      { name: 'src/b.js', content: 'b\n', localHeaderOffsetOverride: 0 },
    ])
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(['corrupt_local_header', 'duplicate_name', 'overlapping_entries', 'local_central_disagreement']).toContain(
      result.refusal?.code,
    )
  })
})

describe('random-access zip: formats and record flags the reader still refuses', () => {
  it('refuses a multi-disk archive', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }], { diskNumber: 1 })
    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal?.code).toBe('multi_disk_not_supported')
  })

  it('reads a zip64 archive reached through its locator', async () => {
    const result = await readArchiveSource(createMemorySource(zip64Archive()))
    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['a.txt'])
  })

  it('keeps the encrypted, symlink, duplicate and traversal refusals', async () => {
    const encrypted = await readArchiveSource(
      createMemorySource(buildZip([{ name: 'src/a.js', content: 'x', encrypted: true }])),
    )
    const symlink = await readArchiveSource(
      createMemorySource(buildZip([{ name: 'link.js', content: '/etc/passwd', symlink: true }])),
    )
    const duplicate = await readArchiveSource(
      createMemorySource(buildZip([
        { name: 'src/a.js', content: 'a\n' },
        { name: 'src/a.js', content: 'b\n' },
      ])),
    )
    const traversal = await readArchiveSource(createMemorySource(buildZip([{ name: '../x.js', content: 'x\n' }])))

    expect(encrypted.refusal?.code).toBe('encrypted_entry')
    expect(symlink.refusal?.code).toBe('symlink_entry')
    expect(duplicate.refusal?.code).toBe('duplicate_name')
    expect(traversal.refusal?.code).toBe('path_traversal')
  })
})

describe('random-access zip: classification happens before a byte is inflated', () => {
  it('never reads the data of an ignored or binary entry', async () => {
    const ignored = 'x'.repeat(2 * 1024 * 1024)
    const fakeImage = new Uint8Array(512 * 1024).fill(0x89)
    const bytes = buildZip([
      { name: 'node_modules/pkg/index.js', content: ignored },
      { name: 'assets/photo.png', content: fakeImage },
      { name: 'src/keep.js', content: 'export const keep = 1\n' },
    ])
    const tracked = tracking(createMemorySource(bytes))
    const result = await readArchiveSource(tracked.source)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/keep.js'])
    expect(tracked.bytesRead).toBeLessThan(1024 * 1024)
  })

  it('reads a deflated entry only after the whole index has been classified', async () => {
    const body = Array.from({ length: 200 }, (_, i) => `export const value${i} = ${i}\n`).join('')
    const bytes = buildZip([
      { name: 'node_modules/pkg/huge.js', content: 'x'.repeat(100_000), method: 8 },
      { name: 'src/app.js', content: body, method: 8 },
    ])
    const tracked = tracking(createMemorySource(bytes))
    const result = await readArchiveSource(tracked.source)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].text).toBe(body)
  })
})

describe('random-access zip: Blob slicing', () => {
  it('reads the same archive through a Blob without loading the whole file first', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'const a = 1\n' },
      { name: 'src/b.py', content: 'print(1)\n', method: 8 },
    ])
    const result = await readArchiveSource(createBlobSource(new Blob([bytes.buffer as ArrayBuffer])))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.py'])
    expect(result.entries[1].language).toBe('python')
  })

  it('keeps the Uint8Array entry point working', async () => {
    const result = await readArchive(buildZip([{ name: 'src/a.js', content: 'x\n' }]))
    expect(result.entries).toHaveLength(1)
  })
})

describe('random-access zip: partial results', () => {
  it('analyses the first maxEntryCount files and names the rest for a continuation', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(100) },
      { name: 'src/c.js', content: 'c'.repeat(100) },
    ])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxEntryCount: 2 }),
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
    expect(result.partial?.code).toBe('entry_count_exceeded')
    expect(result.skipped.filter((entry) => entry.code === 'not_reached').map((entry) => entry.name)).toEqual(['src/c.js'])
  })

  it('stops inflating when the work budget is spent and keeps earlier entries', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(200) },
    ])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxTotalUncompressedBytes: 150 }),
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(result.partial?.code).toBe('total_uncompressed_exceeded')
    expect(result.stats.producedBytes).toBeLessThanOrEqual(150)
  })

  it('keeps what was read when the user cancels mid-extraction', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a'.repeat(80) },
      { name: 'src/b.js', content: 'b'.repeat(80) },
    ])
    const controller = new AbortController()
    const result = await readArchiveSource(createMemorySource(bytes), {
      signal: controller.signal,
      keepPartial: true,
      onProgress: (progress) => {
        if (progress.extractedEntries === 1) controller.abort()
      },
    })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(result.partial?.code).toBe('cancelled')
    expect(result.skipped.some((entry) => entry.code === 'not_reached')).toBe(true)
  })

  it('returns a partial result with a reason when the clock is already spent', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxChunkWallClockMs: 0 }),
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    expect(result.partial?.code).toBe('wall_clock_exceeded')
    expect(result.partial?.message).toContain('second')
  })

  it('still refuses by default when no consumer asked for partial results', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(200) },
    ])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxTotalUncompressedBytes: 150 }),
    })

    expect(result.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(result.entries).toHaveLength(0)
  })
})

describe('random-access zip: skipped entries never block the pass', () => {
  // An entry whose contents turn out to be binary is skipped with a reason; it occupies no slice
  // of any budget, so the files after it are analysed in the same pass.
  const nulls = new Uint8Array(100).fill(0x00)

  it('skips a binary entry and still analyses the files after it', async () => {
    const bytes = buildZip([
      { name: 'src/sneaky.js', content: nulls },
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(100) },
    ])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxEntryCount: 3 }),
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
    expect(result.skipped).toEqual([
      { name: 'src/sneaky.js', code: 'binary_content', message: expect.stringMatching(/binary file/) },
    ])
    expect(result.partial).toBeNull()
  })

  it('names the files past the analysed cap as not reached, with a reason that says so', async () => {
    const bytes = buildZip([
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(100) },
      { name: 'src/c.js', content: 'c'.repeat(100) },
    ])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxEntryCount: 2 }),
      keepPartial: true,
    })

    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
    const unreached = result.skipped.filter((entry) => entry.code === 'not_reached')
    expect(unreached.map((entry) => entry.name)).toEqual(['src/c.js'])
    // The reason has to name the cap, not pretend the file was unreadable.
    expect(unreached[0].message).toMatch(/cap/)
    expect(unreached[0].message).toMatch(/only the files BugPilot actually read/)
  })

  it('counts every record once, whether it was analysed, skipped or left unreached', async () => {
    const bytes = buildZip([
      { name: 'src/sneaky.js', content: nulls },
      { name: 'src/a.js', content: 'a'.repeat(100) },
      { name: 'src/b.js', content: 'b'.repeat(100) },
      { name: 'src/c.js', content: 'c'.repeat(100) },
    ])
    const result = await readArchiveSource(createMemorySource(bytes), {
      limits: limits({ maxEntryCount: 2 }),
      keepPartial: true,
    })

    // Walked records are the whole archive; what comes back out is entries plus skipped, once each.
    expect(result.stats.walkedRecords).toBe(4)
    expect(result.entries.length + result.skipped.length).toBe(4)
    expect(result.stats.plannedEntries).toBe(4)
    expect(result.stats.skipped).toBe(result.skipped.length)
  })
})
