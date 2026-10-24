import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import {
  pythonAttributeErrorRule,
  pythonFileNotFoundErrorRule,
  pythonImportErrorRule,
  pythonIndentationErrorRule,
  pythonIndexErrorRule,
  pythonKeyErrorRule,
  pythonModuleNotFoundErrorRule,
  pythonNameErrorRule,
  pythonPermissionErrorRule,
  pythonSyntaxErrorRule,
  pythonTypeErrorRule,
} from './rules/python'
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
    name: 'ModuleNotFoundError',
    rule: pythonModuleNotFoundErrorRule,
    line: "ModuleNotFoundError: No module named 'requests'",
    category: 'missing-module',
  },
  {
    name: 'ImportError',
    rule: pythonImportErrorRule,
    line: "ImportError: cannot import name 'Client' from 'api'",
    category: 'import-failure',
  },
  {
    name: 'NameError',
    rule: pythonNameErrorRule,
    line: "NameError: name 'user_count' is not defined",
    category: 'undefined-name',
  },
  {
    name: 'TypeError',
    rule: pythonTypeErrorRule,
    line: "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
    category: 'type-mismatch',
  },
  {
    name: 'AttributeError',
    rule: pythonAttributeErrorRule,
    line: "AttributeError: 'NoneType' object has no attribute 'strip'",
    category: 'missing-attribute',
  },
  {
    name: 'KeyError',
    rule: pythonKeyErrorRule,
    line: "KeyError: 'user_id'",
    category: 'missing-key',
  },
  {
    name: 'IndexError',
    rule: pythonIndexErrorRule,
    line: 'IndexError: list index out of range',
    category: 'index-out-of-range',
  },
  {
    name: 'FileNotFoundError',
    rule: pythonFileNotFoundErrorRule,
    line: "FileNotFoundError: [Errno 2] No such file or directory: 'data/input.csv'",
    category: 'missing-file',
  },
  {
    name: 'PermissionError',
    rule: pythonPermissionErrorRule,
    line: "PermissionError: [Errno 13] Permission denied: 'reports/output.csv'",
    category: 'permission-denied',
  },
  {
    name: 'SyntaxError',
    rule: pythonSyntaxErrorRule,
    line: 'SyntaxError: invalid syntax',
    category: 'syntax-error',
  },
  {
    name: 'IndentationError',
    rule: pythonIndentationErrorRule,
    line: 'IndentationError: unexpected indent',
    category: 'indentation-error',
  },
]

const LOOKALIKES: Array<[string, DiagnosticRule, string]> = [
  [
    'ModuleNotFoundError',
    pythonModuleNotFoundErrorRule,
    "ImportError: cannot import name 'requests' from 'http'",
  ],
  [
    'ImportError',
    pythonImportErrorRule,
    "ModuleNotFoundError: No module named 'requests'",
  ],
  [
    'NameError',
    pythonNameErrorRule,
    'ReferenceError: user_count is not defined',
  ],
  [
    'TypeError',
    pythonTypeErrorRule,
    "TypeError: Cannot read properties of undefined (reading 'name')",
  ],
  [
    'AttributeError',
    pythonAttributeErrorRule,
    "TypeError: 'NoneType' object has no attribute 'strip'",
  ],
  [
    'KeyError',
    pythonKeyErrorRule,
    "TypeError: 'user_id' is not a valid key type",
  ],
  ['IndexError', pythonIndexErrorRule, 'KeyError: 3'],
  [
    'FileNotFoundError',
    pythonFileNotFoundErrorRule,
    "PermissionError: [Errno 13] Permission denied: 'data/input.csv'",
  ],
  [
    'PermissionError',
    pythonPermissionErrorRule,
    "FileNotFoundError: [Errno 2] No such file or directory: 'data/input.csv'",
  ],
  [
    'SyntaxError',
    pythonSyntaxErrorRule,
    "SyntaxError: Unexpected token '<'",
  ],
  [
    'IndentationError',
    pythonIndentationErrorRule,
    'SyntaxError: unexpected indent',
  ],
]

describe('Python diagnostic rules', () => {
  it.each(POSITIVE_CASES)(
    '$name produces a complete Python diagnosis',
    ({ rule, line, category }) => {
      expect(rule.match(line)).not.toBeNull()

      const result = diagnose({ language: 'python', errorText: line })

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
