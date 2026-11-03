import type { SourceLanguage } from '../archive/classify'

export interface QuotedLiteral {
  /** Offset of the opening quote. */
  start: number
  /** Offset just after the closing quote. */
  end: number
  contentStart: number
  contentEnd: number
  quote: "'" | '"' | '`'
  content: string
}

const QUOTES = new Set(["'", '"', '`'])

function lineBounds(text: string, offset: number): [number, number] {
  const safe = Math.max(0, Math.min(offset, text.length))
  const start = text.lastIndexOf('\n', Math.max(0, safe - 1)) + 1
  const next = text.indexOf('\n', safe)
  return [start, next === -1 ? text.length : next]
}

/**
 * Conservative single-line scanner. A quote that never closes, a triple-quoted string or an
 * interpolated template literal makes the whole line unusable for a fix: a wrong edit to a
 * literal is worse than no edit.
 */
function scanLine(text: string, lineStart: number, lineEnd: number, allowBacktick: boolean): QuotedLiteral[] | null {
  const literals: QuotedLiteral[] = []
  let index = lineStart
  while (index < lineEnd) {
    const char = text[index]
    if (!QUOTES.has(char) || (char === '`' && !allowBacktick)) {
      index += 1
      continue
    }
    if ((char === '"' || char === "'") && text[index + 1] === char && text[index + 2] === char) {
      return null
    }
    const quote = char as QuotedLiteral['quote']
    let cursor = index + 1
    let closed = false
    while (cursor < lineEnd) {
      if (text[cursor] === '\\') {
        cursor += 2
        continue
      }
      if (quote === '`' && text[cursor] === '$' && text[cursor + 1] === '{') return null
      if (text[cursor] === quote) {
        closed = true
        break
      }
      cursor += 1
    }
    if (!closed) return null
    literals.push({
      start: index,
      end: cursor + 1,
      contentStart: index + 1,
      contentEnd: cursor,
      quote,
      content: text.slice(index + 1, cursor),
    })
    index = cursor + 1
  }
  return literals
}

export function findEnclosingQuotedLiteral(
  text: string,
  offset: number,
  language: SourceLanguage,
): QuotedLiteral | null {
  const [lineStart, lineEnd] = lineBounds(text, offset)
  const literals = scanLine(text, lineStart, lineEnd, allowsBacktick(language))
  if (!literals) return null
  return literals.find((literal) => literal.start <= offset && offset < literal.contentEnd) ?? null
}

export function findFirstQuotedLiteralWithin(
  text: string,
  start: number,
  end: number,
  language: SourceLanguage,
): QuotedLiteral | null {
  const [lineStart, lineEnd] = lineBounds(text, start)
  const literals = scanLine(text, lineStart, lineEnd, allowsBacktick(language))
  if (!literals) return null
  return literals.find((literal) => literal.start >= start && literal.end <= end) ?? null
}

function allowsBacktick(language: SourceLanguage): boolean {
  return language === 'javascript' || language === 'jsx' || language === 'typescript' || language === 'tsx'
}

export interface AssignmentName {
  name: string
  jsxAttribute: boolean
}

/**
 * Reads the name from the assignment the literal belongs to. It never invents a name: when the
 * literal is not clearly assigned, the caller gets null and keeps the finding manual-only.
 */
export function assignmentNameBefore(
  text: string,
  literalStart: number,
  language: SourceLanguage,
): AssignmentName | null {
  const [lineStart] = lineBounds(text, literalStart)
  const prefix = text.slice(lineStart, literalStart).replace(/[ \t]+$/g, '')

  if (language === 'javascript' || language === 'jsx' || language === 'typescript' || language === 'tsx') {
    const jsx = /(?:<[A-Za-z][^<>]*\s+)([A-Za-z_$][\w$-]*)\s*=\s*$/.exec(prefix)
    if (jsx) return { name: jsx[1], jsxAttribute: true }
    const declaration =
      /(?:^|[^\w$])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*$/.exec(prefix)
    if (declaration) return { name: declaration[1], jsxAttribute: false }
    const property = /(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:\s*$/.exec(prefix)
    if (property) return { name: property[1], jsxAttribute: false }
    const assignment = /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*=\s*$/.exec(prefix)
    if (assignment) return { name: assignment[1], jsxAttribute: false }
    return null
  }

  if (language === 'python') {
    const match = /(?:^|[^\w])([A-Za-z_]\w*)\s*(?::\s*[^=]+)?=\s*$/.exec(prefix)
    return match ? { name: match[1], jsxAttribute: false } : null
  }
  if (language === 'ruby') {
    const match = /(?:^|[^\w])([A-Za-z_]\w*)\s*=\s*$/.exec(prefix)
    return match ? { name: match[1], jsxAttribute: false } : null
  }
  if (language === 'php') {
    const match = /\$([A-Za-z_]\w*)\s*=\s*$/.exec(prefix)
    return match ? { name: match[1], jsxAttribute: false } : null
  }
  if (language === 'java' || language === 'csharp') {
    const match = /(?:^|[^\w])([A-Za-z_]\w*)\s*=\s*$/.exec(prefix)
    return match ? { name: match[1], jsxAttribute: false } : null
  }
  if (language === 'go') {
    const match = /(?:^|[^\w])([A-Za-z_]\w*)\s*:?=\s*$/.exec(prefix)
    return match ? { name: match[1], jsxAttribute: false } : null
  }
  if (language === 'shell') {
    const match = /(?:^|[\s;])(?:export\s+)?([A-Za-z_]\w*)\s*=\s*$/.exec(prefix)
    return match ? { name: match[1], jsxAttribute: false } : null
  }
  return null
}

export function toUpperSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}
