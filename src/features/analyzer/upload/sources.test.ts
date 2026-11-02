import { describe, expect, it } from 'vitest'
import { isZipFile, sourcesFromDrop, sourcesFromFiles } from './sources'

interface FakeFile {
  name: string
  size: number
  webkitRelativePath?: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

function fakeFile(name: string, text: string): FakeFile {
  const bytes = new TextEncoder().encode(text)
  return {
    name,
    size: bytes.length,
    webkitRelativePath: '',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }
}

function asFile(file: FakeFile): File {
  return file as unknown as File
}

type Entry =
  | { isFile: true; isDirectory: false; fullPath: string; file: (ok: (file: File) => void) => void }
  | {
      isFile: false
      isDirectory: true
      fullPath: string
      createReader: () => { readEntries: (ok: (entries: unknown[]) => void) => void }
    }

function fileEntry(path: string, file: FakeFile): Entry {
  return { isFile: true, isDirectory: false, fullPath: path, file: (ok) => ok(asFile(file)) }
}

function directoryEntry(path: string, batches: unknown[][]): Entry {
  let call = 0
  return {
    isFile: false,
    isDirectory: true,
    fullPath: path,
    createReader: () => ({
      readEntries: (ok) => {
        ok(batches[call] ?? [])
        call += 1
      },
    }),
  }
}

function dataTransfer(entries: unknown[]): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files: [],
  } as unknown as DataTransfer
}

describe('upload sources', () => {
  it('recognises zip names regardless of case', () => {
    expect(isZipFile({ name: 'bundle.zip' } as File)).toBe(true)
    expect(isZipFile({ name: 'BUNDLE.ZIP' } as File)).toBe(true)
    expect(isZipFile({ name: 'notes.txt' } as File)).toBe(false)
  })

  it('keeps the folder-relative path for picked files', async () => {
    const file = fakeFile('app.ts', 'const x = 1\n')
    file.webkitRelativePath = 'project/src/app.ts'

    const [source] = sourcesFromFiles([asFile(file)])

    expect(source.path).toBe('project/src/app.ts')
    expect(source.size).toBe(file.size)
    expect([...(await source.read())]).toEqual([...new TextEncoder().encode('const x = 1\n')])
  })

  it('walks a dropped folder recursively and keeps the folder name in every path', async () => {
    const inner = directoryEntry('/project/src', [[fileEntry('/project/src/app.ts', fakeFile('app.ts', 'a\n'))], []])
    const root = directoryEntry('/project', [
      [fileEntry('/project/README.md', fakeFile('README.md', 'readme\n')), inner],
      [],
    ])

    const sources = await sourcesFromDrop(dataTransfer([root]))

    expect(sources?.map((source) => source.path)).toEqual(['project/README.md', 'project/src/app.ts'])
  })

  it('accepts a dropped loose file', async () => {
    const sources = await sourcesFromDrop(dataTransfer([fileEntry('/notes.txt', fakeFile('notes.txt', 'hi\n'))]))

    expect(sources?.map((source) => source.path)).toEqual(['notes.txt'])
  })

  it('returns null when the browser exposes no entry API', async () => {
    expect(await sourcesFromDrop(dataTransfer([]))).toBeNull()
  })
})
