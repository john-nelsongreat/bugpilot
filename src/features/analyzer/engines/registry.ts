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
  /** True only when `astQueries.ts` holds at least one rule for this grammar. */
  astRules: boolean
  /** False when the grammar is not trusted for syntax claims: BugPilot parses and reports nothing. */
  syntaxClaims: boolean
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
  python: { language: 'python', grammar: 'python', engines: ['tree-sitter', 'ruff'], astRules: true, syntaxClaims: true },
  java: { language: 'java', grammar: 'java', engines: ['tree-sitter'], astRules: true, syntaxClaims: true },
  kotlin: { language: 'kotlin', grammar: 'kotlin', engines: ['tree-sitter'], astRules: false, syntaxClaims: true },
  csharp: { language: 'csharp', grammar: 'c_sharp', engines: ['tree-sitter'], astRules: true, syntaxClaims: true },
  php: { language: 'php', grammar: 'php', engines: ['tree-sitter'], astRules: true, syntaxClaims: true },
  ruby: { language: 'ruby', grammar: 'ruby', engines: ['tree-sitter'], astRules: true, syntaxClaims: true },
  go: { language: 'go', grammar: 'go', engines: ['tree-sitter'], astRules: true, syntaxClaims: true },
  rust: { language: 'rust', grammar: 'rust', engines: ['tree-sitter'], astRules: false, syntaxClaims: true },
  c: { language: 'c', grammar: 'c', engines: ['tree-sitter'], astRules: true, syntaxClaims: true },
  cpp: { language: 'cpp', grammar: 'cpp', engines: ['tree-sitter'], astRules: true, syntaxClaims: true },
  swift: { language: 'swift', grammar: 'swift', engines: ['tree-sitter'], astRules: false, syntaxClaims: true },
  shell: { language: 'shell', grammar: 'bash', engines: ['tree-sitter'], astRules: false, syntaxClaims: true },
  sql: { language: 'sql', grammar: 'sql', engines: ['tree-sitter'], astRules: false, syntaxClaims: false },
  yaml: { language: 'yaml', grammar: 'yaml', engines: ['tree-sitter'], astRules: false, syntaxClaims: false },
  html: { language: 'html', grammar: 'html', engines: ['tree-sitter'], astRules: false, syntaxClaims: true },
  css: { language: 'css', grammar: 'css', engines: ['tree-sitter'], astRules: false, syntaxClaims: true },
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
