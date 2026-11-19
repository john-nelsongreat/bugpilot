// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeEntryName, relativePathRefusal } from './paths'

describe('normalizeEntryName', () => {
  it('strips a leading dot segment', () => {
    expect(normalizeEntryName('./a.js')).toBe('a.js')
  })

  it('collapses a middle dot segment', () => {
    expect(normalizeEntryName('a/./b.js')).toBe('a/b.js')
  })

  it('canonicalizes the ignore manifest at the archive root', () => {
    expect(normalizeEntryName('./.bugpilotignore')).toBe('.bugpilotignore')
  })

  it('canonicalizes a source path under the root', () => {
    expect(normalizeEntryName('./src/app.js')).toBe('src/app.js')
  })

  it('keeps turning backslashes into separators', () => {
    expect(normalizeEntryName('a\\b.js')).toBe('a/b.js')
  })

  it('leaves a lone dot-dot as written', () => {
    expect(normalizeEntryName('..')).toBe('..')
  })

  it('keeps traversal after a leading dot segment', () => {
    expect(normalizeEntryName('./..')).toBe('..')
  })

  it('preserves a name that is only the current directory', () => {
    expect(normalizeEntryName('.')).toBe('.')
  })

  it('preserves a trailing current-directory name as written', () => {
    expect(normalizeEntryName('./')).toBe('./')
  })

  it('keeps empty segments that are not dot segments', () => {
    expect(normalizeEntryName('a//b.js')).toBe('a//b.js')
  })

  it('leaves a leading-dot file name untouched', () => {
    expect(normalizeEntryName('.hidden')).toBe('.hidden')
  })

  it('leaves a three-dot name untouched', () => {
    expect(normalizeEntryName('...')).toBe('...')
  })

  it('drops a leading dot segment but keeps a trailing separator', () => {
    expect(normalizeEntryName('./src/')).toBe('src/')
  })
})

describe('relativePathRefusal stays as today', () => {
  it('refuses a traversal that walks out', () => {
    expect(relativePathRefusal('../a')).toBe('path_traversal')
  })

  it('refuses a backslash traversal after segment splitting', () => {
    expect(relativePathRefusal('a/..\\b')).toBe('path_traversal')
  })

  it('refuses an absolute path', () => {
    expect(relativePathRefusal('/etc/passwd')).toBe('absolute_path')
  })

  it('refuses a drive-letter path', () => {
    expect(relativePathRefusal('C:/evil.js')).toBe('drive_letter_path')
  })
})
