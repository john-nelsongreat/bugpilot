import { describe, expect, it } from 'vitest'
import { makeRuleFile } from '../rules/context'
import type { RuleFile } from '../rules/types'
import type { GrammarId } from './assets'
import { AST_RULES } from './astQueries'
import {
  evaluateAstRule,
  evaluateAstRules,
  type AstMatchLike,
  type AstRuleDefinition,
} from './astRules'

const python: GrammarId = 'python'

// Assembled at run time from fragments so no file in the repository carries a
// credential-shaped literal (GitHub push protection treats one as a real leak).
const FAKE_GITHUB = ['gh', 'p_', 'K7mN2pQ9rS4tV6wX8yZ1', 'aB3cD5eF7gH9jK2mN4pQ6'].join('')
const CREDENTIAL_LINE = `password = "${FAKE_GITHUB}"`

function fileOf(text: string): RuleFile {
  return makeRuleFile({
    name: 'handler.py',
    text,
    language: 'python',
    languageSource: 'extension',
    encoding: 'utf-8',
  })
}

function capture(name: string, text: string, options: Partial<{ row: number; column: number; endRow: number; endColumn: number; type: string; startIndex: number; parent: AstMatchLike['captures'][number]['node'] | null; hasError: boolean }> = {}) {
  return {
    name,
    node: {
      type: options.type ?? 'block',
      text,
      startIndex: options.startIndex ?? 0,
      endIndex: (options.startIndex ?? 0) + text.length,
      startPosition: { row: options.row ?? 0, column: options.column ?? 0 },
      endPosition: { row: options.endRow ?? options.row ?? 0, column: options.endColumn ?? (options.column ?? 0) + text.length },
      parent: options.parent,
      hasError: options.hasError,
    },
  }
}

function baseRule(overrides: Partial<AstRuleDefinition> = {}): AstRuleDefinition {
  return {
    id: 'bugpilot/ast/test-rule',
    title: 'Test rule',
    severity: 'Medium',
    confidence: 'high',
    grammar: python,
    query: '(except_clause) @ex',
    require: ['ex'],
    message: 'Handler at @ex@ swallows the error.',
    explanation: 'The tree shows an empty handler.',
    limitations: ['The rule reads the tree, not the program.'],
    verificationSteps: ['Open the line and decide.'],
    fixExplanation: 'Log or re-raise.',
    fixWhereItMayApply: 'Handlers that must not be silent.',
    ...overrides,
  }
}

function matches(...captures: AstMatchLike['captures'][]): AstMatchLike[] {
  return captures.map((list) => ({ patternIndex: 0, captures: list }))
}

describe('AST rule evaluator', () => {
  it('ignores a rule written for another grammar', () => {
    const hits = evaluateAstRule(baseRule({ grammar: 'java' }), {
      file: fileOf('try:\n    pass\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', 'except:')]),
      maxHits: 10,
    })
    expect(hits).toEqual([])
  })

  it('turns a match into a finding that describes the tree', () => {
    const [hit] = evaluateAstRule(baseRule(), {
      file: fileOf('try:\n    call()\nexcept ValueError:\n    pass\n'),
      grammar: python,
      runQuery: () =>
        matches([capture('ex', 'except ValueError:', { row: 2, column: 0, endRow: 3, endColumn: 0 })]),
      maxHits: 10,
    })
    expect(hit.ruleId).toBe('bugpilot/ast/test-rule')
    expect(hit.engine).toBe('tree-sitter')
    expect(hit.tier).toBe('pattern')
    expect(hit.severity).toBe('Medium')
    expect(hit.confidence).toEqual({ level: 'high', reason: 'The tree shows an empty handler.' })
    expect(hit.message).toBe('Handler at except ValueError: swallows the error.')
    expect(hit.range).toEqual({ startLine: 3, startColumn: 1, endLine: 4, endColumn: 1 })
    expect(hit.fix?.riskClass).toBe('manual-only')
    expect(hit.fix?.exampleCode).toBe('')
    expect(hit.limitations).toContain('The rule reads the tree, not the program.')
  })

  it('drops a match when a required capture is missing', () => {
    const hits = evaluateAstRule(baseRule({ require: ['ex', 'body'] }), {
      file: fileOf('x = 1\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', 'except:')]),
      maxHits: 10,
    })
    expect(hits).toEqual([])
  })

  it('anchors on the capture the rule names, not the first one', () => {
    const hits = evaluateAstRule(baseRule({ anchor: 'body' }), {
      file: fileOf('a\nb\nc\nd\n'),
      grammar: python,
      runQuery: () =>
        matches([capture('ex', 'except:', { row: 0 }), capture('body', 'pass', { row: 3, column: 4 })]),
      maxHits: 10,
    })
    expect(hits[0].range.startLine).toBe(4)
    expect(hits[0].range.startColumn).toBe(5)
  })

  it('never reports a comment as the bug it resembles', () => {
    const rule = baseRule({ rejectAnchorTypes: ['comment'] })
    const asComment = evaluateAstRule(rule, {
      file: fileOf('# except: pass\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', '# except: pass', { type: 'comment' })]),
      maxHits: 10,
    })
    const asCode = evaluateAstRule(rule, {
      file: fileOf('except:\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', 'except:', { type: 'except_clause' })]),
      maxHits: 10,
    })
    expect(asComment).toEqual([])
    expect(asCode).toHaveLength(1)
  })

  it('applies must and mustNot guards to the named capture', () => {
    const withGuard = baseRule({ checks: [{ capture: 'ex', pattern: '^except[ \\t]*:', when: 'must' }] })
    const bare = evaluateAstRule(withGuard, {
      file: fileOf('except:\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', 'except:')]),
      maxHits: 10,
    })
    const typed = evaluateAstRule(withGuard, {
      file: fileOf('except ValueError:\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', 'except ValueError:')]),
      maxHits: 10,
    })
    expect(bare).toHaveLength(1)
    expect(typed).toEqual([])

    const negative = baseRule({ checks: [{ capture: 'ex', pattern: 'cursor', when: 'mustNot' }] })
    expect(
      evaluateAstRule(negative, {
        file: fileOf('q = cur\n'),
        grammar: python,
        runQuery: () => matches([capture('ex', 'cursor.execute(q)')]),
        maxHits: 10,
      }),
    ).toEqual([])
    expect(
      evaluateAstRule(negative, {
        file: fileOf('q = 1\n'),
        grammar: python,
        runQuery: () => matches([capture('ex', 'conn.execute(q)')]),
        maxHits: 10,
      }),
    ).toHaveLength(1)
  })

  it('treats an unprovable must guard as a miss and an absent mustNot guard as a pass', () => {
    const missingCapture = evaluateAstRule(
      baseRule({ checks: [{ capture: 'absent', pattern: 'x', when: 'must' }] }),
      {
        file: fileOf('a\n'),
        grammar: python,
        runQuery: () => matches([capture('ex', 'except:')]),
        maxHits: 10,
      },
    )
    const missingNegative = evaluateAstRule(
      baseRule({ checks: [{ capture: 'absent', pattern: 'x', when: 'mustNot' }] }),
      {
        file: fileOf('a\n'),
        grammar: python,
        runQuery: () => matches([capture('ex', 'except:')]),
        maxHits: 10,
      },
    )
    expect(missingCapture).toEqual([])
    expect(missingNegative).toHaveLength(1)
  })

  it('drops a match whose guard regex cannot compile instead of crashing the run', () => {
    const hits = evaluateAstRule(
      baseRule({ checks: [{ capture: 'ex', pattern: '(unbalanced', when: 'must' }] }),
      {
        file: fileOf('a\n'),
        grammar: python,
        runQuery: () => matches([capture('ex', 'except:')]),
        maxHits: 10,
      },
    )
    expect(hits).toEqual([])
  })

  it('reports nothing when the grammar rejects the query', () => {
    const hits = evaluateAstRule(baseRule(), {
      file: fileOf('a\n'),
      grammar: python,
      runQuery: () => {
        throw new Error('Bad syntax')
      },
      maxHits: 10,
    })
    expect(hits).toEqual([])
  })

  it('keeps one finding per position even when two patterns overlap', () => {
    const hits = evaluateAstRule(baseRule(), {
      file: fileOf('except:\n'),
      grammar: python,
      runQuery: () => [
        ...matches([capture('ex', 'except:')]),
        ...matches([capture('ex', 'except:')]),
      ],
      maxHits: 10,
    })
    expect(hits).toHaveLength(1)
  })

  it('stops at the per-file cap', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      capture('ex', 'except:', { row: index, column: index }),
    )
    const hits = evaluateAstRule(baseRule(), {
      file: fileOf('x\n'.repeat(40)),
      grammar: python,
      runQuery: () => many.map((one) => ({ patternIndex: 0, captures: [one] })),
      maxHits: 5,
    })
    expect(hits).toHaveLength(5)
  })

  it('runs the whole table for one grammar and stops when the cap is reached', () => {
    const one = baseRule({ id: 'bugpilot/ast/a' })
    const two = baseRule({ id: 'bugpilot/ast/b' })
    const otherGrammar = baseRule({ id: 'bugpilot/ast/c', grammar: 'go' })
    const hits = evaluateAstRules([one, two, otherGrammar], {
      file: fileOf('except:\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', 'except:')]),
      maxHits: 10,
    })
    expect(hits.map((hit) => hit.ruleId)).toEqual(['bugpilot/ast/a', 'bugpilot/ast/b'])

    const capped = evaluateAstRules([one, two], {
      file: fileOf('except:\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', 'except:')]),
      maxHits: 1,
    })
    expect(capped).toHaveLength(1)
  })

  it('redacts a credential-shaped capture before quoting it', () => {
    const hits = evaluateAstRule(baseRule({ message: 'Found @ex@' }), {
      file: fileOf(`${CREDENTIAL_LINE}\n`),
      grammar: python,
      runQuery: () => matches([capture('ex', CREDENTIAL_LINE)]),
      maxHits: 10,
    })
    expect(hits[0].evidence[0].quote).not.toContain(FAKE_GITHUB)
    expect(hits[0].message).not.toContain(FAKE_GITHUB)
    expect(hits[0].message).toContain('redacted')
  })

  it('collapses a multiline capture and truncates a very long one in the message', () => {
    const long = `except ${'w'.repeat(120)}:`
    const hits = evaluateAstRule(baseRule({ message: 'Found @ex@' }), {
      file: fileOf('a\nb\n'),
      grammar: python,
      runQuery: () => matches([capture('ex', `except   ValueError:\n    ${long}`)]),
      maxHits: 10,
    })
    expect(hits[0].message).not.toContain('\n')
    expect(hits[0].message.length).toBeLessThan(140)
    expect(hits[0].message).toContain('…')
  })
})

/** One shipped rule per AST family, with captures that pass the rule's own guards. */
const FAMILY_FIXTURES: readonly { id: string; grammar: GrammarId; captures: AstMatchLike['captures'] }[] = [
  { id: 'bugpilot/ast/empty-catch', grammar: 'python', captures: [capture('ex', 'except ValueError: pass')] },
  { id: 'bugpilot/ast/unreachable-code', grammar: 'c', captures: [capture('after', 'free(p);')] },
  { id: 'bugpilot/ast/assignment-in-condition', grammar: 'c', captures: [capture('cond', 'n = count()')] },
  { id: 'bugpilot/ast/python-bare-except', grammar: 'python', captures: [capture('ex', 'except:')] },
  {
    id: 'bugpilot/ast/sql-built-by-concatenation',
    grammar: 'python',
    captures: [capture('method', 'execute'), capture('arg', '"SELECT * FROM t WHERE id = " + user_id')],
  },
]

function familyRule(id: string, grammar: GrammarId): AstRuleDefinition {
  const rule = AST_RULES.find((candidate) => candidate.id === id && candidate.grammar === grammar)
  if (!rule) throw new Error(`missing shipped rule ${id} for ${grammar}`)
  return rule
}

describe('AST rules distrust trees with syntax errors', () => {
  for (const family of FAMILY_FIXTURES) {
    describe(family.id, () => {
      const rule = familyRule(family.id, family.grammar)

      it('keeps normal confidence on a clean tree', () => {
        const [hit] = evaluateAstRule(rule, {
          file: fileOf('x = 1\n'),
          grammar: family.grammar,
          runQuery: () => matches(family.captures),
          maxHits: 10,
        })
        expect(hit.confidence.level).toBe(rule.confidence)
        expect(hit.confidence.reason).toBe(rule.explanation)
      })

      it('caps a surviving hit at low confidence with the syntax-error reason', () => {
        const captures = family.captures.map((one) => ({
          ...one,
          node: {
            ...one.node,
            startIndex: 5,
            endIndex: 5 + one.node.text.length,
            parent: { type: 'declaration', text: '', startIndex: 0, endIndex: 0, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, parent: { type: 'root', text: '', startIndex: 0, endIndex: 0, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, parent: null } },
          },
        }))
        const [hit] = evaluateAstRule(rule, {
          file: fileOf('x = 1\n'),
          grammar: family.grammar,
          runQuery: () => matches(captures),
          maxHits: 10,
          firstErrorIndex: 500,
        })
        expect(hit).toBeDefined()
        expect(hit.confidence).toEqual({
          level: 'low',
          reason: 'This file has syntax errors, so structural checks may be unreliable.',
        })
      })

      it('drops a hit at or after the first error position', () => {
        const captures = family.captures.map((one) => ({
          ...one,
          node: { ...one.node, startIndex: 500, endIndex: 500 + one.node.text.length },
        }))
        expect(
          evaluateAstRule(rule, {
            file: fileOf('x = 1\n'),
            grammar: family.grammar,
            runQuery: () => matches(captures),
            maxHits: 10,
            firstErrorIndex: 500,
          }),
        ).toEqual([])
      })

      it('drops a hit whose top-level declaration contains the error node', () => {
        const root = { type: 'root', text: '', startIndex: 0, endIndex: 0, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, parent: null }
        const damagedDeclaration = { type: 'declaration', text: '', startIndex: 0, endIndex: 0, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, parent: root, hasError: true }
        const captures = family.captures.map((one) => ({
          ...one,
          node: {
            ...one.node,
            startIndex: 5,
            endIndex: 5 + one.node.text.length,
            parent: damagedDeclaration,
          },
        }))
        expect(
          evaluateAstRule(rule, {
            file: fileOf('x = 1\n'),
            grammar: family.grammar,
            runQuery: () => matches(captures),
            maxHits: 10,
            firstErrorIndex: 500,
          }),
        ).toEqual([])
      })
    })
  }
})
