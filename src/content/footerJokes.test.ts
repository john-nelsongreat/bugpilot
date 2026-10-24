import { describe, expect, it } from 'vitest'
import {
  ALLOWED_FOOTER_JOKE_EMOJIS,
  FOOTER_JOKES,
  FOOTER_PAGE_KEYS,
} from './footerJokes'

const expectedJokes = {
  overview: [
    "My dashboard says zero critical bugs. Bold of it to assume I've finished looking. 😎",
    'Why did the open bug refuse to close? It had unresolved issues. 😑',
    '"About an hour" is the longest lie in tech. 😬',
    'Dashboards are just anxiety with charts. 😶‍🌫️',
  ],
  'bug-log': [
    'Why did the developer break up with the bug log? Too many unresolved issues. 😭',
    'Sorting by severity feels great until you realise everything is Critical. 😖',
    'Filter set to "Resolved". Suspiciously quiet in here. 🫣',
    'A bug log is a diary where every entry starts with "it was working yesterday". 😶‍🌫️',
  ],
  'bug-detail': [
    'Steps to reproduce: 1. Open the app. 2. Wait. 3. It only happens when nobody is watching. 🫣',
    'Expected behaviour: works. Actual behaviour: also works, but only on Tuesdays. 😑',
    'Why did the bug need a verification note? Even bugs have to show their proof. 😎',
    "Marked as Verified without notes? We don't do that here. 😬",
  ],
  'bug-form': [
    'Title your bug like you are texting future-you at 3 a.m. 😖',
    '"It doesn\'t work" is not a description. It is a cry for help. 😭',
    'Why did the form reject the bug? Missing required field: proof. 😑',
    'Reproduction steps: the part everyone skips and later regrets. 😬',
  ],
  assistant: [
    'Why did the traceback feel unappreciated? Everyone reads the last line and ignores the rest. 😑',
    'ModuleNotFoundError: the only module you ever need is the one you forgot to install. 😖',
    "Why did the NameError cry? It didn't know who it was. 😭",
    'This assistant never runs your code, which is also my debugging strategy. 😎',
  ],
  'not-found': [
    '404: this page went to production without telling anyone. 😶‍🌫️',
    'Why did the page vanish? It took a wrong route. 😬',
    'I looked everywhere for this page. Even in git blame. 🫣',
    'This URL is about as real as my sleep schedule. 😭',
  ],
} as const

describe('footer jokes', () => {
  it('defines exactly the six page keys', () => {
    expect([...FOOTER_PAGE_KEYS]).toEqual([
      'overview',
      'bug-log',
      'bug-detail',
      'bug-form',
      'assistant',
      'not-found',
    ])
    expect(Object.keys(FOOTER_JOKES).sort()).toEqual(
      [...FOOTER_PAGE_KEYS].sort(),
    )
  })

  it.each(FOOTER_PAGE_KEYS)(
    'keeps exactly four verbatim, non-empty jokes for %s',
    (pageKey) => {
      const jokes = FOOTER_JOKES[pageKey]
      expect(jokes).toHaveLength(4)
      expect(jokes).toEqual(expectedJokes[pageKey])
      expect(new Set(jokes).size).toBe(4)

      for (const joke of jokes) {
        expect(joke.trim()).not.toBe('')
        expect(
          ALLOWED_FOOTER_JOKE_EMOJIS.some((emoji) =>
            joke.endsWith(` ${emoji}`),
          ),
        ).toBe(true)
      }
    },
  )
})
