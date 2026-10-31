import { describe, expect, it } from 'vitest'
import { diagnose, MAX_ERROR_TEXT_LENGTH } from './engine'
import {
  DIAGNOSTIC_CATEGORY_LABELS,
  diagnosticCategoryLabel,
} from './labels'
import {
  javascriptCorsBlockedRule,
  javascriptJsonParseErrorRule,
  javascriptNetworkRequestFailedRule,
  javascriptReactErrorRule,
  javascriptRules,
  javascriptSyntaxErrorRule,
  javascriptTypeErrorRule,
} from './rules/javascript'
import type { DiagnosticResult } from './types'

const JS_FRAMES = [
  '    at handleClick (src/components/Cart.jsx:24:11)',
  '    at HTMLButtonElement.dispatch (node_modules/react-dom/cjs/react-dom.development.js:1:1)',
].join('\n')

interface RuleCase {
  name: string
  input: string
  signature: string
  category: string
  cause: RegExp
}

const JSON_CASES: RuleCase[] = [
  {
    name: 'V8 older HTML token',
    input: "SyntaxError: Unexpected token < in JSON at position 0",
    signature: "SyntaxError: Unexpected token '<' in JSON at position <position>",
    category: 'json-decode-error',
    cause: /HTML|error page|index\.html/i,
  },
  {
    name: 'V8 newer HTML token',
    input: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
    signature: "SyntaxError: Unexpected token '<', ... is not valid JSON",
    category: 'json-decode-error',
    cause: /HTML|error page|index\.html/i,
  },
  {
    name: 'Firefox unexpected character',
    input:
      'SyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data',
    signature: 'SyntaxError: JSON.parse: unexpected character',
    category: 'json-decode-error',
    cause: /not valid JSON|unexpected token|HTML/i,
  },
  {
    name: 'Safari unrecognised token',
    input: "SyntaxError: JSON Parse error: Unrecognized token '<'",
    signature: "SyntaxError: JSON Parse error: Unrecognized token '<'",
    category: 'json-decode-error',
    cause: /HTML|error page|index\.html/i,
  },
  {
    name: 'V8 older undefined token',
    input: 'SyntaxError: Unexpected token u in JSON at position 0',
    signature: 'SyntaxError: Unexpected token u in JSON at position 0',
    category: 'json-decode-error',
    cause: /undefined/i,
  },
  {
    name: 'V8 newer undefined string',
    input: 'SyntaxError: "undefined" is not valid JSON',
    signature: 'SyntaxError: "undefined" is not valid JSON',
    category: 'json-decode-error',
    cause: /undefined/i,
  },
  {
    name: 'V8 empty input',
    input: 'SyntaxError: Unexpected end of JSON input',
    signature: 'SyntaxError: Unexpected end of JSON input',
    category: 'json-decode-error',
    cause: /empty|truncat|end/i,
  },
  {
    name: 'Firefox truncated input',
    input:
      'SyntaxError: JSON.parse: unexpected end of data at line 1 column 1 of the JSON data',
    signature: 'SyntaxError: JSON.parse: unexpected end of data',
    category: 'json-decode-error',
    cause: /empty|truncat|end/i,
  },
  {
    name: 'Safari EOF',
    input: 'SyntaxError: JSON Parse error: Unexpected EOF',
    signature: 'SyntaxError: JSON Parse error: Unexpected EOF',
    category: 'json-decode-error',
    cause: /empty|truncat|end/i,
  },
  {
    name: 'other invalid JSON token',
    input: "SyntaxError: Unexpected token '}', ... is not valid JSON",
    signature: 'SyntaxError: <invalid JSON payload>',
    category: 'json-decode-error',
    cause: /not valid JSON|unexpected token/i,
  },
]

const NETWORK_CASES: RuleCase[] = [
  {
    name: 'Chrome failed to fetch',
    input: 'TypeError: Failed to fetch',
    signature: 'TypeError: Failed to fetch',
    category: 'network-request-failed',
    cause: /server|URL|network|request/i,
  },
  {
    name: 'Firefox network error',
    input: 'TypeError: NetworkError when attempting to fetch resource.',
    signature: 'TypeError: NetworkError when attempting to fetch resource.',
    category: 'network-request-failed',
    cause: /server|URL|network|request/i,
  },
  {
    name: 'Node fetch failed',
    input: 'TypeError: fetch failed',
    signature: 'TypeError: fetch failed',
    category: 'network-request-failed',
    cause: /server|URL|network|request|DNS|TLS/i,
  },
  {
    name: 'Chrome connection refused console line',
    input: 'GET http://localhost:3000/api net::ERR_CONNECTION_REFUSED',
    signature: 'net::ERR_CONNECTION_REFUSED',
    category: 'network-request-failed',
    cause: /server|refused|running/i,
  },
  {
    name: 'Chrome name not resolved',
    input: 'net::ERR_NAME_NOT_RESOLVED',
    signature: 'net::ERR_NAME_NOT_RESOLVED',
    category: 'network-request-failed',
    cause: /DNS|name|resolved/i,
  },
  {
    name: 'Chrome internet disconnected',
    input: 'net::ERR_INTERNET_DISCONNECTED',
    signature: 'net::ERR_INTERNET_DISCONNECTED',
    category: 'network-request-failed',
    cause: /internet|network|connect/i,
  },
  {
    name: 'Chrome certificate error',
    input: 'GET https://localhost:3000/api net::ERR_CERT_AUTHORITY_INVALID',
    signature: 'net::ERR_CERT_<reason>',
    category: 'network-request-failed',
    cause: /certificate|TLS|HTTPS/i,
  },
]

const CORS_BASE =
  "Access to fetch at 'http://localhost:3000/api' from origin 'http://localhost:5173' has been blocked by CORS policy: "

const CORS_CASES: RuleCase[] = [
  {
    name: 'missing allow-origin header',
    input:
      CORS_BASE +
      "No 'Access-Control-Allow-Origin' header is present on the requested resource.",
    signature:
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: missing 'Access-Control-Allow-Origin' header",
    category: 'cors-blocked',
    cause: /Access-Control-Allow-Origin/,
  },
  {
    name: 'preflight rejected',
    input:
      "Access to fetch at 'https://api.example.com/data' from origin 'https://app.example.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
    signature:
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: preflight request does not pass access control check",
    category: 'cors-blocked',
    cause: /preflight|OPTIONS/i,
  },
  {
    name: 'origin mismatch',
    input:
      "Access to fetch at 'https://api.example.com/data' from origin 'https://app.example.com' has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header has a value 'https://other.example.com' that is not equal to the supplied origin.",
    signature:
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: 'Access-Control-Allow-Origin' does not match the supplied origin",
    category: 'cors-blocked',
    cause: /match|origin/i,
  },
  {
    name: 'credentials wildcard',
    input:
      "Access to fetch at 'https://api.example.com/me' from origin 'https://app.example.com' has been blocked by CORS policy: The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.",
    signature:
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: credentials mode cannot use a wildcard origin",
    category: 'cors-blocked',
    cause: /credentials|wildcard|\*/i,
  },
  {
    name: 'XMLHttpRequest variant',
    input:
      "Access to XMLHttpRequest at 'http://localhost:3000/api' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
    signature:
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: missing 'Access-Control-Allow-Origin' header",
    category: 'cors-blocked',
    cause: /Access-Control-Allow-Origin/,
  },
]

const REACT_CASES: RuleCase[] = [
  {
    name: 'invalid hook call',
    input:
      'Uncaught Error: Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:',
    signature:
      'Error: Invalid hook call. Hooks can only be called inside of the body of a function component.',
    category: 'react-error',
    cause: /hooks?|Rules of Hooks/i,
  },
  {
    name: 'invalid hook call without prefix',
    input:
      'Invalid hook call. Hooks can only be called inside of the body of a function component.',
    signature:
      'Error: Invalid hook call. Hooks can only be called inside of the body of a function component.',
    category: 'react-error',
    cause: /hooks?|Rules of Hooks/i,
  },
  {
    name: 'too many re-renders',
    input:
      'Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.',
    signature:
      'Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.',
    category: 'react-error',
    cause: /render|state/i,
  },
  {
    name: 'maximum update depth',
    input:
      'Uncaught Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.',
    signature: 'Error: Maximum update depth exceeded.',
    category: 'react-error',
    cause: /effect|dependenc|update/i,
  },
  {
    name: 'object as React child',
    input:
      'Error: Objects are not valid as a React child (found: object with keys {name, age}). If you meant to render a collection of children, use an array instead.',
    signature: 'Error: Objects are not valid as a React child (found: <value>)',
    category: 'react-error',
    cause: /object|array|render/i,
  },
]

function expectComplete(result: DiagnosticResult, input: string) {
  expect(result.evidence).toEqual([
    expect.objectContaining({
      source: 'error text',
      quote: input,
      lineNumber: 1,
    }),
  ])
  expect(result.likelyCause.trim()).not.toBe('')
  expect(result.debuggingSteps.length).toBeGreaterThan(0)
  expect(result.possibleFix).not.toBeNull()
  expect(result.possibleFix?.explanation.trim()).not.toBe('')
  expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
  expect(result.possibleFix?.exampleCode.trim()).not.toBe('')
  expect(result.verificationSteps.length).toBeGreaterThan(0)
  expect(result.limitations.length).toBeGreaterThan(0)
  expect(result.alternativeExplanations.length).toBeGreaterThan(0)
}

describe('Browser, network, JSON and React rules', () => {
  describe.each([
    ['JSON parse', javascriptJsonParseErrorRule, JSON_CASES],
    ['network request', javascriptNetworkRequestFailedRule, NETWORK_CASES],
    ['CORS', javascriptCorsBlockedRule, CORS_CASES],
    ['React', javascriptReactErrorRule, REACT_CASES],
  ] as const)('%s rule', (_label, rule, cases) => {
    it.each(cases)(
      '$name produces a specific high-confidence result',
      ({ input, signature, category, cause }) => {
        expect(rule.match(input)).not.toBeNull()

        const result = diagnose({ language: 'javascript', errorText: input })

        expect(result.category).toBe(category)
        expect(result.matchedSignature).toBe(signature)
        expect(result.confidence.level).toBe('high')
        expect(result.likelyCause).toMatch(cause)
        expectComplete(result, input)
      },
    )
  })

  it.each(NETWORK_CASES)(
    '$name is recognised in Auto from its signature',
    ({ input, signature, category }) => {
      const result = diagnose({ language: 'auto', errorText: input })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
      expect(result.confidence.reason).toMatch(/JavaScript/i)
    },
  )

  it.each(CORS_CASES)(
    '$name is recognised in Auto from the console message',
    ({ input, signature, category }) => {
      const result = diagnose({ language: 'auto', errorText: input })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
      expect(result.confidence.reason).toMatch(/JavaScript/i)
    },
  )

  it('keeps Safari "Load failed" at low confidence because the wording is generic', () => {
    const explicit = diagnose({
      language: 'javascript',
      errorText: 'TypeError: Load failed',
    })

    expect(explicit.category).toBe('network-request-failed')
    expect(explicit.matchedSignature).toBe('TypeError: Load failed')
    expect(explicit.confidence.level).toBe('low')
    expect(explicit.confidence.reason).toMatch(/generic|less certain|cannot/i)

    const auto = diagnose({
      language: 'auto',
      errorText: 'TypeError: Load failed',
    })

    expect(auto.category).toBe('network-request-failed')
    expect(auto.matchedSignature).toBe('TypeError: Load failed')
    expect(auto.confidence.level).toBe('low')
    expect(auto.confidence.reason).toMatch(/generic|less certain|cannot/i)
  })

  it.each([
    ...JSON_CASES,
    ...REACT_CASES.filter(
      (testCase) => testCase.name !== 'invalid hook call without prefix',
    ),
    ...NETWORK_CASES.filter((testCase) => testCase.input.startsWith('TypeError:')),
  ])(
    '$name is recognised in Auto with JavaScript stack frames',
    ({ input, signature, category }) => {
      const result = diagnose({
        language: 'auto',
        errorText: `${input}\n${JS_FRAMES}`,
      })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
      expect(result.confidence.reason).toMatch(/JavaScript/i)
    },
  )

  it('uses Node cause details to explain a fetch failure without inventing one', () => {
    const errorText = [
      'TypeError: fetch failed',
      '    at node:internal/deps/undici/undici:12345:11',
      '  [cause]: Error: connect ECONNREFUSED 127.0.0.1:3000',
    ].join('\n')

    const result = diagnose({ language: 'javascript', errorText })

    expect(result.category).toBe('network-request-failed')
    expect(result.matchedSignature).toBe('TypeError: fetch failed')
    expect(result.likelyCause).toMatch(/ECONNREFUSED|refused/i)

    const withoutCause = diagnose({
      language: 'javascript',
      errorText: 'TypeError: fetch failed',
    })
    expect(withoutCause.likelyCause).not.toMatch(/ECONNREFUSED/)
    expect(withoutCause.likelyCause).toMatch(/hidden|may|likely/i)
  })

  it('does not invent a CORS cause from a plain failed fetch', () => {
    const result = diagnose({ language: 'javascript', errorText: 'TypeError: Failed to fetch' })

    expect(result.category).toBe('network-request-failed')
    expect(JSON.stringify(result)).not.toMatch(/blocked by CORS policy/i)
    expect(result.likelyCause).toMatch(/CORS|security|may/i)
  })
})

describe('JSON rule boundaries', () => {
  it('takes precedence over the generic JavaScript syntax rule for JSON messages', () => {
    const line = 'SyntaxError: Unexpected token < in JSON at position 0'

    expect(javascriptSyntaxErrorRule.match(line)).not.toBeNull()
    expect(javascriptJsonParseErrorRule.match(line)).not.toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('json-decode-error')
    expect(result.matchedSignature).toBe(
      "SyntaxError: Unexpected token '<' in JSON at position <position>",
    )
  })

  it.each([
    ["SyntaxError: Unexpected token '}'", 'syntax-error'],
    ['SyntaxError: Invalid or unexpected token', 'syntax-error'],
    ['SyntaxError: Unexpected identifier', 'syntax-error'],
  ] as const)(
    'leaves the ordinary SyntaxError %s to the existing rule',
    (line, category) => {
      expect(javascriptJsonParseErrorRule.match(line)).toBeNull()

      const result = diagnose({ language: 'javascript', errorText: line })
      expect(result.category).toBe(category)
      expect(result.matchedSignature).not.toMatch(/JSON/i)
    },
  )

  it.each([
    "2026-10-28T10:00:00Z SyntaxError: Unexpected token < in JSON at position 0",
    "The console printed SyntaxError: Unexpected token < in JSON at position 0 yesterday.",
    'throw new Error("SyntaxError: Unexpected token < in JSON at position 0")',
  ])('does not claim the JSON message inside another line: %s', (line) => {
    expect(javascriptJsonParseErrorRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })

  it('keeps a Python JSONDecodeError with Python guidance', () => {
    const line = 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)'
    const result = diagnose({ language: 'python', errorText: line })

    expect(result.category).toBe('json-decode-error')
    expect(result.matchedSignature).toBe('JSONDecodeError: <invalid JSON payload>')
    expect(result.likelyCause).toMatch(/JSON|parse|decode/i)
  })

  it('keeps Python JSONDecodeError lines out of the JavaScript rule', () => {
    expect(javascriptJsonParseErrorRule.match(
      'json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)',
    )).toBeNull()
  })
})

describe('Network rule boundaries', () => {
  it('takes precedence over the generic JavaScript TypeError rule for fetch messages', () => {
    const line = 'TypeError: Failed to fetch'

    expect(javascriptTypeErrorRule.match(line)).not.toBeNull()
    expect(javascriptNetworkRequestFailedRule.match(line)).not.toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.category).toBe('network-request-failed')
    expect(result.matchedSignature).toBe('TypeError: Failed to fetch')
  })

  it.each([
    ['TypeError: x is not a function', 'type-mismatch'],
    [
      "TypeError: Cannot read properties of undefined (reading 'name')",
      'type-mismatch',
    ],
    ['TypeError: Assignment to constant variable.', 'type-mismatch'],
  ] as const)(
    'leaves the ordinary TypeError %s to the existing rule',
    (line, category) => {
      expect(javascriptNetworkRequestFailedRule.match(line)).toBeNull()

      const result = diagnose({ language: 'javascript', errorText: line })
      expect(result.category).toBe(category)
      expect(result.matchedSignature).not.toMatch(/fetch|network/i)
    },
  )

  it.each([
    'Failed to fetch the report from the API',
    '2026-10-28T10:00:00Z TypeError: Failed to fetch',
    'The error message said TypeError: Failed to fetch',
    'net::ERR_CONNECTION_REFUSED was printed in the build log',
  ])('does not claim a mention outside an error line: %s', (line) => {
    expect(javascriptNetworkRequestFailedRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
  })

  it('keeps Python connection errors with Python language selection unrecognised', () => {
    const result = diagnose({
      language: 'python',
      errorText: 'requests.exceptions.ConnectionError: HTTPSConnectionPool(host=\'api.example.com\', port=443)',
    })

    expect(result.category).toBe('unrecognized')
  })
})

describe('CORS rule boundaries', () => {
  it.each([
    'Access to fetch at \'http://x\' from origin \'http://y\' failed because the network is offline.',
    "2026-10-28T10:00:00Z Access to fetch at 'http://x' from origin 'http://y' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
    "The developer said Access to fetch at 'http://x' from origin 'http://y' has been blocked by CORS policy.",
  ])('does not claim a non-CORS or embedded mention: %s', (line) => {
    expect(javascriptCorsBlockedRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
  })

  it('explains that the browser enforces CORS and the server must fix it', () => {
    const line =
      CORS_BASE +
      "No 'Access-Control-Allow-Origin' header is present on the requested resource."
    const result = diagnose({ language: 'javascript', errorText: line })
    const fix = result.possibleFix?.explanation ?? ''

    expect(fix).toMatch(/server/i)
    expect(fix).toMatch(/Access-Control-Allow-Origin/)
    expect(fix).toMatch(/cannot|can not/i)
    expect(fix).toMatch(/no-cors/i)
    expect(fix).toMatch(/proxy/i)
    expect(fix).not.toMatch(/disable (browser )?security/i)
  })

  it('warns that credentials and a wildcard origin cannot be combined', () => {
    const line =
      "Access to fetch at 'https://api.example.com/me' from origin 'https://app.example.com' has been blocked by CORS policy: The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'."
    const result = diagnose({ language: 'javascript', errorText: line })

    expect(result.possibleFix?.explanation).toMatch(/credentials/i)
    expect(result.possibleFix?.explanation).toMatch(/wildcard|\*/)
    expect(result.possibleFix?.explanation).toMatch(/specific origin|exact origin/i)
  })
})

describe('React rule boundaries', () => {
  it.each([
    'The console showed Invalid hook call while loading the page.',
    '2026-10-28T10:00:00Z Warning: Invalid hook call. Hooks can only be called inside of the body of a function component.',
    'Error: Objects are not valid as a React child',
    'Error: Something else in a React component failed.',
  ])('does not claim a React mention without the exact message: %s', (line) => {
    expect(javascriptReactErrorRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).not.toBe('react-error')
  })

  it('accepts the exact Invalid hook call sentence with a Warning prefix', () => {
    const result = diagnose({
      language: 'javascript',
      errorText:
        'Warning: Invalid hook call. Hooks can only be called inside of the body of a function component.',
    })

    expect(result.category).toBe('react-error')
    expect(result.confidence.level).toBe('medium')
  })

  it('mentions the Rules of Hooks and duplicate React copies', () => {
    const result = diagnose({
      language: 'javascript',
      errorText:
        'Invalid hook call. Hooks can only be called inside of the body of a function component.',
    })
    const text = JSON.stringify(result)

    expect(text).toMatch(/Rules of Hooks/i)
    expect(text).toMatch(/react-dom|react and react-dom/i)
    expect(text).toMatch(/two copies|duplicate|more than one copy/i)
  })

  it('mentions a state setter called during render for too many re-renders', () => {
    const result = diagnose({
      language: 'javascript',
      errorText:
        'Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.',
    })
    const text = JSON.stringify(result)

    expect(text).toMatch(/setState|state setter/i)
    expect(text).toMatch(/render/i)
    expect(text).toMatch(/onClick/i)
  })

  it('mentions an effect or update loop for maximum update depth', () => {
    const result = diagnose({
      language: 'javascript',
      errorText:
        'Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.',
    })
    const text = JSON.stringify(result)

    expect(text).toMatch(/effect|useEffect/i)
    expect(text).toMatch(/dependenc/i)
  })

  it('mentions mapping objects to elements for an invalid React child', () => {
    const result = diagnose({
      language: 'javascript',
      errorText:
        'Error: Objects are not valid as a React child (found: object with keys {name, age}).',
    })
    const text = JSON.stringify(result)

    expect(text).toMatch(/map/i)
    expect(text).toMatch(/string|element/i)
  })
})

describe('Language detection and precedence proof', () => {
  it('declares the documented supersedes relations', () => {
    expect(javascriptJsonParseErrorRule.supersedes).toEqual([
      'javascript.syntax-error',
    ])
    expect(javascriptNetworkRequestFailedRule.supersedes).toEqual([
      'javascript.type-error',
    ])
    expect(javascriptCorsBlockedRule.supersedes ?? []).toEqual([])
    expect(javascriptReactErrorRule.supersedes ?? []).toEqual([])
  })

  it.each([
    ["SyntaxError: Unexpected token '<' in JSON at position 0", 'json-decode-error'],
    ['TypeError: Failed to fetch', 'network-request-failed'],
    ['net::ERR_CONNECTION_REFUSED', 'network-request-failed'],
    [
      "Access to fetch at 'http://localhost:3000/api' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
      'cors-blocked',
    ],
    [
      'Invalid hook call. Hooks can only be called inside of the body of a function component.',
      'react-error',
    ],
  ] as const)('detects JavaScript in Auto for %s', (line, category) => {
    const result = diagnose({ language: 'auto', errorText: line })

    expect(result.category).toBe(category)
    expect(result.confidence.level).toBe('high')
    expect(result.confidence.reason).toMatch(/JavaScript/i)
  })

  it('lowers confidence when Python context surrounds a new signature', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "/home/ana/project/app.py", line 4, in <module>',
      "    data = json.loads('<!DOCTYPE html>')",
      "SyntaxError: Unexpected token '<' in JSON at position 0",
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.confidence.level).toBe('low')
    expect(result.confidence.reason).toMatch(/conflict|uncertain/i)
  })

  it.each([
    [
      'ReferenceError: cart is not defined',
      'undefined-name',
      'ReferenceError: <name> is not defined',
      'high',
    ],
    [
      'TypeError: Cannot convert undefined or null to object',
      'type-mismatch',
      'TypeError: <JavaScript value type problem>',
      'high',
    ],
    [
      "SyntaxError: Unexpected token '}'",
      'syntax-error',
      'SyntaxError: <JavaScript parser error>',
      'high',
    ],
    [
      "Error: Cannot find module 'express'",
      'missing-module',
      "Error: Cannot find module '<package>'",
      'high',
    ],
    [
      'Error: listen EADDRINUSE: address already in use :::3000',
      'port-in-use',
      'Error: listen EADDRINUSE: address already in use <address>',
      'high',
    ],
    [
      "Error: ENOENT: no such file or directory, open 'C:\\app\\config.json'",
      'missing-file',
      "Error: ENOENT: no such file or directory, <operation> '<path>'",
      'high',
    ],
    [
      "Error: EACCES: permission denied, mkdir '/var/app/cache'",
      'permission-denied',
      "Error: EACCES: permission denied, <operation> '<path>'",
      'high',
    ],
    [
      'RangeError: Maximum call stack size exceeded',
      'recursion-error',
      'RangeError: Maximum call stack size exceeded',
      'high',
    ],
  ] as const)(
    'keeps the existing result for %s',
    (line, category, signature, confidence) => {
      const result = diagnose({ language: 'javascript', errorText: line })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe(confidence)
    },
  )

  it('keeps an existing Python result unchanged', () => {
    const result = diagnose({
      language: 'python',
      errorText: "ModuleNotFoundError: No module named 'requests'",
    })

    expect(result.category).toBe('missing-module')
    expect(result.matchedSignature).toBe(
      "ModuleNotFoundError: No module named '<module>'",
    )
    expect(result.confidence.level).toBe('high')
  })
})

describe('Input limits and labels', () => {
  it('rejects empty input', () => {
    const result = diagnose({ language: 'javascript', errorText: '' })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })

  it('rejects oversized input instead of analysing it', () => {
    const result = diagnose({
      language: 'javascript',
      errorText:
        'TypeError: Failed to fetch' +
        'x'.repeat(MAX_ERROR_TEXT_LENGTH),
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })

  it('registers the new categories with readable labels', () => {
    expect(DIAGNOSTIC_CATEGORY_LABELS['network-request-failed']).toBe(
      'Network request failed',
    )
    expect(DIAGNOSTIC_CATEGORY_LABELS['cors-blocked']).toBe(
      'CORS blocked request',
    )
    expect(DIAGNOSTIC_CATEGORY_LABELS['react-error']).toBe('React error')
    expect(diagnosticCategoryLabel('network-request-failed')).toBe(
      'Network request failed',
    )
    expect(diagnosticCategoryLabel('cors-blocked')).toBe(
      'CORS blocked request',
    )
    expect(diagnosticCategoryLabel('react-error')).toBe('React error')
  })

  it('registers the four new rules once in the JavaScript array', () => {
    const expectations = [
      ['javascript.json-parse-error', 'json-decode-error'],
      ['javascript.network-request-failed', 'network-request-failed'],
      ['javascript.cors-blocked', 'cors-blocked'],
      ['javascript.react-error', 'react-error'],
    ] as const

    for (const [id, category] of expectations) {
      const rules = javascriptRules.filter((rule) => rule.id === id)

      expect(rules).toHaveLength(1)
      expect(rules[0].language).toBe('javascript')
      expect(rules[0].category).toBe(category)
    }

    expect(javascriptRules.slice(0, 8).map((rule) => rule.id)).toEqual([
      'javascript.reference-error',
      'javascript.type-error',
      'javascript.syntax-error',
      'javascript.node-module-not-found',
      'javascript.port-in-use',
      'javascript.node-file-error',
      'javascript.permission-error',
      'javascript.call-stack-exceeded',
    ])
    expect(javascriptRules.slice(8, 12).map((rule) => rule.id)).toEqual([
      'javascript.json-parse-error',
      'javascript.network-request-failed',
      'javascript.cors-blocked',
      'javascript.react-error',
    ])
  })
})
