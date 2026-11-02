import { lineEvidence, quoteLine } from './context'
import type { AnalyzerRule, RuleFile, RuleHit } from './types'

interface ParsePosition {
  line: number
  column: number
}

/** V8 and JavaScriptCore both put a position in the message; browsers phrase the rest differently. */
function parsePosition(file: RuleFile, message: string): ParsePosition {
  const lineColumn = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message)
  if (lineColumn) {
    return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) }
  }
  const position = /position\s+(\d+)/i.exec(message)
  if (position) {
    const offset = Math.min(Number(position[1]), file.text.length)
    let line = 0
    let start = 0
    for (let index = 0; index < file.lineStarts.length; index += 1) {
      if (file.lineStarts[index] <= offset) {
        line = index
        start = file.lineStarts[index]
      } else {
        break
      }
    }
    return { line: line + 1, column: offset - start + 1 }
  }
  return { line: 1, column: 1 }
}

function cleanMessage(message: string): string {
  return message
    .replace(/\s+in JSON at position \d+(?:\s+\(line \d+ column \d+\))?/i, '')
    .replace(/\s+at position \d+.*$/i, '')
    .replace(/\s+in JSON$/i, '')
    .trim()
}

function jsonHit(file: RuleFile, error: unknown): RuleHit {
  const raw = error instanceof Error ? error.message : String(error)
  const position = parsePosition(file, raw)
  const lineIndex = Math.min(Math.max(0, position.line - 1), Math.max(0, file.lines.length - 1))
  const message = cleanMessage(raw)
  return {
    range: {
      startLine: position.line,
      startColumn: position.column,
      endLine: position.line,
      endColumn: position.column,
    },
    message: `Invalid JSON: ${message === '' ? 'the parser rejected this text.' : message}`,
    explanation: `Strict JSON.parse rejected the file near line ${position.line}, column ${position.column}. A single trailing comma, comment, unquoted key or stray character makes the whole document invalid for every strict consumer, including fetch responses, config loaders and package manifests.`,
    confidence: {
      level: 'high',
      reason: 'Strict JSON has one grammar; JSON.parse either accepts the whole text or reports the first position it cannot read.',
    },
    evidence: [lineEvidence(file, lineIndex, quoteLine(file.lines[lineIndex] ?? ''))],
    fix: {
      explanation:
        'Remove or correct the syntax at the reported position. If the content is JSON with comments, it is not JSON and must be renamed or parsed by a JSONC-aware loader.',
      whereItMayApply: 'The reported line; the real cause can be the comma or bracket on the line just before it.',
      exampleCode: '',
      riskClass: 'needs-review',
      riskReason: 'Deleting a comma or bracket can change the data when the reported position is not the actual mistake.',
    },
    verificationSteps: [
      'Read the reported line and the line before it.',
      'Validate the whole document again with a strict JSON parser.',
    ],
    limitations: [
      'Only syntax is checked. Duplicate keys, schema violations and values of the wrong type are valid JSON and are not reported.',
    ],
  }
}

export const jsonSyntaxRule: AnalyzerRule = {
  id: 'bugpilot/syntax/json',
  title: 'Invalid JSON',
  tier: 'syntax',
  severity: 'High',
  languages: ['json'],
  description: 'Parses JSON with the browser JSON.parse and reports the first syntax error.',
  check: (file) => {
    // The archive reader never hands over an empty file; keep the rule quiet if called directly.
    if (file.text.trim() === '') return []
    try {
      JSON.parse(file.text)
      return []
    } catch (error) {
      return [jsonHit(file, error)]
    }
  },
}
