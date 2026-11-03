import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import { analyzeEntries } from '../analysis/engine'
import { makeFinding } from '../analysis/finding'
import { proposeJsonTrailingCommaFix, trailingCommaOffsets } from './jsonTrailingComma'
import { applyEdits } from './text'

const JSON_RULE = 'bugpilot/syntax/json'

function entry(text: string): ArchiveEntry {
  const detection = detectLanguage('data/config.json', text)
  return {
    name: 'data/config.json',
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: text.length,
  }
}

function jsonFinding(source: ArchiveEntry) {
  const finding = analyzeEntries([source]).files[0].findings.find((item) => item.ruleId === JSON_RULE)
  if (!finding) throw new Error('Expected a JSON syntax finding')
  return finding
}

function fakeFinding() {
  return makeFinding({
    ruleId: JSON_RULE,
    analyzer: 'bugpilot-rules',
    tier: 'syntax',
    severity: 'High',
    confidence: { level: 'high', reason: 'test' },
    file: 'data/config.json',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    evidence: [],
    message: 'Invalid JSON: test',
    explanation: 'test',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

describe('JSON trailing comma fix', () => {
  it('removes trailing commas outside strings and produces valid JSON', () => {
    const source = entry('{\n  "name": "widget",\n  "tags": ["a", "b",],\n}\n')
    const candidate = proposeJsonTrailingCommaFix(jsonFinding(source), source.text, source.name)

    expect(candidate?.riskClass).toBe('safe')
    expect(candidate?.behaviourChange).toBe(false)
    expect(candidate?.edits).toHaveLength(2)

    const fixed = applyEdits(source.text, candidate?.edits ?? [])
    expect(fixed).toBe('{\n  "name": "widget",\n  "tags": ["a", "b"]\n}\n')
    expect(() => JSON.parse(fixed)).not.toThrow()
    expect(analyzeEntries([entry(fixed)]).files[0].findings.filter((hit) => hit.ruleId === JSON_RULE)).toHaveLength(0)
  })

  it('leaves comma-brace text inside strings alone', () => {
    const source = entry('{"text": "a,} b", "list": [1,],}\n')
    expect(trailingCommaOffsets(source.text)).toHaveLength(2)
    const candidate = proposeJsonTrailingCommaFix(jsonFinding(source), source.text, source.name)
    const fixed = applyEdits(source.text, candidate?.edits ?? [])
    expect(fixed).toBe('{"text": "a,} b", "list": [1]}\n')
    expect(fixed).toContain('"a,} b"')
  })

  it('refuses when removing commas is not enough to parse', () => {
    const source = entry('{"name": "widget",} trailing\n')
    expect(proposeJsonTrailingCommaFix(jsonFinding(source), source.text, source.name)).toBeNull()
  })

  it('refuses a valid document and invalid JSON without a trailing comma', () => {
    expect(proposeJsonTrailingCommaFix(fakeFinding(), '{"a": 1}\n', 'data/config.json')).toBeNull()
    expect(proposeJsonTrailingCommaFix(fakeFinding(), '{"a": }\n', 'data/config.json')).toBeNull()
  })

  it('is idempotent: the fixed file parses, so nothing is proposed again', () => {
    const source = entry('{"a": [1,2,],}\n')
    const candidate = proposeJsonTrailingCommaFix(jsonFinding(source), source.text, source.name)
    const fixed = entry(applyEdits(source.text, candidate?.edits ?? []))
    expect(analyzeEntries([fixed]).files[0].findings.filter((hit) => hit.ruleId === JSON_RULE)).toHaveLength(0)
    expect(proposeJsonTrailingCommaFix(fakeFinding(), fixed.text, fixed.name)).toBeNull()
  })
})
