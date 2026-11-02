import { describe, expect, it } from 'vitest'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'
import { readLooseFiles, type IntakeSource } from './readLooseFiles'

function source(path: string, text: string, size = new TextEncoder().encode(text).length): IntakeSource {
  return { path, size, read: async () => new TextEncoder().encode(text) }
}

const smallLimits = {
  ...DEFAULT_ARCHIVE_LIMITS,
  maxArchiveBytes: 4096,
  maxTotalUncompressedBytes: 8192,
  maxSingleFileUncompressedBytes: 1024,
  maxEntryCount: 20,
}

describe('readLooseFiles: a normal drop', () => {
  it('reads files with their path, language and encoding', async () => {
    const result = await readLooseFiles([source('app/model.py', 'VALUE = 1\n'), source('src/index.js', 'export const a = 1\n')])

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => [entry.name, entry.language])).toEqual([
      ['app/model.py', 'python'],
      ['src/index.js', 'javascript'],
    ])
    expect(result.entries[0].encoding).toBe('utf-8')
    expect(result.stats.producedBytes).toBe('VALUE = 1\n'.length + 'export const a = 1\n'.length)
  })

  it('never reads the bytes of a file it is going to skip', async () => {
    let reads = 0
    const huge: IntakeSource = {
      path: 'src/huge.js',
      size: smallLimits.maxSingleFileUncompressedBytes + 1,
      read: async () => {
        reads += 1
        return new Uint8Array(0)
      },
    }
    const result = await readLooseFiles([huge, source('src/keep.js', 'export const a = 1\n')], { limits: smallLimits })

    expect(result.refusal).toBeNull()
    expect(reads).toBe(0)
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([['src/huge.js', 'single_file_too_large']])
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/keep.js'])
  })
})

describe('readLooseFiles: skips', () => {
  it('skips generated folders and binary files but keeps the rest', async () => {
    const result = await readLooseFiles([
      source('project/node_modules/left-pad/index.js', 'module.exports = 1\n'),
      source('project/dist/app.min.js', 'x\n'.repeat(400)),
      source('project/assets/logo.png', 'not really a png'),
      source('project/src/keep.js', 'export const a = 1\n'),
    ])

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['project/src/keep.js'])
    expect(result.skipped.map((entry) => entry.code)).toEqual(['ignored_folder', 'ignored_folder', 'binary_content'])
  })

  it('skips an empty file with a reason', async () => {
    const result = await readLooseFiles([source('src/empty.js', '')])

    expect(result.entries).toHaveLength(0)
    expect(result.skipped.map((entry) => entry.code)).toEqual(['empty_entry'])
  })

  it('marks a text file with binary bytes as skipped', async () => {
    const result = await readLooseFiles([
      { path: 'src/sneaky.js', size: 7, read: async () => new Uint8Array([101, 120, 112, 0, 1, 2, 3]) },
    ])

    expect(result.refusal).toBeNull()
    expect(result.skipped.map((entry) => entry.code)).toEqual(['binary_content'])
  })
})

describe('readLooseFiles: caps and hostile paths', () => {
  it('refuses a total size over the byte ceiling without reading anything', async () => {
    let reads = 0
    const files = Array.from({ length: 20 }, (_, i) => {
      const item = source(`src/m${i}.js`, 'x'.repeat(600))
      return { ...item, read: () => { reads += 1; return item.read() } }
    })
    const result = await readLooseFiles(files, { limits: smallLimits })

    expect(result.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(reads).toBe(0)
    expect(result.entries).toHaveLength(0)
    expect(result.stats.producedBytes).toBe(0)
  })

  it('refuses more files than the entry cap', async () => {
    const files = Array.from({ length: smallLimits.maxEntryCount + 1 }, (_, i) => source(`src/f${i}.js`, 'x\n'))
    const result = await readLooseFiles(files, { limits: smallLimits })

    expect(result.refusal?.code).toBe('entry_count_exceeded')
    expect(result.stats.walkedRecords).toBe(smallLimits.maxEntryCount + 1)
    expect(result.entries).toHaveLength(0)
  })

  it.each([
    ['../escape.js', 'path_traversal'],
    ['/etc/passwd', 'absolute_path'],
    ['C:/Windows/system.ini', 'drive_letter_path'],
    ['src\\..\\evil.js', 'path_traversal'],
  ])('refuses the path %s as %s', async (path, code) => {
    const result = await readLooseFiles([source(path, 'x\n'), source('src/keep.js', 'y\n')])

    expect(result.refusal?.code).toBe(code)
    expect(result.entries).toHaveLength(0)
  })

  it('refuses two files with the same path', async () => {
    const result = await readLooseFiles([source('src/dup.js', 'first\n'), source('src/dup.js', 'second\n')])

    expect(result.refusal?.code).toBe('duplicate_name')
  })

  it('refuses an archive found inside a dropped folder', async () => {
    const result = await readLooseFiles([source('project/bundles/vendor.zip', 'PK\x03\x04 junk')])

    expect(result.refusal?.code).toBe('nested_archive')
    expect(result.entries).toHaveLength(0)
  })

  it('refuses a name longer than the cap', async () => {
    const result = await readLooseFiles([source(`src/${'d'.repeat(1_100)}.js`, 'x\n')])

    expect(result.refusal?.code).toBe('name_too_long')
  })
})

describe('readLooseFiles: cancel and progress', () => {
  it('refuses an already cancelled drop', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await readLooseFiles([source('src/a.js', 'x\n')], { signal: controller.signal })

    expect(result.refusal?.code).toBe('cancelled')
    expect(result.stats.walkedRecords).toBe(0)
  })

  it('stops mid-drop when cancelled', async () => {
    const controller = new AbortController()
    const files = Array.from({ length: 6 }, (_, i) => source(`src/f${i}.js`, 'export const a = 1\n'))
    const result = await readLooseFiles(files, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'extract') controller.abort()
      },
    })

    expect(result.refusal?.code).toBe('cancelled')
    expect(result.entries).toHaveLength(0)
  })

  it('reports walk then extract progress', async () => {
    const phases: string[] = []
    const result = await readLooseFiles([source('src/a.js', 'export const a = 1\n')], {
      onProgress: (progress) => phases.push(progress.phase),
    })

    expect(result.refusal).toBeNull()
    expect(phases[0]).toBe('walk')
    expect(phases).toContain('extract')
  })
})
