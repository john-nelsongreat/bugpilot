import { describe, expect, it } from 'vitest'
import {
  codeFenceFor,
  escapeMarkdown,
  isPatchSafePath,
  sanitizeCodeForDisplay,
  sanitizeForDisplay,
  truncateForDisplay,
} from './display'

describe('sanitizeForDisplay', () => {
  it('shows bidi overrides and isolates as visible escape markers', () => {
    const name = `invoice\u202Egnp.exe\u2066txt`
    const shown = sanitizeForDisplay(name)

    expect(shown).toBe('invoice\\u202Egnp.exe\\u2066txt')
    expect(shown).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/)
  })

  it('shows zero-width and control characters as markers', () => {
    const shown = sanitizeForDisplay('a\u200Bb\uFEFFc\u0007d\u001be\u009ff')

    expect(shown).toBe('a\\u200Bb\\uFEFFc\\u0007d\\u001Be\\u009Ff')
  })

  it('turns newlines and tabs in a name into one visible line', () => {
    expect(sanitizeForDisplay('src/a\nb\tc.js')).toBe('src/a\\u000Ab\\u0009c.js')
  })

  it('leaves ordinary text, accents and emoji alone', () => {
    expect(sanitizeForDisplay('src/café/naïve-🐛.js')).toBe('src/café/naïve-🐛.js')
  })
})

describe('sanitizeCodeForDisplay', () => {
  it('keeps line structure but shows bidi and control characters', () => {
    const code = 'const a = 1\n\tif (a) {\u202E}\u0000\n'
    const shown = sanitizeCodeForDisplay(code)

    expect(shown).toBe('const a = 1\n\tif (a) {\\u202E}\\u0000\n')
  })
})

describe('truncateForDisplay', () => {
  it('keeps short names unchanged', () => {
    expect(truncateForDisplay('src/app.js', 20)).toBe('src/app.js')
  })

  it('shortens a long name and marks that it was cut', () => {
    const long = `src/${'a'.repeat(200)}.js`
    const shown = truncateForDisplay(long, 40)

    expect(shown.length).toBeLessThanOrEqual(40)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown.startsWith('src/aaaa')).toBe(true)
  })

  it('never cuts an escape marker in half', () => {
    const name = `${'a'.repeat(37)}\u202Eb`
    const shown = truncateForDisplay(sanitizeForDisplay(name), 40)

    expect(shown).toBe(`${'a'.repeat(37)}…`)
  })
})

describe('escapeMarkdown', () => {
  it('neutralises HTML tags, links and images in a file name', () => {
    expect(escapeMarkdown('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert\\(1\\)&lt;/script&gt;',
    )
    expect(escapeMarkdown('[click](https://example.test)')).toBe(
      '\\[click\\]\\(https://example.test\\)',
    )
    expect(escapeMarkdown('![alt](x)')).toBe('!\\[alt\\]\\(x\\)')
  })

  it('escapes emphasis, code and table metacharacters', () => {
    expect(escapeMarkdown('**bold** _x_ `code` a|b')).toBe(
      '\\*\\*bold\\*\\* \\_x\\_ \\`code\\` a\\|b',
    )
  })

  it('still shows unsafe characters as markers', () => {
    expect(escapeMarkdown('evil\u202Egnp.exe')).toBe('evil\\u202Egnp.exe')
  })

  it('keeps ampersands valid as HTML entities', () => {
    expect(escapeMarkdown('a & b < c')).toBe('a &amp; b &lt; c')
  })
})

describe('codeFenceFor', () => {
  it('uses three backticks for ordinary code', () => {
    expect(codeFenceFor('const a = 1')).toBe('```')
  })

  it('grows past the longest backtick run so evidence cannot break out', () => {
    expect(codeFenceFor('``` inner fence')).toBe('````')
    expect(codeFenceFor('`````` deeper')).toBe('```````')
  })
})

describe('isPatchSafePath', () => {
  it('accepts ordinary relative paths', () => {
    expect(isPatchSafePath('src/app.js')).toBe(true)
    expect(isPatchSafePath('src/café.js')).toBe(true)
  })

  it('rejects newlines, carriage returns, NUL and other control characters', () => {
    expect(isPatchSafePath('src/a\nb.js')).toBe(false)
    expect(isPatchSafePath('src/a\rb.js')).toBe(false)
    expect(isPatchSafePath('src/a\u0000b.js')).toBe(false)
    expect(isPatchSafePath('src/a\u001bb.js')).toBe(false)
  })

  it('rejects a path segment that starts with a dash', () => {
    expect(isPatchSafePath('-rf.js')).toBe(false)
    expect(isPatchSafePath('src/-p/evil.js')).toBe(false)
  })

  it('rejects backslashes, absolute paths and parent segments', () => {
    expect(isPatchSafePath('src\\evil.js')).toBe(false)
    expect(isPatchSafePath('/etc/passwd')).toBe(false)
    expect(isPatchSafePath('C:/Users/evil.js')).toBe(false)
    expect(isPatchSafePath('src/../evil.js')).toBe(false)
  })
})
