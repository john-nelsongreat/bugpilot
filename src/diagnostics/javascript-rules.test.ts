import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import {
  javascriptReferenceErrorRule,
  javascriptSyntaxErrorRule,
  javascriptTypeErrorRule,
} from './rules/javascript'
import type {
  DiagnosticRule,
  SupportedDiagnosticCategory,
} from './types'

interface PositiveCase {
  name: string
  rule: DiagnosticRule
  line: string
  category: SupportedDiagnosticCategory
}

const POSITIVE_CASES: PositiveCase[] = [
  {
    name: 'ReferenceError',
    rule: javascriptReferenceErrorRule,
    line: 'ReferenceError: cart is not defined',
    category: 'undefined-name',
  },
  {
    name: 'TypeError',
    rule: javascriptTypeErrorRule,
    line: "TypeError: Cannot read properties of undefined (reading 'name')",
    category: 'type-mismatch',
  },
  {
    name: 'SyntaxError',
    rule: javascriptSyntaxErrorRule,
    line: "SyntaxError: Unexpected token '<'",
    category: 'syntax-error',
  },
]

const LOOKALIKES: Array<[string, DiagnosticRule, string]> = [
  [
    'ReferenceError',
    javascriptReferenceErrorRule,
    "NameError: name 'cart' is not defined",
  ],
  [
    'TypeError',
    javascriptTypeErrorRule,
    "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
  ],
  [
    'SyntaxError',
    javascriptSyntaxErrorRule,
    'SyntaxError: invalid syntax',
  ],
]

describe('JavaScript diagnostic rules', () => {
  it.each(POSITIVE_CASES)(
    '$name produces a complete JavaScript diagnosis',
    ({ rule, line, category }) => {
      expect(rule.match(line)).not.toBeNull()

      const result = diagnose({ language: 'javascript', errorText: line })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).not.toBeNull()
      expect(result.likelyCause.trim()).not.toBe('')
      expect(result.evidence).toEqual([
        expect.objectContaining({
          source: 'error text',
          quote: line,
          lineNumber: 1,
        }),
      ])
      expect(result.debuggingSteps.length).toBeGreaterThan(0)
      expect(result.possibleFix).not.toBeNull()
      expect(result.possibleFix?.explanation.trim()).not.toBe('')
      expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
      expect(result.possibleFix?.exampleCode.trim()).not.toBe('')
      expect(result.verificationSteps.length).toBeGreaterThan(0)
      expect(result.confidence.level).not.toBe('low')
      expect(result.limitations.length).toBeGreaterThan(0)
      expect(result.alternativeExplanations.length).toBeGreaterThan(0)
    },
  )

  it.each(LOOKALIKES)(
    '%s does not match a nearby lookalike',
    (_name, rule, line) => {
      expect(rule.match(line)).toBeNull()
    },
  )

  it.each(POSITIVE_CASES)(
    '$name does not match a prose mention',
    ({ name, rule }) => {
      expect(
        rule.match(
          `A teammate mentioned ${name} while reviewing the log, but the exception line was omitted.`,
        ),
      ).toBeNull()
    },
  )
})
