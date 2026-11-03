import { describe, expect, it } from 'vitest'
import { applyEdits, editsOverlap, groupCandidatesByFile, resolveFixOverlaps } from './text'
import type { FixCandidate } from './types'

function candidate(
  findingId: string,
  start: number,
  end: number,
  riskClass: FixCandidate['riskClass'] = 'needs-review',
  file = 'src/a.js',
): FixCandidate {
  return {
    findingId,
    ruleId: 'bugpilot/secret/jwt',
    file,
    targetStartLine: 1,
    targetEndLine: 1,
    edits: [{ file, startOffset: start, endOffset: end, newText: 'x' }],
    description: 'test',
    riskClass,
    behaviourChange: true,
    warnings: [],
    maskedSpans: [],
  }
}

describe('edits', () => {
  it('detects overlapping ranges and insertions', () => {
    expect(editsOverlap({ file: 'a', startOffset: 0, endOffset: 2, newText: '' }, { file: 'a', startOffset: 1, endOffset: 3, newText: '' })).toBe(true)
    expect(editsOverlap({ file: 'a', startOffset: 2, endOffset: 2, newText: '' }, { file: 'a', startOffset: 2, endOffset: 2, newText: '' })).toBe(true)
    expect(editsOverlap({ file: 'a', startOffset: 2, endOffset: 2, newText: '' }, { file: 'a', startOffset: 2, endOffset: 4, newText: '' })).toBe(false)
    expect(editsOverlap({ file: 'a', startOffset: 0, endOffset: 2, newText: '' }, { file: 'a', startOffset: 2, endOffset: 4, newText: '' })).toBe(false)
  })

  it('applies edits in ascending order', () => {
    expect(
      applyEdits('abcdef', [
        { file: 'a', startOffset: 4, endOffset: 6, newText: 'EF' },
        { file: 'a', startOffset: 0, endOffset: 1, newText: 'A' },
        { file: 'a', startOffset: 2, endOffset: 2, newText: '-' },
      ]),
    ).toBe('Ab-cdEF')
  })

  it('throws on overlapping or out-of-bounds edits', () => {
    expect(() => applyEdits('abc', [
      { file: 'a', startOffset: 0, endOffset: 2, newText: '' },
      { file: 'a', startOffset: 1, endOffset: 2, newText: '' },
    ])).toThrow(/overlaps/)
    expect(() => applyEdits('abc', [{ file: 'a', startOffset: 0, endOffset: 9, newText: '' }])).toThrow(/outside/)
  })
})

describe('overlap resolution', () => {
  it('keeps the safe fix and names it in the dropped reason', () => {
    const needsReview = candidate('f-needs', 5, 10)
    const safe = candidate('f-safe', 5, 10, 'safe')
    const resolution = resolveFixOverlaps([needsReview, safe])

    expect(resolution.kept.map((item) => item.findingId)).toEqual(['f-safe'])
    expect(resolution.dropped).toHaveLength(1)
    expect(resolution.dropped[0].kept.findingId).toBe('f-safe')
    expect(resolution.dropped[0].reason).toContain('safe')
    expect(resolution.dropped[0].reason).toContain('f-safe')
  })

  it('breaks a tie by finding id and leaves other files alone', () => {
    const late = candidate('f-b', 0, 2, 'safe')
    const early = candidate('f-a', 0, 2, 'safe')
    const otherFile = candidate('f-c', 0, 2, 'safe', 'src/b.js')
    const resolution = resolveFixOverlaps([late, otherFile, early])

    expect(resolution.kept.map((item) => item.findingId)).toEqual(['f-a', 'f-c'])
    expect(resolution.dropped).toHaveLength(1)
  })

  it('groups candidates by file in first-seen order', () => {
    const groups = groupCandidatesByFile([
      candidate('f-1', 0, 1, 'safe', 'a.js'),
      candidate('f-2', 0, 1, 'safe', 'b.js'),
      candidate('f-3', 2, 3, 'safe', 'a.js'),
    ])
    expect([...groups.keys()]).toEqual(['a.js', 'b.js'])
    expect(groups.get('a.js')?.map((item) => item.findingId)).toEqual(['f-1', 'f-3'])
  })
})
