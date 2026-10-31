import { describe, expect, it } from 'vitest'
import {
  CRASH_TITLE,
  DEFAULT_LIVE_URL,
  GUARD_TITLE,
  MAX_RETRIES,
  REQUIRED_HEADERS,
  SLOW_REQUEST_MS,
  WORKFLOW_MESSAGE_LIMIT,
  buildStepSummary,
  classifyAssetResponse,
  classifyRouteResponse,
  classifyTiming,
  compareRequiredHeaders,
  crashMessage,
  describeUrlSource,
  escapeWorkflowData,
  escapeWorkflowProperty,
  extractAssetUrls,
  extractGlobalHeaders,
  failureAnnotation,
  formatRunHeader,
  formatSummaryCell,
  formatWorkflowError,
  guardResult,
  isHtmlContentType,
  isTimeoutError,
  normalizeBaseUrl,
  readRepositoryCommit,
  resolveStepSummaryPath,
  shouldRetry,
  truncateWorkflowMessage,
} from './check-live.mjs'

const VALID_HTML = [
  '<!doctype html>',
  '<html>',
  '  <head>',
  '    <script type="module" src="/assets/index-abc123.js"></script>',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n')

function expectedHeaders() {
  return Object.fromEntries(
    REQUIRED_HEADERS.map((header) => [
      header.toLowerCase(),
      `expected value for ${header}`,
    ]),
  )
}

function actualHeaders({ omit = [], override = {} } = {}) {
  return Object.fromEntries(
    REQUIRED_HEADERS.filter((header) => !omit.includes(header)).map(
      (header) => [
        header.toUpperCase(),
        override[header] ?? `expected value for ${header}`,
      ],
    ),
  )
}

describe('normalizeBaseUrl', () => {
  it('uses the live site when no value is provided', () => {
    expect(normalizeBaseUrl(undefined)).toEqual({
      ok: true,
      baseUrl: DEFAULT_LIVE_URL,
    })
    expect(normalizeBaseUrl('')).toEqual({
      ok: true,
      baseUrl: DEFAULT_LIVE_URL,
    })
  })

  it('removes a trailing slash and keeps the origin', () => {
    expect(normalizeBaseUrl('https://example.com/')).toEqual({
      ok: true,
      baseUrl: 'https://example.com',
    })
  })

  it('rejects invalid, non-HTTP and credential-bearing URLs', () => {
    expect(normalizeBaseUrl('not a url').ok).toBe(false)
    expect(normalizeBaseUrl('ftp://example.com').ok).toBe(false)
    expect(normalizeBaseUrl('https://user:pass@example.com').ok).toBe(false)
  })
})

describe('extractGlobalHeaders', () => {
  it('reads the global headers block, not another source block', () => {
    const config = {
      headers: [
        {
          source: '/api/(.*)',
          headers: [{ key: 'X-API-Only', value: 'api' }],
        },
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ],
        },
      ],
    }

    const result = extractGlobalHeaders(config)
    expect(result.ok).toBe(true)
    expect(result.headers).toEqual({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    })
  })

  it('fails clearly when the global block is absent', () => {
    const result = extractGlobalHeaders({ headers: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/global headers/i)
  })
})

describe('header comparison', () => {
  it('passes when all required headers match exactly', () => {
    const results = compareRequiredHeaders(
      expectedHeaders(),
      actualHeaders(),
    )

    expect(results).toHaveLength(REQUIRED_HEADERS.length)
    expect(results.every((result) => result.pass)).toBe(true)
  })

  it('treats header names case-insensitively', () => {
    const actual = actualHeaders()
    const results = compareRequiredHeaders(expectedHeaders(), actual)

    expect(results.every((result) => result.pass)).toBe(true)
  })

  it('fails a missing header and reports it as absent', () => {
    const results = compareRequiredHeaders(
      expectedHeaders(),
      actualHeaders({ omit: ['Referrer-Policy'] }),
    )
    const result = results.find(
      (entry) => entry.header === 'Referrer-Policy',
    )

    expect(result.pass).toBe(false)
    expect(result.actual).toBeNull()
    expect(result.reason).toMatch(/missing/i)
  })

  it('fails a different CSP and reports both values', () => {
    const expected = expectedHeaders()
    const actual = actualHeaders({
      override: { 'Content-Security-Policy': 'default-src *' },
    })

    const result = compareRequiredHeaders(expected, actual).find(
      (entry) => entry.header === 'Content-Security-Policy',
    )

    expect(result.pass).toBe(false)
    expect(result.expected).toBe(
      `expected value for Content-Security-Policy`,
    )
    expect(result.actual).toBe('default-src *')
    expect(result.reason).toMatch(/different/i)
  })
})

describe('content types', () => {
  it('accepts HTML with parameters and rejects other types', () => {
    expect(isHtmlContentType('text/html')).toBe(true)
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true)
    expect(isHtmlContentType('application/json')).toBe(false)
    expect(isHtmlContentType(undefined)).toBe(false)
  })
})

describe('classifyRouteResponse', () => {
  it('passes a 200 HTML SPA response with a root element and script', () => {
    const result = classifyRouteResponse({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: VALID_HTML,
      elapsedMs: 120,
      location: null,
    })

    expect(result.pass).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.observed.status).toBe(200)
    expect(result.observed.elapsedMs).toBe(120)
  })

  it('fails a 404 response', () => {
    const result = classifyRouteResponse({
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body>Not found</body></html>',
      elapsedMs: 100,
      location: null,
    })

    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/HTTP 404/)
  })

  it('fails a 200 response whose body is the Vercel 404 page', () => {
    const result = classifyRouteResponse({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: [
        '<!doctype html><html><head><title>404: NOT_FOUND</title></head>',
        '<body><h1>404: NOT_FOUND</h1><p>Code: NOT_FOUND</p></body></html>',
      ].join(''),
      elapsedMs: 100,
      location: null,
    })

    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/Vercel 404/)
    expect(result.failures.join(' ')).toMatch(/root element/)
    expect(result.failures.join(' ')).toMatch(/script/)
  })

  it('fails a 200 response with the wrong content type', () => {
    const result = classifyRouteResponse({
      status: 200,
      contentType: 'application/json',
      body: VALID_HTML,
      elapsedMs: 100,
      location: null,
    })

    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/content type/i)
    expect(result.failures.join(' ')).toMatch(/application\/json/)
  })

  it('fails a response that omits the app root or script', () => {
    const noRoot = classifyRouteResponse({
      status: 200,
      contentType: 'text/html',
      body: '<html><head><script src="/assets/app.js"></script></head></html>',
      elapsedMs: 100,
      location: null,
    })
    const noScript = classifyRouteResponse({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><div id="root"></div></body></html>',
      elapsedMs: 100,
      location: null,
    })

    expect(noRoot.pass).toBe(false)
    expect(noRoot.failures.join(' ')).toMatch(/root element/)
    expect(noScript.pass).toBe(false)
    expect(noScript.failures.join(' ')).toMatch(/script/)
  })

  it('fails a request slower than the limit and reports the time', () => {
    const result = classifyRouteResponse({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: VALID_HTML,
      elapsedMs: SLOW_REQUEST_MS + 1,
      location: null,
    })

    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/8000/)
    expect(result.observed.elapsedMs).toBe(SLOW_REQUEST_MS + 1)
  })

  it('fails and reports a redirect instead of following it', () => {
    const result = classifyRouteResponse({
      status: 301,
      contentType: 'text/html',
      body: '',
      elapsedMs: 30,
      location: 'https://elsewhere.example/',
    })

    expect(result.pass).toBe(false)
    expect(result.observed.redirectedTo).toBe('https://elsewhere.example/')
    expect(result.failures.join(' ')).toMatch(/redirect/i)
  })
})

describe('classifyTiming', () => {
  it('passes at the limit and fails above it', () => {
    expect(classifyTiming(SLOW_REQUEST_MS).pass).toBe(true)
    expect(classifyTiming(SLOW_REQUEST_MS).slow).toBe(false)
    expect(classifyTiming(SLOW_REQUEST_MS + 1).pass).toBe(false)
    expect(classifyTiming(SLOW_REQUEST_MS + 1).slow).toBe(true)
  })
})

describe('asset extraction', () => {
  const html = [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '    <link rel="stylesheet" crossorigin href="/assets/index-def456.css">',
    '    <link rel="preload" as="font" type="font/woff2" href="/fonts/inter.woff2">',
    '    <script type="module" crossorigin src="/assets/index-abc123.js"></script>',
    '    <script src="https://cdn.example.com/extra.js"></script>',
    '    <img src="https://images.example.com/hero.png" alt="">',
    '  </head>',
    '  <body><div id="root"></div></body>',
    '</html>',
  ].join('\n')

  it('extracts scripts, stylesheets, images and fonts', () => {
    const { assets } = extractAssetUrls(html, 'https://app.example/')

    expect(assets.map((asset) => asset.kind)).toEqual([
      'image',
      'stylesheet',
      'font',
      'script',
      'script',
      'image',
    ])
    expect(assets[3].url).toBe('https://app.example/assets/index-abc123.js')
    expect(assets[1].url).toBe('https://app.example/assets/index-def456.css')
    expect(assets[0].url).toBe('https://app.example/favicon.svg')
    expect(assets[2].url).toBe('https://app.example/fonts/inter.woff2')
  })

  it('flags external scripts and images as not same-origin', () => {
    const { assets, external } = extractAssetUrls(
      html,
      'https://app.example/',
    )

    expect(external.map((asset) => asset.url)).toEqual([
      'https://cdn.example.com/extra.js',
      'https://images.example.com/hero.png',
    ])
    expect(external.every((asset) => asset.sameOrigin === false)).toBe(true)
    expect(
      assets
        .filter((asset) => asset.sameOrigin)
        .every((asset) => asset.url.startsWith('https://app.example/')),
    ).toBe(true)
  })

  it('resolves relative asset URLs against the page URL', () => {
    const { assets } = extractAssetUrls(
      '<script src="assets/app.js"></script>',
      'https://app.example/nested/page',
    )

    expect(assets[0].url).toBe('https://app.example/nested/assets/app.js')
  })
})

describe('asset response classification', () => {
  it('passes JavaScript and CSS responses with sensible types', () => {
    expect(
      classifyAssetResponse({
        kind: 'script',
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        elapsedMs: 50,
        location: null,
      }).pass,
    ).toBe(true)
    expect(
      classifyAssetResponse({
        kind: 'stylesheet',
        status: 200,
        contentType: 'text/css; charset=utf-8',
        elapsedMs: 50,
        location: null,
      }).pass,
    ).toBe(true)
  })

  it('fails a script served as HTML', () => {
    const result = classifyAssetResponse({
      kind: 'script',
      status: 200,
      contentType: 'text/html; charset=utf-8',
      elapsedMs: 50,
      location: null,
    })

    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/content type/i)
  })

  it('fails a missing asset and a slow asset', () => {
    const missing = classifyAssetResponse({
      kind: 'stylesheet',
      status: 404,
      contentType: 'text/html',
      elapsedMs: 20,
      location: null,
    })
    const slow = classifyAssetResponse({
      kind: 'script',
      status: 200,
      contentType: 'text/javascript',
      elapsedMs: SLOW_REQUEST_MS + 1,
      location: null,
    })

    expect(missing.pass).toBe(false)
    expect(missing.failures.join(' ')).toMatch(/HTTP 404/)
    expect(slow.pass).toBe(false)
    expect(slow.failures.join(' ')).toMatch(/8000/)
  })
})

describe('retry and timeout classification', () => {
  it('retries network errors up to the limit and then stops', () => {
    const error = new Error('fetch failed')

    expect(shouldRetry({ attempt: 0, error })).toBe(true)
    expect(shouldRetry({ attempt: MAX_RETRIES - 1, error })).toBe(true)
    expect(shouldRetry({ attempt: MAX_RETRIES, error })).toBe(false)
    expect(shouldRetry({ attempt: 0, error: null })).toBe(false)
  })

  it('recognises direct and wrapped timeout errors', () => {
    expect(isTimeoutError({ name: 'TimeoutError' })).toBe(true)
    expect(isTimeoutError({ name: 'TypeError', cause: { name: 'TimeoutError' } })).toBe(true)
    expect(isTimeoutError(new Error('fetch failed'))).toBe(false)
  })
})

describe('workflow command escaping', () => {
  it('escapes percent, carriage return and line feed in message data', () => {
    expect(escapeWorkflowData('100% done')).toBe('100%25 done')
    expect(escapeWorkflowData('a\nb')).toBe('a%0Ab')
    expect(escapeWorkflowData('a\r\nb')).toBe('a%0D%0Ab')
    expect(escapeWorkflowData('already %25 escaped')).toBe('already %2525 escaped')
  })

  it('additionally escapes the property separators', () => {
    expect(escapeWorkflowProperty('a:b=c')).toBe('a%3Ab%3Dc')
    expect(escapeWorkflowProperty('50%: x=1')).toBe('50%25%3A x%3D1')
  })

  it('truncates a long message and keeps it recognisable', () => {
    const short = truncateWorkflowMessage('short message')
    expect(short).toBe('short message')

    const long = truncateWorkflowMessage('x'.repeat(WORKFLOW_MESSAGE_LIMIT * 3))
    expect(long.length).toBeLessThanOrEqual(WORKFLOW_MESSAGE_LIMIT)
    expect(long.endsWith('[truncated]')).toBe(true)
  })

  it('builds a single-line error command with an escaped title', () => {
    const line = formatWorkflowError({
      title: 'Headers /: path=1',
      message: 'HTTP 500\nsecond line 100%',
    })

    expect(line.includes('\n')).toBe(false)
    expect(line.startsWith('::error title=Headers /%3A path%3D1::')).toBe(true)
    expect(line.endsWith('HTTP 500%0Asecond line 100%25')).toBe(true)
  })

  it('folds the observed value and every failing detail into one annotation', () => {
    const line = failureAnnotation({
      label: 'GET /bugs',
      pass: false,
      observed: 'HTTP 503; text/html; 412 ms',
      details: ['HTTP 503 (expected 200)', 'body does not contain the app root element (#root)'],
    })

    expect(line).toBe(
      '::error title=GET /bugs::HTTP 503; text/html; 412 ms | HTTP 503 (expected 200) | body does not contain the app root element (#root)',
    )
  })

  it('keeps the guard and crash titles stable', () => {
    expect(GUARD_TITLE).toBe('Live check guard')
    expect(CRASH_TITLE).toBe('Live check crash')
    expect(formatWorkflowError({ title: GUARD_TITLE, message: 'LIVE_URL: bad' })).toBe(
      '::error title=Live check guard::LIVE_URL: bad',
    )
  })
})

describe('guard results', () => {
  it('records a guard failure as a failing check', () => {
    expect(guardResult('vercel.json', 'cannot read or parse /tmp/x: ENOENT')).toEqual({
      label: 'Guard vercel.json',
      pass: false,
      observed: 'cannot read or parse /tmp/x: ENOENT',
      details: [],
    })
  })

  it('names the URL source as LIVE_URL only when a value was supplied', () => {
    expect(describeUrlSource('https://example.test')).toBe('LIVE_URL')
    expect(describeUrlSource('   ')).toBe('default')
    expect(describeUrlSource(undefined)).toBe('default')
  })

  it('prints the run context as one line with the defaults marked', () => {
    const line = formatRunHeader({
      nodeVersion: 'v24.18.0',
      baseUrl: DEFAULT_LIVE_URL,
      urlSource: 'default',
      commit: null,
      utcTime: '2026-10-31T03:04:05.000Z',
    })

    expect(line.includes('\n')).toBe(false)
    expect(line).toBe(
      `run node=v24.18.0 url=${DEFAULT_LIVE_URL} urlSource=default commit=unknown time=2026-10-31T03:04:05.000Z`,
    )
  })

  it('describes an unexpected error with its name, message and stack', () => {
    const error = new RangeError('bad offset')
    const described = crashMessage(error)

    expect(described.startsWith('RangeError: bad offset\n')).toBe(true)
    expect(described).toContain(error.stack.split('\n')[1].trim())
    expect(crashMessage('plain string')).toContain('plain string')
  })

  it('only resolves a step summary path when the variable is set', () => {
    expect(resolveStepSummaryPath({})).toBe(null)
    expect(resolveStepSummaryPath({ GITHUB_STEP_SUMMARY: '  ' })).toBe(null)
    expect(typeof resolveStepSummaryPath({ GITHUB_STEP_SUMMARY: '/tmp/step.md' })).toBe('string')
  })

  it('returns null instead of throwing when the commit cannot be read', () => {
    expect(readRepositoryCommit(process.cwd())).toMatch(/^[0-9a-f]{4,40}$/i)
    expect(readRepositoryCommit('/definitely/not/a/directory')).toBe(null)
  })
})

describe('step summary markdown', () => {
  const results = [
    { label: 'GET /', pass: true, observed: 'HTTP 200; text/html; 41 ms', details: [] },
    {
      label: 'Headers /',
      pass: false,
      observed: '4/5 match vercel.json',
      details: ['X-Frame-Options: missing from the response; expected "DENY", observed null'],
    },
    { label: 'GET /bugs', pass: false, observed: 'network error after 3 attempt(s)', details: [] },
  ]

  it('escapes pipes and newlines in a cell', () => {
    expect(formatSummaryCell('a | b')).toBe('a \\| b')
    expect(formatSummaryCell('line1\nline2')).toBe('line1<br>line2')
    expect(formatSummaryCell('line1\r\nline2')).toBe('line1<br>line2')
  })

  it('writes one row per check plus a heading and counts', () => {
    const text = buildStepSummary({ baseUrl: 'https://example.test', commit: 'abc1234', results })
    const lines = text.split('\n')

    expect(lines[0]).toBe('## BugPilot live site check — FAIL')
    expect(text).toContain('- Base URL: `https://example.test`')
    expect(text).toContain('- Commit: `abc1234`')
    expect(text).toContain('- Checks: 1 passed, 2 failed')
    expect(text).toContain('| Check | Result | Observed | Failing details |')
    expect(text).toContain('| GET / | PASS | HTTP 200; text/html; 41 ms |  |')
    expect(text).toContain('| Headers / | FAIL | 4/5 match vercel.json | X-Frame-Options: missing')
    expect(text).toContain('| GET /bugs | FAIL | network error after 3 attempt(s) | network error after 3 attempt(s) |')
  })

  it('marks a clean run as PASS and uses unknown for a missing commit', () => {
    const text = buildStepSummary({
      baseUrl: 'https://example.test',
      commit: null,
      results: [results[0]],
    })

    expect(text).toContain('## BugPilot live site check — PASS')
    expect(text).toContain('- Commit: `unknown`')
    expect(text).toContain('- Checks: 1 passed, 0 failed')
  })

  it('keeps every summary line free of raw newlines in the table', () => {
    const text = buildStepSummary({
      baseUrl: 'https://example.test',
      commit: 'abc1234',
      results: [guardResult('LIVE_URL', 'line one\nline two | three')],
    })

    for (const line of text.split('\n')) {
      if (line.startsWith('| Guard')) expect(line).toContain('<br>')
    }
    expect(text).toContain('| Guard LIVE_URL | FAIL | line one<br>line two \\| three | line one<br>line two \\| three |')
  })
})
