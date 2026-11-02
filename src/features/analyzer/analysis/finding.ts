import type { DiagnosticConfidence, DiagnosticEvidence } from '../../../diagnostics/types'
import type { Severity } from '../../bugs/types'
import type { AnalyzerFinding, AnalyzerTier, AnalyzerFixProposal, FileRange } from '../types'

export interface FindingInput {
  ruleId: string
  analyzer: AnalyzerFinding['analyzer']
  tier: AnalyzerTier
  severity: Severity
  confidence: DiagnosticConfidence
  file: string
  range: FileRange
  evidence: DiagnosticEvidence[]
  message: string
  explanation: string
  fix: AnalyzerFixProposal | null
  verificationSteps: string[]
  limitations: string[]
}

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The same file bytes, rule and line always produce the same id, so a report can be
 * compared between runs without relying on array order.
 */
export function stableFindingId(input: FindingInput): string {
  const seed = [
    input.ruleId,
    input.file,
    input.range.startLine,
    input.range.startColumn ?? 0,
    input.message,
  ].join('\u0000')
  return `f-${hashText(seed)}-${input.range.startLine}`
}

export function makeFinding(input: FindingInput): AnalyzerFinding {
  return { id: stableFindingId(input), ...input }
}
