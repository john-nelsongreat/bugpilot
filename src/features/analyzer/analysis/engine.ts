import type { ArchiveEntry } from '../archive/guard'
import { ANALYZER_RULES } from '../rules/registry'
import { makeRuleFile } from '../rules/context'
import type { AnalyzerRule } from '../rules/types'
import type { AnalyzerFinding } from '../types'
import { makeFinding } from './finding'

export interface AnalysisLimits {
  /** Wall-clock ceiling for all rules on one file. */
  perFileBudgetMs: number
  /** Hard cap on findings kept for one file; the rest are counted, not stored. */
  maxFindingsPerFile: number
}

export const DEFAULT_ANALYSIS_LIMITS: AnalysisLimits = {
  perFileBudgetMs: 1_500,
  maxFindingsPerFile: 200,
}

export interface AnalysisProgress {
  phase: 'rules'
  filesDone: number
  filesTotal: number
  findings: number
}

export interface FileAnalysis {
  file: string
  findings: AnalyzerFinding[]
  notes: string[]
  rulesRan: string[]
  stoppedEarly: boolean
}

export interface AnalysisBatchResult {
  files: FileAnalysis[]
  cancelled: boolean
}

export interface AnalyzeEntriesOptions {
  rules?: readonly AnalyzerRule[]
  limits?: Partial<AnalysisLimits>
  signal?: AbortSignal
  onProgress?: (progress: AnalysisProgress) => void
}

const SEVERITY_RANK: Record<AnalyzerFinding['severity'], number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
}

function sortFindings(findings: AnalyzerFinding[]): void {
  findings.sort((left, right) => {
    if (left.range.startLine !== right.range.startLine) return left.range.startLine - right.range.startLine
    if ((left.range.startColumn ?? 0) !== (right.range.startColumn ?? 0)) {
      return (left.range.startColumn ?? 0) - (right.range.startColumn ?? 0)
    }
    if (SEVERITY_RANK[left.severity] !== SEVERITY_RANK[right.severity]) {
      return SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
    }
    return left.ruleId.localeCompare(right.ruleId)
  })
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'an unknown error'
}

export interface AnalyzeFileOptions {
  rules: readonly AnalyzerRule[]
  limits: AnalysisLimits
  signal?: AbortSignal
}

/**
 * One file, every applicable rule, each call inside its own try/catch. Returns null only
 * when cancellation arrived before or between rules, so the caller can discard the run.
 */
export function analyzeFile(entry: ArchiveEntry, options: AnalyzeFileOptions): FileAnalysis | null {
  if (options.signal?.aborted) return null

  const started = Date.now()
  const ruleFile = makeRuleFile(entry)
  const findings: AnalyzerFinding[] = []
  const notes: string[] = []
  const rulesRan: string[] = []
  let stoppedEarly = false
  let capNoted = false

  for (const rule of options.rules) {
    if (!rule.languages.includes(ruleFile.language)) continue
    if (options.signal?.aborted) return null
    if (Date.now() - started >= options.limits.perFileBudgetMs) {
      notes.push(
        `Stopped after ${rulesRan.length} rule(s) on this file: the ${options.limits.perFileBudgetMs} ms per-file budget was used up.`,
      )
      stoppedEarly = true
      break
    }

    try {
      const hits = rule.check(ruleFile)
      rulesRan.push(rule.id)
      for (const hit of hits) {
        if (findings.length >= options.limits.maxFindingsPerFile) {
          if (!capNoted) {
            notes.push(`Only the first ${options.limits.maxFindingsPerFile} findings for this file are kept.`)
            capNoted = true
          }
          stoppedEarly = true
          break
        }
        findings.push(
          makeFinding({
            ruleId: rule.id,
            analyzer: 'bugpilot-rules',
            tier: rule.tier,
            severity: hit.severity ?? rule.severity,
            confidence: hit.confidence,
            file: entry.name,
            range: hit.range,
            evidence: hit.evidence,
            message: hit.message,
            explanation: hit.explanation,
            fix: hit.fix ?? null,
            verificationSteps: hit.verificationSteps ?? [],
            limitations: hit.limitations ?? [],
          }),
        )
      }
      if (findings.length >= options.limits.maxFindingsPerFile) break
    } catch (error) {
      notes.push(
        `The ${rule.title} rule failed on this file (${describeError(error)}); the other rules still ran.`,
      )
    }
  }

  sortFindings(findings)
  return { file: entry.name, findings, notes, rulesRan, stoppedEarly }
}

/**
 * Pure, synchronous analysis of already-decoded files. The archive worker has already
 * enforced every byte cap, so this layer only guards its own time and finding count.
 */
export function analyzeEntries(
  entries: readonly ArchiveEntry[],
  options: AnalyzeEntriesOptions = {},
): AnalysisBatchResult {
  const limits: AnalysisLimits = { ...DEFAULT_ANALYSIS_LIMITS, ...options.limits }
  const rules = options.rules ?? ANALYZER_RULES
  const files: FileAnalysis[] = []
  let totalFindings = 0

  if (options.signal?.aborted) return { files: [], cancelled: true }
  options.onProgress?.({ phase: 'rules', filesDone: 0, filesTotal: entries.length, findings: 0 })

  for (const entry of entries) {
    const analysis = analyzeFile(entry, { rules, limits, signal: options.signal })
    if (!analysis) return { files: [], cancelled: true }
    files.push(analysis)
    totalFindings += analysis.findings.length
    options.onProgress?.({
      phase: 'rules',
      filesDone: files.length,
      filesTotal: entries.length,
      findings: totalFindings,
    })
  }

  return { files, cancelled: false }
}
