/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Header {
  key: string
  value: string
}

interface HeaderRule {
  source: string
  headers: Header[]
}

const config = JSON.parse(
  readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
) as {
  headers?: HeaderRule[]
  rewrites?: { source: string; destination: string }[]
}

const rules = config.headers ?? []
const rewrites = config.rewrites ?? []

// `/assets/` is the directory whose every file name is a hash of its bytes, so it is carved out
// of the catch-all twice: once for the hashed app output, once again for the engine subtree,
// which loosens `script-src` and revalidates only its manifest.
const MAIN_SOURCE = '/((?!assets/).*)'
const APP_SOURCE = '/assets/((?!engines/).*)'
const ENGINE_SOURCE = '/assets/engines/((?!manifest.json).*)'
const MANIFEST_SOURCE = '/assets/engines/manifest.json'

const mainRule = rules.find((rule) => rule.source === MAIN_SOURCE)
const appRule = rules.find((rule) => rule.source === APP_SOURCE)
const engineRule = rules.find((rule) => rule.source === ENGINE_SOURCE)
const manifestRule = rules.find((rule) => rule.source === MANIFEST_SOURCE)

// The policy that shipped before the WebAssembly engines. The main document must
// keep it character-for-character; only engine worker files may loosen script-src.
const MAIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

const ENGINE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

// The build names every file under `/assets/` with its content hash, so a name always maps to the
// same bytes and may be cached forever. The engine manifest is the only mutable pointer in that
// tree: it is what tells the browser which hashed names are current, so caching it would pin every
// user to the previous generation of grammars.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const MANIFEST_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

const OTHER_HEADERS: Header[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
]

function cspOf(rule: HeaderRule | undefined): string | undefined {
  return headerOf(rule, 'Content-Security-Policy')
}

function headerOf(
  rule: HeaderRule | undefined,
  key: string,
): string | undefined {
  return rule?.headers.find((header) => header.key === key)?.value
}

function directiveSources(policy: string, name: string): string[] {
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.split(/\s+/)[0] === name)

  return directive ? directive.split(/\s+/).slice(1) : []
}

// path-to-regexp subset: Vercel's `source` is anchored, case-sensitive and its
// `(.*)` / negative lookahead groups translate to the equivalent JS regex.
function matcher(source: string): RegExp {
  const body = source.replace(/^\//, '').replace(/\(\.\*\)$/, '.*')
  return new RegExp('^/' + body + '$', 's')
}

function rulesFor(path: string): HeaderRule[] {
  return rules.filter((rule) => matcher(rule.source).test(path))
}

describe('vercel.json header rules', () => {
  it('has one main rule, one hashed-asset rule, one engine rule and one engine-manifest rule', () => {
    expect(rules.map((rule) => rule.source)).toEqual([
      MAIN_SOURCE,
      APP_SOURCE,
      ENGINE_SOURCE,
      MANIFEST_SOURCE,
    ])
    expect(mainRule).toBeDefined()
    expect(appRule).toBeDefined()
    expect(engineRule).toBeDefined()
    expect(manifestRule).toBeDefined()
  })

  it('keeps the single-page-app fallback away from the hashed asset directory', () => {
    // The fallback answers any path with /index.html, and a header rule is chosen by the request
    // path, so a request for a hashed name the current build no longer contains would be served
    // the document *with the asset rule's headers*. Caching that for a year would pin a piece of
    // HTML to a `.js` URL in that browser forever, which no reload can undo. Leaving `/assets/`
    // out of the fallback makes such a request a plain 404, and is the precondition for the
    // immutable promise the next test asserts.
    expect(rewrites.map((rewrite) => rewrite.source)).toEqual([
      '/((?!assets/).*)',
    ])
    expect(rewrites[0]?.destination).toBe('/index.html')
    expect(matcher('/((?!assets/).*)').test('/assets/index-abc123.js')).toBe(false)
    expect(matcher('/((?!assets/).*)').test('/assets/engines/manifest.json')).toBe(false)
    for (const route of ['/', '/index.html', '/bugs', '/analyze', '/favicon.svg']) {
      expect(matcher(rewrites[0]?.source ?? '').test(route)).toBe(true)
    }
  })

  it('applies the unchanged main-document policy to everything outside the hashed asset directory', () => {
    expect(cspOf(mainRule)).toBe(MAIN_CSP)

    const policy = cspOf(mainRule) as string
    expect(directiveSources(policy, 'default-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'script-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'style-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'object-src')).toEqual(["'none'"])
    expect(directiveSources(policy, 'base-uri')).toEqual(["'self'"])
    expect(directiveSources(policy, 'frame-ancestors')).toEqual(["'none'"])
    // What is left outside `/assets/` is the `public/` copy-through: `favicon.svg` and the
    // licence texts, whose names do not change when their bytes do. Making them immutable would
    // serve last week's logo forever, so this rule makes no caching promise and leaves Vercel's
    // revalidating default in place.
    expect(headerOf(mainRule, 'Cache-Control')).toBeUndefined()
  })

  it('caches every hashed app asset forever and keeps the WebAssembly allowance off it', () => {
    expect(cspOf(appRule)).toBe(MAIN_CSP)
    expect(cspOf(appRule)).not.toContain("'wasm-unsafe-eval'")
    expect(headerOf(appRule, 'Cache-Control')).toBe(IMMUTABLE_CACHE_CONTROL)
  })

  it('applies the WebAssembly policy to the engine directory', () => {
    expect(cspOf(engineRule)).toBe(ENGINE_CSP)

    const policy = cspOf(engineRule) as string
    expect(directiveSources(policy, 'script-src')).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
    ])
    // Everything except script-src is identical to the main document policy.
    expect(policy.replace(/script-src[^;]+;/, '')).toBe(
      MAIN_CSP.replace(/script-src[^;]+;/, ''),
    )
    expect(headerOf(engineRule, 'Cache-Control')).toBe(IMMUTABLE_CACHE_CONTROL)
  })

  it('caches the manifest for nothing and keeps the WebAssembly allowance off it', () => {
    // The manifest is fetched before the engine names it are known, so an immutable answer
    // here would outlive every later grammar build. It is JSON, not a worker, so it takes the
    // main document policy rather than the WebAssembly one.
    expect(cspOf(manifestRule)).toBe(MAIN_CSP)
    expect(headerOf(manifestRule, 'Cache-Control')).toBe(MANIFEST_CACHE_CONTROL)
    expect(cspOf(manifestRule)).not.toContain("'wasm-unsafe-eval'")
  })

  it('repeats the four other security headers on every rule', () => {
    // Over the rules that exist, not over a hand-written list of them: the list is pinned by the
    // first test, and a fifth rule added later must carry the headers too.
    expect(rules).toHaveLength(4)
    for (const rule of rules) {
      for (const expected of OTHER_HEADERS) {
        const values = (rule?.headers ?? []).filter(
          (header) => header.key === expected.key,
        )
        expect(values).toEqual([expected])
      }
    }
  })

  it('never allows unsafe-eval, unsafe-inline or blob: in either policy', () => {
    for (const policy of [MAIN_CSP, ENGINE_CSP]) {
      expect(policy).not.toContain("'unsafe-eval'")
      expect(policy).not.toContain("'unsafe-inline'")
      expect(policy).not.toContain('blob:')
      for (const name of ['script-src', 'default-src', 'connect-src']) {
        const sources = directiveSources(policy, name)
        expect(sources).not.toContain("'unsafe-eval'")
        expect(sources).not.toContain("'unsafe-inline'")
        expect(sources).not.toContain('blob:')
      }
    }
  })

  it('keeps the main document free of the WebAssembly allowance', () => {
    expect(cspOf(mainRule)).not.toContain("'wasm-unsafe-eval'")
  })

  it('matches exactly one rule per path so no response carries two policies', () => {
    // A browser intersects multiple CSP headers, so a double match would silently
    // re-block WebAssembly in the engine worker.
    const mainPaths = [
      '/',
      '/index.html',
      '/bugs',
      '/analyze',
      '/favicon.svg',
      '/licenses/MIT.txt',
    ]
    // `AnalyzePage-jYtTiDat.js` is a real lazily-imported route chunk on the deployed site, which
    // is the traffic this rule is about: it is fetched after the entry bundle, from a name the
    // build cannot produce twice.
    const appPaths = [
      '/assets/index-abc123.js',
      '/assets/index-abc123.css',
      '/assets/AnalyzePage-jYtTiDat.js',
      '/assets/plain-worker-abc123.js',
      '/assets/intercentury-sans-9a8b7c6d.woff2',
    ]
    const enginePaths = [
      '/assets/engines/engineClient-B3En7ltx.js',
      '/assets/engines/engineWorkerEntry-aSAJpoUP.js',
      '/assets/engines/web-tree-sitter-CJcQnmR7.wasm',
      '/assets/engines/tree-sitter-python-DaEC2znC.wasm',
      '/assets/engines/tree-sitter-c_sharp-6u-hrjw0.wasm',
      '/assets/engines/ruff_wasm_bg-CW-taZr4.wasm',
    ]
    const manifestPaths = ['/assets/engines/manifest.json']

    for (const path of [...mainPaths, ...appPaths, ...enginePaths, ...manifestPaths]) {
      const matched = rulesFor(path)
      expect(matched.filter((r) => cspOf(r) !== undefined)).toHaveLength(1)
    }
    for (const path of mainPaths) {
      expect(rulesFor(path).map((rule) => rule.source)).toEqual([MAIN_SOURCE])
    }
    for (const path of appPaths) {
      expect(rulesFor(path).map((rule) => rule.source)).toEqual([APP_SOURCE])
    }
    for (const path of enginePaths) {
      expect(rulesFor(path).map((rule) => rule.source)).toEqual([ENGINE_SOURCE])
    }
    for (const path of manifestPaths) {
      expect(rulesFor(path).map((rule) => rule.source)).toEqual([MANIFEST_SOURCE])
    }
  })

  it('leaves no request outside the four rules', () => {
    // The four sources are a partition, and a gap in it would be a response with no security
    // headers at all. The seams are where a partition leaks: the bare directory names, a name
    // that only *resembles* the exclusion, and the paths the manifest rule carves back out.
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
      '/assets/engines/manifest.json',
      '/assets/engines/manifesto-A1b2C3d4.wasm',
      '/assets/engines/sub/manifest.json',
      '/assets/engines/deep/nested/engine-00000000.wasm',
    ]
    for (const path of paths) {
      expect(rulesFor(path).length).toBe(1)
    }
  })

  it('leaves no file in the engine directory outside both engine rules', () => {
    // The manifest is carved out of the immutable rule by a negative lookahead, so a name the
    // two rules disagree about would be served with no policy at all. Real build names are
    // checked above; this asserts the two rules are exact complements over arbitrary names,
    // which is what makes the carve-out safe for grammars added later.
    const names = [
      'manifest.json',
      'web-tree-sitter-CJcQnmR7.wasm',
      'engineClient-B3En7ltx.js',
      'tree-sitter-zzz-00000000.wasm',
      'manifesto-A1b2C3d4.wasm',
      'MANIFEST.json',
      'manifest',
      'manifest.js',
    ]
    const engine = matcher(ENGINE_SOURCE)
    const manifest = matcher(MANIFEST_SOURCE)

    for (const name of names) {
      const path = `/assets/engines/${name}`
      expect(manifest.test(path)).not.toBe(engine.test(path))
      expect(rulesFor(path)).toHaveLength(1)
    }
  })
})
