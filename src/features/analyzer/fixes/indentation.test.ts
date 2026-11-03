import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import { analyzeEntries } from '../analysis/engine'
import { proposeMixedIndentationFix } from './indentation'
import { applyEdits } from './text'

const INDENT_RULE = 'bugpilot/generic/mixed-indentation'

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

function mixedFinding(source: ArchiveEntry) {
  const finding = analyzeEntries([source]).files[0].findings.find((item) => item.ruleId === INDENT_RULE)
  if (!finding) throw new Error('Expected a mixed indentation finding')
  return finding
}

describe('mixed indentation fix', () => {
  it('rewrites the minority tab lines to the dominant space width', () => {
    const source = entry(
      'src/app.js',
      'const a = 1\n    const b = 2\n    const c = 3\n\tconst d = 4\n',
    )
    const candidate = proposeMixedIndentationFix(mixedFinding(source), source.text, source.language, source.name)

    expect(candidate?.riskClass).toBe('needs-review')
    expect(candidate?.behaviourChange).toBe(true)
    expect(candidate?.edits).toHaveLength(1)
    const fixed = applyEdits(source.text, candidate?.edits ?? [])
    expect(fixed).toBe('const a = 1\n    const b = 2\n    const c = 3\n    const d = 4\n')
    expect(analyzeEntries([entry(source.name, fixed)]).files[0].findings.filter((hit) => hit.ruleId === INDENT_RULE)).toHaveLength(0)
  })

  it('rewrites the minority space lines to tabs when tabs dominate', () => {
    const source = entry(
      'src/app.js',
      '\tconst a = 1\n\tconst b = 2\n  const c = 3\n',
    )
    const candidate = proposeMixedIndentationFix(mixedFinding(source), source.text, source.language, source.name)
    const fixed = applyEdits(source.text, candidate?.edits ?? [])
    expect(fixed).toBe('\tconst a = 1\n\tconst b = 2\n\tconst c = 3\n')
  })

  it('adds a stronger warning for Python and YAML', () => {
    const python = entry('app.py', 'def run():\n    a = 1\n    b = 2\n\tc = 3\n')
    const pythonCandidate = proposeMixedIndentationFix(mixedFinding(python), python.text, python.language, python.name)
    expect(pythonCandidate?.warnings.join(' ')).toContain('Python uses indentation to define blocks')

    const yaml = entry('config.yaml', 'root:\n  a: 1\n  b: 2\n\tc: 3\n')
    const yamlCandidate = proposeMixedIndentationFix(mixedFinding(yaml), yaml.text, yaml.language, yaml.name)
    expect(yamlCandidate?.warnings.join(' ')).toContain('YAML uses indentation to define structure')
  })

  it('refuses a tie between tab-led and space-led lines', () => {
    const source = entry('src/app.js', '\tconst a = 1\n  const b = 2\n')
    expect(proposeMixedIndentationFix(mixedFinding(source), source.text, source.language, source.name)).toBeNull()
  })

  it('does nothing when only one style is present', () => {
    const source = entry('src/app.js', '    const a = 1\n    const b = 2\n')
    expect(analyzeEntries([source]).files[0].findings.filter((hit) => hit.ruleId === INDENT_RULE)).toHaveLength(0)
  })

  it('is idempotent', () => {
    const source = entry('src/app.js', 'const a = 1\n    const b = 2\n    const c = 3\n\tconst d = 4\n')
    const candidate = proposeMixedIndentationFix(mixedFinding(source), source.text, source.language, source.name)
    const fixed = entry(source.name, applyEdits(source.text, candidate?.edits ?? []))
    const after = analyzeEntries([fixed]).files[0].findings.filter((hit) => hit.ruleId === INDENT_RULE)
    expect(after).toHaveLength(0)
    expect(proposeMixedIndentationFix(mixedFinding(entry(source.name, source.text)), fixed.text, fixed.language, fixed.name)).toBeNull()
  })
})
