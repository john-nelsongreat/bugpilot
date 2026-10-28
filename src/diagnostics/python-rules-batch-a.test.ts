import { describe, expect, it } from 'vitest'
import { MAX_ERROR_TEXT_LENGTH, diagnose } from './engine'
import {
  pythonJsonDecodeErrorRule,
  pythonRecursionErrorRule,
  pythonUnicodeErrorRule,
  pythonValueErrorRule,
  pythonZeroDivisionErrorRule,
} from './rules/python'

const UNICODE_DECODE =
  "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte"
const UNICODE_ENCODE =
  "UnicodeEncodeError: 'charmap' codec can't encode character '\\u2713' in position 5: character maps to <undefined>"
const JSON_EXPECTING =
  'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)'

function pythonTraceback(
  file: string,
  lineNumber: number,
  source: string,
  errorLine: string,
): string {
  return [
    'Traceback (most recent call last):',
    `  File "/home/ana/project/${file}", line ${lineNumber}, in <module>`,
    `    ${source}`,
    errorLine,
  ].join('\n')
}

const VALUE_ERROR_CASES = [
  {
    name: 'invalid int literal',
    line: "ValueError: invalid literal for int() with base 10: 'abc'",
    signature:
      "ValueError: invalid literal for int() with base <base>: '<value>'",
    causePattern: /not a valid integer|base/i,
    fixPattern: /convert|format|int\(/i,
  },
  {
    name: 'float conversion',
    line: "ValueError: could not convert string to float: '1,234.5'",
    signature: "ValueError: could not convert string to float: '<value>'",
    causePattern: /float|decimal|comma/i,
    fixPattern: /convert|format|float\(/i,
  },
  {
    name: 'not enough values to unpack',
    line: 'ValueError: not enough values to unpack (expected 2, got 1)',
    signature:
      'ValueError: not enough values to unpack (expected <expected>, got <got>)',
    causePattern: /unpack|shorter|values/i,
    fixPattern: /length|len\(|unpack/i,
  },
  {
    name: 'too many values to unpack',
    line: 'ValueError: too many values to unpack (expected 2)',
    signature: 'ValueError: too many values to unpack (expected <expected>)',
    causePattern: /unpack|more values|extra/i,
    fixPattern: /unpack|rest|extra/i,
  },
  {
    name: 'math domain error',
    line: 'ValueError: math domain error',
    signature: 'ValueError: math domain error',
    causePattern: /domain|math|negative|logarithm/i,
    fixPattern: /domain|sqrt|log|guard|check/i,
  },
  {
    name: 'value not in list',
    line: "ValueError: 'apple' is not in list",
    signature: "ValueError: '<value>' is not in list",
    causePattern: /not found|list|searched/i,
    fixPattern: /index|membership|search/i,
  },
] as const

const AUTO_CASES = [
  {
    name: 'ZeroDivisionError',
    line: 'ZeroDivisionError: division by zero',
    category: 'division-by-zero',
    signature: 'ZeroDivisionError: division by zero',
  },
  {
    name: 'ValueError math domain error',
    line: 'ValueError: math domain error',
    category: 'invalid-value',
    signature: 'ValueError: math domain error',
  },
  {
    name: 'RecursionError',
    line: 'RecursionError: maximum recursion depth exceeded',
    category: 'recursion-error',
    signature: 'RecursionError: maximum recursion depth exceeded',
  },
  {
    name: 'UnicodeDecodeError',
    line: UNICODE_DECODE,
    category: 'unicode-error',
    signature: "UnicodeDecodeError: '<codec>' codec cannot decode the input",
  },
  {
    name: 'JSONDecodeError',
    line: JSON_EXPECTING,
    category: 'json-decode-error',
    signature: 'JSONDecodeError: <invalid JSON payload>',
  },
] as const

describe('ZeroDivisionError rule', () => {
  it.each([
    'division by zero',
    'integer division or modulo by zero',
    'float division by zero',
    'float modulo',
    'integer modulo by zero',
  ])('matches the real message "%s" with one stable signature', (detail) => {
    const line = `ZeroDivisionError: ${detail}`
    const match = pythonZeroDivisionErrorRule.match(line)

    expect(match?.signature).toBe('ZeroDivisionError: division by zero')
    expect(match?.specificity).toBe('specific')

    const result = diagnose({ language: 'python', errorText: line })

    expect(result.category).toBe('division-by-zero')
    expect(result.matchedSignature).toBe('ZeroDivisionError: division by zero')
    expect(result.confidence.level).toBe('high')
    expect(result.evidence).toEqual([
      expect.objectContaining({
        source: 'error text',
        quote: line,
        lineNumber: 1,
      }),
    ])
    expect(result.likelyCause).toMatch(/zero|empty/i)
    expect(result.debuggingSteps.join(' ')).toMatch(/divisor|denominator/i)
    expect(result.possibleFix?.explanation).toMatch(/guard|check|inspect/i)
    expect(result.possibleFix?.explanation).toMatch(
      /swallow|hide|clear error|broad exception/i,
    )
    expect(result.possibleFix?.exampleCode).toMatch(/if /)
    expect(result.verificationSteps.join(' ')).toMatch(/rerun|run/i)
    expect(result.limitations.length).toBeGreaterThan(0)
    expect(result.alternativeExplanations.length).toBeGreaterThan(0)
  })

  it.each([
    ['an ArithmeticError line', 'ArithmeticError: division by zero'],
    [
      'an unknown ZeroDivisionError message',
      'ZeroDivisionError: modulus failure',
    ],
    [
      'a log-prefixed line',
      '2026-10-28 12:00:00 ERROR ZeroDivisionError: division by zero',
    ],
    ['a comment', '# ZeroDivisionError: division by zero'],
    [
      'a string literal',
      'message = "ZeroDivisionError: division by zero"',
    ],
  ])('does not match %s', (_name, line) => {
    expect(pythonZeroDivisionErrorRule.match(line)).toBeNull()
  })

  it('returns Unrecognised for a near-miss ArithmeticError line', () => {
    const result = diagnose({
      language: 'python',
      errorText: 'ArithmeticError: division by zero',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
    expect(result.likelyCause).toMatch(/no cause|cannot determine|not enough/i)
  })
})

describe('ValueError rule', () => {
  it.each(VALUE_ERROR_CASES)(
    'gives $name its own signature, cause, and advice',
    ({ line, signature, causePattern, fixPattern }) => {
      const match = pythonValueErrorRule.match(line)

      expect(match?.signature).toBe(signature)
      expect(match?.specificity).toBe('specific')

      const result = diagnose({ language: 'python', errorText: line })

      expect(result.category).toBe('invalid-value')
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
      expect(result.evidence).toEqual([
        expect.objectContaining({
          source: 'error text',
          quote: line,
          lineNumber: 1,
        }),
      ])
      expect(result.likelyCause).toMatch(causePattern)
      expect(result.possibleFix?.explanation).toMatch(fixPattern)
      expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
      expect(result.possibleFix?.exampleCode.trim()).not.toBe('')
      expect(result.debuggingSteps.length).toBeGreaterThanOrEqual(3)
      expect(result.verificationSteps.length).toBeGreaterThan(0)
      expect(result.limitations.length).toBeGreaterThan(0)
      expect(result.alternativeExplanations.length).toBeGreaterThan(0)
    },
  )

  it('uses distinct signatures for every supported value-error form', () => {
    const signatures = VALUE_ERROR_CASES.map(
      ({ line }) => pythonValueErrorRule.match(line)?.signature,
    )

    expect(new Set(signatures).size).toBe(VALUE_ERROR_CASES.length)
    expect(signatures).not.toContain(
      'ValueError: <unclassified value error>',
    )
  })

  it('captures the base and literal for an integer conversion failure', () => {
    const match = pythonValueErrorRule.match(
      "ValueError: invalid literal for int() with base 16: '0xGG'",
    )

    expect(match?.captures).toMatchObject({ base: '16', value: '0xGG' })
  })

  it('falls back to a lower-confidence generic result for an unclassified ValueError', () => {
    const line = 'ValueError: something unusual happened'
    const match = pythonValueErrorRule.match(line)

    expect(match?.signature).toBe('ValueError: <unclassified value error>')
    expect(match?.specificity).toBe('generic')

    const result = diagnose({ language: 'python', errorText: line })

    expect(result.category).toBe('invalid-value')
    expect(result.matchedSignature).toBe(
      'ValueError: <unclassified value error>',
    )
    expect(result.confidence.level).toBe('medium')
    expect(result.confidence.reason).toMatch(/generic/i)
    expect(result.likelyCause).toMatch(
      /does not match|not enough|cannot be narrowed|unclassified/i,
    )
    expect(result.possibleFix).not.toBeNull()
  })

  it('drops the generic fallback to low confidence without runtime evidence', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'ValueError: something unusual happened',
    })

    expect(result.category).toBe('invalid-value')
    expect(result.confidence.level).toBe('low')
    expect(result.confidence.reason).toMatch(
      /no traceback|not confirm|explicit/i,
    )
  })

  it('raises the generic fallback only to medium confidence with a traceback', () => {
    const result = diagnose({
      language: 'auto',
      errorText: pythonTraceback(
        'app.py',
        3,
        'run()',
        'ValueError: something unusual happened',
      ),
    })

    expect(result.category).toBe('invalid-value')
    expect(result.confidence.level).toBe('medium')
    expect(result.confidence.reason).toMatch(/generic/i)
  })

  it.each([
    [
      'a qualified JSONDecodeError',
      'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    ],
    [
      'a requests JSONDecodeError',
      'requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    ],
    ['a UnicodeDecodeError', UNICODE_DECODE],
    ['a UnicodeEncodeError', UNICODE_ENCODE],
  ])('does not claim %s even though it is a ValueError subclass', (_name, line) => {
    expect(pythonValueErrorRule.match(line)).toBeNull()
  })

  it.each([
    ['a log prefix', '2026-10-28 12:00:00 ERROR ValueError: math domain error'],
    ['a comment', '# ValueError: math domain error'],
    ['a string literal', 'message = "ValueError: math domain error"'],
    [
      'a TypeError lookalike',
      "TypeError: argument of type 'int' is not iterable",
    ],
  ])('does not match %s', (_name, line) => {
    expect(pythonValueErrorRule.match(line)).toBeNull()
  })

  it('quotes the supplied conversion line as whole-identifier evidence', () => {
    const result = diagnose({
      language: 'python',
      errorText: "ValueError: invalid literal for int() with base 10: 'abc'",
      codeSnippet: ['import json', "count = int('abc')"].join('\n'),
    })

    expect(result.evidence).toEqual([
      expect.objectContaining({ source: 'error text', lineNumber: 1 }),
      expect.objectContaining({
        source: 'code snippet',
        quote: "count = int('abc')",
        lineNumber: 2,
      }),
    ])
  })

  it('diagnoses the ValueError fixture that used to be unsupported', () => {
    const result = diagnose({
      language: 'auto',
      errorText: "ValueError: invalid literal for int() with base 10: 'abc'",
    })

    expect(result.category).toBe('invalid-value')
    expect(result.matchedSignature).toBe(
      "ValueError: invalid literal for int() with base <base>: '<value>'",
    )
    expect(result.confidence.level).toBe('medium')
    expect(result.confidence.reason).toMatch(
      /no traceback|not confirm|explicit/i,
    )
  })
})

describe('RecursionError rule', () => {
  it.each([
    'maximum recursion depth exceeded',
    'maximum recursion depth exceeded while calling a Python object',
    'maximum recursion depth exceeded in comparison',
  ])('matches "%s" with one stable signature', (detail) => {
    const line = `RecursionError: ${detail}`
    const match = pythonRecursionErrorRule.match(line)

    expect(match?.signature).toBe(
      'RecursionError: maximum recursion depth exceeded',
    )
    expect(match?.specificity).toBe('specific')

    const result = diagnose({ language: 'python', errorText: line })

    expect(result.category).toBe('recursion-error')
    expect(result.matchedSignature).toBe(
      'RecursionError: maximum recursion depth exceeded',
    )
    expect(result.confidence.level).toBe('high')
    expect(result.likelyCause).toMatch(/base case|recursion/i)
    expect(result.debuggingSteps.join(' ')).toMatch(/base case/i)
    expect(result.debuggingSteps.join(' ')).toMatch(/argument/i)
    expect(
      [
        result.possibleFix?.explanation,
        ...result.limitations,
      ].join(' '),
    ).toMatch(/setrecursionlimit/i)
    expect(result.possibleFix?.exampleCode.trim()).not.toBe('')
    expect(result.verificationSteps.length).toBeGreaterThan(0)
    expect(result.alternativeExplanations.length).toBeGreaterThan(0)
  })

  it.each([
    [
      'a RuntimeError line',
      'RuntimeError: maximum recursion depth exceeded',
    ],
    ['an unknown message', 'RecursionError: recursion limit reached'],
    [
      'a log-prefixed line',
      '2026-10-28 12:00:00 ERROR RecursionError: maximum recursion depth exceeded',
    ],
    ['a comment', '# RecursionError: maximum recursion depth exceeded'],
    [
      'a prose mention',
      'A teammate mentioned RecursionError while reviewing the log.',
    ],
  ])('does not match %s', (_name, line) => {
    expect(pythonRecursionErrorRule.match(line)).toBeNull()
  })

  it('returns Unrecognised for a RuntimeError lookalike', () => {
    const result = diagnose({
      language: 'python',
      errorText: 'RuntimeError: maximum recursion depth exceeded',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })
})

describe('Unicode error rule', () => {
  it.each([
    {
      name: 'utf-8 decode',
      line: UNICODE_DECODE,
      signature:
        "UnicodeDecodeError: '<codec>' codec cannot decode the input",
      codec: 'utf-8',
      causePattern: /decode|byte|encoding/i,
    },
    {
      name: 'charmap decode',
      line: "UnicodeDecodeError: 'charmap' codec can't decode byte 0x9d in position 12: character maps to <undefined>",
      signature:
        "UnicodeDecodeError: '<codec>' codec cannot decode the input",
      codec: 'charmap',
      causePattern: /decode|byte|encoding/i,
    },
    {
      name: 'utf-8 byte range decode',
      line: "UnicodeDecodeError: 'utf-8' codec can't decode bytes in position 2-3: invalid continuation byte",
      signature:
        "UnicodeDecodeError: '<codec>' codec cannot decode the input",
      codec: 'utf-8',
      causePattern: /decode|byte|encoding/i,
    },
    {
      name: 'charmap encode',
      line: UNICODE_ENCODE,
      signature: "UnicodeEncodeError: '<codec>' codec cannot encode the text",
      codec: 'charmap',
      causePattern: /encode|character|codec/i,
    },
  ])('matches $name and names the codec', ({ line, signature, codec, causePattern }) => {
    const match = pythonUnicodeErrorRule.match(line)

    expect(match?.signature).toBe(signature)
    expect(match?.specificity).toBe('specific')
    expect(match?.captures.codec).toBe(codec)

    const result = diagnose({ language: 'python', errorText: line })

    expect(result.category).toBe('unicode-error')
    expect(result.matchedSignature).toBe(signature)
    expect(result.confidence.level).toBe('high')
    expect(result.likelyCause).toMatch(causePattern)
    expect(result.possibleFix?.explanation).toMatch(/encoding|codec/i)
    expect(
      [
        result.possibleFix?.explanation,
        ...result.limitations,
      ].join(' '),
    ).toMatch(/ignore|silently|loss/i)
    expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
    expect(result.possibleFix?.exampleCode).toMatch(/encoding/i)
    expect(result.verificationSteps.length).toBeGreaterThan(0)
    expect(result.alternativeExplanations.length).toBeGreaterThan(0)
  })

  it.each([
    [
      'a TypeError with unicode in the message',
      "TypeError: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte",
    ],
    [
      'a ValueError with codec wording',
      "ValueError: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte",
    ],
    [
      'a log-prefixed line',
      "2026-10-28 12:00:00 ERROR UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte",
    ],
    [
      'a comment',
      "# UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte",
    ],
    [
      'a prose mention',
      'A teammate mentioned UnicodeDecodeError while reviewing the log.',
    ],
  ])('does not match %s', (_name, line) => {
    expect(pythonUnicodeErrorRule.match(line)).toBeNull()
  })

  it('quotes the supplied line that names the codec', () => {
    const result = diagnose({
      language: 'python',
      errorText: UNICODE_DECODE,
      codeSnippet: [
        'import csv',
        "with open('data.csv', encoding='utf-8') as handle:",
        '    rows = list(handle)',
      ].join('\n'),
    })

    expect(result.evidence).toEqual([
      expect.objectContaining({ source: 'error text', lineNumber: 1 }),
      expect.objectContaining({
        source: 'code snippet',
        quote: "with open('data.csv', encoding='utf-8') as handle:",
        lineNumber: 2,
      }),
    ])
  })
})

describe('JSONDecodeError rule', () => {
  const JSON_CASES = [
    {
      name: 'Expecting value',
      message: 'Expecting value: line 1 column 1 (char 0)',
      causePattern: /empty|HTML|value/i,
    },
    {
      name: 'Expecting property name',
      message:
        'Expecting property name enclosed in double quotes: line 2 column 1 (char 1)',
      causePattern: /property|double quotes|comma/i,
    },
    {
      name: 'Extra data',
      message: 'Extra data: line 1 column 15 (char 14)',
      causePattern: /extra|trailing|more than one/i,
    },
    {
      name: 'Unterminated string',
      message: 'Unterminated string starting at: line 1 column 10 (char 9)',
      causePattern: /string|truncat|quote/i,
    },
    {
      name: 'Invalid control character',
      message: 'Invalid control character at: line 1 column 5 (char 4)',
      causePattern: /control character|escape/i,
    },
  ]

  it.each(JSON_CASES)(
    'diagnoses $name with source-checking advice',
    ({ message, causePattern }) => {
      const line = `json.decoder.JSONDecodeError: ${message}`
      const match = pythonJsonDecodeErrorRule.match(line)

      expect(match?.signature).toBe('JSONDecodeError: <invalid JSON payload>')
      expect(match?.specificity).toBe('specific')

      const result = diagnose({ language: 'python', errorText: line })

      expect(result.category).toBe('json-decode-error')
      expect(result.matchedSignature).toBe(
        'JSONDecodeError: <invalid JSON payload>',
      )
      expect(result.confidence.level).toBe('high')
      expect(result.evidence).toEqual([
        expect.objectContaining({
          source: 'error text',
          quote: line,
          lineNumber: 1,
        }),
      ])
      expect(result.likelyCause).toMatch(causePattern)
      expect(result.possibleFix?.explanation).toMatch(/raw|response|payload/i)
      expect(result.possibleFix?.explanation).toMatch(
        /empty|HTML|BOM|status/i,
      )
      expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
      expect(result.possibleFix?.exampleCode.trim()).not.toBe('')
      expect(result.verificationSteps.length).toBeGreaterThan(0)
      expect(result.limitations.length).toBeGreaterThan(0)
      expect(result.alternativeExplanations.length).toBeGreaterThan(0)
    },
  )

  it.each([
    'JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    'json.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    'requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
  ])('matches the qualified form %s', (line) => {
    expect(pythonJsonDecodeErrorRule.match(line)?.signature).toBe(
      'JSONDecodeError: <invalid JSON payload>',
    )
  })

  it.each([
    [
      'an unknown JSONDecodeError message',
      'json.decoder.JSONDecodeError: something unusual happened',
    ],
    [
      'a ValueError carrying the same words',
      'ValueError: Expecting value: line 1 column 1 (char 0)',
    ],
    [
      'a SyntaxError lookalike',
      "SyntaxError: Unexpected token '<', \"<html>\" is not valid JSON",
    ],
    [
      'a log-prefixed line',
      '2026-10-28 12:00:00 ERROR json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    ],
    [
      'a comment',
      '# json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    ],
  ])('does not match %s', (_name, line) => {
    expect(pythonJsonDecodeErrorRule.match(line)).toBeNull()
  })

  it('does not let the JSON rule claim a ValueError line', () => {
    expect(
      pythonJsonDecodeErrorRule.match(
        'ValueError: Expecting value: line 1 column 1 (char 0)',
      ),
    ).toBeNull()

    const result = diagnose({
      language: 'python',
      errorText: 'ValueError: Expecting value: line 1 column 1 (char 0)',
    })

    expect(result.category).toBe('invalid-value')
    expect(result.matchedSignature).toBe(
      'ValueError: <unclassified value error>',
    )
    expect(result.confidence.level).toBe('medium')
  })

  it('returns Unrecognised for an unsupported JSONDecodeError message', () => {
    const result = diagnose({
      language: 'python',
      errorText:
        'json.decoder.JSONDecodeError: something unusual happened',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })
})

describe('Batch A language selection', () => {
  it.each(AUTO_CASES)(
    '$name: a Python traceback is high confidence in auto mode',
    ({ line, category, signature }) => {
      const result = diagnose({
        language: 'auto',
        errorText: pythonTraceback('app.py', 12, 'main()', line),
      })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
      expect(result.confidence.reason).toMatch(/Python/i)
      expect(result.evidence[0]).toMatchObject({
        quote: line,
        lineNumber: 4,
      })
    },
  )

  it.each(AUTO_CASES)(
    '$name: no traceback is medium confidence in auto mode',
    ({ line, category, signature }) => {
      const result = diagnose({ language: 'auto', errorText: line })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('medium')
      expect(result.confidence.reason).toMatch(
        /no traceback|not confirm|explicit/i,
      )
    },
  )

  it.each(AUTO_CASES)(
    '$name: JavaScript stack details lower confidence to low',
    ({ line, category }) => {
      const result = diagnose({
        language: 'auto',
        errorText: [line, '    at handle (src/app.js:12:5)'].join('\n'),
      })

      expect(result.category).toBe(category)
      expect(result.confidence.level).toBe('low')
      expect(result.confidence.reason).toMatch(/conflict|uncertain/i)
    },
  )

  it('keeps an explicit Python selection but lowers confidence on conflicting JavaScript detail', () => {
    const result = diagnose({
      language: 'python',
      errorText: [
        'ZeroDivisionError: division by zero',
        '    at handle (src/app.js:12:5)',
      ].join('\n'),
    })

    expect(result.category).toBe('division-by-zero')
    expect(result.confidence.level).toBe('low')
    expect(result.confidence.reason).toMatch(/conflict|uncertain/i)
  })
})

describe('Batch A precedence and overlap', () => {
  it.each([
    [
      'a qualified JSONDecodeError',
      'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
      'json-decode-error',
    ],
    [
      'a requests JSONDecodeError',
      'requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
      'json-decode-error',
    ],
    ['a UnicodeDecodeError', UNICODE_DECODE, 'unicode-error'],
    ['a UnicodeEncodeError', UNICODE_ENCODE, 'unicode-error'],
  ])('routes %s to its own category instead of ValueError', (_name, line, category) => {
    expect(pythonValueErrorRule.match(line)).toBeNull()

    const result = diagnose({ language: 'python', errorText: line })

    expect(result.category).toBe(category)
    expect(result.confidence.level).toBe('high')
  })

  it('does not let RecursionError claim a RuntimeError line', () => {
    expect(
      pythonRecursionErrorRule.match(
        'RuntimeError: maximum recursion depth exceeded',
      ),
    ).toBeNull()

    const result = diagnose({
      language: 'python',
      errorText: 'RuntimeError: maximum recursion depth exceeded',
    })

    expect(result.category).toBe('unrecognized')
  })

  it('does not let ZeroDivisionError claim an ArithmeticError line', () => {
    expect(
      pythonZeroDivisionErrorRule.match('ArithmeticError: division by zero'),
    ).toBeNull()

    const result = diagnose({
      language: 'python',
      errorText: 'ArithmeticError: division by zero',
    })

    expect(result.category).toBe('unrecognized')
  })
})

describe('Batch A input limits', () => {
  it('returns Unrecognised for empty text without inventing a cause', () => {
    const result = diagnose({ language: 'auto', errorText: '   \n\t ' })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
    expect(result.likelyCause).toMatch(/no cause|cannot determine|not enough/i)
  })

  it('refuses an oversized batch-A input instead of truncating it', () => {
    const errorText = `ZeroDivisionError: division by zero\n${'log line\n'.repeat(
      Math.ceil(MAX_ERROR_TEXT_LENGTH / 9) + 1,
    )}`

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.likelyCause).toMatch(/longer than/i)
    expect(result.limitations.join(' ')).toContain(
      MAX_ERROR_TEXT_LENGTH.toLocaleString(),
    )
  })
})
