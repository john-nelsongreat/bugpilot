import { afterEach, describe, expect, it } from 'vitest'
import {
  isZipFile,
  sourcesFromDirectoryPicker,
  sourcesFromDrop,
  sourcesFromFiles,
  supportsDirectoryPicker,
} from './sources'

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

  it('never descends into ignored folders, and never walks into .git either', async () => {
    const vendored = directoryEntry('/project/node_modules/left-pad', [
      [fileEntry('/project/node_modules/left-pad/index.js', fakeFile('index.js', 'x\n'))],
      [],
    ])
    const history = directoryEntry('/project/.git', [
      [fileEntry('/project/.git/config', fakeFile('config', 'x\n'))],
      [],
    ])
    const root = directoryEntry('/project', [
      [
        fileEntry('/project/app.ts', fakeFile('app.ts', 'a\n')),
        vendored,
        history,
      ],
      [],
    ])

    const sources = await sourcesFromDrop(dataTransfer([root]))

    expect(sources?.map((source) => source.path)).toEqual(['project/app.ts'])
  })

  it('descends into vendored folders only when the checkbox asked for them', async () => {
    const vendored = directoryEntry('/project/dist', [
      [fileEntry('/project/dist/bundle.js', fakeFile('bundle.js', 'x\n'))],
      [],
    ])
    const history = directoryEntry('/project/.git', [
      [fileEntry('/project/.git/config', fakeFile('config', 'x\n'))],
      [],
    ])
    const root = directoryEntry('/project', [[vendored, history], []])

    const sources = await sourcesFromDrop(dataTransfer([root]), { includeGenerated: true })

    expect(sources?.map((source) => source.path)).toEqual(['project/dist/bundle.js'])
  })

  it('walks a folder across several readEntries batches', async () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      fileEntry(`/project/file-${index}.ts`, fakeFile(`file-${index}.ts`, 'a\n')),
    )
    const root = directoryEntry('/project', [[many[0], many[1]], [many[2], many[3]], [many[4]], []])

    const sources = await sourcesFromDrop(dataTransfer([root]))

    expect(sources?.map((source) => source.path)).toEqual([
      'project/file-0.ts',
      'project/file-1.ts',
      'project/file-2.ts',
      'project/file-3.ts',
      'project/file-4.ts',
    ])
  })
})

describe('directory picker', () => {
  afterEach(() => {
    delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker
  })

  interface PickedFile {
    kind: 'file'
    name: string
    getFile: () => Promise<File>
  }
  interface PickedDirectory {
    kind: 'directory'
    name: string
    values: () => AsyncIterableIterator<PickedFile | PickedDirectory>
  }

  function pickedFile(name: string, text: string): PickedFile {
    const file = fakeFile(name, text)
    return { kind: 'file', name, getFile: async () => asFile(file) }
  }

  function pickedDirectory(name: string, children: (PickedFile | PickedDirectory)[]): PickedDirectory {
    return {
      kind: 'directory',
      name,
      // The real handle re-creates its iterator on every `values()` call; one pass is enough here.
      values: async function* () {
        for (const child of children) yield child
      },
    }
  }

  function installPicker(impl: () => Promise<PickedDirectory | null>): void {
    ;(globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = impl
  }

  it('reports support only when the browser has the API', () => {
    expect(supportsDirectoryPicker()).toBe(false)
    installPicker(async () => pickedDirectory('project', []))
    expect(supportsDirectoryPicker()).toBe(true)
  })

  it('walks the picked tree and skips ignored folders', async () => {
    installPicker(async () =>
      pickedDirectory('project', [
        pickedFile('app.ts', 'a\n'),
        pickedDirectory('node_modules', [pickedFile('index.js', 'x\n')]),
        pickedDirectory('.git', [pickedFile('config', 'x\n')]),
        pickedDirectory('src', [pickedFile('main.py', 'b = 2\n')]),
      ]),
    )

    const sources = await sourcesFromDirectoryPicker()

    expect(sources?.map((source) => source.path)).toEqual(['app.ts', 'src/main.py'])
  })

  it('returns null when the user closes the picker without choosing', async () => {
    installPicker(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError')
    })

    await expect(sourcesFromDirectoryPicker()).resolves.toBeNull()
  })

  it('throws a real picker failure instead of pretending nothing happened', async () => {
    installPicker(async () => {
      throw new DOMException('A user activation is required.', 'NotAllowedError')
    })

    await expect(sourcesFromDirectoryPicker()).rejects.toMatchObject({ name: 'NotAllowedError' })
  })
})
