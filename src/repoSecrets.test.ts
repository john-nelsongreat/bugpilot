// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ALLOWLIST,
  isAllowlisted,
  ruleFindings,
  scanRepository,
  trackedFiles,
  unquotedFindings,
  type Finding,
} from './repoSecretScan'

/**
 * Part of the ship gate: no credential-shaped literal may live in this repository. The scanner and
 * its reasoning are in `repoSecretScan.ts`; this file is the gate that CI runs.
 */

const started = Date.now()
const files = trackedFiles()
const findings: Finding[] = scanRepository()
const unknown = findings.filter((finding) => !isAllowlisted(finding))

function describeFinding(finding: Finding): string {
  return `${finding.file}:${finding.line} [${finding.ruleId}] ${finding.text}`
}

describe('repository secret scan', () => {
  it('really is repository-wide', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.filter((file) => file.startsWith('src/')).length).toBeGreaterThan(80)
  })

  it('finds no credential-shaped literal outside the allowlist', () => {
    expect(unknown.map(describeFinding).join('\n')).toBe('')
  })

  it('keeps every allowlist entry honest, justified and still matching', () => {
    const matched = new Set(findings.map((finding) => `${finding.file}|${finding.ruleId}`))
    expect(ALLOWLIST.filter((entry) => !matched.has(entry.key)).map((entry) => entry.key)).toEqual([])
    expect(ALLOWLIST.filter((entry) => entry.reason.trim().length < 20).map((entry) => entry.key)).toEqual([])
  })

  it('catches the literal that survived the previous audit', () => {
    const weak = ['hunt', 'er22'].join('')
    const key = ['gh', 'p_', 'K7mN2pQ9rS4tV6wX8yZ1', 'aB3cD5eF7gH9jK2mN4pQ6'].join('')
    // The exact old shape: a credential assignment nested inside a call, not at the line start.
    const oldFixture = `    expect(redactIfCredential('password = ${weak}')).toContain('redacted')`
    const caught = unquotedFindings('src/features/analyzer/engines/redact.test.ts', oldFixture)
    expect(caught.map((finding) => finding.ruleId)).toEqual(['repo/unquoted-credential-assignment'])
    expect(caught[0]?.text).not.toContain(weak)
    expect(unquotedFindings('app/config.py', `password = ${weak}`).length).toBe(1)
    expect(unquotedFindings('app/config.py', `  db_password: ${weak}`).length).toBe(1)
    expect(unquotedFindings('.env', `API_KEY=${key}`).length).toBeGreaterThan(0)
    expect(ruleFindings('.env', `API_KEY=${key}`).length).toBeGreaterThan(0)
    expect(ruleFindings('app/config.py', `api_key = "${key}"`).length).toBeGreaterThan(0)
    expect(ruleFindings('app/config.py', `api_key = "${key}"`)[0]?.line).toBe(1)
    expect(ruleFindings('a.py', `x = 1\napi_key = "${key}"`)[0]?.line).toBe(2)
    expect(ruleFindings('a.py', `x = 1\napi_key = "${key}"`)[0]?.text).not.toContain(key)
  })

  it('does not flag code, constants, type annotations or fragment-built fixtures', () => {
    for (const line of [
      'password = readFrom.vault()',
      'PASSWORD = DEFAULT_PASSWORD',
      'if (password === supplied) {',
      'const password = promptPassword()',
      'export const secretRules: readonly AnalyzerRule[] = [',
      'const SECRET_FINDING: DeepEngineRow = {',
      'password: string',
      'const apiKey = "${FAKE}"',
    ]) {
      expect(unquotedFindings('src/a.ts', line), line).toEqual([])
    }
    expect(ruleFindings('src/a.js', 'const apiKey = "${FAKE}"').length).toBe(0)
  })

  it('stays fast enough to run on every push', () => {
    expect(Date.now() - started).toBeLessThan(15_000)
  })
})
