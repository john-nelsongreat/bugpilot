/**
 * Every WebAssembly binary the deep engines need, addressed as a same-origin asset so it
 * is fetched only when a file actually requires it. `?url` imports emit the asset and give
 * its hashed path; they do not download anything by themselves.
 */
import treeSitterCore from 'web-tree-sitter/web-tree-sitter.wasm?url'
import ruffWasm from '@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm?url'

import { configureEngineSources, type GrammarId } from './engineSources'

/** The grammar-directory union lives in `engineSources.ts`; this file only registers the Vite URLs. */
export type { GrammarId }

import grammarBash from 'tree-sitter-wasm/bash/tree-sitter-bash.wasm?url'
import grammarC from 'tree-sitter-wasm/c/tree-sitter-c.wasm?url'
import grammarCSharp from 'tree-sitter-wasm/c_sharp/tree-sitter-c_sharp.wasm?url'
import grammarCpp from 'tree-sitter-wasm/cpp/tree-sitter-cpp.wasm?url'
import grammarCss from 'tree-sitter-wasm/css/tree-sitter-css.wasm?url'
import grammarGo from 'tree-sitter-wasm/go/tree-sitter-go.wasm?url'
import grammarHtml from 'tree-sitter-wasm/html/tree-sitter-html.wasm?url'
import grammarJava from 'tree-sitter-wasm/java/tree-sitter-java.wasm?url'
import grammarKotlin from 'tree-sitter-wasm/kotlin/tree-sitter-kotlin.wasm?url'
import grammarLua from 'tree-sitter-wasm/lua/tree-sitter-lua.wasm?url'
import grammarPhp from 'tree-sitter-wasm/php/tree-sitter-php.wasm?url'
import grammarPython from 'tree-sitter-wasm/python/tree-sitter-python.wasm?url'
import grammarR from 'tree-sitter-wasm/r/tree-sitter-r.wasm?url'
import grammarRuby from 'tree-sitter-wasm/ruby/tree-sitter-ruby.wasm?url'
import grammarRust from 'tree-sitter-wasm/rust/tree-sitter-rust.wasm?url'
import grammarSql from 'tree-sitter-wasm/sql/tree-sitter-sql.wasm?url'
import grammarSwift from 'tree-sitter-wasm/swift/tree-sitter-swift.wasm?url'
import grammarTerraform from 'tree-sitter-wasm/terraform/tree-sitter-terraform.wasm?url'
import grammarYaml from 'tree-sitter-wasm/yaml/tree-sitter-yaml.wasm?url'

/** Grammar directory names inside the `tree-sitter-wasm` pack. */
export const GRAMMAR_URLS: Record<GrammarId, string> = {
  bash: grammarBash,
  c: grammarC,
  c_sharp: grammarCSharp,
  cpp: grammarCpp,
  css: grammarCss,
  go: grammarGo,
  html: grammarHtml,
  java: grammarJava,
  kotlin: grammarKotlin,
  lua: grammarLua,
  php: grammarPhp,
  python: grammarPython,
  r: grammarR,
  ruby: grammarRuby,
  rust: grammarRust,
  sql: grammarSql,
  swift: grammarSwift,
  terraform: grammarTerraform,
  yaml: grammarYaml,
}

export const TREE_SITTER_CORE_URL = treeSitterCore
export const RUFF_WASM_URL = ruffWasm

/** The one registration of the Vite-hashed asset locations for browser and vitest runs. */
configureEngineSources({ grammarUrls: GRAMMAR_URLS, treeSitterCoreUrl: TREE_SITTER_CORE_URL, ruffWasmUrl: RUFF_WASM_URL })
