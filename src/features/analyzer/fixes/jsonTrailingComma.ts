import type { AnalyzerFinding } from '../types'
import { applyEdits } from './text'
import type { FixCandidate, FixEdit } from './types'

const JSON_RULE_ID = 'bugpilot/syntax/json'

/** Comma offsets that sit outside strings and are followed only by } or ]. */
export function trailingCommaOffsets(text: string): number[] {
  const offsets: number[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char !== ',') continue
    let next = index + 1
    while (next < text.length && /\s/.test(text[next])) next += 1
    if (text[next] === '}' || text[next] === ']') offsets.push(index)
  }
  return offsets
}

export function proposeJsonTrailingCommaFix(
  finding: AnalyzerFinding,
  text: string,
  fileName: string,
): FixCandidate | null {
  if (finding.ruleId !== JSON_RULE_ID) return null
  const offsets = trailingCommaOffsets(text)
  if (offsets.length === 0) return null
  try {
    JSON.parse(text)
    return null
  } catch {
    // The file is invalid; the candidate below must make it valid.
  }

  const edits: FixEdit[] = offsets.map((offset) => ({
    file: fileName,
    startOffset: offset,
    endOffset: offset + 1,
    newText: '',
  }))
  try {
    JSON.parse(applyEdits(text, edits))
  } catch {
    return null
  }

  return {
    findingId: finding.id,
    ruleId: finding.ruleId,
    file: fileName,
    targetStartLine: finding.range.startLine,
    targetEndLine: finding.range.endLine,
    edits,
    description:
      'Remove the trailing comma before a closing brace or bracket. Removing that comma is the only change, and the result is checked with a strict JSON parser.',
    riskClass: 'safe',
    behaviourChange: false,
    warnings: ['Only trailing commas outside strings are removed; every other character is unchanged.'],
    maskedSpans: [],
  }
}
