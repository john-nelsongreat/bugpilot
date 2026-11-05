import type { ArchiveEntry } from '../archive/guard'
import { isNotebookDerivedName } from '../archive/notebook'
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
  // A notebook cell is not a file on disk, and the brief keeps notebook fixes manual: no edit that
  // BugPilot can render would apply to code the user keeps in Jupyter.
  if (isNotebookDerivedName(finding.file)) return null
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

export interface ProposeLimits {
  /** Stop proposing after this many candidates; the default is every finding. */
  maxCandidates?: number
  /** Stop proposing when the files copied for verification pass this many bytes. */
  maxCandidateSourceBytes?: number
}

export function proposeFixes(
  findings: readonly AnalyzerFinding[],
  sources: readonly ArchiveEntry[],
  limits: ProposeLimits = {},
): ProposedFixes {
  const byName = new Map(sources.map((source) => [source.name, source]))
  const candidates: FixCandidate[] = []
  const byFinding = new Map<string, FixCandidate>()
  const maxCandidates = limits.maxCandidates ?? Number.POSITIVE_INFINITY
  const maxBytes = limits.maxCandidateSourceBytes ?? Number.POSITIVE_INFINITY
  let copiedBytes = 0

  for (const finding of findings) {
    if (candidates.length >= maxCandidates) break
    const source = byName.get(finding.file)
    if (!source) continue
    if (candidates.length > 0 && copiedBytes + source.bytes > maxBytes) break
    const candidate = proposeFix(finding, source)
    if (!candidate) continue
    candidates.push(candidate)
    copiedBytes += source.bytes
    byFinding.set(finding.id, candidate)
  }

  return { candidates, byFinding }
}
