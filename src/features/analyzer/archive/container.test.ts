// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { gzipSync, strToU8 } from 'fflate'
import { readContainer } from './container'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'
import { buildZip } from '../../../test/zipFixtures'
import { buildTar } from '../../../test/tarFixtures'

const zipOf = (name: string, body: string): Uint8Array => buildZip([{ name, content: body }])

describe('readContainer: the bytes decide', () => {
  it('reads a zip named as a tar and notes the disagreement', async () => {
    const bytes = zipOf('src/a.js', 'export const a = 1\n')
    const result = await readContainer(bytes, 'backup.tar')

    expect(result.format).toBe('zip')
    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
    expect(result.note).toContain('backup.tar')
    expect(result.note).toContain('zip')
  })

  it('reads a tar named as a zip and notes the disagreement', async () => {
    const bytes = buildTar([{ name: 'calc.py', content: 'print(1)\n' }])
    const result = await readContainer(bytes, 'project.zip')

    expect(result.format).toBe('tar')
    expect(result.entries[0].language).toBe('python')
    expect(result.note).toContain('.zip')
  })

  it('reads a tar.gz as the tar inside it', async () => {
    const bytes = gzipSync(buildTar([
      { name: 'src/a.js', content: 'export const a = 1\n' },
      { name: 'README.md', content: '# Project\n' },
    ]))
    const result = await readContainer(bytes, 'project.tar.gz')

    expect(result.format).toBe('gzip')
    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'README.md'])
    expect(result.note).toBeNull()
  })

  it('notes a tar.gz wearing a zip name', async () => {
    const bytes = gzipSync(buildTar([{ name: 'calc.py', content: 'print(1)\n' }]))
    const result = await readContainer(bytes, 'project.zip')

    expect(result.format).toBe('gzip')
    expect(result.entries).toHaveLength(1)
    expect(result.note).toContain('.zip')
  })

  it('applies the tar caps through the gzip layer', async () => {
    const bytes = gzipSync(buildTar([{ name: 'a.txt', content: 'x'.repeat(2_000) }]))
    const limits = { ...DEFAULT_ARCHIVE_LIMITS, maxTotalUncompressedBytes: 128 }
    const result = await readContainer(bytes, 'project.tar.gz', { limits })

    expect(result.refusal?.code).toBe('total_uncompressed_exceeded')
    expect(result.entries).toEqual([])
    expect(result.stats.producedBytes).toBe(0)
  })

  it('reads a lone .gz of one text file under the name it really has', async () => {
    const result = await readContainer(gzipSync(strToU8('# Notes\n')), 'notes.md.gz')

    expect(result.format).toBe('gzip')
    // The name the analysis runs under is the uploaded name minus the gzip layer, so the language
    // comes from the file the user actually has rather than from a ".gz".
    expect(result.entries.map((entry) => [entry.name, entry.language])).toEqual([['notes.md', 'markdown']])
    expect(result.note).toBeNull()
    expect(result.stats.producedBytes).toBe(8)
  })

  it('derives a name with nothing left when the .gz has no dotted suffix', async () => {
    const result = await readContainer(gzipSync(strToU8('a = 1\n')), 'values.gz')

    expect(result.entries.map((entry) => entry.name)).toEqual(['values'])
  })

  it('ignores the name a gzip header claims for what it holds', async () => {
    // A .gz can carry a file name inside its header. That claim decides nothing: the entry keeps
    // the uploaded name minus the gzip layer, and the header never reaches the entry list.
    const bytes = gzipSync(strToU8('a = 1\n'), { filename: '../../../../etc/passwd' })
    const result = await readContainer(bytes, 'values.gz')

    expect(result.entries.map((entry) => entry.name)).toEqual(['values'])
    expect(result.skipped).toEqual([])
  })

  it('keeps a text payload of a .tgz as the file it is', async () => {
    const result = await readContainer(gzipSync(strToU8('just text\n')), 'bundle.tgz')

    expect(result.entries.map((entry) => entry.name)).toEqual(['bundle'])
    expect(result.note).toBeNull()
  })

  it('reads a plain source file as one entry', async () => {
    const result = await readContainer(strToU8('def f():\n    pass\n'), 'calc.py')

    expect(result.format).toBe('text')
    expect(result.entries.map((entry) => [entry.name, entry.language])).toEqual([['calc.py', 'python']])
    expect(result.note).toBeNull()
  })

  it('reads a .jar as the zip it is and skips the compiled members', async () => {
    const bytes = buildZip([
      { name: 'META-INF/MANIFEST.MF', content: 'Manifest-Version: 1.0\n' },
      { name: 'com/example/A.class', content: new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 1, 2]) },
    ])
    const result = await readContainer(bytes, 'app.jar')

    expect(result.format).toBe('zip')
    expect(result.entries.map((entry) => entry.name)).toEqual(['META-INF/MANIFEST.MF'])
    expect(result.skipped.map((entry) => [entry.name, entry.code])).toEqual([
      ['com/example/A.class', 'binary_content'],
    ])
    expect(result.note).toBeNull()
  })

  it('reads a .whl as the zip it is', async () => {
    const bytes = buildZip([{ name: 'pkg/module.py', content: 'def f():\n    pass\n' }])
    const result = await readContainer(bytes, 'pkg-1.0-py3-none-any.whl')

    expect(result.entries[0].language).toBe('python')
    expect(result.note).toBeNull()
  })

  it('treats an empty upload as an empty text entry, with a note about the name', async () => {
    const result = await readContainer(new Uint8Array(0), 'empty.zip')

    expect(result.format).toBe('text')
    expect(result.entries).toEqual([])
    expect(result.skipped.map((entry) => entry.code)).toEqual(['empty_entry'])
    expect(result.note).toContain('zip')
  })
})

describe('readContainer: what is never opened', () => {
  it('refuses a zip inside a gzip', async () => {
    const result = await readContainer(gzipSync(zipOf('a.js', 'x\n')), 'payload.gz')

    expect(result.refusal?.code).toBe('nested_archive')
    expect(result.refusal?.message).toContain('payload.gz')
    expect(result.entries).toEqual([])
  })

  it('refuses a gzip inside a gzip', async () => {
    const result = await readContainer(gzipSync(gzipSync(strToU8('x\n'))), 'deeper.gz')

    expect(result.refusal?.code).toBe('nested_archive')
    expect(result.entries).toEqual([])
  })

  it('refuses a tar inside a tar instead of reading it', async () => {
    const inner = buildTar([{ name: 'a.js', content: 'x\n' }])
    const result = await readContainer(buildTar([{ name: 'outer/inner.tar', content: inner }]), 'outer.tar')

    expect(result.refusal?.code).toBe('nested_archive')
  })

  it('refuses a 7z that claims to be a zip, without decoding it', async () => {
    const bytes = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0, 1, 2, 3, 4])
    const result = await readContainer(bytes, 'app.zip')

    expect(result.format).toBeNull()
    expect(result.refusal?.code).toBe('unsupported_format')
    expect(result.refusal?.message).toContain('.7z')
    expect(result.note).toContain('.7z')
  })

  it('refuses bytes that carry no signature BugPilot knows', async () => {
    const result = await readContainer(new Uint8Array([0, 0, 1, 2, 3, 0, 255, 254]), 'mystery')

    expect(result.refusal?.code).toBe('unsupported_format')
    expect(result.refusal?.message).toMatch(/could not recognise/i)
  })

  it('refuses a name that tries to leave the folder', async () => {
    const result = await readContainer(strToU8('x\n'), '../evil.js')

    expect(result.refusal?.code).toBe('path_traversal')
    expect(result.entries).toEqual([])
  })

  it('passes a damaged tar refusal through unchanged', async () => {
    const bytes = buildTar([{ name: 'a.txt', content: 'x'.repeat(2_000) }], { truncateTo: 900 })
    const result = await readContainer(bytes, 'broken.tar')

    expect(result.format).toBe('tar')
    expect(result.refusal?.code).toBe('archive_truncated')
  })

  it('hands nothing back when it refuses, including stats for the read', async () => {
    const result = await readContainer(gzipSync(zipOf('a.js', 'x\n')), 'payload.gz')

    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.stats.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('reports progress from whichever reader is doing the work', async () => {
    const phases: string[] = []
    const entries: number[] = []
    await readContainer(gzipSync(buildTar([{ name: 'a.js', content: 'x\n' }])), 'p.tar.gz', {
      onProgress: (progress) => {
        phases.push(progress.phase)
        if (progress.phase === 'extract') entries.push(progress.extractedEntries)
      },
    })

    // The gzip layer inflates without producing entries, so it reports a walk; the tar reader inside
    // it is the one that hands over a file.
    expect(phases).toContain('walk')
    expect(entries).toEqual([1])
  })
})
