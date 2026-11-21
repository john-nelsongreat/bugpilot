import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

/**
 * Everything a browser needs in order to run a WebAssembly engine has to be served
 * with the `assets/engines/` policy in vercel.json (`script-src 'self'
 * 'wasm-unsafe-eval'`); a module worker's own response headers are its policy, so the
 * worker entry, the chunks it imports and every `.wasm` file must sit in that one
 * directory. The main document keeps `script-src 'self'` unchanged.
 */
const ENGINE_DIR = 'assets/engines/'

/**
 * The only two script chunks allowed in the engine directory: the module worker that
 * instantiates WebAssembly and the small client that spawns it. A page chunk that happens to
 * share engine glue with them must stay under the main policy, or `wasm-unsafe-eval` would
 * follow application code.
 */
const ENGINE_CHUNK_ROOTS = ['engineWorkerEntry', 'engineClient']

function normalisePath(value: string): string {
  return value.replace(/\\/g, '/')
}

interface NamingInfo {
  name?: string
  fileName?: string
  facadeModuleId?: string | null
  modules?: Record<string, unknown>
  moduleIds?: string[]
  originalName?: string
}

function isEngineChunk(info: NamingInfo): boolean {
  const name = info.name ?? ''
  if (ENGINE_CHUNK_ROOTS.some((root) => name.startsWith(root))) return true
  const facade = info.facadeModuleId ? normalisePath(info.facadeModuleId) : ''
  return ENGINE_CHUNK_ROOTS.some((root) => facade.endsWith(`features/analyzer/engines/${root}.ts`))
}

function engineOutput() {
  return {
    entryFileNames: (info: NamingInfo) =>
      isEngineChunk(info) ? `${ENGINE_DIR}[name]-[hash].js` : 'assets/[name]-[hash].js',
    chunkFileNames: (info: NamingInfo) =>
      isEngineChunk(info) ? `${ENGINE_DIR}[name]-[hash].js` : 'assets/[name]-[hash].js',
    assetFileNames: (info: NamingInfo) => {
      const name = info.name ?? info.originalName ?? ''
      // Every WebAssembly module in this app is an engine file; fonts and CSS stay put.
      if (name.endsWith('.wasm')) return `${ENGINE_DIR}[name]-[hash][extname]`
      return 'assets/[name]-[hash][extname]'
    },
  }
}

interface ManifestFile {
  path: string
  kind: 'engine-worker' | 'engine-client' | 'tree-sitter-core' | 'grammar' | 'ruff' | 'other'
  language: string | null
  rawBytes: number
  gzipBytes: number
}

function classifyEngineFile(fileName: string): { kind: ManifestFile['kind']; language: string | null } {
  const base = fileName.split('/').pop() ?? fileName
  if (base.startsWith('engineWorker')) return { kind: 'engine-worker', language: null }
  if (base.startsWith('engineClient')) return { kind: 'engine-client', language: null }
  if (base.startsWith('ruff')) return { kind: 'ruff', language: 'python' }
  if (base.startsWith('web-tree-sitter')) return { kind: 'tree-sitter-core', language: null }
  const grammar = /^tree-sitter-([a-z0-9_]+)-[A-Za-z0-9_-]+\.wasm$/.exec(base)
  if (grammar) return { kind: 'grammar', language: grammar[1] }
  return { kind: 'other', language: null }
}

/**
 * Writes `assets/engines/manifest.json` after the bundle is on disk. The app reads it to
 * tell the user what is about to download and how big it is; `scripts/check-live.mjs`
 * reads it to fetch real engine files and compare their headers with vercel.json.
 */
function engineManifestPlugin(outDir: string): Plugin {
  return {
    name: 'bugpilot:engine-manifest',
    apply: 'build',
    closeBundle() {
      const enginesDir = resolve(process.cwd(), outDir, ENGINE_DIR)
      let names: string[]
      try {
        names = readdirSync(enginesDir).filter((name) => !name.startsWith('manifest.'))
      } catch {
        // No engine files: still write an empty manifest so the live check can tell
        // "no engines in this build" apart from "manifest missing".
        writeFileSync(
          resolve(enginesDir.replace(/\/?$/, ''), 'manifest.json'),
          JSON.stringify({ schemaVersion: 1, files: [] }, null, 2),
        )
        return
      }

      const files: ManifestFile[] = names
        .filter((name) => {
          try {
            return statSync(resolve(enginesDir, name)).isFile()
          } catch {
            return false
          }
        })
        .map((name) => {
          const abs = resolve(enginesDir, name)
          const source = readFileSync(abs)
          const { kind, language } = classifyEngineFile(name)
          return {
            path: `/${ENGINE_DIR}${name}`,
            kind,
            language,
            rawBytes: source.length,
            gzipBytes: gzipSync(source, { level: 9 }).length,
          }
        })
        .sort((left, right) => left.path.localeCompare(right.path))

      writeFileSync(
        resolve(enginesDir, 'manifest.json'),
        `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`,
      )
    },
  }
}

/**
 * The registry trio only exercises the shared-registry leak in one order: `registryPolluter`
 * registers a mock and evaluates the consumer fixture, `registryVictim` imports that consumer, and
 * `registryHygieneCensus` adjudicates what the victim recorded. The default sequencer puts
 * previously-failed files first and then longest-first, so one census red moves the census ahead of
 * its own inputs, where the only mark it can read is one an earlier run left behind (measured
 * 2026-11-17: census at line 47 of ../handoff-audit/evidence/loop2l9/audit/audit-G4c-full-suite.log, its polluter at
 * 299). Pinning the trio's relative order makes the guard's premise enforced rather than usual.
 */
const REGISTRY_ORDER = ['registryPolluter', 'registryVictim', 'registryHygieneCensus']

class RegistryOrderSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files)
    const trio = REGISTRY_ORDER.map((name) => sorted.find((spec) => spec.moduleId.includes(name))).filter(
      (spec): spec is TestSpecification => spec !== undefined,
    )
    if (trio.length === 0) return sorted
    const others = sorted.filter((spec) => !trio.includes(spec))
    const at = Math.min(sorted.findIndex((spec) => trio.includes(spec)), others.length)
    return [...others.slice(0, at), ...trio, ...others.slice(at)]
  }
}

export default defineConfig({
  plugins: [react(), engineManifestPlugin('dist')],
  build: {
    rollupOptions: { output: engineOutput() },
  },
  worker: {
    format: 'es',
    rollupOptions: { output: engineOutput() },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    restoreMocks: true,
    testTimeout: 60000,
    fileParallelism: false,
    sequence: { sequencer: RegistryOrderSequencer },
    // Forked workers intermittently miss the startup timeout on this Windows
    // machine; threads keep the same per-file isolation without process spawn.
    pool: 'threads',
    // Sharing one module registry across files is what makes the suite cheap. It is only safe
    // while every file that mocks a production module re-imports it after vi.resetModules(); a
    // file that wants the real module can otherwise inherit an earlier file's mock. Neither half
    // of that rule is counted here, because a number typed into a comment goes stale the next
    // time a file changes: the mockers are the output of
    // `grep -rl "vi.mock(" src --include=*.test.ts --include=*.test.tsx`, and the files still
    // missing the pattern are that output through `xargs grep -L "vi.resetModules"`. The single
    // deliberate exception is src/registryPolluter.test.ts: it exists to leak, and it stays
    // harmless because RegistryOrderSequencer in this very file orders it ahead of
    // src/registryVictim.test.ts, and because the afterAll reset in src/test/setup.ts clears the
    // cached consumer. Section 3 of ../handoff-audit/evidence/m1g/m1g-report.md names the files this
    // was first applied to and the command that reproduced them.
    isolate: false,
  },
})
