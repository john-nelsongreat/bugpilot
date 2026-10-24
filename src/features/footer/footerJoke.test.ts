import { describe, expect, it, vi } from 'vitest'
import { chooseJokeIndex, getFooterPageKey } from './footerJoke'

describe('getFooterPageKey', () => {
  it.each([
    ['/', 'overview'],
    ['/bugs', 'bug-log'],
    ['/bugs/', 'bug-log'],
    ['/bugs/new', 'bug-form'],
    ['/bugs/new/', 'bug-form'],
    ['/bugs/abc123', 'bug-detail'],
    ['/bugs/abc123/edit', 'bug-form'],
    ['/assistant', 'assistant'],
    ['/assistant/', 'assistant'],
    ['/missing', 'not-found'],
    ['/bugs/abc123/extra', 'not-found'],
  ])('maps %s to %s', (pathname, pageKey) => {
    expect(getFooterPageKey(pathname)).toBe(pageKey)
  })
})

describe('chooseJokeIndex', () => {
  it('uses the random value when there is no previous index', () => {
    expect(chooseJokeIndex(null, () => 0)).toBe(0)
    expect(chooseJokeIndex(null, () => 0.5)).toBe(2)
    expect(chooseJokeIndex(null, () => 0.999)).toBe(3)
  })

  it.each([
    [0, 0, 1],
    [0, 0.999, 3],
    [1, 0, 0],
    [2, 0.5, 1],
    [3, 0.999, 2],
  ])(
    'never repeats when the previous index is %i and random is %f',
    (previousIndex, randomValue, expectedIndex) => {
      const random = vi.fn(() => randomValue)
      expect(chooseJokeIndex(previousIndex, random)).toBe(expectedIndex)
      expect(chooseJokeIndex(previousIndex, random)).not.toBe(previousIndex)
    },
  )
})
