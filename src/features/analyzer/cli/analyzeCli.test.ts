import { describe, expect, it } from 'vitest'
import { buildArchiveEntry, formatFindingsJson, formatFindingsText, parseArgs } from './analyzeCli'
import type { EngineRunResult } from '../engines/protocol'

function sampleResult(): EngineRunResult {
  return {
    files: [
      {
        file: 'a.py',
        hits: [
          {
            ruleId: 'ruff/F401',
            engine: 'ruff',
            tier: 'pattern',
            severity: 'Low',
            confidence: { level: 'high', reason: 'Ruff rule F401 reports the finding.' },
            range: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 10 },
            evidence: [],
            message: '`os` imported but unused (F401)',
            explanation: 'Ruff rule F401 fired.',
            fix: null,
            verificationSteps: [],
            limitations: [],
          },
        ],
        enginesRan: ['tree-sitter', 'ruff'],
        parse: 'parsed',
        notes: ['a note'],
      },
    ],
    filesNotRun: ['b.rb'],
    cancelled: false,
    unavailable: null,
  }
}

describe('parseArgs', () => {
  it('collects paths without flags', () => {
    expect(parseArgs(['a.py', 'b.go'])).toEqual({ paths: ['a.py', 'b.go'], json: false })
  })

  it('accepts --json in any position', () => {
    expect(parseArgs(['--json', 'a.py'])).toEqual({ paths: ['a.py'], json: true })
    expect(parseArgs(['a.py', '--json'])).toEqual({ paths: ['a.py'], json: true })
  })

  it('refuses an empty invocation with the usage line', () => {
    const parsed = parseArgs([])
    expect('error' in parsed && parsed.error).toMatch(/Usage: npm run analyze --/)
  })

  it('names an unknown option instead of guessing', () => {
    const parsed = parseArgs(['a.py', '--wat'])
    expect('error' in parsed && parsed.error).toMatch(/--wat/)
  })
})

describe('buildArchiveEntry', () => {
  it('classifies a Python file by extension and counts its bytes', () => {
    const entry = buildArchiveEntry('app.py', Buffer.from('import os\nx = 1\n', 'utf8'))
    expect(entry.language).toBe('python')
    expect(entry.languageSource).toBe('extension')
    expect(entry.encoding).toBe('utf-8')
    expect(entry.bytes).toBe(16)
    expect(entry.name).toBe('app.py')
  })

  it('strips a UTF-8 BOM and records that it did', () => {
    const entry = buildArchiveEntry('app.py', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x = 1\n', 'utf8')]))
    expect(entry.text.startsWith('\uFEFF')).toBe(false)
    expect(entry.text).toBe('x = 1\n')
    expect(entry.encoding).toBe('utf-8-bom')
  })

  it('falls back to the shebang when the extension says nothing', () => {
    const entry = buildArchiveEntry('tool.run', Buffer.from('#!/bin/sh\necho hi\n', 'utf8'))
    expect(entry.language).toBe('shell')
    expect(entry.languageSource).toBe('shebang')
  })

  it('reports the unknown fallback for an unrecognised file', () => {
    const entry = buildArchiveEntry('data.zyx', Buffer.from('plain words only\n', 'utf8'))
    expect(entry.language).toBe('unknown')
    expect(entry.languageSource).toBe('fallback')
  })
})

describe('formatFindingsText', () => {
  it('prints one finding line with position, severity, rule and message', () => {
    const text = formatFindingsText(sampleResult())
    expect(text).toContain('  1:8 Low [ruff/F401] `os` imported but unused (F401)')
  })

  it('prints the parse line with engines, the notes, and the summary', () => {
    const text = formatFindingsText(sampleResult())
    expect(text).toContain('a.py: parsed (engines: tree-sitter, ruff)')
    expect(text).toContain('  note: a note')
    expect(text).toContain('files: 1, findings: 1, notes: 1')
  })

  it('records files the run never reached', () => {
    const text = formatFindingsText(sampleResult())
    expect(text).toContain('b.rb: not run')
  })
})

describe('formatFindingsJson', () => {
  it('emits the engine result document unchanged in shape', () => {
    const parsed = JSON.parse(formatFindingsJson(sampleResult())) as EngineRunResult
    expect(Object.keys(parsed).sort()).toEqual(['cancelled', 'files', 'filesNotRun', 'unavailable'])
    expect(parsed.files[0].file).toBe('a.py')
    expect(parsed.files[0].hits[0].ruleId).toBe('ruff/F401')
    expect(parsed.filesNotRun).toEqual(['b.rb'])
  })
})
