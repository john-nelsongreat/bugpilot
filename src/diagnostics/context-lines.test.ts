import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'

const CORS_LINE =
  "Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource."
const PREFLIGHT_LINE =
  "Access to fetch at 'https://api.example.com/v1/items' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource."
const HOOK_SENTENCE =
  'Invalid hook call. Hooks can only be called inside of the body of a function component.'
const HOOK_WARNING = `Warning: ${HOOK_SENTENCE} This could happen for one of the following reasons: 1. You might have mismatching versions of React and the renderer (such as React DOM) 2. You might be breaking the Rules of Hooks 3. You might have more than one copy of React in the same app`
const HOOK_SIGNATURE = `Error: ${HOOK_SENTENCE}`

function run(errorText: string, language: 'auto' | 'javascript' | 'python' = 'auto') {
  return diagnose({ language, errorText })
}

describe('context lines for generic final lines', () => {
  it('prefers the CORS message over the generic Failed to fetch final line', () => {
    const result = run(
      [
        CORS_LINE,
        'GET https://api.example.com/data net::ERR_FAILED 200 (OK)',
        'Uncaught (in promise) TypeError: Failed to fetch',
      ].join('\n'),
    )

    expect(result.category).toBe('cors-blocked')
    expect(result.matchedSignature).toBe(
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: missing 'Access-Control-Allow-Origin' header",
    )
    expect(result.confidence.level).toBe('high')
    expect(result.evidence[0]).toEqual({
      source: 'error text',
      label: 'Final exception line',
      quote: 'Uncaught (in promise) TypeError: Failed to fetch',
      lineNumber: 3,
    })
    expect(result.evidence).toContainEqual({
      source: 'error text',
      label: 'Matched context line',
      quote: CORS_LINE,
      lineNumber: 1,
    })
    expect(result.likelyCause).toMatch(/header/i)
  })

  it('prefers the preflight CORS message over the generic final line', () => {
    const result = run([PREFLIGHT_LINE, 'TypeError: Failed to fetch'].join('\n'))

    expect(result.category).toBe('cors-blocked')
    expect(result.matchedSignature).toBe(
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: preflight request does not pass access control check",
    )
    expect(result.evidence).toContainEqual({
      source: 'error text',
      label: 'Matched context line',
      quote: PREFLIGHT_LINE,
      lineNumber: 1,
    })
    expect(result.likelyCause).toMatch(/preflight/i)
  })

  it('names the specific net::ERR code for a plain network failure', () => {
    const refused = 'GET http://localhost:9999/api/users net::ERR_CONNECTION_REFUSED'
    const result = run(
      [refused, 'Uncaught (in promise) TypeError: Failed to fetch'].join('\n'),
    )

    expect(result.category).toBe('network-request-failed')
    expect(result.matchedSignature).toBe('TypeError: Failed to fetch')
    expect(result.likelyCause).toContain('net::ERR_CONNECTION_REFUSED')
  })

  it('explains a null hook TypeError with the Invalid hook call warning', () => {
    const result = run(
      [
        HOOK_WARNING,
        "Uncaught TypeError: Cannot read properties of null (reading 'useState')",
      ].join('\n'),
    )

    expect(result.category).toBe('react-error')
    expect(result.matchedSignature).toBe(HOOK_SIGNATURE)
    expect(result.evidence).toContainEqual({
      source: 'error text',
      label: 'Matched context line',
      quote: HOOK_WARNING,
      lineNumber: 1,
    })
    expect(result.likelyCause).toMatch(/hook/i)
  })

  it.each([
    ['the full Warning line from the browser', HOOK_WARNING],
    ['the short Warning sentence', `Warning: ${HOOK_SENTENCE}`],
  ])('matches %s at no more than medium confidence', (_name, line) => {
    const result = run(line)

    expect(result.category).toBe('react-error')
    expect(result.matchedSignature).toBe(HOOK_SIGNATURE)
    expect(['low', 'medium']).toContain(result.confidence.level)
  })

  it('does not accept a Warning prefix behind a timestamp', () => {
    const result = run(
      `2026-10-28T10:00:00Z Warning: ${HOOK_SENTENCE}`,
    )

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })

  it('does not accept a Warning prefix for other React messages', () => {
    const result = run(
      'Warning: Objects are not valid as a React child (found: object with keys {id})',
    )

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })

  it('keeps the React render error when the component trailer follows it', () => {
    const result = run(
      [
        'Uncaught Error: Objects are not valid as a React child (found: object with keys {id, name}). If you meant to render a collection of children, use an array instead.',
        '    at throwOnInvalidObjectType (react-dom.development.js:3500:13)',
        'The above error occurred in the <App> component:',
        '    at App (App.jsx:5:3)',
        'Consider adding an error boundary to your tree to customize error handling behavior.',
      ].join('\n'),
    )

    expect(result.category).toBe('react-error')
    expect(result.matchedSignature).toBe(
      'Error: Objects are not valid as a React child (found: <value>)',
    )
    expect(result.confidence.level).toBe('high')
  })

  it('keeps the Too many re-renders error when the trailer follows it', () => {
    const result = run(
      [
        'Uncaught Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.',
        '    at App (App.jsx:5:3)',
        'The above error occurred in the <App> component:',
        '    at App (App.jsx:5:3)',
        'Consider adding an error boundary to your tree to customize error handling behavior.',
      ].join('\n'),
    )

    expect(result.category).toBe('react-error')
    expect(result.matchedSignature).toBe(
      'Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.',
    )
  })

  it('skips the component trailer when the only real message is a warning', () => {
    const result = run(
      [
        `Warning: ${HOOK_SENTENCE}`,
        'The above error occurred in the <App> component:',
        '    at App (App.jsx:5:3)',
        'Consider adding an error boundary to your tree to customize error handling behavior.',
      ].join('\n'),
    )

    expect(result.category).toBe('react-error')
    expect(result.matchedSignature).toBe(HOOK_SIGNATURE)
    expect(['low', 'medium']).toContain(result.confidence.level)
  })

  it('does not let the CORS context override a different final-line error', () => {
    const result = run(
      [
        CORS_LINE,
        "TypeError: Cannot read properties of undefined (reading 'amount')",
      ].join('\n'),
    )

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe(
      "TypeError: Cannot read properties of undefined (reading 'amount')",
    )
  })

  it('does not let a React warning override an unrelated final error', () => {
    const result = run(
      [`Warning: ${HOOK_SENTENCE}`, 'ReferenceError: userCount is not defined'].join(
        '\n',
      ),
    )

    expect(result.category).toBe('undefined-name')
    expect(result.matchedSignature).toBe('ReferenceError: <name> is not defined')
  })

  it.each([
    'TODO: fix the CORS error before release',
    'see the docs about Invalid hook call',
    "2026-10-28T10:00:00Z Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
  ])('keeps prose and timestamped copies unrecognised: %s', (line) => {
    const result = run(line)

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })
})
