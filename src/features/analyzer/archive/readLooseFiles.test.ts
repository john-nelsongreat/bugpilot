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

  it('truncates the drop at the analysis budget, not at the unpacking ceiling', async () => {
    const files = [source('src/a.js', 'a'.repeat(120)), source('src/b.js', 'b'.repeat(120)), source('src/c.js', 'c'.repeat(120))]
    const limits = { ...DEFAULT_ARCHIVE_LIMITS, maxTotalUncompressedBytes: 10_000, maxAnalysableTextBytes: 240 }

    const kept = await readLooseFiles(files, { limits, keepPartial: true })
    expect(kept.refusal).toBeNull()
    expect(kept.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
    expect(kept.partial?.code).toBe('analysable_budget_exceeded')
    expect(kept.skipped.map((entry) => [entry.name, entry.code])).toEqual([['src/c.js', 'not_reached']])

    const refused = await readLooseFiles(files, { limits })
    expect(refused.refusal?.code).toBe('analysable_budget_exceeded')
    expect(refused.entries).toHaveLength(0)
  })

  it('does not let a skipped file spend the analysis budget', async () => {
    const files = [
      { path: 'src/sneaky.js', size: 120, read: async () => new Uint8Array(120).fill(0x00) },
      source('src/a.js', 'a'.repeat(120)),
      source('src/b.js', 'b'.repeat(120)),
    ]
    const result = await readLooseFiles(files, {
      limits: { ...DEFAULT_ARCHIVE_LIMITS, maxTotalUncompressedBytes: 10_000, maxAnalysableTextBytes: 240 },
      keepPartial: true,
    })

    expect(result.refusal).toBeNull()
    // The budget is 240 and the two text files add up to exactly that; the file whose bytes turned
    // out to be binary was read, found to hold no text and set aside without charging anything.
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
    expect(result.skipped.map((entry) => entry.code)).toEqual(['binary_content'])
    expect(result.partial).toBeUndefined()
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

  it('keeps the files read before a cancel when the caller accepts a partial result', async () => {
    const controller = new AbortController()
    const files = Array.from({ length: 6 }, (_, i) => source(`src/f${i}.js`, 'export const a = 1\n'))
    const result = await readLooseFiles(files, {
      signal: controller.signal,
      keepPartial: true,
      onProgress: (progress) => {
        if (progress.phase === 'extract') controller.abort()
      },
    })

    expect(result.refusal).toBeNull()
    expect(result.partial?.code).toBe('cancelled')
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/f0.js'])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['src/f1.js', 'not_reached'],
      ['src/f2.js', 'not_reached'],
      ['src/f3.js', 'not_reached'],
      ['src/f4.js', 'not_reached'],
      ['src/f5.js', 'not_reached'],
    ])
    expect(result.partial).toMatchObject({ analysedFiles: 1, plannedFiles: 6, unreachedFiles: 5 })
    expect(result.skipped[0].message).toContain('you cancelled')
  })

  it('turns a read aborted by the browser into a partial result that names the rest', async () => {
    const controller = new AbortController()
    const files = [
      source('src/a.js', 'export const a = 1\n'),
      {
        path: 'src/b.js',
        size: 5,
        read: async () => {
          controller.abort()
          throw new DOMException('Aborted', 'AbortError')
        },
      },
      source('src/c.js', 'export const c = 1\n'),
    ]
    const result = await readLooseFiles(files, { signal: controller.signal, keepPartial: true })

    expect(result.refusal).toBeNull()
    expect(result.partial?.code).toBe('cancelled')
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['src/b.js', 'not_reached'],
      ['src/c.js', 'not_reached'],
    ])
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

describe('readLooseFiles: the generated-file override', () => {
  it('reads generated folders on request but never reads .git', async () => {
    const result = await readLooseFiles(
      [
        source('project/node_modules/left-pad/index.js', 'module.exports = 1\n'),
        source('project/dist/app.min.js', 'var a=1\n'),
        source('project/.git/config', '[core]\n'),
        source('project/src/keep.js', 'export const a = 1\n'),
      ],
      { includeGenerated: true },
    )

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'project/node_modules/left-pad/index.js',
      'project/dist/app.min.js',
      'project/src/keep.js',
    ])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([['project/.git/config', 'ignored_folder']])
  })
})
