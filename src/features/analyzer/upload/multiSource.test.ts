import { describe, expect, it } from 'vitest'
import type { IntakeSource } from '../archive/readLooseFiles'
import { combineUploads } from './multiSource'

function source(path: string, size = 10): IntakeSource {
  return { path, size, read: async () => new Uint8Array(size) }
}

describe('combining several uploads into one run', () => {
  it('leaves a lone upload under its own paths', () => {
    const combined = combineUploads([[source('src/a.js'), source('src/b.js')]])

    expect(combined.sources.map((item) => item.path)).toEqual(['src/a.js', 'src/b.js'])
    expect(combined.notes).toEqual([])
  })

  it('namespaces every upload so the same path in two uploads is not a collision', () => {
    const combined = combineUploads([[source('src/a.js')], [source('src/a.js')], [source('readme.md')]])

    expect(combined.sources.map((item) => item.path)).toEqual([
      'upload-1/src/a.js',
      'upload-2/src/a.js',
      'upload-3/readme.md',
    ])
    expect(combined.notes).toEqual([])
  })

  it('sets one unsafe upload aside and still reads the others', () => {
    const combined = combineUploads([[source('src/a.js')], [source('../escape.js')], [source('src/c.js')]])

    expect(combined.sources.map((item) => item.path)).toEqual(['upload-1/src/a.js', 'upload-3/src/c.js'])
    expect(combined.notes).toHaveLength(1)
    const note = combined.notes[0]
    expect(note?.name).toBe('upload-2')
    expect(note?.code).toBe('source_set_aside')
    expect(note?.message).toContain('upload-2')
    expect(note?.message).toContain('../escape.js')
    expect(note?.message).toMatch(/left out/)
  })

  it('does not open an archive that arrived inside an upload', () => {
    const combined = combineUploads([[source('bundle.zip')], [source('src/a.js')]])

    expect(combined.sources.map((item) => item.path)).toEqual(['upload-2/src/a.js'])
    expect(combined.notes[0]?.message).toMatch(/archive|container/i)
    // "archives inside archives" would be a lie about a zip the user added as its own upload, and
    // the sentence has to say what to do instead.
    expect(combined.notes[0]?.message).toMatch(/one archive per run/i)
    expect(combined.notes[0]?.message).toMatch(/Clear/i)
  })

  it('keeps every surviving file so the reader can apply its ceilings to the total', () => {
    const many = Array.from({ length: 4 }, (_unused, index) => source(`src/${index}.js`))
    const combined = combineUploads([many, many.map((item) => source(`lib/${item.path.slice(4)}`))])

    expect(combined.sources).toHaveLength(8)
    expect(combined.notes).toEqual([])
  })

  it('refuses to combine an upload whose paths repeat after naming', () => {
    const combined = combineUploads([[source('src/a.js')], [source('src/a.js'), source('src/a.js')]])

    expect(combined.sources.map((item) => item.path)).toEqual(['upload-1/src/a.js'])
    expect(combined.notes.map((note) => note.name)).toEqual(['upload-2'])
    expect(combined.notes[0]?.message).toMatch(/twice|duplicate/i)
  })
})
