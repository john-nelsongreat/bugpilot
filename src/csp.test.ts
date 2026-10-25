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

const globalRules = (config.headers ?? []).filter(
  (rule) => rule.source === '/(.*)',
)

const csp = globalRules
  .flatMap((rule) => rule.headers)
  .find((header) => header.key === 'Content-Security-Policy')?.value

function directiveSources(policy: string, name: string): string[] {
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.split(/\s+/)[0] === name)

  return directive ? directive.split(/\s+/).slice(1) : []
}

describe('Content-Security-Policy in vercel.json', () => {
  it('applies a self-only policy on the global rule without unsafe sources', () => {
    expect(globalRules).toHaveLength(1)
    expect(csp).toBeTruthy()
    const policy = csp as string

    expect(directiveSources(policy, 'default-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'script-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'style-src')).toEqual(["'self'"])
    expect(directiveSources(policy, 'object-src')).toEqual(["'none'"])
    expect(directiveSources(policy, 'base-uri')).toEqual(["'self'"])
    expect(directiveSources(policy, 'frame-ancestors')).toEqual(["'none'"])

    expect(policy).not.toContain("'unsafe-eval'")
    expect(directiveSources(policy, 'script-src')).not.toContain(
      "'unsafe-inline'",
    )
  })
})
