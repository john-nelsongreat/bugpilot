import { describe, expect, it } from 'vitest'
import type { FileAnalysis } from '../analysis/engine'
import { makeFinding } from '../analysis/finding'
import type { AnalyzerFinding } from '../types'
import { applyInlineWaivers, WAIVER_TOKEN, type WaiverSource } from './waivers'

const TODO = 'bugpilot/generic/todo-marker'
const EMPTY_CATCH = 'bugpilot/ast/empty-catch'
const MAGIC_NUMBER = 'bugpilot/ast/magic-number'
const ENV_FILE = 'bugpilot/sensitive/env-file'
const AWS_KEY = 'bugpilot/secret/aws-access-key'

function finding(file: string, ruleId: string, startLine: number): AnalyzerFinding {
  return makeFinding({
    ruleId,
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: 'Low',
    confidence: { level: 'low', reason: 'Test finding.' },
    file,
    range: { startLine, startColumn: 1, endLine: startLine, endColumn: 2 },
    evidence: [],
    message: 'Test finding.',
    explanation: 'Test finding.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

function analysis(file: string, findings: AnalyzerFinding[]): FileAnalysis {
  return {
    file,
    findings,
    notes: ['The rules checked this file.'],
    rulesRan: [TODO, EMPTY_CATCH],
    stoppedEarly: false,
  }
}

function source(name: string, text: string): WaiverSource {
  return { name, text }
}

function pragma(ids: string): string {
  return `// ${WAIVER_TOKEN} ${ids}`
}

function ruleIds(kept: FileAnalysis[]): string[] {
  return kept.flatMap((item) => item.findings.map((found) => found.ruleId))
}

describe('inline pragma waivers', () => {
  it('waives a finding on the pragma line', () => {
    const text = `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])],
      [source('src/a.ts', text)],
    )

    expect(out.analyses[0]?.findings).toHaveLength(0)
    expect(out.waived).toBe(1)
    expect(out.refused).toBe(0)
  })

  it('waives a finding on the line below the pragma', () => {
    const text = `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\nconst y = 1\n`
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 2)])],
      [source('src/a.ts', text)],
    )

    expect(out.analyses[0]?.findings).toHaveLength(0)
    expect(out.waived).toBe(1)
  })

  it('does not reach past the line below', () => {
    const text = `${pragma(EMPTY_CATCH)}\nconst a = 1\nconst b = 2\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 4)])],
      [source('src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([EMPTY_CATCH])
    expect(out.waived).toBe(0)
    expect(out.summary).toBeNull()
  })

  it('ignores a token in a string whose id is glued to the closing quote', () => {
    const text = `const x = '${WAIVER_TOKEN} ${EMPTY_CATCH}'\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])],
      [source('src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([EMPTY_CATCH])
    expect(out.waived).toBe(0)
    expect(out.summary).toBeNull()
  })

  it('ignores a pragma with no opener even when its id matches exactly', () => {
    const text = `const x = ${WAIVER_TOKEN} ${EMPTY_CATCH}\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])],
      [source('src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([EMPTY_CATCH])
    expect(out.waived).toBe(0)
  })

  it('counts an opener inside a string when the id ends the line', () => {
    const text = 'const t = `// ' + WAIVER_TOKEN + ' ' + EMPTY_CATCH + '\nconst b = 2\n'
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])],
      [source('src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([])
    expect(out.waived).toBe(1)
  })

  it('does not count an id inside a string that ends on its closing quote', () => {
    const text = `const s = "// ${WAIVER_TOKEN} ${EMPTY_CATCH}"\nconst b = 2\n`
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])],
      [source('src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([EMPTY_CATCH])
    expect(out.waived).toBe(0)
  })

  it('waives only the named rule', () => {
    const text = `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers(
      [
        analysis('src/a.ts', [
          finding('src/a.ts', EMPTY_CATCH, 2),
          finding('src/a.ts', MAGIC_NUMBER, 2),
        ]),
      ],
      [source('src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([MAGIC_NUMBER])
    expect(out.waived).toBe(1)
  })

  it('accepts a comma-separated list', () => {
    const text = `${pragma(`${EMPTY_CATCH},${MAGIC_NUMBER}`)}\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers(
      [
        analysis('src/a.ts', [
          finding('src/a.ts', EMPTY_CATCH, 2),
          finding('src/a.ts', MAGIC_NUMBER, 2),
          finding('src/a.ts', TODO, 2),
        ]),
      ],
      [source('src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([TODO])
    expect(out.waived).toBe(2)
  })

  it('refuses a sensitive rule and discloses the refusal', () => {
    const text = `${pragma(ENV_FILE)}\nAPI_KEY=abc\n`
    const out = applyInlineWaivers(
      [analysis('.env', [finding('.env', ENV_FILE, 2)])],
      [source('.env', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([ENV_FILE])
    expect(out.waived).toBe(0)
    expect(out.refused).toBe(1)
    expect(out.summary).toContain('1 waiver was refused')
  })

  it('refuses a content-derived secret rule and discloses the refusal', () => {
    const text = `${pragma(AWS_KEY)}\nconst key = 'AKIAIOSFODNN7EXAMPLE'\n`
    const out = applyInlineWaivers(
      [analysis('src/aws.js', [finding('src/aws.js', AWS_KEY, 2)])],
      [source('src/aws.js', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([AWS_KEY])
    expect(out.waived).toBe(0)
    expect(out.refused).toBe(1)
    expect(out.summary).toContain('cannot be silenced by a comment')
  })

  it('keeps the analysis entry when its last finding is waived', () => {
    const before = analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])
    const text = `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers([before], [source('src/a.ts', text)])
    const after = out.analyses[0]

    expect(out.analyses).toHaveLength(1)
    expect(after?.findings).toEqual([])
    expect(after?.rulesRan).toEqual(before.rulesRan)
    expect(after?.notes).toEqual(before.notes)
    expect(after?.stoppedEarly).toBe(false)
    expect(out.summary).toContain('1 finding was waived')
  })

  it('applies nothing when the entry name does not match the finding file', () => {
    const text = `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\n`
    const out = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])],
      [source('./src/a.ts', text)],
    )

    expect(ruleIds(out.analyses)).toEqual([EMPTY_CATCH])
    expect(out.waived).toBe(0)
    expect(out.refused).toBe(0)
    expect(out.summary).toBeNull()
  })

  it('says the count in the sentence in both singular and plural', () => {
    const one = applyInlineWaivers(
      [analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)])],
      [source('src/a.ts', `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\n`)],
    )
    const two = applyInlineWaivers(
      [
        analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 1)]),
        analysis('src/b.ts', [finding('src/b.ts', EMPTY_CATCH, 1)]),
      ],
      [
        source('src/a.ts', `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\n`),
        source('src/b.ts', `${pragma(EMPTY_CATCH)}\ntry { run() } catch (e) {}\n`),
      ],
    )

    expect(one.waived).toBe(1)
    expect(one.summary).toContain('1 finding was waived')
    expect(one.summary).not.toContain('1 findings were waived')
    expect(two.waived).toBe(2)
    expect(two.summary).toContain('2 findings were waived')
    expect(two.summary).not.toContain('2 finding was waived')
  })

  it('adds no sentence when nothing was waived', () => {
    const out = applyInlineWaivers(
      [
        analysis('src/a.ts', [finding('src/a.ts', EMPTY_CATCH, 3)]),
        analysis('src/clean.ts', []),
      ],
      [
        source('src/a.ts', `${pragma(MAGIC_NUMBER)}\nconst a = 1\nconst b = 2\ntry { run() } catch (e) {}\n`),
        source('src/clean.ts', `${pragma(EMPTY_CATCH)}\nconst clean = 1\n`),
      ],
    )

    expect(out.waived).toBe(0)
    expect(out.refused).toBe(0)
    expect(out.summary).toBeNull()
    expect(ruleIds(out.analyses)).toEqual([EMPTY_CATCH])
  })
})
