import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerFinding } from '../types'
import { proposeHttpsUrlFix } from './httpsUrl'
import { proposeMixedIndentationFix } from './indentation'
import { proposeJsonTrailingCommaFix } from './jsonTrailingComma'
import { proposeSecretFix } from './secretFix'
import type { FixCandidate } from './types'

const SECRET_RULES = new Set([
  'bugpilot/secret/aws-access-key',
  'bugpilot/secret/github-token',
  'bugpilot/secret/slack-token',
  'bugpilot/secret/stripe-live-key',
  'bugpilot/secret/private-key-block',
  'bugpilot/secret/jwt',
  'bugpilot/secret/connection-string',
  'bugpilot/secret/credential-assignment',
])

export function proposeFix(finding: AnalyzerFinding, source: ArchiveEntry): FixCandidate | null {
  if (finding.file !== source.name) return null
  if (SECRET_RULES.has(finding.ruleId)) {
    return proposeSecretFix(finding, source.text, source.language, source.name)
  }
  if (finding.ruleId === 'bugpilot/syntax/json') {
    return proposeJsonTrailingCommaFix(finding, source.text, source.name)
  }
  if (finding.ruleId === 'bugpilot/generic/insecure-http-url') {
    return proposeHttpsUrlFix(finding, source.text, source.name)
  }
  if (finding.ruleId === 'bugpilot/generic/mixed-indentation') {
    return proposeMixedIndentationFix(finding, source.text, source.language, source.name)
  }
  return null
}

export interface ProposedFixes {
  candidates: FixCandidate[]
  byFinding: Map<string, FixCandidate>
}

export function proposeFixes(
  findings: readonly AnalyzerFinding[],
  sources: readonly ArchiveEntry[],
): ProposedFixes {
  const byName = new Map(sources.map((source) => [source.name, source]))
  const candidates: FixCandidate[] = []
  const byFinding = new Map<string, FixCandidate>()

  for (const finding of findings) {
    const source = byName.get(finding.file)
    if (!source) continue
    const candidate = proposeFix(finding, source)
    if (!candidate) continue
    candidates.push(candidate)
    byFinding.set(finding.id, candidate)
  }

  return { candidates, byFinding }
}
