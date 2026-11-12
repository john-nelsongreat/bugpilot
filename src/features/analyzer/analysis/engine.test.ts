import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerRule, RuleFile, RuleHit } from '../rules/types'
import { analyzeEntries } from './engine'

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: new TextEncoder().encode(text).length,
  }
}

function ruleHit(message: string, line = 1): RuleHit {
  return {
    range: { startLine: line, startColumn: 1, endLine: line, endColumn: 5 },
    message,
    explanation: 'Test explanation.',
    confidence: { level: 'medium', reason: 'Test reason.' },
    evidence: [{ source: 'code snippet', label: `Line ${line}`, quote: 'test', lineNumber: line }],
  }
}

function testRule(id: string, check: (file: RuleFile) => RuleHit[]): AnalyzerRule {
  return {
    id,
    title: `Test rule ${id}`,
    tier: 'pattern',
    severity: 'Medium',
    languages: ['javascript'],
    description: 'A rule used by the engine tests.',
    check,
  }
}

describe('analysis engine', () => {
  it('analyses each file with the rules for its language and keeps deterministic ids', () => {
    const entries = [entry('src/app.js', '// TODO: tidy this up\n'), entry('data/bad.json', '{"a": 1,,}')]
    const first = analyzeEntries(entries)
    const second = analyzeEntries(entries)

    expect(first.cancelled).toBe(false)
    expect(first.files.map((file) => file.file)).toEqual(['src/app.js', 'data/bad.json'])
    expect(first.files[0].findings.map((finding) => finding.ruleId)).toContain('bugpilot/generic/todo-marker')
    expect(first.files[1].findings.map((finding) => finding.ruleId)).toContain('bugpilot/syntax/json')
    expect(first.files[0].findings[0].id).toBe(second.files[0].findings[0].id)
    expect(first.files[0].findings[0].id).toMatch(/^f-[0-9a-f]{8}-\d+$/)
    expect(first.files[0].findings[0].analyzer).toBe('bugpilot-rules')
    expect(first.files[0].rulesRan.length).toBeGreaterThan(0)
  })

  it('orders findings by line, column and severity', () => {
    const rules = [
      testRule('test/later', () => [ruleHit('later', 5)]),
      testRule('test/early-low', () => [{ ...ruleHit('early', 2), severity: 'Low' }]),
      testRule('test/early-high', () => [{ ...ruleHit('early high', 2), severity: 'High' }]),
    ]
    const [file] = analyzeEntries([entry('src/app.js', 'const a = 1\n')], { rules }).files

    expect(file.findings.map((finding) => finding.message)).toEqual(['early high', 'early', 'later'])
  })

  it('keeps the other rules running when one rule crashes', () => {
    const rules = [
      testRule('test/crash', () => {
        throw new Error('synthetic rule failure')
      }),
      testRule('test/ok', () => [ruleHit('still found')]),
    ]
    const [file] = analyzeEntries([entry('src/app.js', 'x\n')], { rules }).files

    expect(file.findings.map((finding) => finding.message)).toEqual(['still found'])
    expect(file.notes.join(' ')).toMatch(/synthetic rule failure/)
    expect(file.notes.join(' ')).toMatch(/other rules still ran/)
    expect(file.rulesRan).toEqual(['test/ok'])
  })

  it('stops a file when its time budget is already spent', () => {
    const rules = [testRule('test/slow', () => [ruleHit('never')])]
    const [file] = analyzeEntries([entry('src/app.js', 'x\n')], {
      rules,
      limits: { perFileBudgetMs: 0 },
    }).files

    expect(file.findings).toHaveLength(0)
    expect(file.stoppedEarly).toBe(true)
    expect(file.notes.join(' ')).toMatch(/per-file budget/)
  })

  it('caps stored findings and says so', () => {
    const rules = [
      testRule('test/many', () => Array.from({ length: 5 }, (_, index) => ruleHit(`hit ${index}`, index + 1))),
    ]
    const [file] = analyzeEntries([entry('src/app.js', 'x\n')], {
      rules,
      limits: { maxFindingsPerFile: 3 },
    }).files

    expect(file.findings).toHaveLength(3)
    expect(file.notes.join(' ')).toMatch(/first 3 findings/)
    expect(file.stoppedEarly).toBe(true)
  })

  it('reports progress from zero to the file count', () => {
    const seen: string[] = []
    analyzeEntries([entry('src/a.js', 'x\n'), entry('src/b.py', 'y\n')], {
      onProgress: (progress) => seen.push(`${progress.filesDone}/${progress.filesTotal}`),
    })

    expect(seen).toEqual(['0/2', '1/2', '2/2'])
  })

  it('refuses an already cancelled run', () => {
    const controller = new AbortController()
    controller.abort()
    const result = analyzeEntries([entry('src/a.js', 'x\n')], { signal: controller.signal })

    expect(result.cancelled).toBe(true)
    expect(result.files).toEqual([])
  })

  it('discards everything when cancellation arrives between files', () => {
    const controller = new AbortController()
    const result = analyzeEntries([entry('src/a.js', 'x\n'), entry('src/b.js', 'y\n')], {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.filesDone === 1) controller.abort()
      },
    })

    expect(result.cancelled).toBe(true)
    expect(result.files).toEqual([])
  })

  it('maps secret findings to the existing severity scale', () => {
    const fakeAws = ['AKIA', 'Q7R2T9', 'MW4XZ8', 'B3N6'].join('')
    const [file] = analyzeEntries([entry('src/config.js', `const id = "${fakeAws}"\n`)]).files
    const secret = file.findings.find((finding) => finding.ruleId === 'bugpilot/secret/aws-access-key')

    expect(secret?.severity).toBe('Critical')
    expect(secret?.confidence.level).toBe('high')
    expect(secret?.fix?.riskClass).toBe('manual-only')
  })
})
