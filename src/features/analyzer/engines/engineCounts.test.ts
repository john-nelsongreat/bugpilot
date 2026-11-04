// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRAMMAR_URLS } from './assets'
import { ENGINE_IDS } from './registry'

/**
 * The engine counts in the documentation used to be prose someone typed. They are now derived from
 * the registry and the build configuration, so a grammar added or dropped cannot leave a stale
 * number in README.md or docs/ENGINE-LICENCES.md — the slice B report had exactly that bug ("19
 * shipped binaries" against a manifest of 18).
 */

const GRAMMAR_COUNT = Object.keys(GRAMMAR_URLS).length

/** The two non-grammar binaries, read from the same module that publishes their URLs. */
const RUNTIME_WASM_COUNT = 2

const WASM_COUNT = GRAMMAR_COUNT + RUNTIME_WASM_COUNT

/** The script chunks the build is allowed to place in the engine directory. */
function engineChunkCount(): number {
  const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
  const match = /const ENGINE_CHUNK_ROOTS = \[([^\]]*)\]/.exec(config)
  return (match?.[1] ?? '').split(',').filter((entry) => entry.trim() !== '').length
}

const TOTAL_ASSET_COUNT = WASM_COUNT + engineChunkCount()

const DOCS = ['README.md', 'docs/ENGINE-LICENCES.md'] as const

function readDoc(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
}

function captures(pattern: RegExp, text: string): string[] {
  if (!pattern.global) throw new Error('captures() needs a global pattern: matchAll would throw.')
  const found: string[] = []
  for (const match of text.matchAll(pattern)) {
    const value = match[1]
    if (value !== undefined) found.push(value)
  }
  return found
}

describe('engine counts stated in the docs', () => {
  it('derives a sane set of numbers from the registry and the build', () => {
    expect(GRAMMAR_COUNT).toBe(16)
    expect(WASM_COUNT).toBe(18)
    expect(engineChunkCount()).toBe(2)
    expect(TOTAL_ASSET_COUNT).toBe(20)
    expect(ENGINE_IDS).toEqual(['tree-sitter', 'ruff'])
  })

  it('never says a different number of shipped binaries', () => {
    for (const file of DOCS) {
      const stated = captures(/all (\d+) shipped(?: `\.wasm`)? binaries/gi, readDoc(file))
      expect(stated, `${file} shipped-binaries count`).toEqual(stated.map(() => String(WASM_COUNT)))
      expect(stated.length, `${file} mentions the shipped binary count at least once`).toBeGreaterThan(0)
    }
  })

  it('never says a different number of .wasm files', () => {
    for (const file of DOCS) {
      const stated = captures(/(?:the|distributes the) (\d+) `\.wasm`/gi, readDoc(file))
      for (const value of stated) {
        expect(Number(value), `${file} .wasm count`).toBe(WASM_COUNT)
      }
    }
  })

  it('never says a different number of grammars', () => {
    for (const file of DOCS) {
      const text = readDoc(file)
      const stated = [
        ...captures(/\((\d+) grammars\)/g, text),
        ...captures(/(\d+) grammar binaries/g, text),
        ...captures(/^## The (\d+) grammars$/gm, text),
      ]
      expect(stated.length).toBeGreaterThan(0)
      for (const value of stated) {
        expect(Number(value), `${file} grammar count`).toBe(GRAMMAR_COUNT)
      }
    }
  })

  it('matches the manifest total the build publishes', () => {
    const stated = captures(/Total published: (\d+) files/g, readDoc('README.md'))
    expect(stated.length).toBeGreaterThan(0)
    for (const value of stated) {
      expect(Number(value)).toBe(TOTAL_ASSET_COUNT)
    }
  })
})
