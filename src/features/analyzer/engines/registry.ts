import type { SourceLanguage } from '../archive/classify'
import type { GrammarId } from './assets'

/** Engines that can run on one file. `bugpilot-rules` and `typescript` are slice A. */
export const ENGINE_IDS = ['tree-sitter', 'ruff'] as const
export type EngineId = (typeof ENGINE_IDS)[number]

export interface LanguageEngines {
  language: SourceLanguage
  /** Grammar in the tree-sitter pack, or null when no permissive grammar is shipped. */
  grammar: GrammarId | null
  engines: EngineId[]
}

/**
 * The whole language decision in one table. JavaScript and TypeScript are deliberately
 * absent: the TypeScript compiler already parses them in slice A and a second parser
 * would only add duplicate findings. JSON uses `JSON.parse`. Scala, TOML and XML keep
 * slice A coverage only — no grammar is shipped for them.
 *
 * `template` is absent on purpose. EJS, ERB, Handlebars, Mustache and Twig markup (and HTML
 * that carries template directives) is recognised by `archive/classify.ts` as a text-only
 * source, so no grammar is looked up for it and no engine entry exists to invent. Adding a
 * template grammar is AN-D3 work; until then a missing row here means "not analysed", which
 * is what the report says.
 */
export const LANGUAGE_ENGINES: Partial<Record<SourceLanguage, LanguageEngines>> = {
  python: { language: 'python', grammar: 'python', engines: ['tree-sitter', 'ruff'] },
  java: { language: 'java', grammar: 'java', engines: ['tree-sitter'] },
  kotlin: { language: 'kotlin', grammar: 'kotlin', engines: ['tree-sitter'] },
  csharp: { language: 'csharp', grammar: 'c_sharp', engines: ['tree-sitter'] },
  php: { language: 'php', grammar: 'php', engines: ['tree-sitter'] },
  ruby: { language: 'ruby', grammar: 'ruby', engines: ['tree-sitter'] },
  go: { language: 'go', grammar: 'go', engines: ['tree-sitter'] },
  rust: { language: 'rust', grammar: 'rust', engines: ['tree-sitter'] },
  c: { language: 'c', grammar: 'c', engines: ['tree-sitter'] },
  cpp: { language: 'cpp', grammar: 'cpp', engines: ['tree-sitter'] },
  swift: { language: 'swift', grammar: 'swift', engines: ['tree-sitter'] },
  shell: { language: 'shell', grammar: 'bash', engines: ['tree-sitter'] },
  sql: { language: 'sql', grammar: 'sql', engines: ['tree-sitter'] },
  yaml: { language: 'yaml', grammar: 'yaml', engines: ['tree-sitter'] },
  html: { language: 'html', grammar: 'html', engines: ['tree-sitter'] },
  css: { language: 'css', grammar: 'css', engines: ['tree-sitter'] },
}

export function enginesFor(language: SourceLanguage): LanguageEngines | null {
  return LANGUAGE_ENGINES[language] ?? null
}

export function grammarFor(language: SourceLanguage): GrammarId | null {
  return LANGUAGE_ENGINES[language]?.grammar ?? null
}

export function needsRuff(languages: Iterable<SourceLanguage>): boolean {
  for (const language of languages) {
    if (LANGUAGE_ENGINES[language]?.engines.includes('ruff')) return true
  }
  return false
}
