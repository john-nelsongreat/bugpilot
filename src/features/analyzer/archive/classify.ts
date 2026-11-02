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
  jsonc: 'json',
  jsonl: 'json',
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

export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function basenameOf(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1).toLowerCase()
}

export function languageOf(name: string, text: string): SourceLanguage {
  const ext = extensionOf(name)
  const byExt = BY_EXTENSION[ext]
  if (byExt) return byExt
  const byBase = BY_BASENAME[basenameOf(name)]
  if (byBase) return byBase
  if (text.startsWith('#!')) {
    const end = text.indexOf('\n')
    const line = text.slice(0, end === -1 ? text.length : end)
    for (const raw of line.split(/[\s/]+/)) {
      const mapped = SHEBANG_LANGUAGES[raw.replace(/[0-9.]+$/, '')]
      if (mapped) return mapped
    }
  }
  return ext ? 'unknown' : 'text'
}

/** Languages whose syntax the TypeScript compiler can be asked about in slice A. */
export const TSC_CHECKABLE: readonly SourceLanguage[] = ['javascript', 'jsx', 'typescript', 'tsx']

export function isTscCheckable(language: SourceLanguage): boolean {
  return TSC_CHECKABLE.includes(language)
}
