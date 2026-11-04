import { deflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildZip, zip64Archive } from '../../../test/zipFixtures'
import { DEFAULT_ARCHIVE_LIMITS, readArchive } from './guard'

const smallLimits = {
  ...DEFAULT_ARCHIVE_LIMITS,
  maxArchiveBytes: 4096,
  maxTotalUncompressedBytes: 8192,
  maxSingleFileUncompressedBytes: 1024,
  maxEntryCount: 20,
}

function manyEntries(count: number, prefix = 'src') {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}/file-${i}.js`,
    content: `export const n = ${i}\n`,
  }))
}

describe('readArchive: accepts a normal archive', () => {
  it('extracts a stored text entry with its language and encoding', async () => {
    const bytes = buildZip([{ name: 'app/model.py', content: 'VALUE = 1\n' }])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name).toBe('app/model.py')
    expect(result.entries[0].text).toBe('VALUE = 1\n')
    expect(result.entries[0].language).toBe('python')
    expect(result.entries[0].encoding).toBe('utf-8')
  })

  it('inflates a deflated entry', async () => {
    const body = Array.from({ length: 300 }, (_, i) => `export const value${i} = ${i * 7}\n`).join('')
    const bytes = buildZip([{ name: 'src/app.js', content: body, method: 8 }])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].text).toBe(body)
    expect(result.entries[0].language).toBe('javascript')
  })

  it('refuses an entry that declares an impossible expansion ratio', async () => {
    const body = 'line\n'.repeat(200)
    const bytes = buildZip([{ name: 'notes.txt', content: body, method: 8 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('declared_ratio_exceeded')
    expect(result.stats.producedBytes).toBe(0)
  })
})

describe('readArchive: refuses paths that escape the archive', () => {
  it('refuses a ../ traversal name and produces nothing', async () => {
    const bytes = buildZip([{ name: '../outside.py', content: 'x = 1\n' }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('path_traversal')
    expect(result.entries).toHaveLength(0)
    expect(result.refusal?.message).toMatch(/\.\./)
  })

  it('refuses an absolute POSIX path', async () => {
    const bytes = buildZip([{ name: '/etc/passwd', content: 'root:x:0:0\n' }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('absolute_path')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses a Windows drive-letter path', async () => {
    const bytes = buildZip([{ name: 'C:\\Windows\\system.ini', content: 'a\n' }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('drive_letter_path')
  })

  it('refuses a backslash trick that resolves outside the root', async () => {
    const bytes = buildZip([{ name: 'ok\\..\\evil.js', content: 'x\n' }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('path_traversal')
  })
})

describe('readArchive: refuses archive structures the reader must not follow', () => {
  it('refuses a duplicate entry name', async () => {
    const bytes = buildZip([
      { name: 'a/dup.js', content: 'first\n' },
      { name: 'a/dup.js', content: 'second\n' },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('duplicate_name')
  })

  it('refuses a symlink entry', async () => {
    const bytes = buildZip([
      { name: 'link', content: '/etc/passwd', symlink: true },
      { name: 'safe.js', content: 'x\n' },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('symlink_entry')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses a nested archive instead of reading it', async () => {
    const inner = buildZip([{ name: 'inside.js', content: 'x\n' }])
    const bytes = buildZip([{ name: 'bundles/nested.zip', content: inner, method: 8 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('nested_archive')
  })

  it('refuses a zip64 archive with a specific reason', async () => {
    const result = await readArchive(zip64Archive())

    expect(result.refusal?.code).toBe('zip64_not_supported')
  })
})

describe('readArchive: leak A — the entry cap is measured on records actually walked', () => {
  it('stops at the cap when the archive declares far fewer entries than it holds', async () => {
    const records = manyEntries(smallLimits.maxEntryCount + 5)
    const bytes = buildZip(records, { declaredEntryCount: 3 })
    const result = await readArchive(bytes, { limits: smallLimits })

    expect(result.refusal?.code).toBe('entry_count_exceeded')
    expect(result.entries).toHaveLength(0)
    expect(result.stats.walkedRecords).toBeLessThanOrEqual(smallLimits.maxEntryCount + 1)
  })

  it('refuses an archive holding more real entries than the default cap', async () => {
    const bytes = buildZip(manyEntries(DEFAULT_ARCHIVE_LIMITS.maxEntryCount + 1))
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('entry_count_exceeded')
    expect(result.stats.walkedRecords).toBeLessThanOrEqual(DEFAULT_ARCHIVE_LIMITS.maxEntryCount + 1)
    expect(result.entries).toHaveLength(0)
  })

  it('refuses a file larger than maxArchiveBytes before walking anything', async () => {
    const bytes = buildZip(manyEntries(40, 'pad'), { declaredEntryCount: 40 })
    const filler = new Uint8Array(smallLimits.maxArchiveBytes + 1).fill(0x41)
    const padded = new Uint8Array(bytes.length + filler.length)
    padded.set(bytes, 0)
    padded.set(filler, bytes.length)
    const result = await readArchive(padded, { limits: smallLimits })

    expect(result.refusal?.code).toBe('archive_too_large')
    expect(result.stats.walkedRecords).toBe(0)
    expect(result.stats.producedBytes).toBe(0)
  })
})

describe('readArchive: leak B — encryption is diagnosed before the name', () => {
  it('reports an encrypted entry even when its name is also hostile', async () => {
    const bytes = buildZip([{ name: '../secret.enc', content: 'x', encrypted: true }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('encrypted_entry')
    expect(result.refusal?.message).toMatch(/encrypt/i)
  })

  it('reports an encrypted entry in an otherwise valid archive', async () => {
    const bytes = buildZip([
      { name: 'ok.js', content: 'x\n' },
      { name: 'locked.js', content: 'y', encrypted: true },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('encrypted_entry')
    expect(result.entries).toHaveLength(0)
  })
})

function filler(name: string, size: number) {
  const lines: string[] = []
  for (let at = 0; at < size; at += 40) lines.push(`const v${at} = "value-${at}"\n`.padEnd(40, ' ').slice(0, 40))
  return { name, content: lines.join('') }
}

describe('readArchive: size and count caps hold with nothing produced', () => {
  it('refuses once the declared entries add up past the total budget', async () => {
    const records = Array.from({ length: 20 }, (_, i) => filler(`src/m${i}.js`, 600))
    const bytes = buildZip(records)
    const result = await readArchive(bytes, { limits: { ...smallLimits, maxArchiveBytes: 65_536 } })

    expect(result.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(result.entries).toHaveLength(0)
    expect(result.stats.producedBytes).toBeLessThanOrEqual(smallLimits.maxTotalUncompressedBytes)
  })

  it('skips a file over the per-file ceiling and keeps analysing the rest', async () => {
    const bytes = buildZip([
      { name: 'src/big.js', content: 'x'.repeat(smallLimits.maxSingleFileUncompressedBytes + 500) },
      filler('src/small.js', 400),
    ])
    const result = await readArchive(bytes, { limits: smallLimits })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/small.js'])
    expect(result.skipped).toEqual([
      {
        name: 'src/big.js',
        code: 'single_file_too_large',
        message: expect.stringMatching(/skipped this file/),
      },
    ])
  })

  it('refuses 10 000 tiny files at the cap without unpacking a single one', async () => {
    const started = Date.now()
    const bytes = buildZip(manyEntries(10_000))
    const buildMs = Date.now() - started
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('entry_count_exceeded')
    expect(result.stats.walkedRecords).toBe(DEFAULT_ARCHIVE_LIMITS.maxEntryCount + 1)
    expect(result.entries).toHaveLength(0)
    expect(result.stats.producedBytes).toBe(0)
    expect(result.stats.durationMs).toBeLessThan(5_000)
    expect(buildMs).toBeLessThan(60_000)
  })
})

describe('readArchive: skips that are not refusals', () => {
  it('skips generated folders, binaries, folders and empty files with a reason', async () => {
    const bytes = buildZip([
      { name: 'node_modules/left-pad/index.js', content: 'module.exports = 1\n' },
      { name: 'assets/logo.png', content: '‰PNG not real' },
      { name: 'src', directory: true },
      { name: 'src/empty.js', content: '' },
      { name: 'src/keep.js', content: 'export const a = 1\n' },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/keep.js'])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['node_modules/left-pad/index.js', 'ignored_folder'],
      ['assets/logo.png', 'binary_content'],
      ['src', 'directory_entry'],
      ['src/empty.js', 'empty_entry'],
    ])
    for (const entry of result.skipped) expect(entry.message).not.toBe('')
  })

  it('skips a text-named file whose bytes are binary', async () => {
    const bytes = buildZip([
      { name: 'src/sneaky.js', content: new Uint8Array([0x65, 0x78, 0x70, 0x00, 0x01, 0x02, 0x03]) },
      filler('src/keep.js', 20),
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.skipped).toEqual([
      { name: 'src/sneaky.js', code: 'binary_content', message: expect.stringMatching(/binary file/) },
    ])
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/keep.js'])
  })
})

describe('readArchive: encoding detection', () => {
  const utf8 = new TextEncoder()

  it('labels plain UTF-8 bytes as utf-8', async () => {
    const archive = buildZip([{ name: 'src/app.js', content: utf8.encode('const a = 1\n') }])
    const result = await readArchive(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].encoding).toBe('utf-8')
  })

  it('keeps a UTF-8 BOM visible in the label', async () => {
    const archive = buildZip([{ name: 'src/app.js', content: new Uint8Array([0xef, 0xbb, 0xbf, ...utf8.encode('const a = 1\n')]) }])
    const result = await readArchive(archive)

    expect(result.entries[0].encoding).toBe('utf-8-bom')
    expect(result.entries[0].text).toBe('const a = 1\n')
  })

  it('falls back to latin-1 for bytes that are not valid UTF-8', async () => {
    const archive = buildZip([{ name: 'src/app.js', content: new Uint8Array([...utf8.encode('const caf'), 0xe9, ...utf8.encode(' = 1\n')]) }])
    const result = await readArchive(archive)

    expect(result.entries[0].encoding).toBe('latin-1')
    expect(result.entries[0].text).toBe('const café = 1\n')
  })

  it('reads a UTF-16LE archive member and keeps the text', async () => {
    const source = 'const café = 1\n'
    const wide: number[] = []
    for (const ch of source) {
      const code = ch.codePointAt(0) ?? 0
      wide.push(code & 0xff, code >>> 8)
    }
    const archive = buildZip([{ name: 'src/app.js', content: new Uint8Array([0xff, 0xfe, ...wide]) }])
    const result = await readArchive(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].encoding).toBe('utf-16-le')
    expect(result.entries[0].text).toBe(source)
  })

  it('classifies by extension, then shebang, then text fallback', async () => {
    const archive = buildZip([
      { name: 'tools/build.sh', content: '#!/bin/bash\necho hi\n' },
      { name: 'LICENSE', content: 'MIT\n' },
      { name: 'data/records.xyz', content: 'anything\n' },
      { name: 'noext', content: '#!/usr/bin/env python3\nprint(1)\n' },
    ])
    const result = await readArchive(archive)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => [entry.name, entry.language])).toEqual([
      ['tools/build.sh', 'shell'],
      ['LICENSE', 'text'],
      ['data/records.xyz', 'unknown'],
      ['noext', 'python'],
    ])
  })
})

describe('readArchive: damaged and lying archives', () => {
  it('refuses an archive cut off before its end-of-directory record', async () => {
    const bytes = buildZip([filler('src/a.js', 300), filler('src/b.js', 300)])
    const result = await readArchive(bytes.subarray(0, bytes.length - 30))

    expect(result.refusal?.code).toBe('not_a_zip')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses an index that points outside the file', async () => {
    const bytes = buildZip([filler('src/a.js', 300)], { declaredCdOffset: 900_000 })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_central_directory')
  })

  it('refuses an archive with no end-of-directory record', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }], { omitEocd: true })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('not_a_zip')
  })

  it('refuses a truncated deflate stream', async () => {
    const body = Array.from({ length: 120 }, (_, i) => `export const value${i} = ${i}\n`).join('')
    const bytes = buildZip([{ name: 'src/a.js', content: body, method: 8, declaredCompressed: 100 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_deflate_stream')
    expect(result.stats.producedBytes).toBe(0)
  })

  it('refuses a deflate member that expands past its declared size', async () => {
    const body = Array.from({ length: 120 }, (_, i) => `export const value${i} = ${i}\n`).join('')
    const deflated = deflateSync(new TextEncoder().encode(body))
    const bytes = buildZip([
      { name: 'src/a.js', content: body, method: 8, declaredUncompressed: 100, declaredCompressed: deflated.length },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('declared_size_understated')
    expect(result.stats.producedBytes).toBe(0)
  })

  it('refuses a stored member larger than its header declares', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x'.repeat(400), declaredUncompressed: 10 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('declared_size_understated')
  })

  it('refuses content that fails the stored checksum', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'export const a = 1\n', crcOverride: 1234 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('crc_mismatch')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses a local header whose name differs from the index', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n', localNameOverride: 'src/other-name.js' }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('corrupt_local_header')
  })

  it('refuses an unsupported compression method', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n', method: 14 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('unsupported_compression')
    expect(result.refusal?.message).toMatch(/14/)
  })

  it('refuses an absurdly long entry name', async () => {
    const bytes = buildZip([{ name: `src/${'d'.repeat(1_200)}.js`, content: 'x\n' }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('name_too_long')
  })

  it('refuses a name carrying a NUL byte', async () => {
    const name = new TextEncoder().encode('src/ok.js')
    const sneaky = new Uint8Array([...name, 0x00, ...new TextEncoder().encode('/../../etc/passwd')])
    const bytes = buildZip([{ name: 'src/ok.js', content: 'x\n' }], { rawNames: { 'src/ok.js': sneaky } })
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('null_byte_in_name')
  })

  it('refuses an entry that stores its sizes after its data', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n', dataDescriptor: true }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('data_descriptor_not_supported')
  })
})

describe('readArchive: modest zip bombs stay inside the caps', () => {
  it('refuses an honest bomb on its declared ratio before inflating anything', async () => {
    const body = 'A'.repeat(2 * 1024 * 1024)
    const bytes = buildZip([{ name: 'notes.txt', content: body, method: 8 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('declared_ratio_exceeded')
    expect(result.stats.producedBytes).toBe(0)
    expect(result.stats.peakEntryBytes).toBe(0)
  })

  it('stops a lying bomb while inflating, with bounded accumulated bytes', async () => {
    // 20 MB of one byte compresses to about 20 KB, so the archive itself is modest.
    const body = 'A'.repeat(20 * 1024 * 1024)
    const deflated = deflateSync(new TextEncoder().encode(body))
    const bytes = buildZip([
      {
        name: 'notes.txt',
        content: body,
        method: 8,
        declaredUncompressed: 100,
        declaredCompressed: deflated.length,
      },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('declared_size_understated')
    expect(result.entries).toHaveLength(0)
    expect(result.stats.producedBytes).toBe(0)
    // fflate hands back its accumulated output between pushes; measured ceiling is one
    // 4 MiB slice per 4 KiB compressed push, never the 20 MB payload.
    expect(result.stats.peakEntryBytes).toBeGreaterThan(0)
    expect(result.stats.peakEntryBytes).toBeLessThan(10 * 1024 * 1024)
    expect(result.stats.peakEntryBytes).toBeLessThan(body.length)
  })

  it('never accumulates more than the per-file ceiling when several entries are skipped', async () => {
    const bytes = buildZip([
      { name: 'src/big-a.js', content: 'x'.repeat(smallLimits.maxSingleFileUncompressedBytes + 400) },
      { name: 'src/big-b.js', content: 'y'.repeat(smallLimits.maxSingleFileUncompressedBytes + 400) },
      filler('src/keep.js', 200),
    ])
    const result = await readArchive(bytes, { limits: smallLimits })

    expect(result.refusal).toBeNull()
    expect(result.stats.producedBytes).toBeLessThanOrEqual(smallLimits.maxTotalUncompressedBytes)
    expect(result.stats.peakEntryBytes).toBeLessThanOrEqual(smallLimits.maxSingleFileUncompressedBytes)
  })
})

describe('readArchive: progress and cancellation', () => {
  it('reports walk then extract progress with monotonic counters', async () => {
    const bytes = buildZip([filler('src/a.js', 200), filler('src/b.js', 200)])
    const seen: string[] = []
    let lastProduced = 0
    const result = await readArchive(bytes, {
      onProgress: (progress) => {
        seen.push(progress.phase)
        expect(progress.walkedRecords).toBeLessThanOrEqual(2)
        expect(progress.producedBytes).toBeGreaterThanOrEqual(lastProduced)
        lastProduced = progress.producedBytes
      },
    })

    expect(result.refusal).toBeNull()
    expect(seen[0]).toBe('walk')
    expect(seen).toContain('extract')
  })

  it('refuses a cancelled read and produces nothing', async () => {
    const bytes = buildZip([filler('src/a.js', 200), filler('src/b.js', 200)])
    const controller = new AbortController()
    const result = await readArchive(bytes, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'extract') controller.abort()
      },
    })

    expect(result.refusal?.code).toBe('cancelled')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses before doing any work when the signal is already aborted', async () => {
    const bytes = buildZip([{ name: 'src/a.js', content: 'x\n' }])
    const controller = new AbortController()
    controller.abort()
    const result = await readArchive(bytes, { signal: controller.signal })

    expect(result.refusal?.code).toBe('cancelled')
    expect(result.stats.walkedRecords).toBe(0)
  })
})

describe('readArchive: the generated-file override', () => {
  it('reads vendored files on request but never reads .git', async () => {
    const bytes = buildZip([
      { name: 'node_modules/left-pad/index.js', content: 'module.exports = 1\n' },
      { name: '.git/config', content: '[core]\n' },
      { name: 'src/app.js', content: 'export const a = 1\n' },
    ])
    const result = await readArchive(bytes, { includeGenerated: true })

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['node_modules/left-pad/index.js', 'src/app.js'])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([['.git/config', 'ignored_folder']])
  })

  it('keeps the old behaviour when the override is off', async () => {
    const bytes = buildZip([
      { name: 'node_modules/left-pad/index.js', content: 'module.exports = 1\n' },
      { name: 'src/app.js', content: 'export const a = 1\n' },
    ])
    const result = await readArchive(bytes)

    expect(result.entries.map((entry) => entry.name)).toEqual(['src/app.js'])
    expect(result.skipped.map((entry) => entry.code)).toEqual(['ignored_folder'])
  })
})
