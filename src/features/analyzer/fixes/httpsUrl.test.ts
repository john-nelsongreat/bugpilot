import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import { analyzeEntries } from '../analysis/engine'
import { makeFinding } from '../analysis/finding'
import { proposeHttpsUrlFix } from './httpsUrl'
import { applyEdits } from './text'

const HTTP_RULE = 'bugpilot/generic/insecure-http-url'

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: text.length,
  }
}

function httpFinding(source: ArchiveEntry) {
  const finding = analyzeEntries([source]).files[0].findings.find((item) => item.ruleId === HTTP_RULE)
  if (!finding) throw new Error('Expected an insecure URL finding')
  return finding
}

describe('http to https fix', () => {
  it('replaces the scheme and asks for review', () => {
    const source = entry('src/api.js', 'fetch("http://api.widgets.dev/v1/items")\n')
    const candidate = proposeHttpsUrlFix(httpFinding(source), source.text, source.name)

    expect(candidate?.riskClass).toBe('needs-review')
    expect(candidate?.behaviourChange).toBe(true)
    const fixed = applyEdits(source.text, candidate?.edits ?? [])
    expect(fixed).toBe('fetch("https://api.widgets.dev/v1/items")\n')
    expect(analyzeEntries([entry(source.name, fixed)]).files[0].findings.filter((hit) => hit.ruleId === HTTP_RULE)).toHaveLength(0)
  })

  it('handles an uppercase scheme', () => {
    const source = entry('src/api.js', 'fetch("HTTP://api.widgets.dev/v1")\n')
    const fixed = applyEdits(source.text, proposeHttpsUrlFix(httpFinding(source), source.text, source.name)?.edits ?? [])
    expect(fixed).toBe('fetch("https://api.widgets.dev/v1")\n')
  })

  it('does not fire on local or documentation hosts', () => {
    const source = entry('src/api.js', 'fetch("http://localhost:8080/v1")\n')
    expect(analyzeEntries([source]).files[0].findings.filter((hit) => hit.ruleId === HTTP_RULE)).toHaveLength(0)
  })

  it('refuses a finding from another rule', () => {
    const finding = makeFinding({
      ruleId: 'bugpilot/generic/todo-marker',
      analyzer: 'bugpilot-rules',
      tier: 'pattern',
      severity: 'Low',
      confidence: { level: 'high', reason: 'test' },
      file: 'src/api.js',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
      evidence: [],
      message: 'test',
      explanation: 'test',
      fix: null,
      verificationSteps: [],
      limitations: [],
    })
    expect(proposeHttpsUrlFix(finding, 'fetch("http://api.widgets.dev")\n', 'src/api.js')).toBeNull()
  })

  it('is idempotent', () => {
    const source = entry('src/api.js', 'fetch("http://api.widgets.dev/v1")\n')
    const fixed = entry(source.name, applyEdits(source.text, proposeHttpsUrlFix(httpFinding(source), source.text, source.name)?.edits ?? []))
    const next = analyzeEntries([fixed]).files[0].findings.find((hit) => hit.ruleId === HTTP_RULE)
    expect(next).toBeUndefined()
  })
})
