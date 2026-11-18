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
) as { headers?: HeaderRule[] }

const rules = config.headers ?? []

const MAIN_SOURCE = '/((?!assets/engines/).*)'
const ENGINE_SOURCE = '/assets/engines/((?!manifest.json).*)'
const MANIFEST_SOURCE = '/assets/engines/manifest.json'

const mainRule = rules.find((rule) => rule.source === MAIN_SOURCE)
const engineRule = rules.find((rule) => rule.source === ENGINE_SOURCE)
const manifestRule = rules.find((rule) => rule.source === MANIFEST_SOURCE)

// The policy that shipped before the WebAssembly engines. The main document must
// keep it character-for-character; only engine worker files may loosen script-src.
const MAIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

const ENGINE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

// The build names every engine file with its content hash, so a name always maps to the same
// bytes and may be cached forever. The manifest is the only mutable pointer in that directory:
// it is what tells the browser which hashed names are current, so caching it would pin every
// user to the previous generation of grammars.
const ENGINE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
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
  it('has one main rule, one engine rule and one engine-manifest rule', () => {
    expect(rules.map((rule) => rule.source)).toEqual([
      MAIN_SOURCE,
      ENGINE_SOURCE,
      MANIFEST_SOURCE,
    ])
    expect(mainRule).toBeDefined()
    expect(engineRule).toBeDefined()
    expect(manifestRule).toBeDefined()
  })

  it('applies the unchanged main-document policy to everything outside the engine directory', () => {
    expect(cspOf(mainRule)).toBe(MAIN_CSP)

    const policy = cspOf(mainRule) as string
    expect(directiveSources(policy, 'default-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'script-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'style-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'object-src')).toEqual(["'none'"])
    expect(directiveSources(policy, 'base-uri')).toEqual(["'self'"])
    expect(directiveSources(policy, 'frame-ancestors')).toEqual(["'none'"])
    // Keeps this phase provably additive: only the engine directory gains a cache policy.
    expect(headerOf(mainRule, 'Cache-Control')).toBeUndefined()
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
    expect(headerOf(engineRule, 'Cache-Control')).toBe(ENGINE_CACHE_CONTROL)
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
    for (const rule of [mainRule, engineRule, manifestRule]) {
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
      '/assets/index-abc123.js',
      '/assets/index-abc123.css',
      '/assets/plain-worker-abc123.js',
      '/favicon.svg',
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

    for (const path of mainPaths) {
      const matched = rulesFor(path)
      expect(matched.map((rule) => rule.source)).toEqual([MAIN_SOURCE])
      expect(matched.filter((r) => cspOf(r) !== undefined)).toHaveLength(1)
    }
    for (const path of enginePaths) {
      const matched = rulesFor(path)
      expect(matched.map((rule) => rule.source)).toEqual([ENGINE_SOURCE])
      expect(matched.filter((r) => cspOf(r) !== undefined)).toHaveLength(1)
    }
    for (const path of manifestPaths) {
      const matched = rulesFor(path)
      expect(matched.map((rule) => rule.source)).toEqual([MANIFEST_SOURCE])
      expect(matched.filter((r) => cspOf(r) !== undefined)).toHaveLength(1)
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
