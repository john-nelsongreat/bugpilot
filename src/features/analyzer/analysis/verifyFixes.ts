import type { ArchiveEntry } from '../archive/guard'
import { isTsFamily } from '../languages'
import type { AnalyzerFinding } from '../types'
import type { FixCandidate, FixDrop } from '../fixes/types'
import { applyEdits } from '../fixes/text'
import type { AnalyzerClient } from './analyzerClient'
import { createAnalyzerClient } from './analyzerClient'
import type { TsSyntaxClient } from './typescript/tsClient'
import { createDefaultTsClient, TS_FILE_TIMEOUT_MS } from './typescript/tsClient'

const TS_SYNTAX_RULE_ID = 'bugpilot/typescript/syntax'

const SEVERITY_RANK: Record<AnalyzerFinding['severity'], number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
}

export interface VerifyFixesDeps {
  analyzer?: AnalyzerClient
  createTsClient?: () => Promise<TsSyntaxClient>
}

export interface FixVerificationOutcome {
  verified: FixCandidate[]
  dropped: FixDrop[]
}

interface Variant {
  candidate: FixCandidate
  source: ArchiveEntry
  name: string
  text: string
}

function defaultAnalyzer(): AnalyzerClient {
  return createAnalyzerClient(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))
}

function findingKey(finding: AnalyzerFinding): string {
  return `${finding.severity}\u0000${finding.ruleId}\u0000${finding.message}`
}

function countKeys(findings: readonly AnalyzerFinding[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const finding of findings) {
    const key = findingKey(finding)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function countRule(findings: readonly AnalyzerFinding[], ruleId: string): number {
  return findings.filter((finding) => finding.ruleId === ruleId).length
}

function messages(findings: readonly AnalyzerFinding[]): string[] {
  return findings.map((finding) => finding.message)
}

function newMessagesExceed(fixed: readonly string[], baseline: readonly string[]): string | null {
  const allowed = new Map<string, number>()
  for (const message of baseline) allowed.set(message, (allowed.get(message) ?? 0) + 1)
  for (const message of fixed) {
    const left = allowed.get(message) ?? 0
    if (left <= 0) return message
    allowed.set(message, left - 1)
  }
  return null
}

interface TargetCheck {
  ok: boolean
  reason: string
}

function checkTarget(candidate: FixCandidate, baseline: readonly AnalyzerFinding[], fixed: readonly AnalyzerFinding[]): TargetCheck {
  const before = countRule(baseline, candidate.ruleId)
  const after = countRule(fixed, candidate.ruleId)
  if (after >= before) {
    return {
      ok: false,
      reason: `The ${candidate.ruleId} finding was still present after the change, so the fix did not verify.`,
    }
  }

  const targetFinding = baseline.find((finding) => finding.id === candidate.findingId)
  const targetSeverity = SEVERITY_RANK[targetFinding?.severity ?? 'Low']
  const relevant = (finding: AnalyzerFinding) => SEVERITY_RANK[finding.severity] >= targetSeverity
  const allowed = countKeys(baseline.filter(relevant))
  const counts = countKeys(fixed.filter(relevant))
  for (const [key, count] of counts) {
    const limit = allowed.get(key) ?? 0
    if (count > limit) {
      const [, ruleId, message] = key.split('\u0000')
      return {
        ok: false,
        reason: `The change introduced a new ${ruleId} finding ("${message}") at the same or higher severity, so it was not kept.`,
      }
    }
  }

  return { ok: true, reason: '' }
}

/**
 * Applies every candidate to a copy of its file and re-runs the real analyzers in the worker
 * pipeline. A candidate is kept only when its target finding disappears, no finding of equal
 * or higher severity appears, and JSON/JS/TS source still parses. Anything else is dropped
 * with a plain reason; the original text is never modified.
 */
export async function verifyFixCandidates(
  candidates: readonly FixCandidate[],
  sources: readonly ArchiveEntry[],
  baselineFindings: readonly AnalyzerFinding[],
  deps: VerifyFixesDeps = {},
  signal?: AbortSignal,
): Promise<FixVerificationOutcome> {
  const verified: FixCandidate[] = []
  const dropped: FixDrop[] = []
  if (candidates.length === 0) return { verified, dropped }

  const byName = new Map(sources.map((source) => [source.name, source]))
  const variants: Variant[] = []
  const baselineByFile = new Map<string, AnalyzerFinding[]>()
  for (const finding of baselineFindings) {
    const list = baselineByFile.get(finding.file)
    if (list) list.push(finding)
    else baselineByFile.set(finding.file, [finding])
  }

  for (const candidate of candidates) {
    const source = byName.get(candidate.file)
    if (!source) {
      dropped.push({ candidate, reason: 'The analysed text for this file is no longer available, so the fix cannot be verified.' })
      continue
    }
    let text: string
    try {
      text = applyEdits(source.text, candidate.edits)
    } catch (error) {
      dropped.push({
        candidate,
        reason: error instanceof Error ? error.message : 'The change could not be applied to the original text.',
      })
      continue
    }
    variants.push({
      candidate,
      source,
      name: `__bugpilot_verify__/${variants.length}/${source.name}`,
      text,
    })
  }

  if (variants.length === 0) return { verified, dropped }
  if (signal?.aborted) {
    for (const variant of variants) {
      dropped.push({ candidate: variant.candidate, reason: 'Verification was cancelled before it finished.' })
    }
    return { verified, dropped }
  }

  const entries: ArchiveEntry[] = variants.map((variant) => ({
    ...variant.source,
    name: variant.name,
    text: variant.text,
  }))

  let analyses = new Map<string, AnalyzerFinding[]>()
  try {
    const analyzer = deps.analyzer ?? defaultAnalyzer()
    const run = await analyzer.analyze(entries, { signal })
    if (run.cancelled || signal?.aborted) {
      for (const variant of variants) {
        dropped.push({ candidate: variant.candidate, reason: 'Verification was cancelled before it finished.' })
      }
      return { verified, dropped }
    }
    if (run.error) {
      for (const variant of variants) {
        dropped.push({ candidate: variant.candidate, reason: `The verification analysis could not run: ${run.error}` })
      }
      return { verified, dropped }
    }
    analyses = new Map(run.files.map((file) => [file.file, file.findings]))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The verification analysis could not run.'
    for (const variant of variants) dropped.push({ candidate: variant.candidate, reason })
    return { verified, dropped }
  }

  const tsVariants = variants.filter((variant) => isTsFamily(variant.source.language))
  const tsFindings = new Map<string, AnalyzerFinding[]>()
  if (tsVariants.length > 0) {
    let client: TsSyntaxClient | null = null
    try {
      client = await (deps.createTsClient ?? createDefaultTsClient)()
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The syntax checker could not start.'
      for (const variant of tsVariants) {
        dropped.push({ candidate: variant.candidate, reason: `The syntax re-check could not run (${reason}), so the fix did not verify.` })
      }
    }
    if (client) {
      try {
        for (const variant of tsVariants) {
          if (signal?.aborted) {
            dropped.push({ candidate: variant.candidate, reason: 'Verification was cancelled before it finished.' })
            continue
          }
          const check = await client.check({ name: variant.name, text: variant.text }, { signal })
          if (check.cancelled || signal?.aborted) {
            dropped.push({ candidate: variant.candidate, reason: 'Verification was cancelled before it finished.' })
            continue
          }
          if (check.timedOut) {
            dropped.push({
              candidate: variant.candidate,
              reason: `The syntax re-check did not finish within ${TS_FILE_TIMEOUT_MS} ms, so the fix did not verify.`,
            })
            continue
          }
          if (check.error) {
            dropped.push({ candidate: variant.candidate, reason: `The syntax re-check failed (${check.error}), so the fix did not verify.` })
            continue
          }
          tsFindings.set(variant.name, check.findings)
        }
      } finally {
        client.dispose()
      }
    }
  }

  const droppedIds = new Set(dropped.map((drop) => drop.candidate.findingId))
  for (const variant of variants) {
    if (droppedIds.has(variant.candidate.findingId)) continue
    const baseline = baselineByFile.get(variant.candidate.file) ?? []
    const fixed = analyses.get(variant.name) ?? []
    const target = checkTarget(variant.candidate, baseline, fixed)
    if (!target.ok) {
      dropped.push({ candidate: variant.candidate, reason: target.reason })
      continue
    }

    if (variant.source.language === 'json') {
      try {
        JSON.parse(variant.text)
      } catch {
        dropped.push({
          candidate: variant.candidate,
          reason: 'The changed file is still not valid JSON, so the fix did not verify.',
        })
        continue
      }
    }

    if (isTsFamily(variant.source.language)) {
      const original = baseline.filter((finding) => finding.ruleId === TS_SYNTAX_RULE_ID)
      const checked = tsFindings.get(variant.name)
      if (!checked) continue
      const introduced = newMessagesExceed(messages(checked), messages(original))
      if (introduced) {
        dropped.push({
          candidate: variant.candidate,
          reason: `The change introduced a new syntax diagnostic ("${introduced}"), so the fix did not verify.`,
        })
        continue
      }
    }

    verified.push(variant.candidate)
  }

  return { verified, dropped }
}
