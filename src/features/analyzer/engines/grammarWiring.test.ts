// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRAMMAR_URLS } from './assets'

/**
 * The real-grammar suites load `node_modules/tree-sitter-wasm/out/<grammar>/...` straight off disk, so
 * they never exercise the wiring that puts a grammar into the bundle: the static `?url` imports in
 * `assets.ts`, and the classifier in `vite.config.ts` that names the emitted file in
 * `assets/engines/manifest.json`, which the download plan and the live check both read. Each link is
 * loose enough to be wrong in silence: a `?url` import replaced by a runtime-built path still yields a
 * string ending `.wasm`, and a grammar id bound to the wrong pack file still loads a grammar.
 *
 * So follow the id the way the build does — key to import specifier to emitted file name to manifest
 * language — instead of trusting the count of keys, which `engineCounts.test.ts` already gates.
 */

const GRAMMAR_IDS = Object.keys(GRAMMAR_URLS).sort()

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const ASSETS_SOURCE = readRepoFile('src/features/analyzer/engines/assets.ts')
const CONFIG_SOURCE = readRepoFile('vite.config.ts')

/** `identifier -> module specifier` for every static import in a file. */
function staticImports(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of source.matchAll(/^import (\w+) from '([^']+)'$/gm)) {
    found.set(String(match[1]), String(match[2]))
  }
  return found
}

/** `GrammarId -> identifier` inside the published `GRAMMAR_URLS` literal. */
function publishedBindings(source: string): Map<string, string> {
  const block = /export const GRAMMAR_URLS: Record<GrammarId, string> = \{([\s\S]*?)\n\}/.exec(source)
  expect(block, 'assets.ts: the GRAMMAR_URLS literal must still be shaped as written').not.toBeNull()
  const found = new Map<string, string>()
  for (const match of String(block?.[1]).matchAll(/^(\s+)([a-z0-9_]+): (\w+),$/gm)) {
    found.set(String(match[2]), String(match[3]))
  }
  return found
}

/** The grammar-name pattern the build uses to label an emitted engine file, lifted out of the config. */
function grammarNamePattern(source: string): RegExp {
  const statement = /const grammar = (\/[^\n]+\/)\.exec\(base\)/.exec(source)
  expect(statement, 'vite.config.ts: the classifier must still derive the grammar name with a regex').not.toBeNull()
  return new RegExp(String(statement?.[1]).slice(1, -1))
}

describe('grammar wiring from assets.ts to the engine manifest', () => {
  it('publishes one static ?url import per grammar, and no grammar shares another one', () => {
    const bindings = publishedBindings(ASSETS_SOURCE)
    const imports = staticImports(ASSETS_SOURCE)

    expect([...bindings.keys()].sort()).toEqual(GRAMMAR_IDS)
    expect(GRAMMAR_IDS).toHaveLength(16)

    const specifiers = new Set<string>()
    for (const id of GRAMMAR_IDS) {
      const identifier = bindings.get(id)
      expect(identifier, `assets.ts: ${id} has no entry in the published map`).toBeDefined()
      const specifier = imports.get(String(identifier))
      expect(specifier, `assets.ts: ${id} is bound to '${identifier}', which is not a static import`).toBeDefined()
      // A URL built at runtime is the shape that survives every type check and ships no asset.
      expect(String(specifier), `assets.ts: ${id} must be imported with ?url`).toMatch(/\.wasm\?url$/)
      specifiers.add(String(specifier))
    }
    expect(specifiers.size, 'assets.ts: two grammars point at the same pack file').toBe(GRAMMAR_IDS.length)
  })

  it('binds each grammar id to the pack file that names it', () => {
    const bindings = publishedBindings(ASSETS_SOURCE)
    const imports = staticImports(ASSETS_SOURCE)

    for (const id of GRAMMAR_IDS) {
      const specifier = String(imports.get(String(bindings.get(id))))
      // 'tree-sitter-wasm/python/tree-sitter-python.wasm?url' is the only shape that means this id:
      // the pack directory and the binary both carry the grammar name, so a swapped binding is caught
      // here rather than at run time, where it shows up as wrong-but-plausible analysis.
      expect(specifier, `assets.ts: ${id} is not imported from its own pack directory`).toBe(
        `tree-sitter-wasm/${id}/tree-sitter-${id}.wasm?url`,
      )
    }
  })

  it('names every shipped grammar in the manifest the build writes', () => {
    const pattern = grammarNamePattern(CONFIG_SOURCE)

    for (const id of GRAMMAR_IDS) {
      // `assetFileNames` puts `[name]-[hash]` in the engine directory, and `[name]` is the imported
      // binary without its extension, so this is the file name the manifest would carry for this id.
      const emitted = `tree-sitter-${id}-A1b2C3d4.wasm`
      const match = pattern.exec(emitted)
      expect(match, `vite.config.ts: '${emitted}' is not recognised as a grammar`).not.toBeNull()
      expect(String(match?.[1]), `vite.config.ts: '${emitted}' is labelled as the wrong language`).toBe(id)
    }

    // The two binaries that are not grammars must not be swallowed by the grammar pattern either.
    for (const runtime of ['web-tree-sitter-A1b2C3d4.wasm', 'ruff_wasm_bg-CW-taZr4.wasm']) {
      expect(pattern.exec(runtime), `vite.config.ts: '${runtime}' must not classify as a grammar`).toBeNull()
    }

    expect(CONFIG_SOURCE).toMatch(/base\.startsWith\('web-tree-sitter'\)/)
    expect(CONFIG_SOURCE).toMatch(/base\.startsWith\('ruff'\)/)
  })

  it('gives every grammar its own language in the manifest', () => {
    const pattern = grammarNamePattern(CONFIG_SOURCE)
    const languages = GRAMMAR_IDS.map((id) => pattern.exec(`tree-sitter-${id}-A1b2C3d4.wasm`)?.[1])
    expect(new Set(languages).size, 'two grammars collapse to the same manifest language').toBe(GRAMMAR_IDS.length)
  })
})
