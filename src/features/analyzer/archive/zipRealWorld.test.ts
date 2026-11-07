import { describe, expect, it } from 'vitest'
import { buildZip, type ZipBuildOptions, type ZipEntrySpec } from '../../../test/zipFixtures'
import { readArchive, readArchiveSource, createMemorySource } from './guard'
import { detectFormat } from './format'

/**
 * The byte habits of the writers a real project zip comes from. Each builder describes what the
 * tool actually puts on disk — which entries get directory records, who sets bit 11, who streams
 * with a data descriptor, whose external attributes are DOS or Unix — so a change that breaks one
 * of them is caught without ever committing an archive binary.
 */

const BMI = [
  'weight = 72.5',
  'height = 1.73',
  'bmi = weight / (height * height)',
  'print(f"BMI is {bmi:.1f}")',
  '',
].join('\n')

interface WriterProfile {
  label: string
  /** Defaults merged into every file entry this writer emits. */
  entry: Partial<ZipEntrySpec>
  /** Folder-oriented writers record every directory as its own entry first. */
  directories: boolean
  /** External attributes for the directory entries (DOS tools use the low byte only). */
  dirAttrs?: number
  /** Java's jar tool writes a manifest as the first entry. */
  manifest?: boolean
  options?: ZipBuildOptions
}

const DOS_FILE_ATTRS = 0x20
const DOS_DIR_ATTRS = 0x10
const UNIX_FILE_ATTRS = (0o100644 << 16) | DOS_FILE_ATTRS
const UNIX_DIR_ATTRS = (0o40755 << 16) | DOS_DIR_ATTRS

const WRITERS: WriterProfile[] = [
  {
    // Windows "Send to > Compressed folder": DOS attributes, deflate, directory records.
    label: 'Windows Explorer',
    entry: { method: 8, externalAttrsOverride: DOS_FILE_ATTRS },
    directories: true,
    dirAttrs: DOS_DIR_ATTRS,
  },
  {
    // PowerShell Compress-Archive (.NET): deflate, no directory entries, attributes zero.
    label: 'PowerShell Compress-Archive',
    entry: { method: 8, externalAttrsOverride: 0 },
    directories: false,
  },
  {
    // 7-Zip: Unix attributes in the high word, directory records, deflate.
    label: '7-Zip',
    entry: { method: 8, externalAttrsOverride: UNIX_FILE_ATTRS },
    directories: true,
    dirAttrs: UNIX_DIR_ATTRS,
  },
  {
    // Python zipfile on a non-seekable stream: bit 3, sizes only in the descriptor.
    label: 'Python zipfile to a non-seekable stream',
    entry: { method: 8, dataDescriptor: true, externalAttrsOverride: 0o100600 << 16 },
    directories: true,
    dirAttrs: UNIX_DIR_ATTRS,
  },
  {
    // Info-ZIP zip streaming to stdout ("zip -r -"): bit 3 on every entry.
    label: 'Info-ZIP zip streaming to stdout',
    entry: { method: 8, dataDescriptor: true, externalAttrsOverride: UNIX_FILE_ATTRS },
    directories: true,
    dirAttrs: UNIX_DIR_ATTRS,
  },
  {
    // Java jar: always bit 11, a manifest first, no directory entries.
    label: 'Java jar',
    entry: { method: 8, utf8Flag: true, externalAttrsOverride: 0 },
    directories: false,
    manifest: true,
    options: {},
  },
  {
    // macOS Archive Utility is covered separately below: it adds __MACOSX and .DS_Store junk.
    label: 'macOS Archive Utility',
    entry: { method: 8, externalAttrsOverride: UNIX_FILE_ATTRS },
    directories: true,
    dirAttrs: UNIX_DIR_ATTRS,
  },
]

const PROJECT = [
  { path: 'project/README.md', body: '# Demo\nA small project used by the writer tests.\n', method: 0 },
  { path: 'project/src/bmi.py', body: BMI, method: 8 },
]

function writerZip(profile: WriterProfile, files: { path: string; body: string; method?: number }[]): Uint8Array {
  const dirs = new Set<string>()
  for (const file of files) {
    const segments = file.path.split('/')
    for (let at = 1; at < segments.length; at += 1) dirs.add(`${segments.slice(0, at).join('/')}/`)
  }
  const directoryEntries: ZipEntrySpec[] = profile.directories
    ? [...dirs].sort().map((name) => ({ name, directory: true, externalAttrsOverride: profile.dirAttrs }))
    : []
  const manifest: ZipEntrySpec[] = profile.manifest
    ? [{ name: 'META-INF/MANIFEST.MF', content: 'Manifest-Version: 1.0\r\n\r\n', ...profile.entry }]
    : []
  const fileEntries: ZipEntrySpec[] = files.map((file) => ({
    name: file.path,
    content: file.body,
    method: file.method ?? 8,
    ...profile.entry,
  }))
  return buildZip([...directoryEntries, ...manifest, ...fileEntries], profile.options)
}

describe('archives written by the tools people actually use', () => {
  for (const profile of WRITERS) {
    it(`reads a ${profile.label} archive of a small project`, async () => {
      const result = await readArchive(writerZip(profile, PROJECT))

      expect(result.refusal).toBeNull()
      const names = result.entries.map((entry) => entry.name)
      if (profile.manifest) {
        expect(names[0]).toBe('META-INF/MANIFEST.MF')
        expect(names.slice(1)).toEqual(['project/README.md', 'project/src/bmi.py'])
      } else {
        expect(names).toEqual(['project/README.md', 'project/src/bmi.py'])
      }
      const readme = result.entries.find((entry) => entry.name.endsWith('README.md'))
      const python = result.entries.at(-1)
      expect(readme?.language).toBe('markdown')
      expect(python?.language).toBe('python')
      expect(python?.text).toBe(BMI)
    })
  }

  it('reads a PowerShell Compress-Archive archive whose names use backslash separators', async () => {
    // Real Compress-Archive output writes "\" between segments (the .NET writer predates the
    // APPNOTE recommendation). The reader normalizes it the way Explorer extracts, so the tool's
    // output is read while a backslash escape still refuses as traversal.
    const compressArchive = WRITERS[1]
    const bytes = writerZip(compressArchive, [
      { path: 'BMI CALCULATOR( final boss)\\bmi.py', body: BMI, method: 8 },
      { path: 'BMI CALCULATOR( final boss)\\read me.txt', body: 'hello\n', method: 8 },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'BMI CALCULATOR( final boss)/bmi.py',
      'BMI CALCULATOR( final boss)/read me.txt',
    ])
    expect(result.entries[0].language).toBe('python')
    expect(result.entries[1].language).toBe('text')
  })

  it('skips the directory records a folder-oriented writer adds', async () => {
    const explorer = WRITERS[0]
    const result = await readArchive(writerZip(explorer, PROJECT))

    expect(result.refusal).toBeNull()
    expect(result.skipped.filter((entry) => entry.code === 'directory_entry')).toHaveLength(2)
    expect(result.entries).toHaveLength(2)
  })

  it('refuses an entry compressed with a method no decoder ships for', async () => {
    const bytes = buildZip([{ name: 'project/src/bmi.py', content: BMI, method: 12 }])
    const result = await readArchive(bytes)

    expect(result.refusal?.code).toBe('unsupported_compression')
    expect(result.refusal?.message).toContain('project/src/bmi.py')
    expect(result.refusal?.message).toContain('12')
  })
})

describe('names in the wild', () => {
  it('reads UTF-8 names with spaces, parentheses and accents', async () => {
    const bytes = buildZip([
      { name: 'projeto cálculos (v2)/main.py', content: BMI, utf8Flag: true },
      { name: 'projeto cálculos (v2)/read me.txt', content: 'hello\n', utf8Flag: true },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'projeto cálculos (v2)/main.py',
      'projeto cálculos (v2)/read me.txt',
    ])
  })

  it('reads CP437 name bytes that carry no UTF-8 flag', async () => {
    // 'ï' is byte 0xEF in CP437; old writers store it raw with bit 11 clear.
    const ascii = new TextEncoder().encode('projeto c')
    const tail = new TextEncoder().encode('lculos/main.py')
    const rawName = Uint8Array.of(...ascii, 0xef, ...tail)
    const bytes = buildZip([{ name: 'projeto cálculos/main.py', content: BMI, cp437Name: true }], {
      rawNames: { 'projeto cálculos/main.py': rawName },
    })
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name.length).toBe('projeto cálculos/main.py'.length)
    expect(result.entries[0].text).toBe(BMI)
  })

  it('resolves the real name from an Info-ZIP unicode path extra field', async () => {
    const ascii = new TextEncoder().encode('projeto c')
    const tail = new TextEncoder().encode('lculos/main.py')
    const rawName = Uint8Array.of(...ascii, 0xef, ...tail)
    const bytes = buildZip(
      [{ name: 'projeto cálculos/main.py', content: BMI, cp437Name: true, unicodePathName: 'projeto cálculos/main.py' }],
      { rawNames: { 'projeto cálculos/main.py': rawName } },
    )
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].name).toBe('projeto cálculos/main.py')
  })

  it('ignores a unicode path field whose checksum does not guard these bytes', async () => {
    const ascii = new TextEncoder().encode('projeto c')
    const tail = new TextEncoder().encode('lculos/main.py')
    const rawName = Uint8Array.of(...ascii, 0xef, ...tail)
    const bytes = buildZip(
      [
        {
          name: 'projeto cálculos/main.py',
          content: BMI,
          cp437Name: true,
          unicodePathName: '../elsewhere/main.py',
          unicodePathCrcOverride: 0x01020304,
        },
      ],
      { rawNames: { 'projeto cálculos/main.py': rawName } },
    )
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries[0].name.length).toBe('projeto cálculos/main.py'.length)
  })
})

describe('the junk macOS Archive Utility and Windows Explorer leave behind', () => {
  it('skips __MACOSX resource forks and .DS_Store without reading their bytes', async () => {
    const bytes = buildZip([
      { name: 'project/', directory: true, externalAttrsOverride: UNIX_DIR_ATTRS },
      { name: 'project/src/bmi.py', content: BMI },
      { name: '.DS_Store', content: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x62, 0x75, 0x64, 0x31]) },
      { name: '__MACOSX/project/._bmi.py', content: new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]) },
    ])
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['project/src/bmi.py'])
    expect(result.skipped.some((entry) => entry.name === '.DS_Store' && entry.code === 'generated_file')).toBe(true)
    expect(result.skipped.some((entry) => entry.name === '__MACOSX/project/._bmi.py' && entry.code === 'ignored_folder')).toBe(true)
  })
})

describe('a self-extracting stub in front of the zip', () => {
  it('finds the archive inside a stub and reads it', async () => {
    const stub = new Uint8Array(600)
    stub[0] = 0x4d
    stub[1] = 0x5a
    for (let at = 2; at < stub.length; at += 1) stub[at] = at & 0xff
    const bytes = buildZip(PROJECT.map((file) => ({ name: file.path, content: file.body, method: file.method ?? 8 })), {
      prepend: stub,
    })

    expect(detectFormat(bytes, 'installer.exe').format).toBe('zip')

    const result = await readArchiveSource(createMemorySource(bytes))
    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['project/README.md', 'project/src/bmi.py'])
  })
})

describe('the archive shape the live site refused', () => {
  it('accepts the user project: descriptors inside .venv, project files analysed, junk skipped', async () => {
    const folder = 'BMI CALCULATOR( final boss)'
    const bytes = buildZip(
      [
        { name: `${folder}/`, directory: true, externalAttrsOverride: DOS_DIR_ATTRS },
        { name: `${folder}/README.md`, content: '# BMI CALCULATOR\n\nFinal boss version.\n', method: 0 },
        { name: `${folder}/bmi.py`, content: BMI, method: 8 },
        { name: `${folder}/.venv/pyvenv.cfg`, content: 'home = C:/Python312\n', method: 8, dataDescriptor: true },
        { name: `${folder}/.venv/Lib/site-packages/pip/__init__.py`, content: 'from pip import main\n', method: 8, dataDescriptor: true },
        { name: `${folder}/.venv/.gitignore`, content: '*\n', method: 8, dataDescriptor: true },
        { name: '.DS_Store', content: new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x62, 0x75, 0x64, 0x31]) },
        { name: '__MACOSX/._bmi.py', content: new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]) },
      ],
      { comment: 'zipped on this machine' },
    )
    const result = await readArchive(bytes)

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual([`${folder}/README.md`, `${folder}/bmi.py`])
    expect(result.entries[1].text).toBe(BMI)
    expect(result.entries[1].language).toBe('python')
    expect(result.stats.entries).toBe(2)

    const skippedByCode = new Map(result.skipped.map((entry) => [entry.name, entry.code]))
    expect(skippedByCode.get(`${folder}/.venv/pyvenv.cfg`)).toBe('ignored_folder')
    expect(skippedByCode.get(`${folder}/.venv/Lib/site-packages/pip/__init__.py`)).toBe('ignored_folder')
    expect(skippedByCode.get(`${folder}/.venv/.gitignore`)).toBe('ignored_folder')
    expect(skippedByCode.get('.DS_Store')).toBe('generated_file')
    expect(skippedByCode.get('__MACOSX/._bmi.py')).toBe('ignored_folder')
    expect(skippedByCode.get(`${folder}/`)).toBe('directory_entry')
  })
})
