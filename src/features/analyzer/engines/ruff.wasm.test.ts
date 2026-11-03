// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import initRuff, { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-web'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeRuleFile } from '../rules/context'
import type { RuleFile } from '../rules/types'
import { RUFF_SETTINGS, ruffHitToEngineHit, type RuffDiagnostic } from './ruff'

/**
 * Part 4 proved with the binary the app actually ships: the selected rule set is run over a
 * buggy file and a clean file, and every finding that comes back is checked through the same
 * mapping the worker uses. This is also the evidence behind "Python is detector-only": the
 * payload BugPilot reads carries no fix that could reach the clean export.
 */

const NODE_MODULES = resolve(process.cwd(), 'node_modules')
const RUFF_WASM = resolve(NODE_MODULES, '@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm')

const FAKE = ['K7mN', '2pQ9', 'rS4t', 'V6wX8yZ1'].join('')

const BUGGY = [
  'import os',
  'from typing import List',
  '',
  '',
  'def load(items: List[int] = []) -> int:',
  '    total = 0',
  '    password = "' + FAKE + '"',
  '    try:',
  '        for item in items:',
  '            total += item',
  '    except:',
  '        pass',
  '    return total',
  '',
].join('\n')

const CLEAN = ['def total(items: list[int]) -> int:', '    return sum(items)', ''].join('\n')

let workspace: Workspace | null = null

function check(code: string, file: RuleFile) {
  if (!workspace) throw new Error('Ruff was not initialised.')
  const result = workspace.check(code) as RuffDiagnostic[] | { diagnostics: RuffDiagnostic[] }
  const diagnostics = Array.isArray(result) ? result : result.diagnostics
  return {
    diagnostics,
    hits: diagnostics
      .map((diagnostic) => ruffHitToEngineHit(diagnostic, file))
      .filter((hit): hit is NonNullable<typeof hit> => hit !== null),
  }
}

function pythonFile(text: string): RuleFile {
  return makeRuleFile({
    name: 'sample.py',
    text,
    language: 'python',
    languageSource: 'extension',
    encoding: 'utf-8',
  })
}

describe('Ruff WebAssembly engine', () => {
  beforeAll(async () => {
    await initRuff({ module_or_path: new Uint8Array(readFileSync(RUFF_WASM)) })
    workspace = new Workspace(RUFF_SETTINGS, PositionEncoding.Utf16)
  }, 180_000)

  it('loads the shipped binary and reports its version', () => {
    expect(workspace).not.toBeNull()
    expect(Workspace.version()).toMatch(/^\d+\.\d+/)
  })

  it('finds the real defects in a buggy Python file', () => {
    const { hits } = check(BUGGY, pythonFile(BUGGY))
    const codes = hits.map((hit) => hit.ruleId)
    // Unused import, mutable default, bare except, swallowed error, unused variable,
    // hardcoded password.
    for (const expected of ['ruff/F401', 'ruff/B006', 'ruff/E722', 'ruff/S110', 'ruff/F841', 'ruff/S105']) {
      expect(codes, `missing ${expected} in ${JSON.stringify(codes)}`).toContain(expected)
    }
  })

  it('keeps every Python finding detector-only', () => {
    const { hits } = check(BUGGY, pythonFile(BUGGY))
    for (const hit of hits) {
      expect(hit.engine).toBe('ruff')
      expect(hit.tier).toBe('pattern')
      expect(hit.fix?.riskClass).toBe('manual-only')
      expect(hit.fix?.exampleCode).toBe('')
      expect(hit.message).toMatch(/\(([A-Z]+\d+|SyntaxError)\)$|^Syntax error: /)
      expect(hit.limitations.join(' ')).toContain('No automatic change is offered for Python')
      expect(hit.verificationSteps.join(' ')).toContain('ruff check')
    }
  })

  it('does not report a password value it found', () => {
    const { hits } = check(BUGGY, pythonFile(BUGGY))
    const secret = hits.find((hit) => hit.ruleId === 'ruff/S105')
    if (!secret) throw new Error(`No S105 finding in ${JSON.stringify(hits.map((hit) => hit.ruleId))}`)
    expect(secret.message).not.toContain(FAKE)
    expect(secret.evidence[0].quote).not.toContain(FAKE)
    expect(secret.severity).toBe('Critical')
    expect(secret.confidence.level).toBe('medium')
  })

  it('says nothing about a clean Python file', () => {
    const { hits } = check(CLEAN, pythonFile(CLEAN))
    expect(hits.map((hit) => hit.ruleId), JSON.stringify(hits.map((hit) => hit.message))).toEqual([])
  })

  it('turns a parse failure into one syntax finding', () => {
    const broken = 'def load(:\n    pass\n'
    const { hits } = check(broken, pythonFile(broken))
    expect(hits.length).toBeGreaterThan(0)
    const syntax = hits.find((hit) => hit.tier === 'syntax')
    if (!syntax) throw new Error(`No syntax-tier finding in ${JSON.stringify(hits.map((hit) => hit.message))}`)
    expect(syntax.severity).toBe('High')
    expect(syntax.message).toContain('Syntax error:')
  })

  it('points at the line it claims, not at the line after it', () => {
    const { hits } = check(BUGGY, pythonFile(BUGGY))
    const lines = BUGGY.split('\n')
    for (const hit of hits) {
      expect(hit.range.startLine).toBeGreaterThanOrEqual(1)
      expect(hit.range.startLine).toBeLessThanOrEqual(lines.length)
      const quoted = lines[hit.range.startLine - 1] ?? ''
      if (quoted.trim() !== '') expect(hit.evidence[0].lineNumber).toBe(hit.range.startLine)
    }
  })
})
