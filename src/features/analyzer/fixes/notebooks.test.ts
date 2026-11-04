import { describe, expect, it } from 'vitest'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerFinding } from '../types'
import { proposeFix } from './proposeFix'

function source(name: string): ArchiveEntry {
  return {
    name,
    text: 'fetch("http://api.example-service.test/data")\n',
    language: 'javascript',
    languageSource: 'content',
    encoding: 'utf-8',
    bytes: 40,
  }
}

function finding(file: string): AnalyzerFinding {
  return {
    id: 'f-url',
    file,
    ruleId: 'bugpilot/generic/insecure-http-url',
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: 'Low',
    confidence: { level: 'medium', reason: 'Fixture.' },
    range: { startLine: 1, startColumn: 7, endLine: 1, endColumn: 44 },
    evidence: [],
    message: 'Literal URL uses the http scheme.',
    explanation: 'Fixture explanation.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  }
}

/**
 * A notebook cell is a virtual file: there is no file on disk to patch, and the brief keeps
 * notebook fixes manual. A rule that would fix an ordinary file must offer nothing here.
 */
describe('fixes for notebook cells', () => {
  it('never proposes a candidate for a cell, an output or the notebook document itself', () => {
    const cell = source('nb.ipynb#cell-1')
    const output = source('nb.ipynb#cell-1.output-1')
    const raw = source('nb.ipynb')

    expect(proposeFix(finding(cell.name), cell)).toBeNull()
    expect(proposeFix(finding(output.name), output)).toBeNull()
    expect(proposeFix(finding(raw.name), raw)).toBeNull()
  })
})
