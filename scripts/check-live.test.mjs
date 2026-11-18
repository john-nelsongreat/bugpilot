import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ASSET_CANARY_PATH,
  ASSET_REQUIRED_HEADERS,
  CRASH_TITLE,
  DEFAULT_LIVE_URL,
  ENGINE_CANARY_PATH,
  ENGINE_MANIFEST_PATH,
  GUARD_TITLE,
  MAX_RETRIES,
  REQUIRED_HEADERS,
  SLOW_REQUEST_MS,
  WORKFLOW_MESSAGE_LIMIT,
  buildStepSummary,
  classifyAssetResponse,
  classifyEngineResponse,
  classifyRouteResponse,
  classifyTiming,
  compareRequiredHeaders,
  crashMessage,
  describeUrlSource,
  engineProbeTargets,
  escapeWorkflowData,
  escapeWorkflowProperty,
  expectedHeadersForPath,
  extractAssetUrls,
  extractGlobalHeaders,
  extractHeaderRules,
  failureAnnotation,
  formatRunHeader,
  formatSummaryCell,
  formatWorkflowError,
  guardResult,
  headerValues,
  isGlobalSource,
  isHtmlContentType,
  isTimeoutError,
  matchesSource,
  normalizeBaseUrl,
  parseEngineManifest,
  policiesDifferOnlyInScriptSrc,
  rawHeadersToObject,
  readRepositoryCommit,
  resolveStepSummaryPath,
  shouldRetry,
  truncateWorkflowMessage,
} from './check-live.mjs'

const MAIN_SOURCE = '/((?!assets/).*)'
const APP_SOURCE = '/assets/((?!engines/).*)'
const ENGINE_SOURCE = '/assets/engines/((?!manifest.json).*)'
const MANIFEST_SOURCE = '/assets/engines/manifest.json'
const MAIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
const ENGINE_CSP = MAIN_CSP.replace(
  "script-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
)
const ENGINE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
// The same promise for the same reason: every name vite writes under `/assets/` is a hash of its
// bytes, so a cached copy can never be the wrong copy.
const APP_CACHE_CONTROL = ENGINE_CACHE_CONTROL
const MANIFEST_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

function headerList(extra = {}) {
  return [
    { key: 'Content-Security-Policy', value: MAIN_CSP },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...Object.entries(extra).map(([key, value]) => ({ key, value })),
  ]
}

/** The four shipped rules, in the order they appear in vercel.json. */
function headerRuleConfig() {
  return {
    headers: [
      { source: MAIN_SOURCE, headers: headerList() },
      {
        source: APP_SOURCE,
        headers: headerList({ 'Cache-Control': APP_CACHE_CONTROL }),
      },
      {
        source: ENGINE_SOURCE,
        headers: headerList({
          'Content-Security-Policy': ENGINE_CSP,
          'Cache-Control': ENGINE_CACHE_CONTROL,
        }),
      },
      {
        source: MANIFEST_SOURCE,
        headers: headerList({ 'Cache-Control': MANIFEST_CACHE_CONTROL }),
      },
    ],
  }
}

const VALID_HTML = [
  '<!doctype html>',
  '<html>',
  '  <head>',
  '    <script type="module" src="/assets/index-abc123.js"></script>',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n')

function expectedHeaders(names = REQUIRED_HEADERS) {
  return Object.fromEntries(
    names.map((header) => [
      header.toLowerCase(),
      `expected value for ${header}`,
    ]),
  )
}

function actualHeaders({ names = REQUIRED_HEADERS, omit = [], override = {} } = {}) {
  return Object.fromEntries(
    names.filter((header) => !omit.includes(header)).map((header) => [
      header.toUpperCase(),
      override[header] ?? `expected value for ${header}`,
    ]),
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

  it('accepts the asset-scoped global source', () => {
    expect(isGlobalSource(MAIN_SOURCE)).toBe(true)
    expect(isGlobalSource(APP_SOURCE)).toBe(false)
    expect(isGlobalSource(ENGINE_SOURCE)).toBe(false)
    expect(extractGlobalHeaders(headerRuleConfig()).headers['content-security-policy']).toBe(
      MAIN_CSP,
    )
  })
})

describe('header rule selection', () => {
  it('understands only the source shapes BugPilot ships', () => {
    expect(matchesSource(MAIN_SOURCE, '/analyze')).toBe('yes')
    expect(matchesSource(MAIN_SOURCE, '/assets/x.js')).toBe('no')
    expect(matchesSource(MAIN_SOURCE, '/assets/engines/x.wasm')).toBe('no')
    expect(matchesSource(APP_SOURCE, '/assets/x.js')).toBe('yes')
    expect(matchesSource(APP_SOURCE, '/assets/engines/x.wasm')).toBe('no')
    expect(matchesSource(APP_SOURCE, '/analyze')).toBe('no')
    expect(matchesSource(ENGINE_SOURCE, '/assets/engines/x.wasm')).toBe('yes')
    expect(matchesSource(ENGINE_SOURCE, '/assets/x.js')).toBe('no')
    // The carve-out has to bite. If the guarded group were read as a plain prefix the manifest
    // would inherit the immutable policy, and a browser would never see a new grammar name.
    expect(matchesSource(ENGINE_SOURCE, ENGINE_MANIFEST_PATH)).toBe('no')
    expect(matchesSource(MANIFEST_SOURCE, ENGINE_MANIFEST_PATH)).toBe('yes')
    expect(matchesSource(MANIFEST_SOURCE, '/assets/engines/x.wasm')).toBe('no')
    expect(matchesSource(MANIFEST_SOURCE, '/analyze')).toBe('no')
    expect(matchesSource('/(.*)', '/anything')).toBe('yes')
    expect(matchesSource('/regex{2}/(.*)', '/assets/x.js')).toBe('unknown')
  })

  it('refuses a guarded group it cannot compile instead of guessing', () => {
    // `*` is not a valid expression on its own; reporting unknown keeps a malformed source from
    // silently matching, or not matching, every engine file.
    expect(matchesSource('/assets/engines/((?!*).*)', '/assets/engines/a.wasm')).toBe('unknown')
  })

  it('resolves one rule per path so no response carries two policies', () => {
    const { rules } = extractHeaderRules(headerRuleConfig())
    // Each path is paired with the one rule allowed to describe it; asserting the source rather
    // than a count is what makes a double match, or a dropped file, fail here.
    const routing = [
      ['/', MAIN_SOURCE],
      ['/analyze', MAIN_SOURCE],
      ['/favicon.svg', MAIN_SOURCE],
      ['/assets/index-abc123.js', APP_SOURCE],
      ['/assets/AnalyzePage-jYtTiDat.js', APP_SOURCE],
      ['/assets/engines/web-tree-sitter-CJcQnmR7.wasm', ENGINE_SOURCE],
      ['/assets/engines/engineClient-B3En7ltx.js', ENGINE_SOURCE],
      [ENGINE_MANIFEST_PATH, MANIFEST_SOURCE],
    ]

    for (const [path, source] of routing) {
      const result = expectedHeadersForPath(rules, path)
      expect(result.ok, path).toBe(true)
      expect(result.rule.source, path).toBe(source)
    }

    const app = expectedHeadersForPath(rules, '/assets/index-abc123.js')
    expect(app.headers['content-security-policy']).toBe(MAIN_CSP)
    expect(app.headers['cache-control']).toBe(APP_CACHE_CONTROL)
    const engine = expectedHeadersForPath(rules, '/assets/engines/a.wasm')
    expect(engine.headers['content-security-policy']).toBe(ENGINE_CSP)
    expect(engine.headers['cache-control']).toBe(ENGINE_CACHE_CONTROL)
    const manifest = expectedHeadersForPath(rules, ENGINE_MANIFEST_PATH)
    expect(manifest.headers['content-security-policy']).toBe(MAIN_CSP)
    expect(manifest.headers['cache-control']).toBe(MANIFEST_CACHE_CONTROL)
  })

  it('partitions the engine directory so no real file loses its policy', () => {
    const { rules } = extractHeaderRules(headerRuleConfig())
    // A name that merely starts with something close to the excluded one is what an unanchored
    // carve-out can strand; every file the build can write must still be claimed exactly once.
    const names = [
      'manifest.json',
      'engineWorkerEntry-aSAJpoUP.js',
      'tree-sitter-c_sharp-6u-hrjw0.wasm',
      'manifesto-A1b2C3d4.wasm',
      'manifest',
    ]

    for (const name of names) {
      const result = expectedHeadersForPath(rules, `/assets/engines/${name}`)
      expect(result.ok, name).toBe(true)
    }
    expect(expectedHeadersForPath(rules, ENGINE_CANARY_PATH).rule.source).toBe(
      ENGINE_SOURCE,
    )
  })

  it('finds the app rule by the canary the live check itself uses', () => {
    const { rules } = extractHeaderRules(headerRuleConfig())
    // `main()` resolves the app rule from this one constant, so if the canary were claimed twice,
    // or not at all, the caching promise would be read from the wrong rule or from none.
    const result = expectedHeadersForPath(rules, APP_ASSET_CANARY_PATH)
    expect(result.ok).toBe(true)
    expect(result.rule.source).toBe(APP_SOURCE)
    expect(result.headers['cache-control']).toBe(APP_CACHE_CONTROL)
  })

  it('leaves no request outside the four rules', () => {
    const { rules } = extractHeaderRules(headerRuleConfig())
    // A gap in the partition is a response with no security headers at all, and the seams are
    // where a partition leaks: the bare directory names, a name that only resembles the
    // exclusion, and the paths each carve-out hands back to another rule.
    const paths = [
      '/',
      '/index.html',
      '/favicon.svg',
      '/assets',
      '/assets/',
      '/assets/index-abc123.js',
      '/assetsengines-x.js',
      '/assets/engines',
      '/assets/engines/',
      ENGINE_MANIFEST_PATH,
      '/assets/engines/manifesto-A1b2C3d4.wasm',
      '/assets/engines/sub/manifest.json',
    ]

    for (const path of paths) {
      const result = expectedHeadersForPath(rules, path)
      expect(result.ok, path).toBe(true)
    }
  })

  it('reports a path covered by two rules as a failure instead of picking one', () => {
    const overlapping = [
      { source: '/(.*)', headers: { 'content-security-policy': MAIN_CSP } },
      { source: ENGINE_SOURCE, headers: { 'content-security-policy': ENGINE_CSP } },
    ]

    const result = expectedHeadersForPath(overlapping, '/assets/engines/a.wasm')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/matches 2 header rules/)
  })

  it('refuses to guess an unrecognised source shape', () => {
    const result = expectedHeadersForPath(
      [{ source: '/weird{2}/(.*)', headers: {} }],
      '/assets/engines/a.wasm',
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/unrecognised source shape/)
  })

  it('requires the engine policy to differ only in script-src', () => {
    const { rules } = extractHeaderRules(headerRuleConfig())
    const main = rules.find((rule) => rule.source === MAIN_SOURCE)
    const engine = rules.find((rule) => rule.source === ENGINE_SOURCE)

    expect(policiesDifferOnlyInScriptSrc(main.headers, engine.headers).pass).toBe(true)
    expect(
      policiesDifferOnlyInScriptSrc(
        { 'content-security-policy': ENGINE_CSP },
        engine.headers,
      ).reason,
    ).toMatch(/scope is not narrowed/)
    expect(
      policiesDifferOnlyInScriptSrc(main.headers, {
        'content-security-policy': ENGINE_CSP.replace("object-src 'none'", "object-src 'self'"),
      }).reason,
    ).toMatch(/differ outside script-src/)
    expect(policiesDifferOnlyInScriptSrc(main.headers, {}).reason).toMatch(/missing/)
  })
})

describe('engine manifest and probes', () => {
  const files = [
    { path: '/assets/engines/engineClient-a.js', kind: 'engine-client', gzipBytes: 900 },
    { path: '/assets/engines/engineWorkerEntry-b.js', kind: 'engine-worker', gzipBytes: 36000 },
    { path: '/assets/engines/web-tree-sitter-c.wasm', kind: 'tree-sitter-core' },
    { path: '/assets/engines/tree-sitter-python-d.wasm', kind: 'grammar', language: 'python' },
    { path: '/assets/engines/tree-sitter-java-e.wasm', kind: 'grammar', language: 'java' },
    { path: '/assets/engines/ruff_wasm_bg-f.wasm', kind: 'ruff', language: 'python' },
  ]

  it('parses the build manifest', () => {
    expect(parseEngineManifest(JSON.stringify({ schemaVersion: 1, files })).files).toHaveLength(6)
    expect(parseEngineManifest('{oops').ok).toBe(false)
    expect(parseEngineManifest('{"files":[]}').ok).toBe(false)
    expect(parseEngineManifest('{"schemaVersion":1}').error).toMatch(/files/)
  })

  it('probes every script and one module per kind and language', () => {
    const targets = engineProbeTargets(files)
    expect(targets.map((target) => target.path)).toEqual([
      '/assets/engines/engineClient-a.js',
      '/assets/engines/engineWorkerEntry-b.js',
      '/assets/engines/web-tree-sitter-c.wasm',
      '/assets/engines/tree-sitter-python-d.wasm',
      '/assets/engines/tree-sitter-java-e.wasm',
      '/assets/engines/ruff_wasm_bg-f.wasm',
    ])
    expect(targets[0].expect).toBe('script')
    expect(targets[2].expect).toBe('wasm')
  })

  it('keeps duplicate CSP headers visible, which is the point of the raw probe', () => {
    const raw = [
      'content-security-policy',
      MAIN_CSP,
      'Content-Security-Policy',
      ENGINE_CSP,
      'content-type',
      'application/wasm',
    ]
    expect(headerValues(raw, 'Content-Security-Policy')).toEqual([MAIN_CSP, ENGINE_CSP])
    expect(headerValues(raw, 'content-type')).toEqual(['application/wasm'])
    expect(headerValues(raw, 'x-nothing')).toEqual([])
    expect(rawHeadersToObject(raw)['content-type']).toBe('application/wasm')
  })

  function engineTargetResponse(overrides = {}) {
    const target = { path: '/assets/engines/x.wasm', kind: 'grammar', language: 'go', expect: 'wasm' }
    const cspValues = overrides.cspValues ?? [ENGINE_CSP]
    const rawHeaders = [
      'content-type',
      overrides.contentType ?? 'application/wasm',
      'x-content-type-options',
      'nosniff',
      'x-frame-options',
      'DENY',
      'referrer-policy',
      'strict-origin-when-cross-origin',
      'permissions-policy',
      'camera=(), microphone=(), geolocation=()',
      ...(overrides.cacheControl === null
        ? []
        : ['cache-control', overrides.cacheControl ?? ENGINE_CACHE_CONTROL]),
      ...cspValues.flatMap((value) => ['content-security-policy', value]),
    ]
    const engineRule = extractHeaderRules(headerRuleConfig()).rules.find(
      (rule) => rule.source === ENGINE_SOURCE,
    )
    const base = {
      target,
      status: 200,
      contentType: overrides.contentType ?? 'application/wasm',
      cspValues,
      headerResults: compareRequiredHeaders(
        engineRule.headers,
        rawHeadersToObject(rawHeaders),
        ASSET_REQUIRED_HEADERS,
      ),
      elapsedMs: 120,
      method: 'HEAD',
    }
    return classifyEngineResponse({ ...base, ...overrides, cspValues })
  }

  it('passes a correctly served engine module', () => {
    const result = engineTargetResponse()
    expect(result.pass).toBe(true)
    expect(result.observed).toContain('grammar/go')
  })

  it('fails an engine module the platform served revalidating instead of immutable', () => {
    // The whole point of the immutable rule is that a hashed grammar is never re-fetched, so a
    // response that quietly falls back to the platform default has to be caught here.
    const result = engineTargetResponse({
      cacheControl: MANIFEST_CACHE_CONTROL,
    })
    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/Cache-Control: different value/)
  })

  it('fails an engine module served with no cache policy at all', () => {
    const result = engineTargetResponse({ cacheControl: null })

    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/Cache-Control: missing from the response/)
  })

  it('fails a response that carries two policies', () => {
    const result = engineTargetResponse({ cspValues: [MAIN_CSP, ENGINE_CSP] })
    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/expected exactly 1/)
  })

  it('fails the main policy served for an engine file', () => {
    const result = engineTargetResponse({ cspValues: [MAIN_CSP] })
    expect(result.pass).toBe(false)
    expect(result.failures.join(' ')).toMatch(/Content-Security-Policy: different value/)
  })

  it('fails a 404 page and a wrong content type', () => {
    expect(engineTargetResponse({ status: 404 }).failures.join(' ')).toMatch(/HTTP 404/)
    expect(
      engineTargetResponse({ contentType: 'text/html; charset=utf-8' }).failures.join(' '),
    ).toMatch(/text\/html/)
    expect(engineTargetResponse({ contentType: 'application/octet-stream' }).failures.join(
      ' ',
    )).toMatch(/application\/wasm/)
  })

  it('fails a slow engine request', () => {
    expect(engineTargetResponse({ elapsedMs: SLOW_REQUEST_MS + 1 }).pass).toBe(false)
  })

  it('reads the four real rules from vercel.json and keeps them apart', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))
    const { rules } = extractHeaderRules(config)
    const ruleFor = (source) => rules.find((rule) => rule.source === source)

    expect(rules.map((rule) => rule.source)).toEqual([
      MAIN_SOURCE,
      APP_SOURCE,
      ENGINE_SOURCE,
      MANIFEST_SOURCE,
    ])
    expect(expectedHeadersForPath(rules, '/analyze').headers['content-security-policy']).toBe(
      MAIN_CSP,
    )
    // The whole header set of the app rule is pinned, not just its policy: this is the promise
    // that takes the entry bundle and every lazily-imported chunk off the revalidation path.
    expect(expectedHeadersForPath(rules, APP_ASSET_CANARY_PATH).headers).toEqual({
      'content-security-policy': MAIN_CSP,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cache-control': APP_CACHE_CONTROL,
    })
    expect(expectedHeadersForPath(rules, ENGINE_CANARY_PATH).headers).toEqual(
      ruleFor(ENGINE_SOURCE).headers,
    )
    // The manifest is the only mutable file in that directory, so its whole header set is
    // pinned here: the cache policy that makes a new grammar generation reachable, plus the
    // security headers it keeps even though it no longer shares the main rule.
    expect(expectedHeadersForPath(rules, ENGINE_MANIFEST_PATH).headers).toEqual({
      'content-security-policy': MAIN_CSP,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cache-control': MANIFEST_CACHE_CONTROL,
    })
    expect(
      policiesDifferOnlyInScriptSrc(ruleFor(MAIN_SOURCE).headers, ruleFor(ENGINE_SOURCE).headers)
        .pass,
    ).toBe(true)
  })

  it('keeps the single-page-app fallback off the directory it would let the browser cache wrongly', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'))
    const fallback = config.rewrites ?? []

    expect(fallback.map((rewrite) => rewrite.source)).toEqual([MAIN_SOURCE])
    expect(fallback[0].destination).toBe('/index.html')
    // The fallback must still reach every client-side route, or the rewrite stops being a
    // single-page-app fallback. `/assets/` must stay out of it, or a hashed name the current
    // build no longer holds would be answered with the document under an immutable policy.
    for (const route of ['/', '/bugs', '/bugs/new', '/assistant', '/analyze']) {
      expect(matchesSource(fallback[0].source, route), route).toBe('yes')
    }
    for (const asset of ['/assets/index-abc123.js', '/assets/engines/a.wasm']) {
      expect(matchesSource(fallback[0].source, asset), asset).toBe('no')
    }
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

  it('compares the cache policy only where a rule promises one', () => {
    const results = compareRequiredHeaders(
      expectedHeaders(ASSET_REQUIRED_HEADERS),
      actualHeaders({ names: ASSET_REQUIRED_HEADERS }),
      ASSET_REQUIRED_HEADERS,
    )
    const withoutCache = compareRequiredHeaders(
      expectedHeaders(ASSET_REQUIRED_HEADERS),
      actualHeaders(),
      ASSET_REQUIRED_HEADERS,
    )

    expect(results).toHaveLength(ASSET_REQUIRED_HEADERS.length)
    expect(ASSET_REQUIRED_HEADERS.length).toBe(REQUIRED_HEADERS.length + 1)
    expect(results.every((result) => result.pass)).toBe(true)
    expect(
      withoutCache.find((result) => result.header === 'Cache-Control').pass,
    ).toBe(false)
    // The site-wide list must stay the short one, or a route would be failed for a header its
    // own rule never declared.
    expect(
      compareRequiredHeaders(
        expectedHeaders(ASSET_REQUIRED_HEADERS),
        actualHeaders(),
      ).every((result) => result.pass),
    ).toBe(true)
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
