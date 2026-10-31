import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTIC_CATEGORY_LABELS,
  diagnosticCategoryLabel,
} from './labels'
import { javascriptRules } from './rules/javascript'
import { pythonRules } from './rules/python'
import type { DiagnosticRule } from './types'

const ALL_RULES: readonly DiagnosticRule[] = [
  ...pythonRules,
  ...javascriptRules,
]

const NEW_RULES = [
  ['python.zero-division-error', 'division-by-zero', 'Division by zero'],
  ['python.value-error', 'invalid-value', 'Invalid value'],
  ['python.recursion-error', 'recursion-error', 'Recursion error'],
  ['python.unicode-error', 'unicode-error', 'Unicode error'],
  ['python.json-decode-error', 'json-decode-error', 'JSON decode error'],
] as const

const BATCH_B1_RULES = [
  [
    'javascript.node-module-not-found',
    'javascript',
    'missing-module',
    'Missing module',
  ],
  ['javascript.port-in-use', 'javascript', 'port-in-use', 'Port already in use'],
  [
    'javascript.node-file-error',
    'javascript',
    'missing-file',
    'Missing file',
  ],
  [
    'javascript.permission-error',
    'javascript',
    'permission-denied',
    'Permission denied',
  ],
  [
    'javascript.call-stack-exceeded',
    'javascript',
    'recursion-error',
    'Recursion error',
  ],
] as const

const BATCH_B2_RULES = [
  [
    'javascript.json-parse-error',
    'javascript',
    'json-decode-error',
    'JSON decode error',
  ],
  [
    'javascript.network-request-failed',
    'javascript',
    'network-request-failed',
    'Network request failed',
  ],
  [
    'javascript.cors-blocked',
    'javascript',
    'cors-blocked',
    'CORS blocked request',
  ],
  ['javascript.react-error', 'javascript', 'react-error', 'React error'],
] as const

const BATCH_C1_RULES = [
  [
    'javascript.typescript-error',
    'javascript',
    'typescript-error',
    'TypeScript compiler error',
  ],
  [
    'javascript.npm-error',
    'javascript',
    'npm-error',
    'NPM install or run error',
  ],
] as const

describe('diagnostic rule registry', () => {
  it('registers every batch-A rule once with a stable id and category', () => {
    for (const [id, category] of NEW_RULES) {
      const rules = pythonRules.filter((rule) => rule.id === id)

      expect(rules).toHaveLength(1)
      expect(rules[0].language).toBe('python')
      expect(rules[0].category).toBe(category)
    }
  })

  it('uses a unique id for every registered rule', () => {
    const ids = ALL_RULES.map((rule) => rule.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a label for every registered rule category', () => {
    for (const rule of ALL_RULES) {
      expect(DIAGNOSTIC_CATEGORY_LABELS[rule.category]).toBeTruthy()
    }
  })

  it('renders a human-readable label for every registered rule category', () => {
    for (const rule of ALL_RULES) {
      const label = diagnosticCategoryLabel(rule.category)

      expect(label).not.toBe(rule.category)
      expect(label).toMatch(/^[A-Z]/)
    }
  })

  it.each(NEW_RULES)(
    'labels %s with %s on the detail page',
    (_id, category, label) => {
      expect(DIAGNOSTIC_CATEGORY_LABELS[category]).toBe(label)
      expect(diagnosticCategoryLabel(category)).toBe(label)
    },
  )

  it('registers every batch-B1 rule once in the JavaScript array', () => {
    for (const [id, language, category] of BATCH_B1_RULES) {
      const rules = javascriptRules.filter((rule) => rule.id === id)

      expect(rules).toHaveLength(1)
      expect(rules[0].language).toBe(language)
      expect(rules[0].category).toBe(category)
    }
  })

  it.each(BATCH_B1_RULES)(
    'labels %s with %s on the detail page',
    (_id, _language, category, label) => {
      expect(DIAGNOSTIC_CATEGORY_LABELS[category]).toBe(label)
      expect(diagnosticCategoryLabel(category)).toBe(label)
    },
  )

  it('registers every batch-B2 rule once in the JavaScript array', () => {
    for (const [id, language, category] of BATCH_B2_RULES) {
      const rules = javascriptRules.filter((rule) => rule.id === id)

      expect(rules).toHaveLength(1)
      expect(rules[0].language).toBe(language)
      expect(rules[0].category).toBe(category)
    }

    expect(javascriptRules.slice(8, 12).map((rule) => rule.id)).toEqual(
      BATCH_B2_RULES.map(([id]) => id),
    )
  })

  it.each(BATCH_B2_RULES)(
    'labels %s with %s on the detail page',
    (_id, _language, category, label) => {
      expect(DIAGNOSTIC_CATEGORY_LABELS[category]).toBe(label)
      expect(diagnosticCategoryLabel(category)).toBe(label)
    },
  )

  it('registers every batch-C1 rule once after the existing JavaScript rules', () => {
    for (const [id, language, category] of BATCH_C1_RULES) {
      const rules = javascriptRules.filter((rule) => rule.id === id)

      expect(rules).toHaveLength(1)
      expect(rules[0].language).toBe(language)
      expect(rules[0].category).toBe(category)
    }

    expect(javascriptRules.slice(12).map((rule) => rule.id)).toEqual(
      BATCH_C1_RULES.map(([id]) => id),
    )
  })

  it.each(BATCH_C1_RULES)(
    'labels %s with %s on the detail page',
    (_id, _language, category, label) => {
      expect(DIAGNOSTIC_CATEGORY_LABELS[category]).toBe(label)
      expect(diagnosticCategoryLabel(category)).toBe(label)
    },
  )

  it('keeps the pre-existing category labels unchanged', () => {
    expect(DIAGNOSTIC_CATEGORY_LABELS).toMatchObject({
      'missing-module': 'Missing module',
      'import-failure': 'Import failure',
      'undefined-name': 'Undefined name',
      'type-mismatch': 'Type mismatch',
      'missing-attribute': 'Missing attribute',
      'missing-key': 'Missing key',
      'index-out-of-range': 'Index out of range',
      'missing-file': 'Missing file',
      'permission-denied': 'Permission denied',
      'syntax-error': 'Syntax error',
      'indentation-error': 'Indentation error',
      unrecognized: 'Unrecognised',
    })
  })
})
