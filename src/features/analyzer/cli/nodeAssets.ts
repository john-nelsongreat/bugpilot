/**
 * The headless CLI's engine binary source. The browser gets Vite-hashed same-origin URLs;
 * here the same pack files are served over a loopback HTTP listener so the engines run
 * through their real download path — `fetch`, the byte caps, and the wasm-header guard —
 * with nothing shunted aside for Node. The web-tree-sitter core is the one exception: its
 * emscripten loader reads a filesystem path in Node, so it is registered as a path.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRAMMAR_IDS, type EngineSourcesConfig, type GrammarId } from '../engines/engineSources'

export interface NodeAssetServer {
  engineSourcesConfig: () => EngineSourcesConfig
  close: () => void
}

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error('Could not find the package root (no package.json above the CLI module).')
    }
    dir = parent
  }
}

export async function startNodeAssets(): Promise<NodeAssetServer> {
  const root = repoRoot()
  const grammarDir = path.join(root, 'node_modules', 'tree-sitter-wasm', 'out')
  const corePath = path.join(root, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm')
  const ruffPath = path.join(root, 'node_modules', '@astral-sh', 'ruff-wasm-web', 'ruff_wasm_bg.wasm')

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const match = /^\/grammars\/([a-z0-9_]+)\.wasm$/.exec(url.pathname)
    const file =
      match && (GRAMMAR_IDS as readonly string[]).includes(match[1])
        ? path.join(grammarDir, match[1], `tree-sitter-${match[1]}.wasm`)
        : url.pathname === '/ruff.wasm'
          ? ruffPath
          : null
    if (!file || !fs.existsSync(file)) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    const bytes = fs.readFileSync(file)
    response.writeHead(200, { 'content-type': 'application/wasm', 'content-length': bytes.byteLength })
    response.end(bytes)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`
  const grammarUrls = Object.fromEntries(GRAMMAR_IDS.map((id) => [id, `${base}/grammars/${id}.wasm`])) as Record<
    GrammarId,
    string
  >

  return {
    engineSourcesConfig: () => ({ grammarUrls, treeSitterCoreUrl: corePath, ruffWasmUrl: `${base}/ruff.wasm` }),
    close: () => server.close(),
  }
}
