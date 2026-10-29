import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import { javascriptTypeErrorRule } from './rules/javascript'

describe('JavaScript TypeError sub-signatures: lookalikes and prose', () => {
  it('row 2: leaves a prose mention of the legacy read message unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        "The log shows TypeError: Cannot read property 'name' of undefined at startup.",
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 3: leaves a timestamp-prefixed modern write message unrecognised', () => {
    const line =
      "2026-10-29T10:00:00Z TypeError: Cannot set properties of undefined (setting 'value')"
    const result = diagnose({ language: 'auto', errorText: line })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 3: falls back to the generic type mismatch when the property quote is missing', () => {
    const line =
      'TypeError: Cannot set properties of undefined (setting value)'
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe('TypeError: <JavaScript type mismatch>')
    expect(javascriptTypeErrorRule.match(line)?.specificity).toBe('generic')
  })

  it('row 3: leaves a prose mention of the modern write message unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        "The console printed TypeError: Cannot set properties of undefined (setting 'value') after the click.",
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it.each(['undefined', 'null'])(
    'row 4: recognises the legacy singular write message on %s',
    (target) => {
      const line = `TypeError: Cannot set property 'count' of ${target}`
      const result = diagnose({ language: 'javascript', errorText: line })

      expect(result.category).toBe('type-mismatch')
      expect(result.matchedSignature).toBe(
        'TypeError: Cannot set properties of undefined or null',
      )
      expect(result.confidence.level).toBe('high')
      expect(javascriptTypeErrorRule.match(line)?.specificity).toBe('specific')
    },
  )

  it('row 4: ignores the singular write wording under a different error class', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: "Error: Cannot set property 'count' of undefined",
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 4: falls back to the generic type mismatch for a non-nullish target', () => {
    const line = "TypeError: Cannot set property 'count' of object"
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe('TypeError: <JavaScript type mismatch>')
    expect(javascriptTypeErrorRule.match(line)?.specificity).toBe('generic')
  })

  it('row 4: leaves a prose mention of the singular write message unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        "The log contains TypeError: Cannot set property 'count' of undefined once.",
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 5: leaves a prose mention of the not-a-function message unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        'The message "TypeError: items.map is not a function" was pasted into the report.',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 6: falls back to the generic type mismatch for a truncated not-iterable suffix', () => {
    const line =
      'TypeError: items is not iterable (cannot read property Symbol(Symbol.iterator)'
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe('TypeError: <JavaScript type mismatch>')
    expect(javascriptTypeErrorRule.match(line)?.specificity).toBe('generic')
  })

  it('row 6: ignores the not-iterable wording under a different error class', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: 'Error: items is not iterable',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 7: ignores constant assignment under a different error class', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: 'Error: Assignment to constant variable.',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 7: leaves a prose mention of the constant assignment message unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        'The log said "TypeError: Assignment to constant variable." twice.',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 8: ignores the not-a-constructor wording under a different error class', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: 'Error: Cart is not a constructor',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 8: leaves a prose mention of the not-a-constructor message unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'The log said "TypeError: Cart is not a constructor" once.',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 9: leaves a prose mention of the Firefox property message unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        'Firefox printed TypeError: can\'t access property "name", user is undefined in the console.',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 10: keeps a similar value-type complaint on the generic catch-all', () => {
    const line = 'TypeError: Cannot convert undefined value to object'
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe('TypeError: <JavaScript type mismatch>')
    expect(result.matchedSignature).not.toBe(
      'TypeError: <JavaScript value type problem>',
    )
    expect(javascriptTypeErrorRule.match(line)?.specificity).toBe('generic')
  })

  it('row 10: leaves a prose mention of a value-type shape unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        'The page logged TypeError: Cannot convert undefined or null to object once.',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('row 11: leaves a prose mention of any other TypeError unrecognised', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        "The user saw TypeError: Cannot use 'in' operator to search for 'x' in null while testing.",
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })
})
