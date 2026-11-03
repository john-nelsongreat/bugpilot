import { describe, expect, it } from 'vitest'
import { buildSplitRows, buildUnifiedRows, masksByLine, maskLine } from './diffModel'

describe('masksByLine', () => {
  it('maps an absolute span to the right line and column', () => {
    const text = 'first\nsecond value\nthird\n'
    const start = text.indexOf('value')
    const masks = masksByLine(text, [
      { startOffset: start, endOffset: start + 5, maskedText: 'v…e' },
    ])
    expect([...masks.keys()]).toEqual([1])
    expect(masks.get(1)).toEqual([{ startColumn: 7, endColumn: 12, maskedText: 'v…e' }])
    expect(maskLine('second value', masks.get(1) ?? [])).toBe('second v…e')
    expect(maskLine('first', masks.get(0) ?? [])).toBe('first')
  })

  it('splits a span that crosses a newline', () => {
    const text = 'abcdef\nghijkl\n'
    const masks = masksByLine(text, [{ startOffset: 3, endOffset: 10, maskedText: '[masked]' }])
    expect(maskLine('abcdef', masks.get(0) ?? [])).toBe('abc[masked]')
    expect(maskLine('ghijkl', masks.get(1) ?? [])).toBe('[masked]jkl')
  })
})

describe('buildUnifiedRows', () => {
  const before = 'one\ntwo\nthree\nfour\nfive\n'
  const after = 'one\nTWO\nthree\nfour\nfive\n'

  it('numbers old and new lines and indexes every change', () => {
    const diff = buildUnifiedRows('src/a.ts', before, after, new Map())
    const kinds = diff.rows.map((row) => row.kind)
    expect(kinds).toContain('hunk')
    expect(kinds).toContain('remove')
    expect(kinds).toContain('add')

    const removed = diff.rows.find((row) => row.kind === 'remove')
    const added = diff.rows.find((row) => row.kind === 'add')
    expect(removed?.oldLine).toBe(2)
    expect(removed?.newLine).toBeNull()
    expect(added?.newLine).toBe(2)
    expect(added?.oldLine).toBeNull()
    expect(removed?.changeIndex).toBe(0)
    expect(added?.changeIndex).toBe(1)
    expect(diff.changeCount).toBe(2)

    const context = diff.rows.filter((row) => row.kind === 'context')
    expect(context.every((row) => row.oldLine !== null && row.newLine !== null)).toBe(true)
  })

  it('masks removed lines from the original text but not untouched lines', () => {
    const source = 'const secret = "q7Vz"\nkeep\n'
    const fixed = 'const secret = process.env.SECRET\nkeep\n'
    const start = source.indexOf('"q7Vz"')
    const masks = masksByLine(source, [
      { startOffset: start, endOffset: start + 6, maskedText: 'q…z' },
    ])

    const diff = buildUnifiedRows('src/a.ts', source, fixed, masks)
    const removed = diff.rows.find((row) => row.kind === 'remove')
    const added = diff.rows.find((row) => row.kind === 'add')
    expect(removed?.text).toBe('const secret = q…z')
    expect(added?.text).toBe('const secret = process.env.SECRET')
  })

  it('returns no rows for identical text', () => {
    const diff = buildUnifiedRows('src/a.ts', before, before, new Map())
    expect(diff.rows).toEqual([])
    expect(diff.changeCount).toBe(0)
  })
})

describe('buildSplitRows', () => {
  it('pairs a one-line replacement and keeps extras standalone', () => {
    const before = 'one\ntwo\nthree\n'
    const after = 'one\nTWO\nTHREE\n'
    const diff = buildSplitRows('src/a.ts', before, after, new Map())
    const changes = diff.rows.filter((row) => row.changeIndex !== null)
    expect(changes.map((row) => row.kind)).toEqual(['pair', 'pair'])
    expect(changes[0]).toMatchObject({ oldLine: 2, newLine: 2, oldText: 'two', newText: 'TWO' })
    expect(changes[1]).toMatchObject({ oldLine: 3, newLine: 3, oldText: 'three', newText: 'THREE' })
  })

  it('leaves a pure insertion as an add row', () => {
    const diff = buildSplitRows('src/a.ts', 'one\n', 'one\ntwo\n', new Map())
    const changes = diff.rows.filter((row) => row.changeIndex !== null)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'add', oldLine: null, newLine: 2 })
  })
})
