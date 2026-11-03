import type { SourceLanguage } from '../archive/classify'
import { toUpperSnake } from './literals'
import type { FixEdit } from './types'

export const ROTATE_CREDENTIAL_WARNING =
  'Rotate this credential: removing it from the code does not revoke it.'

export const ENV_MISSING_WARNING =
  'If this environment variable is not set where the code runs, the value will be missing and the code may fail.'

const ENV_LANGUAGES: readonly SourceLanguage[] = [
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'python',
  'ruby',
  'php',
  'java',
  'csharp',
  'go',
  'shell',
]

export interface EnvLookupInput {
  language: SourceLanguage
  fileName: string
  text: string
  name: string
  jsxAttribute: boolean
}

export interface EnvLookup {
  expression: string
  extraEdits: FixEdit[]
  warnings: string[]
}

function isConfigLike(fileName: string): boolean {
  return /(?:^|\/)\.env(?:\.|$)/i.test(fileName) || /\.(?:env|ini|conf|cfg)$/i.test(fileName)
}

function pythonImportOffset(text: string): number {
  let offset = 0
  const lines = text.split('\n')
  let index = 0
  if (lines[0]?.startsWith('#!')) {
    offset += lines[0].length + 1
    index = 1
  }
  if (index < 2 && /coding[:=]/.test(lines[index] ?? '')) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  return offset
}

function goImportEdit(text: string, fileName: string): FixEdit | null {
  const groupOpen = /^[ \t]*import\s*\(/m.exec(text)
  if (groupOpen) {
    const open = groupOpen.index + groupOpen[0].length
    const close = text.indexOf(')', open)
    if (close === -1) return null
    const closeLineStart = text.lastIndexOf('\n', Math.max(0, close - 1)) + 1
    const beforeClose = text.slice(closeLineStart, close)
    if (beforeClose.trim() === '') {
      return { file: fileName, startOffset: closeLineStart, endOffset: closeLineStart, newText: '\t"os"\n' }
    }
    return { file: fileName, startOffset: close, endOffset: close, newText: '\n\t"os"' }
  }

  const singles = [...text.matchAll(/^[ \t]*import\s+(?:[\w.]+\s+)?"[^"\n]*"[ \t]*$/gm)]
  if (singles.length > 0) {
    const last = singles[singles.length - 1]
    const end = (last.index ?? 0) + last[0].length
    const newline = text.indexOf('\n', end)
    if (newline === -1) {
      return { file: fileName, startOffset: end, endOffset: end, newText: '\nimport "os"\n' }
    }
    return { file: fileName, startOffset: newline + 1, endOffset: newline + 1, newText: 'import "os"\n' }
  }

  const pkg = /^[ \t]*package\s+[A-Za-z_]\w*[^\n]*$/m.exec(text)
  if (!pkg) return null
  const end = pkg.index + pkg[0].length
  const newline = text.indexOf('\n', end)
  if (newline === -1) {
    return { file: fileName, startOffset: end, endOffset: end, newText: '\nimport "os"\n' }
  }
  return { file: fileName, startOffset: newline + 1, endOffset: newline + 1, newText: 'import "os"\n' }
}

function goHasOsImport(text: string): boolean {
  if (/^[ \t]*import\s+(?:[\w.]+\s+)?"os"[ \t]*$/m.test(text)) return true
  const groupOpen = /^[ \t]*import\s*\(/m.exec(text)
  if (!groupOpen) return false
  const open = groupOpen.index + groupOpen[0].length
  const close = text.indexOf(')', open)
  if (close === -1) return false
  return /^[ \t]*(?:[\w.]+\s+)?"os"[ \t]*$/m.test(text.slice(open, close))
}

export function buildEnvLookup(input: EnvLookupInput): EnvLookup | null {
  const { language, fileName, text, jsxAttribute } = input
  if (!ENV_LANGUAGES.includes(language) || isConfigLike(fileName)) return null

  const name = toUpperSnake(input.name)
  if (name === '' || !/^[A-Z_][A-Z0-9_]*$/.test(name)) return null

  const warnings = [ENV_MISSING_WARNING]

  if (language === 'javascript' || language === 'jsx' || language === 'typescript' || language === 'tsx') {
    const expression = `process.env.${name}`
    return {
      expression: jsxAttribute ? `{${expression}}` : expression,
      extraEdits: [],
      warnings: jsxAttribute
        ? [...warnings, 'The JSX attribute was changed from a string to a braced expression.']
        : warnings,
    }
  }

  if (language === 'python') {
    const extraEdits: FixEdit[] = []
    if (!/^[ \t]*(?:import\s+os\b|from\s+os\s+import\b)/m.test(text)) {
      const offset = pythonImportOffset(text)
      extraEdits.push({ file: fileName, startOffset: offset, endOffset: offset, newText: 'import os\n' })
      warnings.push(
        'An import os line is added near the top of the file; review shebangs, encoding declarations and the module docstring.',
      )
    }
    return { expression: `os.environ["${name}"]`, extraEdits, warnings }
  }

  if (language === 'ruby') {
    return { expression: `ENV["${name}"]`, extraEdits: [], warnings }
  }

  if (language === 'php') {
    return { expression: `getenv('${name}')`, extraEdits: [], warnings }
  }

  if (language === 'java') {
    return { expression: `System.getenv("${name}")`, extraEdits: [], warnings }
  }

  if (language === 'csharp') {
    return { expression: `Environment.GetEnvironmentVariable("${name}")`, extraEdits: [], warnings }
  }

  if (language === 'go') {
    const extraEdits: FixEdit[] = []
    if (!goHasOsImport(text)) {
      const edit = goImportEdit(text, fileName)
      if (!edit) return null
      extraEdits.push(edit)
      warnings.push('An import "os" line is added; run gofmt and the compiler to confirm the import block still builds.')
    }
    return { expression: `os.Getenv("${name}")`, extraEdits, warnings }
  }

  // Shell: "$NAME" reads the environment variable, so NAME must differ from the variable
  // being assigned or the line would read itself.
  if (/^[A-Z_][A-Z0-9_]*$/.test(input.name) && name === input.name) return null
  return { expression: `"$${name}"`, extraEdits: [], warnings }
}
