import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import { javascriptTypeErrorRule } from './rules/javascript'

interface SubtypeCase {
  name: string
  kind: string
  line: string
  signature: string
  explanation: RegExp
  example: RegExp
}

const SUBTYPE_CASES: SubtypeCase[] = [
  {
    name: 'modern read of a property on undefined',
    kind: 'read-modern',
    line: "TypeError: Cannot read properties of undefined (reading 'amount')",
    signature:
      "TypeError: Cannot read properties of undefined (reading 'amount')",
    explanation: /property/i,
    example: /amount/,
  },
  {
    name: 'modern read of a property on null',
    kind: 'read-modern',
    line: "TypeError: Cannot read properties of null (reading 'length')",
    signature:
      "TypeError: Cannot read properties of null (reading 'length')",
    explanation: /property/i,
    example: /\blength\b/,
  },
  {
    name: 'legacy read of a property on undefined',
    kind: 'read-legacy',
    line: "TypeError: Cannot read property 'amount' of undefined",
    signature: "TypeError: Cannot read property 'amount' of undefined",
    explanation: /property/i,
    example: /amount/,
  },
  {
    name: 'legacy read of a property on null',
    kind: 'read-legacy',
    line: "TypeError: Cannot read property 'length' of null",
    signature: "TypeError: Cannot read property 'length' of null",
    explanation: /property/i,
    example: /\blength\b/,
  },
  {
    name: 'modern write of a property on undefined',
    kind: 'write',
    line: "TypeError: Cannot set properties of undefined (setting 'value')",
    signature:
      "TypeError: Cannot set properties of undefined (setting 'value')",
    explanation: /initialis|initializ/i,
    example: /= \{\}/,
  },
  {
    name: 'modern write of a property on null',
    kind: 'write',
    line: "TypeError: Cannot set properties of null (setting 'checked')",
    signature:
      "TypeError: Cannot set properties of null (setting 'checked')",
    explanation: /initialis|initializ/i,
    example: /= \{\}/,
  },
  {
    name: 'calling a value that is not a function',
    kind: 'not-a-function',
    line: 'TypeError: items.map is not a function',
    signature: 'TypeError: items.map is not a function',
    explanation: /callable/i,
    example: /typeof/,
  },
  {
    name: 'iterating a value that is not iterable',
    kind: 'not-iterable',
    line: 'TypeError: items is not iterable',
    signature: 'TypeError: items is not iterable',
    explanation: /iterable/i,
    example: /Array\.isArray/,
  },
  {
    name: 'iterating the null object',
    kind: 'not-iterable',
    line: 'TypeError: object null is not iterable',
    signature: 'TypeError: object null is not iterable',
    explanation: /iterable/i,
    example: /Array\.isArray/,
  },
  {
    name: 'assigning to a constant binding',
    kind: 'constant',
    line: 'TypeError: Assignment to constant variable.',
    signature: 'TypeError: Assignment to constant variable.',
    explanation: /const|reassign/i,
    example: /let /,
  },
  {
    name: 'using new on a value that is not a constructor',
    kind: 'constructor',
    line: 'TypeError: Cart is not a constructor',
    signature: 'TypeError: Cart is not a constructor',
    explanation: /constructor/i,
    example: /new Cart/,
  },
  {
    name: 'Firefox wording for a property read on undefined',
    kind: 'firefox',
    line: 'TypeError: can\'t access property "name", user is undefined',
    signature: 'TypeError: can\'t access property "name", user is undefined',
    explanation: /Firefox/i,
    example: /\["name"\]/,
  },
  {
    name: 'Firefox wording for a property read on null',
    kind: 'firefox',
    line: 'TypeError: can\'t access property "length", items is null',
    signature: 'TypeError: can\'t access property "length", items is null',
    explanation: /Firefox/i,
    example: /\["length"\]/,
  },
]

describe('JavaScript TypeError sub-signatures', () => {
  it.each(SUBTYPE_CASES)(
    '$name produces its own signature and guidance',
    ({ line, signature, explanation, example }) => {
      const result = diagnose({ language: 'javascript', errorText: line })

      expect(result.category).toBe('type-mismatch')
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
      expect(result.evidence[0]).toEqual({
        source: 'error text',
        label: 'Final exception line',
        quote: line,
        lineNumber: 1,
      })
      expect(result.likelyCause.trim()).not.toBe('')
      expect(result.debuggingSteps.length).toBeGreaterThan(0)
      expect(result.possibleFix).not.toBeNull()
      expect(result.possibleFix?.explanation).toMatch(explanation)
      expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
      expect(result.possibleFix?.exampleCode).toMatch(example)
      expect(result.verificationSteps.length).toBeGreaterThan(0)
      expect(result.limitations.length).toBeGreaterThan(0)
      expect(result.alternativeExplanations.length).toBeGreaterThan(0)
      expect(javascriptTypeErrorRule.match(line)?.specificity).toBe('specific')
    },
  )

  it('gives each sub-signature family its own cause instead of the generic wording', () => {
    const generic = diagnose({
      language: 'javascript',
      errorText: "TypeError: Cannot use 'in' operator to search for 'x' in null",
    })

    const causesByKind = new Map<string, string>()
    for (const { kind, line } of SUBTYPE_CASES) {
      const result = diagnose({ language: 'javascript', errorText: line })
      expect(result.likelyCause).not.toBe(generic.likelyCause)
      const known = causesByKind.get(kind)
      if (known === undefined) {
        causesByKind.set(kind, result.likelyCause)
      } else {
        expect(result.likelyCause).toBe(known)
      }
    }

    expect(causesByKind.size).toBe(8)
    expect(new Set(causesByKind.values()).size).toBe(8)
  })

  it('keeps the existing specific signature for an unlisted but known shape', () => {
    const line = 'TypeError: Cannot convert undefined or null to object'
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe(
      'TypeError: <JavaScript value type problem>',
    )
    expect(result.confidence.level).toBe('high')
  })

  it('keeps the generic fallback when no shape matches', () => {
    const line =
      'TypeError: Cannot use \'in\' operator to search for \'name\' in undefined'
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe('TypeError: <JavaScript type mismatch>')
    expect(result.possibleFix?.explanation).toMatch(/Validate or default/)
    expect(javascriptTypeErrorRule.match(line)?.specificity).toBe('generic')
  })

  it('infers JavaScript for a Firefox property message without a stack frame', () => {
    const line =
      'TypeError: can\'t access property "name", user is undefined'
    const result = diagnose({ language: 'auto', errorText: line })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe(line)
    expect(result.confidence.level).toBe('medium')
  })

  it('keeps a constant assignment at medium confidence without runtime evidence', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'TypeError: Assignment to constant variable.',
    })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe(
      'TypeError: Assignment to constant variable.',
    )
    expect(result.confidence.level).toBe('medium')
  })

  it.each([
    'Error: items.map is not a function',
    'console.log("items are not iterable")',
    "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
    'The page threw TypeError: Cannot read properties of undefined (reading \'name\') yesterday',
    'Error: Cannot read properties of undefined (reading \'name\')',
  ])('does not claim %s as a TypeError subtype', (line) => {
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it.each([
    [
      "TypeError: Cannot read property 'name' of object",
      'TypeError: <JavaScript type mismatch>',
    ],
    [
      'TypeError: can\'t access property "name", user is defined',
      'TypeError: <JavaScript type mismatch>',
    ],
  ])(
    'does not force a subtype for the malformed message %s',
    (line, signature) => {
      const result = diagnose({ language: 'javascript', errorText: line })

      expect(result.matchedSignature).toBe(signature)
    },
  )

  it('writes the constant-assignment example without const', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: 'TypeError: Assignment to constant variable.',
    })

    expect(result.possibleFix?.exampleCode).toContain('let ')
    expect(result.possibleFix?.exampleCode).not.toContain('const ')
  })
})
