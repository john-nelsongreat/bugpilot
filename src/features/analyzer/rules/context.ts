import type { DiagnosticEvidence } from '../../../diagnostics/types'
import type { SourceLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerFixProposal, FileRange, FixRiskClass } from '../types'
import type { RuleFile } from './types'

export const ALL_TEXT_LANGUAGES: readonly SourceLanguage[] = [
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'python',
  'java',
  'kotlin',
  'csharp',
  'php',
  'ruby',
  'go',
  'rust',
  'c',
  'cpp',
  'swift',
  'scala',
  'shell',
  'sql',
  'json',
  'yaml',
  'toml',
  'xml',
  'html',
  'css',
  'markdown',
  'template',
  'text',
  'unknown',
]

export function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

export function makeRuleFile(entry: Pick<ArchiveEntry, 'name' | 'text' | 'language' | 'languageSource' | 'encoding'>): RuleFile {
  return {
    file: entry.name,
    language: entry.language,
    languageSource: entry.languageSource,
    encoding: entry.encoding,
    text: entry.text,
    lines: entry.text.split('\n'),
    lineStarts: buildLineStarts(entry.text),
  }
}

export function lineIndexAt(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low
}

export function rangeFromOffsets(lineStarts: readonly number[], startOffset: number, endOffset: number): FileRange {
  const startLine = lineIndexAt(lineStarts, Math.max(0, startOffset))
  const endLine = lineIndexAt(lineStarts, Math.max(0, endOffset))
  return {
    startLine: startLine + 1,
    startColumn: Math.max(0, startOffset - lineStarts[startLine]) + 1,
    endLine: endLine + 1,
    endColumn: Math.max(0, endOffset - lineStarts[endLine]) + 1,
  }
}

export function rangeForLine(lineIndex: number, lineText: string): FileRange {
  return {
    startLine: lineIndex + 1,
    startColumn: 1,
    endLine: lineIndex + 1,
    endColumn: Math.max(1, lineText.length + 1),
  }
}

export function quoteLine(line: string, max = 300): string {
  const trimmed = line.length > max ? `${line.slice(0, max)}…` : line
  return trimmed
}

export function lineEvidence(file: RuleFile, lineIndex: number, quote?: string): DiagnosticEvidence {
  return {
    source: 'code snippet',
    label: `Line ${lineIndex + 1}`,
    quote: quote ?? quoteLine(file.lines[lineIndex] ?? ''),
    lineNumber: lineIndex + 1,
  }
}

export function redactSecret(value: string): string {
  if (value.length <= 4) return '••••'
  return `${value.slice(0, 2)}…${value.slice(-2)}`
}

export function shannonEntropy(value: string): number {
  if (value === '') return 0
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /example/i,
  /sample/i,
  /placeholder/i,
  /change[_-]?me/i,
  /xxxx/i,
  /^your[_-]/i,
  /dummy/i,
  /redacted/i,
  /^fake[_-]?/i,
  /^\$\{.*\}$/,
  /^\$[A-Za-z_][A-Za-z0-9_]*$/,
  /^\{\{.*\}\}$/,
  /^<.*>$/,
  /^process\.env\./i,
  /^os\.environ/i,
  /^env\(/i,
  /^getenv\(/i,
  /^import\.meta\.env/i,
  /^%.*%$/,
]

export function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  if (/^[*x.\-_#]+$/i.test(trimmed)) return true
  if (/^(.)\1+$/.test(trimmed)) return true
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function manualFix(
  explanation: string,
  whereItMayApply: string,
  riskClass: FixRiskClass,
  riskReason: string,
): AnalyzerFixProposal {
  return {
    explanation,
    whereItMayApply,
    exampleCode: '',
    riskClass,
    riskReason,
  }
}

export const SECRET_LIMITATIONS = [
  'Only the credential shapes BugPilot knows are recognised; split, encoded, or obfuscated secrets are not found.',
  'A match is not proof the credential is live. Rotate anything that could be real.',
]

/** One rule never materialises more than this many hits for a single file. */
export const MAX_RULE_HITS = 100

export const SECRET_VERIFICATION = [
  'Check the value in the provider that issued it, then rotate or revoke it if it is real.',
  'Remove it from tracked files and load the replacement from an environment variable or secret manager.',
  'Search the repository history so the old value is not recoverable from an earlier commit.',
]
