import type { SourceLanguage } from '../archive/classify'
import type { AnalyzerFinding } from '../types'
import type { FixCandidate, FixEdit } from './types'

const MIXED_INDENTATION_RULE_ID = 'bugpilot/generic/mixed-indentation'

const STRONG_WARNINGS: Partial<Record<SourceLanguage, string>> = {
  python:
    'Python uses indentation to define blocks. Changing which whitespace forms the indentation can move statements between blocks or raise IndentationError, so run the tests and the interpreter before keeping this change.',
  yaml:
    'YAML uses indentation to define structure. Changing the indentation can change which value belongs to which key, so compare the parsed output before and after this change.',
}

interface LeadingWhitespace {
  lineIndex: number
  start: number
  end: number
  run: string
}

function leadingRuns(text: string): LeadingWhitespace[] {
  const runs: LeadingWhitespace[] = []
  let offset = 0
  let lineIndex = 0
  while (offset <= text.length) {
    const newline = text.indexOf('\n', offset)
    const end = newline === -1 ? text.length : newline
    const line = text.slice(offset, end)
    const match = /^[ \t]+/.exec(line)
    if (match) {
      runs.push({ lineIndex, start: offset, end: offset + match[0].length, run: match[0] })
    }
    if (newline === -1) break
    offset = newline + 1
    lineIndex += 1
  }
  return runs
}

/** Greatest common divisor of the positive space widths, clamped to a sane indent unit. */
export function inferIndentWidth(runs: readonly LeadingWhitespace[]): number {
  const widths = runs
    .filter((item) => item.run[0] === ' ')
    .map((item) => /^ */.exec(item.run)?.[0].length ?? 0)
    .filter((width) => width > 0)
  if (widths.length === 0) return 2
  let gcd = widths[0]
  for (const width of widths.slice(1)) {
    let left = gcd
    let right = width
    while (right !== 0) {
      const next = left % right
      left = right
      right = next
    }
    gcd = left
  }
  return Math.min(8, Math.max(2, gcd))
}

export function proposeMixedIndentationFix(
  finding: AnalyzerFinding,
  text: string,
  language: SourceLanguage,
  fileName: string,
): FixCandidate | null {
  if (finding.ruleId !== MIXED_INDENTATION_RULE_ID) return null

  const runs = leadingRuns(text)
  const tabLines = runs.filter((item) => item.run[0] === '\t').length
  const spaceLines = runs.filter((item) => item.run[0] === ' ').length
  if (tabLines === 0 || spaceLines === 0 || tabLines === spaceLines) return null

  const dominant: 'tab' | 'space' = spaceLines > tabLines ? 'space' : 'tab'
  const unit = inferIndentWidth(runs)
  const edits: FixEdit[] = []

  for (const item of runs) {
    if (item.run[0] === (dominant === 'tab' ? '\t' : ' ')) continue
    let replacement: string
    if (dominant === 'space') {
      replacement = item.run.replace(/\t/g, ' '.repeat(unit))
    } else {
      const width = item.run.length
      replacement = '\t'.repeat(Math.max(1, Math.round(width / unit)))
    }
    if (replacement === item.run) continue
    edits.push({ file: fileName, startOffset: item.start, endOffset: item.end, newText: replacement })
  }
  if (edits.length === 0) return null

  const warnings = [
    `Leading whitespace is rewritten to the dominant ${dominant === 'tab' ? 'tab' : `${unit}-space`} style. No other character changes.`,
    'Review the diff line by line: alignment that was deliberate can move.',
  ]
  const strong = STRONG_WARNINGS[language]
  if (strong) warnings.push(strong)

  return {
    findingId: finding.id,
    ruleId: finding.ruleId,
    file: fileName,
    targetStartLine: finding.range.startLine,
    targetEndLine: finding.range.endLine,
    edits,
    description: `Rewrite the leading whitespace of ${edits.length} line${edits.length === 1 ? '' : 's'} to the dominant ${dominant} indentation.`,
    riskClass: 'needs-review',
    behaviourChange: true,
    warnings,
    maskedSpans: [],
  }
}
