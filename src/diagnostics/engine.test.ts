import { describe, expect, it } from 'vitest'
import { MAX_ERROR_TEXT_LENGTH, diagnose } from './engine'
import type { DiagnosticInput } from './types'

describe('diagnose', () => {
  it('names a missing Python module from the final exception line with evidence and a fix', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "/home/ana/project/app.py", line 2, in <module>',
      '    import requests',
      "ModuleNotFoundError: No module named 'requests'",
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('missing-module')
    expect(result.matchedSignature).toContain('ModuleNotFoundError')
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'error text',
          quote: "ModuleNotFoundError: No module named 'requests'",
          lineNumber: 4,
        }),
      ]),
    )
    expect(result.possibleFix).not.toBeNull()
    expect(result.possibleFix?.exampleCode).toContain('pip install requests')
    expect(result.confidence.level).toBe('high')
    expect(result.confidence.reason.length).toBeGreaterThan(0)
  })

  it('uses the final exception line when earlier traceback text contains another error', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "/home/ana/project/app.py", line 2, in <module>',
      "    load_user()",
      "KeyError: 'user_id'",
      '',
      'During handling of the above exception, another exception occurred:',
      'Traceback (most recent call last):',
      '  File "/home/ana/project/app.py", line 5, in <module>',
      "    fallback()",
      "NameError: name 'fallback' is not defined",
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('undefined-name')
    expect(result.matchedSignature).toContain('NameError')
    expect(result.evidence[0]).toEqual(
      expect.objectContaining({
        source: 'error text',
        quote: "NameError: name 'fallback' is not defined",
        lineNumber: 10,
      }),
    )
  })

  it('adds a matching line from the supplied code as evidence', () => {
    const result = diagnose({
      language: 'auto',
      errorText: "ModuleNotFoundError: No module named 'requests'",
      codeSnippet: [
        'import json',
        'import requests',
        '',
        'def fetch():',
        '    return requests.get("https://example.test")',
      ].join('\n'),
    })

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'code snippet',
          quote: 'import requests',
          lineNumber: 2,
        }),
      ]),
    )
  })

  it.each(['subtotal = 10', 'total_count = 1', 'my_total = 2', '$total = 1'])(
    'does not quote %s as snippet evidence for the identifier total',
    (codeSnippet) => {
      const result = diagnose({
        language: 'auto',
        errorText: "NameError: name 'total' is not defined",
        codeSnippet,
      })

      expect(
        result.evidence.filter((item) => item.source === 'code snippet'),
      ).toEqual([])
    },
  )

  it.each(['total', 'total = 1', 'print(total)', 'x = total + 1', 'total+=1'])(
    'quotes the whole-identifier line %s as snippet evidence',
    (codeSnippet) => {
      const result = diagnose({
        language: 'auto',
        errorText: "NameError: name 'total' is not defined",
        codeSnippet,
      })

      expect(result.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'code snippet',
            quote: codeSnippet,
            lineNumber: 1,
          }),
        ]),
      )
    },
  )

  it('quotes the matching line in the reported subtotal scenario end to end', () => {
    const result = diagnose({
      language: 'auto',
      errorText: "NameError: name 'total' is not defined",
      codeSnippet: ['subtotal = 10', 'total = 0', 'print(total)'].join('\n'),
    })

    expect(result.category).toBe('undefined-name')
    expect(result.evidence[0]).toEqual(
      expect.objectContaining({
        source: 'error text',
        quote: "NameError: name 'total' is not defined",
      }),
    )
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'code snippet',
          quote: 'total = 0',
          lineNumber: 2,
        }),
      ]),
    )
    expect(
      result.evidence.filter((item) => item.source === 'code snippet'),
    ).toHaveLength(1)
  })

  it('matches a dotted token only when the whole dotted identifier appears', () => {
    const result = diagnose({
      language: 'auto',
      errorText: "AttributeError: module 'pkg.sub' has no attribute 'load'",
      codeSnippet: ['mypkg.sub', 'import pkg.sub'].join('\n'),
    })

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'code snippet',
          quote: 'import pkg.sub',
          lineNumber: 2,
        }),
      ]),
    )
    expect(
      result.evidence.filter((item) => item.source === 'code snippet'),
    ).toHaveLength(1)
  })

  it('escapes regular expression characters in snippet tokens', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        "FileNotFoundError: [Errno 2] No such file or directory: 'data/input(1).csv'",
      codeSnippet: [
        "open('data/input(1)Xcsv')",
        "open('data/input(1).csv')",
      ].join('\n'),
    })

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'code snippet',
          quote: "open('data/input(1).csv')",
          lineNumber: 2,
        }),
      ]),
    )
    expect(
      result.evidence.filter((item) => item.source === 'code snippet'),
    ).toHaveLength(1)
  })

  it('uses Python traceback evidence to resolve a Python TypeError', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "/home/ana/project/calc.py", line 3, in <module>',
      "    total = '1' + 2",
      "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toContain('Python')
    expect(result.confidence.level).toBe('high')
    expect(result.confidence.reason).toMatch(/Python/i)
  })

  it('uses JavaScript stack evidence to resolve a JavaScript TypeError', () => {
    const errorText = [
      "TypeError: Cannot read properties of undefined (reading 'name')",
      '    at renderProfile (src/profile.js:12:18)',
      '    at main (src/main.js:4:3)',
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe(
      "TypeError: Cannot read properties of undefined (reading 'name')",
    )
    expect(result.confidence.level).toBe('high')
    expect(result.confidence.reason).toMatch(/JavaScript/i)
  })

  it('does not guess a language for a generic error line without evidence', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'TypeError: a value was not what the function expected',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.likelyCause).toMatch(/cannot determine|not enough/i)
    expect(result.evidence).toEqual([])
    expect(result.debuggingSteps.length).toBeGreaterThan(0)
    expect(result.confidence.level).toBe('low')
  })

  it('uses reproduction details as language evidence for a generic error line', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'TypeError: a value was not what the function expected',
      reproductionDetails:
        'The failing run was node app.js and the stack ended in node:internal.',
    })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toContain('JavaScript')
    expect(result.confidence.reason).toMatch(/JavaScript/i)
  })

  it('keeps an explicit language from diagnosing another runtime', () => {
    const result = diagnose({
      language: 'python',
      errorText: 'ReferenceError: cart is not defined',
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('marks a JavaScript signature as uncertain when the traceback points to Python', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "/home/ana/project/worker.py", line 4, in <module>',
      '    run_task()',
      'ReferenceError: task is not defined',
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('undefined-name')
    expect(result.matchedSignature).toContain('ReferenceError')
    expect(result.confidence.level).toBe('low')
    expect(result.confidence.reason).toMatch(/conflict|uncertain/i)
  })

  it('reports competing generic matches without overstating confidence', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "/home/ana/project/worker.py", line 3, in <module>',
      'TypeError: a value was not what the function expected',
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('type-mismatch')
    expect(result.confidence.level).toBe('medium')
    expect(result.confidence.reason).toMatch(/competing/i)
  })

  it('falls back to medium confidence for a lone specific signature', () => {
    const result = diagnose({
      language: 'auto',
      errorText: "ModuleNotFoundError: No module named 'requests'",
    })

    expect(result.category).toBe('missing-module')
    expect(result.confidence.level).toBe('medium')
    expect(result.confidence.reason).toMatch(/no traceback|not confirm|explicit/i)
  })

  it('prefers a specific JavaScript signature over a competing generic match', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'TypeError: items is not iterable',
    })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe('TypeError: items is not iterable')
    expect(result.confidence.level).toBe('medium')
    expect(result.confidence.reason).toMatch(/more specific/i)
  })

  it('does not describe a generic signature as specific in its confidence reason', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'ImportError: something unusual happened',
    })

    expect(result.category).toBe('import-failure')
    expect(result.matchedSignature).toBe('ImportError: <import failure>')
    expect(result.confidence.level).toBe('low')
    expect(result.confidence.reason).toMatch(/generic/i)
    expect(result.confidence.reason).not.toMatch(/specific .*signature/i)
  })

  it.each([
    ['empty text', ''],
    ['whitespace-only text', '  \n\t '],
    [
      'unsupported error text',
      'RuntimeError: something unusual happened',
    ],
    [
      'a prose mention of an error',
      'A teammate mentioned TypeError and SyntaxError, but the final log line was cut off.',
    ],
  ])('returns general guidance for %s without inventing a cause', (_name, errorText) => {
    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.likelyCause).toMatch(/no cause|cannot determine|not enough/i)
    expect(result.evidence).toEqual([])
    expect(result.debuggingSteps.length).toBeGreaterThan(0)
    expect(result.possibleFix).toBeNull()
    expect(result.verificationSteps.length).toBeGreaterThan(0)
    expect(result.confidence.level).toBe('low')
    expect(result.limitations.length).toBeGreaterThan(0)
  })

  it('refuses an oversized input instead of analyzing a truncated buffer', () => {
    const errorText = `ModuleNotFoundError: No module named 'requests'\n${'log line\n'.repeat(
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

  it('handles malformed requests without throwing', () => {
    const malformedRequests: unknown[] = [
      null,
      undefined,
      {},
      { language: 'ruby', errorText: 'ReferenceError: value is not defined' },
      { language: 'auto', errorText: 42 },
    ]

    for (const request of malformedRequests) {
      let result: ReturnType<typeof diagnose> | undefined
      expect(() => {
        result = diagnose(request as DiagnosticInput)
      }).not.toThrow()
      expect(result?.category).toBe('unrecognized')
      expect(result?.matchedSignature).toBeNull()
      expect(result?.possibleFix).toBeNull()
      expect(result?.confidence.level).toBe('low')
    }
  })
})
