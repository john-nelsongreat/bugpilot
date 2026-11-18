/**
 * The runtime source of truth for where the engine binaries live. Under Vite, `assets.ts`
 * registers the build-hashed same-origin URLs the moment it is imported. In a plain Node
 * process (the headless CLI) nothing imports `assets.ts` — its `?url` specifiers only
 * resolve inside the Vite pipeline — so the CLI registers loopback-HTTP and filesystem
 * locations instead. The engine modules read through the `require*` accessors and fail
 * with a message naming both registration routes, instead of failing later with an
 * unresolvable download.
 */
export type GrammarId =
  | 'bash'
  | 'c'
  | 'c_sharp'
  | 'cpp'
  | 'css'
  | 'go'
  | 'html'
  | 'java'
  | 'kotlin'
  | 'lua'
  | 'php'
  | 'python'
  | 'r'
  | 'ruby'
  | 'rust'
  | 'sql'
  | 'swift'
  | 'terraform'
  | 'yaml'

/** Every grammar the pack ships, in `assets.ts` declaration order. */
export const GRAMMAR_IDS: readonly GrammarId[] = [
  'bash',
  'c',
  'c_sharp',
  'cpp',
  'css',
  'go',
  'html',
  'java',
  'kotlin',
  'lua',
  'php',
  'python',
  'r',
  'ruby',
  'rust',
  'sql',
  'swift',
  'terraform',
  'yaml',
]

export interface EngineSourcesConfig {
  /** One URL or filesystem path per grammar; the set must be exactly the shipped pack. */
  grammarUrls: Record<GrammarId, string>
  /** The web-tree-sitter core wasm, resolvable by the emscripten loader (path or URL). */
  treeSitterCoreUrl: string
  /** The Ruff wasm served to `fetchWasmCapped` (something the global `fetch` can reach). */
  ruffWasmUrl: string
}

export class EngineSourcesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineSourcesError'
  }
}

const REGISTRATION_ROUTES =
  "Engine sources are not configured: import './assets' (browser and vitest) or call configureEngineSources (Node CLI) before loading an engine."

let sources: EngineSourcesConfig | null = null

/** Registers the engine binary locations for this process; a second registration is a bug. */
export function configureEngineSources(config: EngineSourcesConfig): void {
  if (sources) {
    throw new EngineSourcesError('Engine sources are already configured; registration must happen exactly once per process.')
  }
  const missing = GRAMMAR_IDS.filter((id) => typeof config.grammarUrls[id] !== 'string' || config.grammarUrls[id].length === 0)
  if (missing.length > 0) {
    throw new EngineSourcesError(
      `grammarUrls is missing ${missing.length} of the ${GRAMMAR_IDS.length} grammars: ${missing.join(', ')}.`,
    )
  }
  sources = {
    grammarUrls: { ...config.grammarUrls },
    treeSitterCoreUrl: config.treeSitterCoreUrl,
    ruffWasmUrl: config.ruffWasmUrl,
  }
}

export function engineSourcesConfigured(): boolean {
  return sources !== null
}

export function requireGrammarUrl(grammar: GrammarId): string {
  if (!sources) throw new EngineSourcesError(REGISTRATION_ROUTES)
  return sources.grammarUrls[grammar]
}

export function requireTreeSitterCoreUrl(): string {
  if (!sources) throw new EngineSourcesError(REGISTRATION_ROUTES)
  return sources.treeSitterCoreUrl
}

export function requireRuffWasmUrl(): string {
  if (!sources) throw new EngineSourcesError(REGISTRATION_ROUTES)
  return sources.ruffWasmUrl
}
