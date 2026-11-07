// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import { readTar } from './tar'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'
import { buildTar, emptyTar, tarLongNameBlocks, tarMetaBlocks, TAR_BLOCK, TAR_TYPE, tarOf } from '../../../test/tarFixtures'

const encoder = new TextEncoder()
const smallLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxArchiveBytes: 512 * 1024, maxTotalUncompressedBytes: 8 * 1024 }

function headerBytes(name: string, body: string) {
  return buildTar([{ name, content: body }])
}

describe('readTar: an honest archive', () => {
  it('reads every text member with its language', async () => {
    const archive = buildTar([
      { name: 'src/app.js', content: 'export const a = 1\n' },
      { name: 'calc.py', content: 'def f():\n    return 1\n' },
    ])
    const result = await readTar(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => [entry.name, entry.language])).toEqual([
      ['src/app.js', 'javascript'],
      ['calc.py', 'python'],
    ])
    expect(result.entries[0].text).toBe('export const a = 1\n')
    expect(result.stats.entries).toBe(2)
    expect(result.stats.producedBytes).toBe(encoder.encode('export const a = 1\n').length + encoder.encode('def f():\n    return 1\n').length)
  })

  it('reads a single-file archive whose trailer is the standard blocking factor', async () => {
    const result = await readTar(tarOf('notes.txt', 'hello\n'))
    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
  })

  it('reads an empty archive as no entries rather than a failure', async () => {
    const result = await readTar(emptyTar())
    expect(result.refusal).toBeNull()
    expect(result.entries).toEqual([])
    expect(result.stats.walkedRecords).toBe(0)
  })

  it('skips directory entries and keeps going', async () => {
    const archive = buildTar([
      { name: 'src/', content: '', typeFlag: TAR_TYPE.directory },
      { name: 'src/a.js', content: 'export const a = 1\n' },
    ])
    const result = await readTar(archive)

    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([['src/', 'directory_entry']])
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
  })

  it('reassembles a ustar prefix split across the two name fields', async () => {
    const deep = 'very/deeply/nested/folder'
    const archive = buildTar([{ name: 'file.js', prefix: deep, content: 'export const a = 1\n' }])
    const result = await readTar(archive)

    expect(result.entries.map((entry) => entry.name)).toEqual([`${deep}/file.js`])
  })

  it('takes the path from a PAX extended header', async () => {
    const longPath = `src/${'folder/'.repeat(30)}app.js`
    const archive = buildTar([{ name: 'short.js', pax: { path: longPath }, content: 'export const a = 1\n' }])
    const result = await readTar(archive)

    expect(result.entries.map((entry) => entry.name)).toEqual([longPath])
  })

  it('takes the size from a PAX record that contradicts the header', async () => {
    const body = 'x'.repeat(900)
    // The header claims 512 bytes while the PAX record and the real body say 900.
    const archive = buildTar([{ name: 'a.txt', content: body, sizeOverride: 512, pax: { size: '900' } }])
    const result = await readTar(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].bytes).toBe(900)
  })

  it('ignores PAX records it was not told to honour', async () => {
    const archive = buildTar([{ name: 'a.js', content: 'x\n', pax: { mtime: '1700000000', atime: '1', 'Schily.xattr.trusted.foo': 'bar' } }])
    const result = await readTar(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['a.js'])
  })

  it('reads a GNU long name from the L record that precedes it', async () => {
    const longName = `src/${'module/'.repeat(20)}deep.js`
    const archive = buildTar([{ name: 'ignored', gnuLongName: longName, content: 'export const a = 1\n' }])
    const result = await readTar(archive)

    expect(result.entries.map((entry) => entry.name)).toEqual([longName])
  })

  it('consumes a global PAX header without letting it rename the entries', async () => {
    // A `g` record belongs to the whole archive, so its `path` cannot be the name of one entry.
    const archive = buildTar([
      { name: 'second.js', content: 'y\n', paxGlobal: { comment: 'written by tester', path: 'global/first.js' } },
      { name: 'third.js', content: 'z\n' },
    ])
    const result = await readTar(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['second.js', 'third.js'])
    expect(result.skipped).toEqual([])
  })

  it('refuses an archive whose last block is cut in half', async () => {
    const archive = buildTar([{ name: 'a.txt', content: 'x\n' }], { truncateTo: TAR_BLOCK * 2 - 100 })
    const result = await readTar(archive)

    expect(result.refusal?.code).toBe('archive_truncated')
  })

  it('refuses an archive that stops before its declared body ends', async () => {
    // Cut the file itself, so the bytes the header promises really are not there.
    const archive = buildTar([{ name: 'a.txt', content: 'x'.repeat(2000) }], { truncateTo: TAR_BLOCK + 800 })
    const result = await readTar(archive)

    expect(result.refusal?.code).toBe('archive_truncated')
    expect(result.entries).toEqual([])
  })

  it('refuses an archive with no end-of-archive blocks', async () => {
    const archive = buildTar([{ name: 'a.txt', content: 'x\n' }], { endBlocks: 0 })
    const result = await readTar(archive)

    expect(result.refusal?.code).toBe('archive_truncated')
  })

  it('accepts an archive whose padding runs past the trailer', async () => {
    const archive = buildTar([{ name: 'a.txt', content: 'x\n' }], { endBlocks: 8 })
    const result = await readTar(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
  })
})

describe('readTar: hostile headers', () => {
  it('refuses a header whose checksum does not match its own bytes', async () => {
    const result = await readTar(buildTar([{ name: 'a.txt', content: 'x\n', breakChecksum: true }]))
    expect(result.refusal?.code).toBe('corrupt_tar_header')
    expect(result.refusal?.message).toContain('checksum')
  })

  it('refuses a header with no ustar magic at all', async () => {
    // Only the magic is missing: the checksum is still correct, so this proves the magic check.
    const result = await readTar(buildTar([{ name: 'a.txt', content: 'x\n', magicOverride: '' }]))
    expect(result.refusal?.code).toBe('not_a_tar')
  })

  it('refuses a damaged header deeper in the archive', async () => {
    const archive = buildTar([
      { name: 'a.txt', content: 'x\n' },
      { name: 'b.txt', content: 'y\n', magicOverride: '' },
    ])
    const result = await readTar(archive)
    expect(result.refusal?.code).toBe('corrupt_tar_header')
  })

  it('refuses a path that walks out of the archive', async () => {
    const result = await readTar(headerBytes('../evil.js', 'x\n'))
    expect(result.refusal?.code).toBe('path_traversal')
  })

  it('refuses an absolute path', async () => {
    const result = await readTar(headerBytes('/etc/passwd', 'x\n'))
    expect(result.refusal?.code).toBe('absolute_path')
  })

  it('refuses a Windows drive letter', async () => {
    const result = await readTar(headerBytes('C:/evil.js', 'x\n'))
    expect(result.refusal?.code).toBe('drive_letter_path')
  })

  it('reads a backslash path as a separator, the way extraction tools do', async () => {
    const result = await readTar(headerBytes('src\\evil.js', 'x\n'))
    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/evil.js'])
  })

  it('refuses a backslash escape after normalization', async () => {
    const result = await readTar(headerBytes('src\\..\\evil.js', 'x\n'))
    expect(result.refusal?.code).toBe('path_traversal')
  })

  it('refuses a PAX path that traverses, before reading a byte of its body', async () => {
    const archive = buildTar([{ name: 'a.js', pax: { path: '../../outside.js' }, content: 'x'.repeat(600) }])
    const result = await readTar(archive)
    expect(result.refusal?.code).toBe('path_traversal')
    expect(result.entries).toEqual([])
  })

  it('refuses a name hidden behind a NUL byte', async () => {
    const raw = new Uint8Array(100)
    raw.set(encoder.encode('a.js'), 0)
    raw[6] = 0
    raw.set(encoder.encode('../../etc/passwd'), 7)
    const result = await readTar(buildTar([{ name: 'a.js', rawName: raw, content: 'x\n' }]))
    expect(result.refusal?.code).toBe('null_byte_in_name')
  })

  it('refuses two members with the same name', async () => {
    const result = await readTar(buildTar([
      { name: 'src/a.js', content: 'first\n' },
      { name: 'src/a.js', content: 'second\n' },
    ]))
    expect(result.refusal?.code).toBe('duplicate_name')
  })

  it('refuses a nested archive inside the tar', async () => {
    const inner = gzipSync(encoder.encode('not really a zip but named like one'))
    const result = await readTar(buildTar([{ name: 'payloads/inner.zip', content: inner }]))
    expect(result.refusal?.code).toBe('nested_archive')
  })

  it('refuses a name longer than the reader will handle', async () => {
    const result = await readTar(buildTar([{ name: 'src/a.txt', gnuLongName: `src/${'d'.repeat(1_300)}.js`, content: 'x\n' }]))
    expect(result.refusal?.code).toBe('name_too_long')
  })

  it('refuses a lying PAX header size instead of scanning it', async () => {
    const blocks = tarMetaBlocks(TAR_TYPE.paxExtended, { path: 'a.js' }, 40 * 1024 * 1024)
    const archive = buildTar([{ name: 'a.js', content: 'x\n' }])
    const merged = new Uint8Array(blocks[0].length + archive.length)
    merged.set(blocks[0])
    merged.set(archive, blocks[0].length)
    const result = await readTar(merged)
    expect(result.refusal?.code).toBe('corrupt_tar_header')
  })

  it('refuses a lying GNU long-name header before copying its body', async () => {
    const blocks = tarLongNameBlocks('src/a.js', 40 * 1024 * 1024)
    const archive = buildTar([{ name: 'a.js', content: 'x\n' }])
    const merged = new Uint8Array(blocks[0].length + archive.length)
    merged.set(blocks[0])
    merged.set(archive, blocks[0].length)

    const result = await readTar(merged)
    expect(result.refusal?.code).toBe('corrupt_tar_header')
  })

  it('refuses a base-256 size that cannot be a real length', async () => {
    // 0x80 marks base-256; the eleven following bytes spell 2^88-1, far past a safe JavaScript integer.
    const archive = buildTar([{ name: 'a.txt', content: 'x\n', sizeRaw: [0x80, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] }])
    const result = await readTar(archive)
    expect(result.refusal?.code).toBe('corrupt_tar_header')
  })

  it('reads a base-256 size that is a real length', async () => {
    const body = 'x'.repeat(70_000)
    // 70 000 = 0x011170, spelled in the last three bytes of the field.
    const archive = buildTar([{ name: 'a.txt', content: body, sizeRaw: [0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x11, 0x70] }])
    const result = await readTar(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].bytes).toBe(70_000)
  })

  it('refuses an archive whose member count exceeds the cap', async () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({ name: `f${index}.txt`, content: 'x\n' }))
    const result = await readTar(buildTar(entries), { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxEntryCount: 5 } })
    expect(result.refusal?.code).toBe('entry_count_exceeded')
  })

  it('refuses an archive whose members add up past the total cap', async () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({ name: `f${index}.txt`, content: 'x'.repeat(1_200) }))
    const result = await readTar(buildTar(entries), { limits: { ...smallLimits, maxTotalUncompressedBytes: 4 * 1024 } })
    expect(result.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(result.entries).toEqual([])
  })

  it('keeps the members read before the total cap when the caller accepts a partial result', async () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({ name: `f${index}.txt`, content: 'x'.repeat(1_200) }))
    const result = await readTar(buildTar(entries), {
      limits: { ...smallLimits, maxTotalUncompressedBytes: 4 * 1024 },
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    expect(result.partial?.code).toBe('total_uncompressed_exceeded')
    expect(result.entries.map((entry) => entry.name)).toEqual(['f0.txt', 'f1.txt', 'f2.txt'])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['f3.txt', 'not_reached'],
      ['(rest of the archive)', 'not_reached'],
    ])
    expect(result.partial).toMatchObject({ analysedFiles: 3, plannedFiles: 5, unreachedFiles: 2 })
    expect(result.skipped[0].message).toContain('unpacking work budget')
  })

  it('keeps what it read when the wall clock is already spent', async () => {
    const result = await readTar(buildTar([{ name: 'first.txt', content: 'x\n' }]), {
      limits: { ...DEFAULT_ARCHIVE_LIMITS, maxChunkWallClockMs: 0 },
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    expect(result.partial?.code).toBe('wall_clock_exceeded')
    // The clock is spent on the first yield, inside the first member, so that member is named
    // as cut off and everything behind it is accounted for by one marker.
    expect(result.entries).toEqual([])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['first.txt', 'not_reached'],
      ['(rest of the archive)', 'not_reached'],
    ])
    expect(result.partial).toMatchObject({ analysedFiles: 0, plannedFiles: 2, unreachedFiles: 2 })
  })

  it('refuses an archive bigger than the byte ceiling before reading a header', async () => {
    const archive = buildTar([{ name: 'a.txt', content: 'x'.repeat(600) }])
    const result = await readTar(archive, { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxArchiveBytes: 512 } })
    expect(result.refusal?.code).toBe('archive_too_large')
  })

  // A tar is walked in one direction, so the member that trips the analysed cap is named and the
  // tail behind it is one marker rather than a list of names the reader never reached. The cap is
  // a separate number from the unpacking budget and applies even when the budget has room left.
  it('stops at the analysed-entry cap even though the work budget has room left', async () => {
    const archive = buildTar([
      { name: 'a.txt', content: 'a'.repeat(120) },
      { name: 'b.txt', content: 'b'.repeat(120) },
      { name: 'c.txt', content: 'c'.repeat(120) },
    ])
    const limits = { ...DEFAULT_ARCHIVE_LIMITS, maxTotalUncompressedBytes: 10_000, maxEntryCount: 2 }

    const kept = await readTar(archive, { limits, keepPartial: true })
    expect(kept.refusal).toBeNull()
    expect(kept.entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.txt'])
    expect(kept.partial?.code).toBe('entry_count_exceeded')
    expect(kept.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['c.txt', 'not_reached'],
      ['(rest of the archive)', 'not_reached'],
    ])
    expect(kept.partial).toMatchObject({ analysedFiles: 2, plannedFiles: 4, unreachedFiles: 2 })
    expect(kept.skipped[0].message).toMatch(/analysed-entry cap/)

    const refused = await readTar(archive, { limits })
    expect(refused.refusal?.code).toBe('entry_count_exceeded')
    expect(refused.entries).toHaveLength(0)
  })

  it('does not count a skipped member toward the analysed cap', async () => {
    const archive = buildTar([
      { name: 'blob.dat', content: new Uint8Array(120).fill(0x00) },
      { name: 'a.txt', content: 'a'.repeat(120) },
      { name: 'b.txt', content: 'b'.repeat(120) },
    ])
    const result = await readTar(archive, {
      limits: { ...DEFAULT_ARCHIVE_LIMITS, maxTotalUncompressedBytes: 10_000, maxEntryCount: 2 },
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.txt'])
    expect(result.skipped.map((entry) => entry.code)).toEqual(['binary_content'])
    expect(result.partial).toBeNull()
  })
})

describe('readTar: special entries are never followed', () => {
  const special: { flag: string; label: string }[] = [
    { flag: TAR_TYPE.symlink, label: 'symbolic link' },
    { flag: TAR_TYPE.hardLink, label: 'hard link' },
    { flag: TAR_TYPE.charDevice, label: 'character device' },
    { flag: TAR_TYPE.blockDevice, label: 'block device' },
    { flag: TAR_TYPE.fifo, label: 'FIFO' },
    { flag: TAR_TYPE.gnuSparse, label: 'sparse file' },
    { flag: TAR_TYPE.volumeLabel, label: 'volume label' },
    { flag: TAR_TYPE.volumeContinuation, label: 'volume continuation' },
  ]

  for (const item of special) {
    it(`skips a ${item.label} and still reads the file next to it`, async () => {
      const archive = buildTar([
        { name: 'weird/entry', typeFlag: item.flag, linkName: '/etc/shadow', content: '' },
        { name: 'src/a.js', content: 'export const a = 1\n' },
      ])
      const result = await readTar(archive)

      expect(result.refusal).toBeNull()
      expect(result.skipped.map((entry) => entry.code)).toEqual(['special_entry'])
      expect(result.skipped[0].message).toContain(item.label)
      expect(result.skipped[0].message).not.toContain('/etc/shadow')
      expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    })
  }

  it('skips a symlink whose target is written as a long link name', async () => {
    const archive = buildTar([{ name: 'link', typeFlag: TAR_TYPE.symlink, gnuLongLink: '/home/user/.ssh/id_rsa', content: '' }])
    const result = await readTar(archive)

    expect(result.skipped.map((entry) => entry.code)).toEqual(['special_entry'])
    expect(result.skipped[0].message).not.toContain('id_rsa')
  })
})

describe('readTar: the same skips the zip reader makes', () => {
  it('skips ignored folders and binary members', async () => {
    const archive = buildTar([
      { name: 'node_modules/leftpad/index.js', content: 'module.exports = 1\n' },
      { name: 'assets/logo.png', content: '\x89PNG\r\n\x1a\n' },
      { name: 'src/a.js', content: 'export const a = 1\n' },
      { name: 'empty.txt', content: '' },
    ])
    const result = await readTar(archive)

    expect(result.refusal).toBeNull()
    expect(result.skipped.map((entry) => entry.code)).toEqual(['ignored_folder', 'binary_content', 'empty_entry'])
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
  })

  it('skips a member over the per-file ceiling and keeps the rest', async () => {
    const archive = buildTar([
      { name: 'big.txt', content: 'x'.repeat(4 * 1024) },
      { name: 'src/a.js', content: 'export const a = 1\n' },
    ])
    const limits = { ...smallLimits, maxTotalUncompressedBytes: 64 * 1024, maxSingleFileUncompressedBytes: 2 * 1024 }
    const result = await readTar(archive, { limits })

    expect(result.refusal).toBeNull()
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([['big.txt', 'single_file_too_large']])
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    // Skipping on the declared length means the oversized member is never accumulated at all.
    expect(result.stats.producedBytes).toBe(19)
    expect(result.stats.peakEntryBytes).toBeLessThanOrEqual(2 * 1024)
  })

  it('reads a UTF-8 name that is not ASCII', async () => {
    const result = await readTar(headerBytes('docs/caf\u00e9.md', '# Notes\n'))
    expect(result.entries[0].name).toBe('docs/caf\u00e9.md')
    expect(result.entries[0].language).toBe('markdown')
  })

  it('refuses a cancelled read and produces nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await readTar(tarOf('a.txt', 'x\n'), { signal: controller.signal })
    expect(result.refusal?.code).toBe('cancelled')
    expect(result.entries).toEqual([])
  })

  it('reports progress while it walks', async () => {
    const seen: number[] = []
    await readTar(buildTar([{ name: 'a.js', content: 'x\n' }, { name: 'b.js', content: 'y\n' }]), {
      onProgress: (progress) => seen.push(progress.extractedEntries),
    })
    expect(seen).toEqual([1, 2])
  })
})

describe('readTar: the generated-file override', () => {
  it('reads vendored files on request but never reads .git', async () => {
    const archive = buildTar([
      { name: 'node_modules/left-pad/index.js', content: 'module.exports = 1\n' },
      { name: '.git/config', content: '[core]\n' },
      { name: 'src/app.js', content: 'export const a = 1\n' },
    ])
    const result = await readTar(archive, { includeGenerated: true })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['node_modules/left-pad/index.js', 'src/app.js'])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([['.git/config', 'ignored_folder']])
  })
})
