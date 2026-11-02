import * as ts from 'typescript'
import { TS_SYNTAX_RULE_ID } from '../../rules/registry'
import type { AnalyzerFinding } from '../../types'
import { makeFinding } from '../finding'

/**
 * Transpile-only on purpose. `transpileModule` runs the parser and reports syntax and
 * a few option diagnostics; it never builds a program, resolves imports or checks types.
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.Preserve,
  isolatedModules: true,
}

const LIMITATIONS = [
  'Syntax diagnostics only: no type checking, module resolution, lint rules or data-flow analysis ran.',
  'A file with no syntax error can still fail to compile or behave incorrectly; BugPilot did not execute it.',
]

function quoteLine(lines: string[], lineIndex: number): string {
  const line = lines[lineIndex] ?? ''
  return line.length > 300 ? `${line.slice(0, 300)}…` : line
}

function messageOf(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
}

export function checkTypeScriptFile(name: string, text: string): AnalyzerFinding[] {
  const result = ts.transpileModule(text, {
    fileName: name,
    compilerOptions: COMPILER_OPTIONS,
    reportDiagnostics: true,
  })
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) =>
      diagnostic.file !== undefined &&
      diagnostic.start !== undefined &&
      (diagnostic.category === ts.DiagnosticCategory.Error ||
        diagnostic.category === ts.DiagnosticCategory.Warning),
  )
  if (diagnostics.length === 0) return []

  const lines = text.split('\n')
  return diagnostics.map((diagnostic) => {
    const start = diagnostic.start ?? 0
    const position = ts.getLineAndCharacterOfPosition(diagnostic.file!, start)
    const length = diagnostic.length ?? 0
    const end = ts.getLineAndCharacterOfPosition(diagnostic.file!, start + length)
    const lineIndex = Math.min(position.line, Math.max(0, lines.length - 1))
    const isWarning = diagnostic.category === ts.DiagnosticCategory.Warning
    return makeFinding({
      ruleId: TS_SYNTAX_RULE_ID,
      analyzer: 'typescript',
      tier: 'syntax',
      severity: isWarning ? 'Medium' : 'High',
      confidence: {
        level: 'high',
        reason: `The TypeScript parser rejected this text with diagnostic TS${diagnostic.code}; syntax errors are deterministic.`,
      },
      file: name,
      range: {
        startLine: position.line + 1,
        startColumn: position.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
      },
      evidence: [
        {
          source: 'code snippet',
          label: `Line ${position.line + 1}`,
          quote: quoteLine(lines, lineIndex),
          lineNumber: position.line + 1,
        },
      ],
      message: `TypeScript syntax error TS${diagnostic.code}: ${messageOf(diagnostic)}`,
      explanation:
        'The TypeScript parser could not build a syntax tree at this position, so this file cannot compile and tools that read it will stop or fall back to guessing.',
      fix: null,
      verificationSteps: [
        'Open the reported line and the line before it; syntax errors are often caused by a missing bracket or comma above.',
        'Run the project type check after the correction, then analyse the file again.',
      ],
      limitations: LIMITATIONS,
    })
  })
}
