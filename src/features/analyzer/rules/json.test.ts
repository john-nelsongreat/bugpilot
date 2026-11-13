import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { buildLineStarts } from './context'
import { jsonSyntaxRule } from './json'
import type { RuleFile } from './types'

function makeFile(text: string, name = 'data/config.json'): RuleFile {
  const detection = detectLanguage(name, text)
  return {
    file: name,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    text,
    lines: text.split('\n'),
    lineStarts: buildLineStarts(text),
  }
}

/** A file labelled JSON by content sniffing rather than by its name. */
function makeSniffedFile(text: string): RuleFile {
  return {
    file: 'payload',
    language: 'json',
    languageSource: 'content',
    encoding: 'utf-8',
    text,
    lines: text.split('\n'),
    lineStarts: buildLineStarts(text),
  }
}

const TSCONFIG = `{
  "extends": "../../.configs/tsconfig.base.json",
  // the base config sets strictness
  "compilerOptions": {
    "noEmit": true,
  },
}
`

describe('JSON syntax rule', () => {
  it('accepts a valid document silently', () => {
    expect(jsonSyntaxRule.check(makeFile('{"name":"bugpilot","values":[1,2,3]}\n'))).toHaveLength(0)
    expect(jsonSyntaxRule.coverageNotes?.(makeFile('{"name":"bugpilot"}'))).toEqual([])
  })

  it('tolerates a line comment and a trailing comma as JSONC, with a visible reason', () => {
    expect(jsonSyntaxRule.check(makeFile(TSCONFIG))).toHaveLength(0)

    const [note] = jsonSyntaxRule.coverageNotes?.(makeFile(TSCONFIG)) ?? []
    expect(note).toBeDefined()
    expect(note).toContain('JSONC')
    expect(note).toContain('// or /* */ comments outside strings')
    expect(note).toContain('a comma before a closing } or ]')
    // Honest about what was not checked: strict consumers still reject the file.
    expect(note).toContain('A strict JSON parser still rejects this document')
  })

  it('tolerates a block comment outside strings', () => {
    const text = '{\n  /* built by the scaffolder */\n  "a": 1\n}\n'
    expect(jsonSyntaxRule.check(makeFile(text))).toHaveLength(0)
    expect(jsonSyntaxRule.coverageNotes?.(makeFile(text))?.[0]).toContain('JSONC')
  })

  it('tolerates a trailing comma with no comments in the file', () => {
    const text = '{\n  "tags": ["a", "b",],\n}\n'
    expect(jsonSyntaxRule.check(makeFile(text))).toHaveLength(0)
    const [note] = jsonSyntaxRule.coverageNotes?.(makeFile(text)) ?? []
    expect(note).toContain('JSONC')
    expect(note).toContain('a comma before a closing } or ]')
    expect(note, 'no comments were tolerated, so none may be claimed').not.toContain('// or /* */')
    expect(note).toContain('A strict JSON parser still rejects this document')
  })

  it('keeps comment punctuation inside strings out of the dialect decision', () => {
    const text = JSON.stringify({ url: 'http://example.com/a//b', doc: '/* not a comment */' })
    expect(jsonSyntaxRule.check(makeFile(text))).toHaveLength(0)
    expect(jsonSyntaxRule.coverageNotes?.(makeFile(text))).toEqual([])
  })

  it('still reports genuinely malformed JSON that tolerance cannot rescue', () => {
    const cases: readonly [string, string][] = [
      ['missing value', '{\n  "a": ,\n  "b": 1\n}\n'],
      ['unquoted key', '{\n  a: 1\n}\n'],
      ['unterminated string', '{\n  "a": "unterminated\n}\n'],
      ['unterminated block comment', '{\n  /* never closed\n  "a": 1\n}\n'],
      ['missing closer', '{\n  "a": [1, 2\n}\n'],
      ['single-quoted string', "{ 'a': 1 }\n"],
    ]

    for (const [name, text] of cases) {
      const hits = jsonSyntaxRule.check(makeFile(text))
      expect(hits, name).toHaveLength(1)
      expect(hits[0].message, name).toMatch(/Invalid JSON/)
      expect(jsonSyntaxRule.coverageNotes?.(makeFile(text)), name).toEqual([])
    }
  })

  it('reports a trailing comma when tolerance is not what the file needed to fail on', () => {
    // A comma before a closer is the tolerated shape; a comma with nothing after it is not.
    const [hit] = jsonSyntaxRule.check(makeFile('{"a": 1,\n}\n\n[\n'))
    expect(hit.message).toMatch(/Invalid JSON/)
    expect(jsonSyntaxRule.coverageNotes?.(makeFile('{"a": 1,\n}\n\n[\n'))).toEqual([])
  })

  it('never admits a dialect on content alone, only on the name', () => {
    const text = '{\n  // comment\n  "a": 1\n}\n'

    expect(jsonSyntaxRule.check(makeSniffedFile(text))).toHaveLength(1)
    expect(jsonSyntaxRule.coverageNotes?.(makeSniffedFile(text))).toEqual([])
  })

  it('reports the malformed document at the line the parser names', () => {
    const [hit] = jsonSyntaxRule.check(makeFile('{\n  "a": "unterminated\n}\n'))
    expect(hit.range.startLine).toBeGreaterThanOrEqual(1)
    expect(hit.range.startLine).toBeLessThanOrEqual(3)
    expect(jsonSyntaxRule.severity).toBe('High')
    expect(hit.confidence.level).toBe('high')
    expect(hit.evidence[0].lineNumber).toBe(hit.range.startLine)
  })

  it('does not confuse valid JSON prose for a syntax error', () => {
    const text = JSON.stringify({
      message: 'A parser error is expected when this file is edited by hand.',
      url: 'http://example.com/docs',
    })
    expect(jsonSyntaxRule.check(makeFile(text))).toHaveLength(0)
  })

  it('does not claim to check duplicate keys or schema', () => {
    const [hit] = jsonSyntaxRule.check(makeFile('{"a": 1,\n"b": 2\n}\n"{"}\n'))
    expect(hit.limitations?.join(' ')).toMatch(/Duplicate keys/)
  })
})
