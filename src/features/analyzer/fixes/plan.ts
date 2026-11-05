import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerFinding } from '../types'
import { verifyFixCandidates, type VerifyFixesDeps } from '../analysis/verifyFixes'
import { proposeFixes, type ProposeLimits } from './proposeFix'
import { resolveFixOverlaps } from './text'
import type { FixCandidate, FixDrop } from './types'

export interface FixPlan {
  available: FixCandidate[]
  unavailable: Map<string, string>
  dropped: FixDrop[]
}

/**
 * Proposes, de-duplicates overlapping ranges and verifies every candidate before the UI
 * offers it. `unavailable` explains, per finding id, why no checkbox is shown.
 */
export async function prepareFixPlan(
  findings: readonly AnalyzerFinding[],
  sources: readonly ArchiveEntry[],
  deps: VerifyFixesDeps = {},
  signal?: AbortSignal,
  limits: ProposeLimits = {},
): Promise<FixPlan> {
  const proposed = proposeFixes(findings, sources, limits)
  const resolution = resolveFixOverlaps(proposed.candidates)
  const outcome = await verifyFixCandidates(resolution.kept, sources, findings, deps, signal)

  const unavailable = new Map<string, string>()
  for (const drop of resolution.dropped) unavailable.set(drop.candidate.findingId, drop.reason)
  for (const drop of outcome.dropped) unavailable.set(drop.candidate.findingId, drop.reason)

  return { available: outcome.verified, unavailable, dropped: outcome.dropped }
}
