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
    explanation: `Strict JSON.parse rejected the file near line ${position.line}, column ${position.column}. This is not the JSON-config dialect BugPilot tolerates: comments and a comma before a closing brace or bracket are accepted elsewhere in this rule, so the text fails even with those allowed. Everything else about the document is still valid JSON, and it is the position reported here that a consumer cannot read.`,
    confidence: {
      level: 'high',
      reason: 'Strict JSON has one grammar; JSON.parse either accepts the whole text or reports the first position it cannot read.',
    },
    evidence: [lineEvidence(file, lineIndex, quoteLine(file.lines[lineIndex] ?? ''))],
    fix: {
      explanation:
        'Remove or correct the syntax at the reported position. Comments and trailing commas alone would not have produced this finding, so the mistake is something the tolerant read cannot rescue.',
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
      'Comments and trailing commas are tolerated by this rule, so one in a file a strict consumer really reads — a genuine package.json, for instance — is not reported here.',
    ],
  }
}

/**
 * JSON-with-comments is a config dialect that ships under `.json` (TypeScript and dev-container
 * configs are the common cases). It is admitted when the *name* offers the candidate and the
 * *content* proves that tolerance is what rescues the parse; neither half alone is enough.
 * Only the two deviations the dialect is defined by are tolerated: comments outside strings and
 * a comma before a closer. Everything else the strict grammar rejects stays rejected.
 */
export interface JsonDialect {
  comments: boolean
  trailingCommas: boolean
}

interface JsonVerdict {
  strictOk: boolean
  strictError: unknown
  /** null unless the file is `.json` by name and the tolerant read succeeds. */
  dialect: JsonDialect | null
}

const JSON_WHITESPACE = new Set([' ', '\t', '\n', '\r'])

/** Copies one JSON string literal out, returning the offset just past it. */
function scanString(text: string, open: number): { end: number; closed: boolean } {
  let index = open + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '"') return { end: index + 1, closed: true }
    index += 1
  }
  return { end: index, closed: false }
}

/**
 * Drops `//` and block comments found outside strings, keeping line breaks so line counts survive.
 * Null means the text has an unterminated string or comment: there is no dialect to blame for that.
 */
function stripComments(text: string): { body: string; removed: boolean } | null {
  let body = ''
  let removed = false
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      const scanned = scanString(text, index)
      if (!scanned.closed) return null
      body += text.slice(index, scanned.end)
      index = scanned.end
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      removed = true
      const newline = text.indexOf('\n', index)
      if (newline === -1) return { body, removed }
      index = newline
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      if (close === -1) return null
      removed = true
      body += text.slice(index, close + 2).replace(/[^\n]/g, '')
      index = close + 2
      continue
    }
    body += char
    index += 1
  }
  return { body, removed }
}

/** Removes only commas whose next non-space token is a closer, leaving string bodies alone. */
function stripTrailingCommas(text: string): { body: string; removed: boolean } {
  let body = ''
  let removed = false
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      const scanned = scanString(text, index)
      body += text.slice(index, scanned.end)
      index = scanned.end
      continue
    }
    if (char === ',') {
      let probe = index + 1
      while (probe < text.length && JSON_WHITESPACE.has(text[probe])) probe += 1
      if (text[probe] === '}' || text[probe] === ']') {
        removed = true
        index += 1
        continue
      }
    }
    body += char
    index += 1
  }
  return { body, removed }
}

/** The name has to offer the candidate; content sniffing alone never admits a dialect. */
function dialectCandidate(file: RuleFile): boolean {
  return file.languageSource === 'extension'
}

function rescueDialect(text: string): JsonDialect | null {
  const stripped = stripComments(text)
  if (!stripped) return null
  const closers = stripTrailingCommas(stripped.body)
  try {
    JSON.parse(closers.body)
  } catch {
    return null
  }
  return { comments: stripped.removed, trailingCommas: closers.removed }
}

function judgeJson(file: RuleFile): JsonVerdict {
  // The archive reader never hands over an empty file; keep the rule quiet if called directly.
  if (file.text.trim() === '') return { strictOk: true, strictError: null, dialect: null }
  try {
    JSON.parse(file.text)
    return { strictOk: true, strictError: null, dialect: null }
  } catch (error) {
    return {
      strictOk: false,
      strictError: error,
      dialect: dialectCandidate(file) ? rescueDialect(file.text) : null,
    }
  }
}

function describeJsonDialect(dialect: JsonDialect): string {
  const tolerated: string[] = []
  if (dialect.comments) tolerated.push('// or /* */ comments outside strings')
  if (dialect.trailingCommas) tolerated.push('a comma before a closing } or ]')
  return (
    `Treated as JSONC (JSON with comments), not strict JSON: it parses once ${tolerated.join(' and ')} are allowed. ` +
    'The `.json` name offered the candidate and the content confirmed it, so no Invalid JSON finding is reported. ' +
    'A strict JSON parser still rejects this document, so any consumer that is not JSONC-aware will fail on it.'
  )
}

export const jsonSyntaxRule: AnalyzerRule = {
  id: 'bugpilot/syntax/json',
  title: 'Invalid JSON',
  tier: 'syntax',
  severity: 'High',
  languages: ['json'],
  description:
    'Parses JSON with the browser JSON.parse and reports the first syntax error, except where the text is a recognised JSON-config dialect.',
  check: (file) => {
    const verdict = judgeJson(file)
    if (verdict.strictOk) return []
    if (verdict.dialect) return []
    return [jsonHit(file, verdict.strictError)]
  },
  coverageNotes: (file) => {
    const verdict = judgeJson(file)
    if (verdict.strictOk || !verdict.dialect) return []
    return [describeJsonDialect(verdict.dialect)]
  },
}
