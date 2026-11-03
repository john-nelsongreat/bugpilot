import { buildLineStarts } from '../rules/context'
import type { AnalyzerFinding } from '../types'
import type { FixCandidate } from './types'

const HTTP_RULE_ID = 'bugpilot/generic/insecure-http-url'

export function proposeHttpsUrlFix(finding: AnalyzerFinding, text: string, fileName: string): FixCandidate | null {
  if (finding.ruleId !== HTTP_RULE_ID) return null
  const lineStarts = buildLineStarts(text)
  const lineStart = lineStarts[finding.range.startLine - 1]
  if (lineStart === undefined) return null
  const startOffset = Math.max(0, Math.min(text.length, lineStart + (finding.range.startColumn ?? 1) - 1))
  if (text.slice(startOffset, startOffset + 7).toLowerCase() !== 'http://') return null

  return {
    findingId: finding.id,
    ruleId: finding.ruleId,
    file: fileName,
    targetStartLine: finding.range.startLine,
    targetEndLine: finding.range.endLine,
    edits: [{ file: fileName, startOffset, endOffset: startOffset + 7, newText: 'https://' }],
    description: 'Change the URL scheme from http:// to https://.',
    riskClass: 'needs-review',
    behaviourChange: true,
    warnings: [
      'The host must actually serve HTTPS with a valid certificate; some legacy hosts do not, and the request would fail.',
    ],
    maskedSpans: [],
  }
}
