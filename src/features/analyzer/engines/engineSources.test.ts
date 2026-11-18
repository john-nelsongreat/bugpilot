// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GRAMMAR_IDS, type GrammarId } from './engineSources'

const CONFIG = {
  grammarUrls: Object.fromEntries(GRAMMAR_IDS.map((id) => [id, `stub://${id}.wasm`])) as Record<GrammarId, string>,
  treeSitterCoreUrl: 'stub://core.wasm',
  ruffWasmUrl: 'stub://ruff.wasm',
}

/** A pristine module instance: setup.ts may already have registered assets.ts in this registry. */
async function freshModule(): Promise<typeof import('./engineSources')> {
  vi.resetModules()
  return import('./engineSources')
}

describe('engineSources', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('refuses every accessor before any registration, naming both registration routes', async () => {
    const mod = await freshModule()
    const { EngineSourcesError: FreshError } = mod
    expect(() => mod.requireGrammarUrl('python')).toThrow(FreshError)
    expect(() => mod.requireGrammarUrl('python')).toThrow(/configureEngineSources/)
    expect(() => mod.requireTreeSitterCoreUrl()).toThrow(FreshError)
    expect(() => mod.requireRuffWasmUrl()).toThrow(FreshError)
    expect(mod.engineSourcesConfigured()).toBe(false)
  })

  it('round-trips all three source kinds after one registration', async () => {
    const mod = await freshModule()
    mod.configureEngineSources(CONFIG)
    expect(mod.engineSourcesConfigured()).toBe(true)
    expect(mod.requireGrammarUrl('python')).toBe('stub://python.wasm')
    expect(mod.requireGrammarUrl('c_sharp')).toBe('stub://c_sharp.wasm')
    expect(mod.requireTreeSitterCoreUrl()).toBe('stub://core.wasm')
    expect(mod.requireRuffWasmUrl()).toBe('stub://ruff.wasm')
  })

  it('rejects a registration missing grammars and leaves the module unconfigured', async () => {
    const mod = await freshModule()
    const partial: Partial<Record<GrammarId, string>> = { ...CONFIG.grammarUrls }
    delete partial.python
    expect(() =>
      mod.configureEngineSources({ ...CONFIG, grammarUrls: partial as Record<GrammarId, string> }),
    ).toThrow(/missing 1 of the 19 grammars: python/)
    expect(mod.engineSourcesConfigured()).toBe(false)
  })

  it('refuses a second registration', async () => {
    const mod = await freshModule()
    const { EngineSourcesError: FreshError } = mod
    mod.configureEngineSources(CONFIG)
    expect(() => mod.configureEngineSources(CONFIG)).toThrow(FreshError)
    expect(() => mod.configureEngineSources(CONFIG)).toThrow(/exactly once/)
  })

  it('copies the grammar map, so later mutation of the caller object cannot reach the engines', async () => {
    const mod = await freshModule()
    const urls: Record<GrammarId, string> = { ...CONFIG.grammarUrls }
    mod.configureEngineSources({ ...CONFIG, grammarUrls: urls })
    urls.python = 'tampered://python.wasm'
    expect(mod.requireGrammarUrl('python')).toBe('stub://python.wasm')
  })

  it('assets.ts registration covers the browser and vitest route with the whole pack', async () => {
    const mod = await freshModule()
    await import('./assets')
    expect(mod.engineSourcesConfigured()).toBe(true)
    for (const id of GRAMMAR_IDS) {
      expect(mod.requireGrammarUrl(id), id).toMatch(/\.wasm$/)
    }
    expect(mod.requireTreeSitterCoreUrl()).toMatch(/web-tree-sitter\.wasm$/)
    expect(mod.requireRuffWasmUrl()).toMatch(/ruff_wasm_bg\.wasm$/)
  })
})
