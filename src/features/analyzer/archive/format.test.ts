// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import { archiveReasonMessage } from './reasons'
import {
  CONTAINER_EXTENSIONS,
  PACKAGE_ARCHIVE_EXTENSIONS,
  claimedFormatOf,
  detectFormat,
  isContainerName,
} from './format'
import { buildTar, emptyTar, tarOf, tarWithBadChecksum } from '../../../test/tarFixtures'

const encoder = new TextEncoder()

function gzip(body: string): Uint8Array {
  return gzipSync(encoder.encode(body))
}

describe('detectFormat: zip signatures', () => {
  it('reads the local-header signature rather than the name', () => {
    const detection = detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), '')
    expect(detection.format).toBe('zip')
    expect(detection.refusalCode).toBeNull()
    expect(detection.note).toBeNull()
  })

  it('accepts an empty archive that only holds the end-of-directory signature', () => {
    const detection = detectFormat(new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), '')
    expect(detection.format).toBe('zip')
  })

  it('still sees a zip behind a self-extracting stub and says the name disagreed', () => {
    const stub = encoder.encode('#!/bin/sh\necho installing\n'.repeat(4))
    const detection = detectFormat(new Uint8Array([...stub, 0x50, 0x4b, 0x03, 0x04, 0, 0]), 'installer.exe')
    expect(detection.format).toBe('zip')
    expect(detection.note).toContain('.exe')
    expect(detection.note).toContain('zip')
  })

  it('does not scan the whole file for a signature', () => {
    // Two signatures, both outside the bounded scan windows, in a megabyte of text.
    const junk = new Uint8Array(1024 * 1024).fill(0x61)
    for (const at of [200_000, junk.length - 70_000]) {
      junk[at] = 0x50
      junk[at + 1] = 0x4b
      junk[at + 2] = 0x03
      junk[at + 3] = 0x04
    }
    expect(detectFormat(junk, 'blob.dat').format).toBe('text')
  })

  it('prefers the zip signature over a ustar string that only looks like a header', () => {
    const bytes = new Uint8Array(1024)
    bytes.set(encoder.encode('ustar'), 257)
    bytes[0] = 0x50
    bytes[1] = 0x4b
    bytes[2] = 0x03
    bytes[3] = 0x04
    expect(detectFormat(bytes, 'a.zip').format).toBe('zip')
  })
})

describe('detectFormat: tar signatures', () => {
  it('reads a real ustar header at offset 257', () => {
    expect(detectFormat(tarOf('src/app.js', 'export const a = 1\n'), '').format).toBe('tar')
  })

  it('reads the pre-POSIX magic as well', () => {
    const archive = buildTar([{ name: 'a.txt', content: 'a\n', magicOverride: 'ustar ' }])
    expect(detectFormat(archive, '').format).toBe('tar')
  })

  it('rejects a text file that merely contains the word ustar at offset 257', () => {
    // 'line one\n' is 9 bytes, so the repeated padding puts the word at exactly offset 257.
    const text = `line one\n${'x'.repeat(248)}ustar  rest of a prose file that is not an archive\n`
    const bytes = encoder.encode(text)
    expect(bytes.length).toBeGreaterThan(262)
    expect(bytes.subarray(257, 262)).toEqual(encoder.encode('ustar'))
    expect(detectFormat(bytes, 'notes.txt').format).toBe('text')
  })

  it('rejects a ustar magic whose header checksum does not verify', () => {
    const detection = detectFormat(tarWithBadChecksum(), 'broken')
    expect(detection.format).toBeNull()
    expect(detection.refusalCode).toBe('unsupported_format')
  })

  it('reads an archive that holds no entries as a tar, not as binary junk', () => {
    expect(detectFormat(emptyTar(), '').format).toBe('tar')
  })

  it('refuses a header cut off before offset 262 instead of guessing a tar', () => {
    expect(detectFormat(tarOf('a.txt', 'x\n').subarray(0, 200), 'a.txt').format).toBeNull()
  })

  it('refuses one zero block: a trailer needs two blocks', () => {
    expect(detectFormat(new Uint8Array(512), 'zeros.bin').format).toBeNull()
  })

  it('reports the name disagreement when a .tar.gz holds an unpacked tar', () => {
    const detection = detectFormat(tarOf('src/app.js', 'export const a = 1\n'), 'project.tar.gz')
    expect(detection.format).toBe('tar')
    expect(detection.note).toContain('tar.gz')
    expect(detection.note).toContain('tar archive')
  })
})

describe('detectFormat: gzip signatures', () => {
  it('reads 1f 8b as a gzip stream', () => {
    expect(detectFormat(gzip('export const a = 1\n'), '').format).toBe('gzip')
  })

  it('reads the signature even when the stream was cut short', () => {
    expect(detectFormat(gzip('some text that goes on for a while').subarray(0, 12), 'cut.gz').format).toBe('gzip')
  })

  it('says what disagreed when a .zip name carries a gzip stream', () => {
    const detection = detectFormat(gzip('hello\n'), 'bundle.zip')
    expect(detection.format).toBe('gzip')
    expect(detection.note).toContain('.zip')
    expect(detection.note).toContain('gzip')
    expect(detection.note).toMatch(/contents/i)
  })

  it('says nothing when the name and the contents agree', () => {
    expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'bundle.zip').note).toBeNull()
    expect(detectFormat(gzip('x'), 'notes.txt.gz').note).toBeNull()
  })

  it('keeps a tar inside a gzip stream in the gzip family', () => {
    // The .tgz is a gzip stream first; finding the tar inside it is the reader's job.
    const archive = gzipSync(tarOf('src/app.js', 'export const a = 1\n'))
    expect(detectFormat(archive, 'project.tgz').format).toBe('gzip')
    expect(detectFormat(archive, 'project.tgz').note).toBeNull()
  })
})

describe('detectFormat: formats BugPilot refuses', () => {
  const refused: { kind: string; bytes: Uint8Array }[] = [
    { kind: '7z', bytes: new Uint8Array([0x37, 0x7b, 0xa3, 0xab, 0x27, 0x1c, 0, 0]) },
    { kind: 'rar', bytes: new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0, 0]) },
    { kind: 'bz2', bytes: encoder.encode('BZh91AY&SY\0\0\0\0') },
    { kind: 'xz', bytes: new Uint8Array([0xfd, 0x37, 0x5a, 0x58, 0x5a, 0x00, 0xff, 0x00]) },
    { kind: 'zst', bytes: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]) },
  ]

  for (const item of refused) {
    it(`refuses ${item.kind} with a message that asks for zip or tar.gz`, () => {
      const detection = detectFormat(item.bytes, `archive.${item.kind}`)
      expect(detection.format).toBeNull()
      expect(detection.refusalCode).toBe('unsupported_format')
      expect(detection.refusalSubject).toBe(item.kind)
      // The name already told the truth, so there is nothing extra to say about it.
      expect(detection.note).toBeNull()
      const message = archiveReasonMessage('unsupported_format', detection.refusalSubject)
      expect(message.toLowerCase()).toContain('.zip')
      expect(message.toLowerCase()).toContain('tar.gz')
    })
  }

  it('notes a refused format hiding behind a different name', () => {
    const detection = detectFormat(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]), 'project.tar.gz')
    expect(detection.refusalSubject).toBe('zst')
    expect(detection.note).toContain('.tar.gz')
    expect(detection.note).toContain('.zst')
  })

  it('refuses binary bytes that carry no signature at all', () => {
    const detection = detectFormat(new Uint8Array([0, 0, 1, 2, 3, 0, 255, 254]), 'mystery')
    expect(detection.format).toBeNull()
    expect(detection.refusalCode).toBe('unsupported_format')
    expect(detection.note).toBeNull()
    expect(archiveReasonMessage('unsupported_format', '')).toMatch(/could not recognise/i)
  })

  it('never decodes a refused format just because the name promises a zip', () => {
    const detection = detectFormat(new Uint8Array([0x37, 0x7b, 0xa3, 0xab, 0x27, 0x1c, 0, 0]), 'archive.zip')
    expect(detection.format).toBeNull()
    expect(detection.refusalSubject).toBe('7z')
    expect(detection.note).toContain('.zip')
  })
})

describe('detectFormat: plain source and text', () => {
  it('accepts a UTF-8 source file', () => {
    const detection = detectFormat(encoder.encode('def add(a, b):\n    return a + b\n'), 'calc.py')
    expect(detection.format).toBe('text')
    expect(detection.note).toBeNull()
    expect(detection.refusalCode).toBeNull()
  })

  it('accepts an empty file as text', () => {
    expect(detectFormat(new Uint8Array(0), 'empty.txt').format).toBe('text')
  })

  it('accepts UTF-16 source, which otherwise looks like a NUL-heavy binary', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0, 0x21, 0])
    expect(detectFormat(utf16, 'notes.txt').format).toBe('text')
  })

  it('does not claim a note for a plain file that is plain', () => {
    expect(detectFormat(encoder.encode('# Notes\n\nnothing to see\n'), 'README.md').note).toBeNull()
  })

  it('reports a text-named file that is really a zip', () => {
    const detection = detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'readme.md')
    expect(detection.format).toBe('zip')
    expect(detection.note).toMatch(/readme\.md/)
  })
})

describe('container routing gate', () => {
  it('names the container extensions the intake accepts', () => {
    expect(CONTAINER_EXTENSIONS).toEqual(
      expect.arrayContaining(['zip', 'tar', 'gz', 'tgz', 'whl', 'nupkg', 'vsix', 'jar', 'war', 'aar', 'apk']),
    )
  })

  it('treats every package archive as a zip container', () => {
    expect(PACKAGE_ARCHIVE_EXTENSIONS).toEqual(['whl', 'nupkg', 'vsix', 'jar', 'war', 'aar', 'apk'])
    for (const extension of PACKAGE_ARCHIVE_EXTENSIONS) {
      expect(isContainerName(`download.${extension}`)).toBe(true)
      expect(claimedFormatOf(`download.${extension}`)).toBe('zip')
    }
  })

  it('accepts a compound .tar.gz name, case-insensitively', () => {
    expect(isContainerName('project.TAR.GZ')).toBe(true)
    expect(isContainerName('project.tgz')).toBe(true)
    expect(claimedFormatOf('project.tar.gz')).toBe('gzip')
  })

  it('does not claim a plain source file is a container', () => {
    for (const name of ['app.js', 'calc.py', 'notes.txt', 'book.ipynb', '.env', 'archive.zip.7z']) {
      expect(isContainerName(name)).toBe(false)
    }
  })

  it('does not mistake a file called tar for a container', () => {
    expect(isContainerName('project/tar')).toBe(false)
    expect(isContainerName('project/tar.xz')).toBe(false)
  })

  it('claims nothing for a name with no extension', () => {
    expect(claimedFormatOf('Makefile')).toBeNull()
    expect(isContainerName('Makefile')).toBe(false)
  })
})
