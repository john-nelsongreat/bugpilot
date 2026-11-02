import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { buildLineStarts } from './context'
import { jsonSyntaxRule } from './json'
import type { RuleFile } from './types'

function makeFile(text: string): RuleFile {
  const detection = detectLanguage('data/config.json', text)
  return {
    file: 'data/config.json',
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    text,
    lines: text.split('\n'),
    lineStarts: buildLineStarts(text),
  }
}

describe('JSON syntax rule', () => {
  it('accepts a valid document silently', () => {
    expect(jsonSyntaxRule.check(makeFile('{"name":"bugpilot","values":[1,2,3]}\n'))).toHaveLength(0)
  })

  it('reports a trailing comma at the line the parser names', () => {
    const [hit] = jsonSyntaxRule.check(makeFile('{\n  "a": 1,\n}\n'))

    expect(hit.message).toMatch(/Invalid JSON/)
    expect(hit.range.startLine).toBeGreaterThanOrEqual(2)
    expect(jsonSyntaxRule.severity).toBe('High')
    expect(hit.confidence.level).toBe('high')
    expect(hit.evidence[0].lineNumber).toBe(hit.range.startLine)
  })

  it('reports an unclosed string with a line number', () => {
    const [hit] = jsonSyntaxRule.check(makeFile('{\n  "a": "unterminated\n}\n'))
    expect(hit.message).toMatch(/Invalid JSON/)
    expect(hit.range.startLine).toBeGreaterThanOrEqual(1)
    expect(hit.range.startLine).toBeLessThanOrEqual(3)
  })

  it('does not confuse valid JSON prose for a syntax error', () => {
    const text = JSON.stringify({
      message: 'A parser error is expected when this file is edited by hand.',
      url: 'http://example.com/docs',
    })
    expect(jsonSyntaxRule.check(makeFile(text))).toHaveLength(0)
  })

  it('does not claim to check duplicate keys or schema', () => {
    const [hit] = jsonSyntaxRule.check(makeFile('{"a": 1,}'))
    expect(hit.limitations?.join(' ')).toMatch(/Duplicate keys/)
  })
})
