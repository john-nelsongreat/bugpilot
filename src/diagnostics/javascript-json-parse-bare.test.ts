import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import { javascriptJsonParseErrorRule } from './rules/javascript'

interface BareCase {
  name: string
  line: string
  signature: string
}

const BARE_CASES: BareCase[] = [
  {
    name: 'Firefox unexpected character',
    line:
      'JSON.parse: unexpected character at line 1 column 1 of the JSON data',
    signature: 'SyntaxError: JSON.parse: unexpected character',
  },
  {
    name: 'Firefox unexpected end of data',
    line:
      'JSON.parse: unexpected end of data at line 1 column 1 of the JSON data',
    signature: 'SyntaxError: JSON.parse: unexpected end of data',
  },
  {
    name: 'Safari unrecognised token',
    line: "JSON Parse error: Unrecognized token '<'",
    signature: "SyntaxError: JSON Parse error: Unrecognized token '<'",
  },
  {
    name: 'Safari end of file',
    line: 'JSON Parse error: Unexpected EOF',
    signature: 'SyntaxError: JSON Parse error: Unexpected EOF',
  },
  {
    name: 'V8 newer HTML token',
    line: `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
    signature: "SyntaxError: Unexpected token '<', ... is not valid JSON",
  },
  {
    name: 'V8 older HTML token',
    line: 'Unexpected token < in JSON at position 0',
    signature: "SyntaxError: Unexpected token '<' in JSON at position <position>",
  },
  {
    name: 'V8 empty input',
    line: 'Unexpected end of JSON input',
    signature: 'SyntaxError: Unexpected end of JSON input',
  },
  {
    name: 'V8 undefined string',
    line: '"undefined" is not valid JSON',
    signature: 'SyntaxError: "undefined" is not valid JSON',
  },
]

const LOOKALIKES = [
  [
    'timestamp-prefixed Firefox message',
    '2026-10-29T10:00:00Z JSON.parse: unexpected character at line 1 column 1 of the JSON data',
  ],
  [
    'timestamp-prefixed empty input',
    '2026-10-29T10:00:00Z Unexpected end of JSON input',
  ],
  [
    'mid-sentence prose mention',
    'The log says JSON.parse: unexpected character at line 1 column 1 of the JSON data',
  ],
  [
    'sentence that only mentions JSON',
    'The response was JSON but it did not parse.',
  ],
  ['a different error class', 'Error: Unexpected end of JSON input'],
  [
    'trailing text after the message',
    'Unexpected end of JSON input (response was truncated)',
  ],
  ['generic unexpected token', 'Unexpected token }'],
  ['generic unexpected token with a bracket', "Unexpected token '<'"],
]

describe('bare JSON parser messages', () => {
  it.each(BARE_CASES)(
    '$name is recognised at the start of a line in Auto mode',
    ({ line, signature }) => {
      const result = diagnose({ language: 'auto', errorText: line })

      expect(result.category).toBe('json-decode-error')
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('medium')
      expect(result.possibleFix).not.toBeNull()
      expect(javascriptJsonParseErrorRule.match(line)?.signature).toBe(
        signature,
      )
    },
  )

  it.each(BARE_CASES)(
    '$name keeps the same cause and advice as the prefixed form',
    ({ line }) => {
      const bare = diagnose({ language: 'auto', errorText: line })
      const prefixed = diagnose({
        language: 'auto',
        errorText: `SyntaxError: ${line}`,
      })

      expect(prefixed.confidence.level).toBe('high')
      expect(bare.category).toBe(prefixed.category)
      expect(bare.matchedSignature).toBe(prefixed.matchedSignature)
      expect(bare.likelyCause).toBe(prefixed.likelyCause)
      expect(bare.debuggingSteps).toEqual(prefixed.debuggingSteps)
      expect(bare.possibleFix).toEqual(prefixed.possibleFix)
      expect(bare.verificationSteps).toEqual(prefixed.verificationSteps)
      expect(bare.limitations).toEqual(prefixed.limitations)
      expect(bare.alternativeExplanations).toEqual(
        prefixed.alternativeExplanations,
      )
    },
  )

  it.each(LOOKALIKES)('does not claim %s', (_name, line) => {
    const result = diagnose({ language: 'auto', errorText: line })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
    expect(javascriptJsonParseErrorRule.match(line)).toBeNull()
  })

  it('keeps a bare Python JSONDecodeError in the Python rule', () => {
    const line =
      'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)'
    const result = diagnose({ language: 'auto', errorText: line })

    expect(result.category).toBe('json-decode-error')
    expect(result.matchedSignature).toBe(
      'JSONDecodeError: <invalid JSON payload>',
    )
    expect(result.confidence.level).toBe('medium')
    expect(javascriptJsonParseErrorRule.match(line)).toBeNull()
  })

  it('keeps a Python traceback with a JSONDecodeError at high confidence', () => {
    const text = [
      'Traceback (most recent call last):',
      '  File "app.py", line 4, in <module>',
      'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    ].join('\n')
    const result = diagnose({ language: 'auto', errorText: text })

    expect(result.category).toBe('json-decode-error')
    expect(result.matchedSignature).toBe(
      'JSONDecodeError: <invalid JSON payload>',
    )
    expect(result.confidence.level).toBe('high')
  })
})
