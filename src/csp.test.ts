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
const ENGINE_SOURCE = '/assets/engines/(.*)'

const mainRule = rules.find((rule) => rule.source === MAIN_SOURCE)
const engineRule = rules.find((rule) => rule.source === ENGINE_SOURCE)

// The policy that shipped before the WebAssembly engines. The main document must
// keep it character-for-character; only engine worker files may loosen script-src.
const MAIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

const ENGINE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

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
  return rule?.headers.find((header) => header.key === 'Content-Security-Policy')
    ?.value
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
  it('has exactly one main rule and one engine rule', () => {
    expect(rules).toHaveLength(2)
    expect(mainRule).toBeDefined()
    expect(engineRule).toBeDefined()
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
  })

  it('repeats the four other security headers on the engine rule', () => {
    for (const rule of [mainRule, engineRule]) {
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
      '/assets/engines/manifest.json',
      '/assets/engines/engine-worker-abc123.js',
      '/assets/engines/web-tree-sitter-abc123.wasm',
      '/assets/engines/grammar-python-abc123.wasm',
      '/assets/engines/ruff-abc123.wasm',
    ]

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
  })
})
