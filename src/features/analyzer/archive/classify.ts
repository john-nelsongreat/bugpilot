export type SourceLanguage =
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'go'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'swift'
  | 'scala'
  | 'shell'
  | 'sql'
  | 'json'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'html'
  | 'css'
  | 'template'
  | 'markdown'
  | 'text'
  | 'unknown'

const BY_EXTENSION: Record<string, SourceLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  php: 'php',
  phtml: 'php',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  swift: 'swift',
  scala: 'scala',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  json: 'json',
  jsonc: 'text',
  jsonl: 'text',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  xsl: 'xml',
  svg: 'xml',
  htm: 'html',
  html: 'html',
  vue: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  ejs: 'template',
  erb: 'template',
  hbs: 'template',
  mustache: 'template',
  twig: 'template',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  csv: 'text',
  env: 'text',
  ini: 'text',
  conf: 'text',
  cfg: 'text',
}

/** Files with no extension that are still source: Dockerfile, Makefile, LICENSE. */
const BY_BASENAME: Record<string, SourceLanguage> = {
  dockerfile: 'text',
  makefile: 'text',
  gemfile: 'ruby',
  rakefile: 'ruby',
  jenkinsfile: 'unknown',
  '.env': 'text',
  '.gitignore': 'text',
  '.editorconfig': 'text',
  license: 'text',
  readme: 'text',
  changelog: 'text',
}

const SHEBANG_LANGUAGES: Record<string, SourceLanguage> = {
  python: 'python',
  node: 'javascript',
  deno: 'typescript',
  bun: 'typescript',
  bash: 'shell',
  sh: 'shell',
  zsh: 'shell',
  ruby: 'ruby',
  php: 'php',
  perl: 'unknown',
}

/**
 * Template dialects: files whose markup carries a host-language directive that no shipped
 * grammar can parse (`<%= user.name %>` is not HTML and not JavaScript). They are admitted as
 * text-only sources — BugPilot runs its text-tier rules on them and claims no syntax verdict.
 * Admission is not support: nothing here analyses EJS, ERB, Handlebars, Mustache or Twig.
 */
export const TEMPLATE_EXTENSIONS: readonly string[] = ['ejs', 'erb', 'hbs', 'mustache', 'twig']

/**
 * The marker that lets a markup file be read as a template. `<%` opens an EJS or ERB tag in every
 * form the templating engines use (`<%`, `<%_`, `<%-`, `<%=` and `<%#`).
 */
export function hasTemplateDirective(text: string): boolean {
  return text.slice(0, 65_536).includes('<%')
}

export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function basenameOf(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1).toLowerCase()
}

export type LanguageSource = 'extension' | 'shebang' | 'content' | 'fallback'

export interface LanguageDetection {
  language: SourceLanguage
  source: LanguageSource
}

/** Content sniffing only runs when the name says nothing; it never overrides an extension. */
function sniffContent(text: string): SourceLanguage | null {
  const head = text.slice(0, 65_536).trimStart()
  if (head === '') return null
  if (/^<\?xml\b/i.test(head)) return 'xml'
  if (/^<!doctype\s+html\b/i.test(head) || /^<html\b/i.test(head)) return 'html'
  const first = head[0]
  if (first === '{' || first === '[') {
    try {
      JSON.parse(head)
      return 'json'
    } catch {
      return null
    }
  }
  return null
}

export function detectLanguage(name: string, text: string): LanguageDetection {
  const ext = extensionOf(name)
  const byExt = BY_EXTENSION[ext]
  if (byExt) {
    // A markup file that carries template directives is not the language its grammar expects.
    // The name supplies the candidate and the content decides, exactly as for JSONC.
    if (byExt === 'html' && hasTemplateDirective(text)) return { language: 'template', source: 'extension' }
    return { language: byExt, source: 'extension' }
  }
  const byBase = BY_BASENAME[basenameOf(name)]
  if (byBase) return { language: byBase, source: 'extension' }
  if (text.startsWith('#!')) {
    const end = text.indexOf('\n')
    const line = text.slice(0, end === -1 ? text.length : end)
    for (const raw of line.split(/[\s/]+/)) {
      const mapped = SHEBANG_LANGUAGES[raw.replace(/[0-9.]+$/, '')]
      if (mapped) return { language: mapped, source: 'shebang' }
    }
  }
  const sniffed = sniffContent(text)
  if (sniffed) return { language: sniffed, source: 'content' }
  return ext ? { language: 'unknown', source: 'fallback' } : { language: 'text', source: 'fallback' }
}

export function languageOf(name: string, text: string): SourceLanguage {
  return detectLanguage(name, text).language
}

/** Languages whose syntax the TypeScript compiler can be asked about in slice A. */
export const TSC_CHECKABLE: readonly SourceLanguage[] = ['javascript', 'jsx', 'typescript', 'tsx']

export function isTscCheckable(language: SourceLanguage): boolean {
  return TSC_CHECKABLE.includes(language)
}
