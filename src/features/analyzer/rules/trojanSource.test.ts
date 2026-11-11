import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { buildLineStarts } from './context'
import { ruleById } from './registry'
import type { RuleFile } from './types'

function makeFile(path: string, text: string): RuleFile {
  const detection = detectLanguage(path, text)
  return {
    file: path,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    text,
    lines: text.split('\n'),
    lineStarts: buildLineStarts(text),
  }
}

function hits(ruleId: string, path: string, text: string) {
  const rule = ruleById(ruleId)
  if (!rule) throw new Error(`missing rule ${ruleId}`)
  return rule.check(makeFile(path, text))
}

const BIDI_ID = 'bugpilot/generic/bidi-control-character'
const ZERO_WIDTH_ID = 'bugpilot/generic/zero-width-character'

describe('rule: bidirectional control characters', () => {
  it('flags every bidi control character the rule knows', () => {
    const text = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'].join(' ')
    const found = hits(BIDI_ID, 'src/app.js', `const x = 1\n// ${text}\n`)
    expect(found).toHaveLength(9)
    expect(found.map((hit) => hit.message)).toEqual([
      'Bidirectional control character \\u202a (LEFT-TO-RIGHT EMBEDDING).',
      'Bidirectional control character \\u202b (RIGHT-TO-LEFT EMBEDDING).',
      'Bidirectional control character \\u202c (POP DIRECTIONAL FORMATTING).',
      'Bidirectional control character \\u202d (LEFT-TO-RIGHT OVERRIDE).',
      'Bidirectional control character \\u202e (RIGHT-TO-LEFT OVERRIDE).',
      'Bidirectional control character \\u2066 (LEFT-TO-RIGHT ISOLATE).',
      'Bidirectional control character \\u2067 (RIGHT-TO-LEFT ISOLATE).',
      'Bidirectional control character \\u2068 (FIRST STRONG ISOLATE).',
      'Bidirectional control character \\u2069 (POP DIRECTIONAL ISOLATE).',
    ])
  })

  it('reports the codepoint as an escape and never as the raw character', () => {
    const [hit] = hits(BIDI_ID, 'src/app.js', 'if (ok) {\u202e return admin }\n')
    expect(hit?.message).toContain('\\u202e')
    expect(hit?.message).not.toContain('\u202e')
    const serialized = JSON.stringify(hit)
    expect(serialized).toContain('\\u202e')
    expect(serialized).not.toContain('\u202e')
    expect(hit?.evidence[0]?.quote).not.toContain('\u202e')
    expect(hit?.evidence[0]?.quote).toContain('\\u202e')
  })

  it('is High severity in code and Low in prose-like files', () => {
    const [code] = hits(BIDI_ID, 'src/app.js', 'x = 1\u202e\n')
    const [prose] = hits(BIDI_ID, 'docs/notes.md', 'see the \u202e result\n')
    expect(code?.severity ?? 'High').toBe('High')
    expect(prose?.severity).toBe('Low')
  })

  it('does not flag the RLM and LRM marks of ordinary right-to-left text', () => {
    const arabic = '\u0645\u0631\u062d\u0628\u0627 \u200f\u0639\u0627\u0644\u0645'
    const hebrew = '\u05e9\u05dc\u05d5\u05dd \u200e\u05e2\u05d5\u05dc\u05dd'
    expect(hits(BIDI_ID, 'src/app.js', `const label = "${arabic}"\n`)).toEqual([])
    expect(hits(BIDI_ID, 'docs/readme.md', `${hebrew}\n`)).toEqual([])
    expect(hits(ZERO_WIDTH_ID, 'src/app.js', `const label = "${arabic}"\n`)).toEqual([])
    expect(hits(ZERO_WIDTH_ID, 'docs/readme.md', `${hebrew}\n`)).toEqual([])
  })

  it('does not fire on a file without invisible characters', () => {
    expect(hits(BIDI_ID, 'src/app.js', 'const ok = true\n')).toEqual([])
  })
})

describe('rule: zero-width characters', () => {
  it('flags a zero-width space hidden inside an identifier', () => {
    const [hit] = hits(ZERO_WIDTH_ID, 'src/app.js', 'const is\u200bAdmin = false\n')
    expect(hit?.message).toBe('Zero-width character \\u200b (ZERO WIDTH SPACE).')
    expect(hit?.range.startLine).toBe(1)
    expect(hit?.range.startColumn).toBe(9)
  })

  it('flags zero-width characters inside string literals', () => {
    const found = hits(ZERO_WIDTH_ID, 'src/app.py', 'label = "pass\u2060word"\n')
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toContain('\\u2060')
  })

  it('flags a BOM that is not at the start of the file, and ignores a real leading BOM', () => {
    const [mid] = hits(ZERO_WIDTH_ID, 'src/app.js', 'const x\ufeff = 1\n')
    expect(mid?.message).toContain('\\ufeff')

    const withBom = '\ufeffconst ok = true\n'
    expect(hits(ZERO_WIDTH_ID, 'src/app.js', withBom)).toEqual([])
  })

  it('does not flag zero-width characters in comments or plain prose', () => {
    expect(hits(ZERO_WIDTH_ID, 'src/app.js', '// careful\u200b here\n')).toEqual([])
    expect(hits(ZERO_WIDTH_ID, 'docs/notes.md', 'a word\u200b split invisibly\n')).toEqual([])
  })

  it('does not flag a ZWJ inside an emoji sequence, in or out of a string', () => {
    const family = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}'
    expect(hits(ZERO_WIDTH_ID, 'src/app.js', `const who = "${family}"\n`)).toEqual([])
    expect(hits(ZERO_WIDTH_ID, 'src/app.js', `// ${family}\n`)).toEqual([])
  })

  it('still flags a ZWJ that is not between two emoji', () => {
    const [hit] = hits(ZERO_WIDTH_ID, 'src/app.js', 'const a\u200db = 1\n')
    expect(hit?.message).toContain('\\u200d')
  })

  it('reports the codepoint as an escape and never as the raw character', () => {
    const [hit] = hits(ZERO_WIDTH_ID, 'src/app.js', 'const is\u200bAdmin = false\n')
    const serialized = JSON.stringify(hit)
    expect(serialized).toContain('\\u200b')
    expect(serialized).not.toContain('\u200b')
    expect(hit?.evidence[0]?.quote).not.toContain('\u200b')
  })

  it('does not fire on a file without invisible characters', () => {
    expect(hits(ZERO_WIDTH_ID, 'src/app.js', 'const ok = true\n')).toEqual([])
  })
})
