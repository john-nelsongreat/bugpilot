import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import { javascriptRules } from './rules/javascript'
import { pythonRules } from './rules/python'
import type { DiagnosticResult } from './types'

interface CorpusCase {
  id: string
  source: string
  language: 'auto' | 'python' | 'javascript'
  errorText: string
}

interface BaselineEntry {
  category: string
  matchedSignature: string | null
  confidence: string
  ruleId: string | null
}

const corpus = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), 'src/diagnostics/regression-corpus.json'),
    'utf8',
  ),
) as { cases: CorpusCase[] }

const baseline = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), 'src/diagnostics/regression-corpus.baseline.json'),
    'utf8',
  ),
) as Record<string, BaselineEntry>

const EXCEPTION_LINE =
  /^(?:Uncaught\s+(?:\(in promise\)\s+)?)?(?:(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Error|Exception)):\s*\S/
const NODE_ERROR_LINE =
  /^(?:Uncaught\s+(?:\(in promise\)\s+)?)?Error(?:\s+\[[A-Z][A-Z0-9_]*\])?:\s+\S/

function primaryLineOf(errorText: string): string | null {
  const lines = errorText.split(/\r?\n/)
  let lastNonEmpty: string | null = null
  let lastException: string | null = null
  let lastNodeError: string | null = null
  for (const line of lines) {
    const text = line.trim()
    if (text === '') continue
    lastNonEmpty = text
    if (EXCEPTION_LINE.test(text)) lastException = text
    else if (NODE_ERROR_LINE.test(text)) lastNodeError = text
  }
  const selected = lastException ?? lastNodeError ?? lastNonEmpty
  return selected === null
    ? null
    : selected.replace(/^Uncaught\s+(?:\(in promise\)\s+)?/, '')
}

const rules = [...pythonRules, ...javascriptRules]

function ruleIdFor(
  entry: CorpusCase,
  result: DiagnosticResult,
): string | null {
  if (result.matchedSignature === null) {
    return null
  }

  const lines = new Set<string>()
  const primary = primaryLineOf(entry.errorText)
  if (primary !== null) {
    lines.add(primary)
  }
  for (const line of entry.errorText.split(/\r?\n/)) {
    const text = line
      .trim()
      .replace(/^Uncaught\s+(?:\(in promise\)\s+)?/, '')
    if (text !== '') {
      lines.add(text)
    }
  }

  const ids = rules
    .filter(
      (rule) =>
        rule.category === result.category &&
        [...lines].some(
          (line) => rule.match(line)?.signature === result.matchedSignature,
        ),
    )
    .map((rule) => rule.id)
  return ids.length === 1 ? ids[0] : null
}

describe('diagnostic regression corpus', () => {
  it('records exactly one baseline entry per corpus case', () => {
    const corpusIds = corpus.cases.map((entry) => entry.id).sort()
    const baselineIds = Object.keys(baseline).sort()
    expect(new Set(corpusIds).size).toBe(corpusIds.length)
    expect(baselineIds).toEqual(corpusIds)
  })

  it.each(corpus.cases)(
    '$id keeps its recorded category, signature, confidence and rule',
    (entry) => {
      const result = diagnose({
        language: entry.language,
        errorText: entry.errorText,
      })

      expect({
        category: result.category,
        matchedSignature: result.matchedSignature,
        confidence: result.confidence.level,
        ruleId: ruleIdFor(entry, result),
      }).toEqual(baseline[entry.id])
    },
  )
})
