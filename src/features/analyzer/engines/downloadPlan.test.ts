import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceLanguage } from '../archive/classify'
import {
  formatEngineBytes,
  loadEngineManifest,
  planEngineDownload,
  resetEngineManifestCache,
  type EngineFileEntry,
  type EngineManifest,
} from './downloadPlan'

function entry(
  path: string,
  kind: EngineFileEntry['kind'],
  rawBytes: number,
  gzipBytes: number,
  language: string | null = null,
): EngineFileEntry {
  return { path, kind, language, rawBytes, gzipBytes }
}

const MANIFEST: EngineManifest = {
  schemaVersion: 1,
  files: [
    entry('/assets/engines/engineWorkerEntry-a.js', 'engine-worker', 132_000, 37_000),
    entry('/assets/engines/engineClient-b.js', 'engine-client', 2_400, 940),
    entry('/assets/engines/web-tree-sitter-c.js', 'tree-sitter-core', 200_000, 60_000),
    entry('/assets/engines/tree-sitter-python-d.wasm', 'grammar', 456_587, 120_000, 'python'),
    entry('/assets/engines/tree-sitter-java-e.wasm', 'grammar', 400_000, 90_000, 'java'),
    entry('/assets/engines/tree-sitter-ruby-f.wasm', 'grammar', 300_000, 70_000, 'ruby'),
    entry('/assets/engines/ruff_wasm_bg-g.wasm', 'ruff', 10_038_888, 3_733_660),
    entry('/assets/engines/manifest.json', 'other', 900, 300),
  ],
}

function fetchReturning(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
}

afterEach(() => {
  resetEngineManifestCache()
})

describe('engine manifest loading', () => {
  it('reads the sizes the build recorded, from a same-origin URL', async () => {
    const doFetch = fetchReturning(200, MANIFEST)
    const manifest = await loadEngineManifest(doFetch as never)
    expect(manifest?.files).toHaveLength(MANIFEST.files.length)
    const url = doFetch.mock.calls[0][0]
    expect(url).toBe('/assets/engines/manifest.json')
    expect(url.startsWith('/')).toBe(true)
    expect(doFetch.mock.calls[0][1]).toEqual({ cache: 'no-store' })
  })

  it('is fetched once per page and cached', async () => {
    const doFetch = fetchReturning(200, MANIFEST)
    await loadEngineManifest(doFetch as never)
    await loadEngineManifest(doFetch as never)
    expect(doFetch).toHaveBeenCalledTimes(1)
  })

  it('gives up quietly on a missing or malformed manifest', async () => {
    resetEngineManifestCache()
    expect(await loadEngineManifest(fetchReturning(404, null) as never)).toBeNull()
    resetEngineManifestCache()
    expect(await loadEngineManifest(fetchReturning(200, { files: 'nope' }) as never)).toBeNull()
    resetEngineManifestCache()
    expect(await loadEngineManifest(fetchReturning(200, { files: [{ path: 1 }] }) as never)).toEqual({
      schemaVersion: 1,
      files: [],
    })
    resetEngineManifestCache()
    expect(await loadEngineManifest((async () => {
      throw new Error('offline')
    }) as never)).toBeNull()
  })
})

describe('engine download plan', () => {
  it('lists the worker, its loader and only the grammars this upload needs', () => {
    const plan = planEngineDownload(MANIFEST, ['c', 'java'])
    expect(plan.files.map((file) => file.path)).toEqual([
      '/assets/engines/engineWorkerEntry-a.js',
      '/assets/engines/engineClient-b.js',
      '/assets/engines/web-tree-sitter-c.js',
      '/assets/engines/tree-sitter-java-e.wasm',
    ])
    expect(plan.needsRuff).toBe(false)
    expect(plan.needsTreeSitter).toBe(true)
    expect(plan.files.some((file) => file.kind === 'ruff')).toBe(false)
    // Nothing outside the engine directory, and nothing the page did not ask for.
    expect(plan.files.every((file) => file.path.startsWith('/assets/engines/'))).toBe(true)
  })

  it('counts the loader script in the total it quotes', () => {
    const plan = planEngineDownload(MANIFEST, ['java'])
    expect(plan.files.map((file) => file.path)).toContain('/assets/engines/engineClient-b.js')
    expect(plan.gzipBytes).toBe(37_000 + 940 + 60_000 + 90_000)
    expect(plan.rawBytes).toBe(132_000 + 2_400 + 200_000 + 400_000)
  })

  it('adds the Ruff binary only for Python', () => {
    const withPython = planEngineDownload(MANIFEST, ['java', 'python'])
    expect(withPython.needsRuff).toBe(true)
    expect(withPython.files.map((file) => file.path)).toContain('/assets/engines/ruff_wasm_bg-g.wasm')

    const withoutPython = planEngineDownload(MANIFEST, ['java', 'ruby'])
    expect(withoutPython.needsRuff).toBe(false)
    expect(withoutPython.files.some((file) => file.kind === 'ruff')).toBe(false)
  })

  it('names the languages no engine covers instead of pretending to check them', () => {
    const plan = planEngineDownload(MANIFEST, ['scala', 'python', 'markdown'] as SourceLanguage[])
    expect(plan.uncovered).toEqual(['scala', 'markdown'])
  })

  it('still plans the run when the manifest is missing, without a number', () => {
    const plan = planEngineDownload(null, ['python'])
    expect(plan.files).toEqual([])
    expect(plan.gzipBytes).toBe(0)
    expect(plan.needsRuff).toBe(true)
    expect(plan.uncovered).toEqual([])
  })

  it('says nothing is needed for a language the engines skip', () => {
    const plan = planEngineDownload(MANIFEST, ['javascript', 'typescript'])
    expect(plan.files).toEqual([])
    expect(plan.gzipBytes).toBe(0)
    expect(plan.needsTreeSitter).toBe(false)
    expect(plan.needsRuff).toBe(false)
    expect(plan.uncovered).toEqual(['javascript', 'typescript'])
  })
})

describe('engine size copy', () => {
  it('formats bytes the way the gate quotes them', () => {
    expect(formatEngineBytes(512)).toBe('512 B')
    expect(formatEngineBytes(1_024)).toBe('1.0 KiB')
    expect(formatEngineBytes(9_728)).toBe('9.5 KiB')
    expect(formatEngineBytes(102_400)).toBe('100 KiB')
    expect(formatEngineBytes(3_733_660)).toBe('3.6 MiB')
  })
})
