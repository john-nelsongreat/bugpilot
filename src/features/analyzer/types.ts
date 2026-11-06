import type { DiagnosticConfidence, DiagnosticEvidence, PossibleFix } from '../../diagnostics/types'
import type { Severity } from '../bugs/types'
import type { LanguageSource, SourceLanguage } from './archive/classify'
import type { TextEncoding } from './archive/decode'

export const ANALYZER_TIERS = ['syntax', 'pattern', 'type-or-dataflow'] as const
export type AnalyzerTier = (typeof ANALYZER_TIERS)[number]

export const FIX_RISK_CLASSES = ['safe', 'needs-review', 'manual-only'] as const
export type FixRiskClass = (typeof FIX_RISK_CLASSES)[number]

export interface FileRange {
  /** 1-based, matching `DiagnosticEvidence.lineNumber`. */
  startLine: number
  startColumn?: number
  endLine: number
  endColumn?: number
}

export interface AnalyzerFixProposal extends PossibleFix {
  riskClass: FixRiskClass
  /** Why this risk class, in one sentence a reviewer can check. */
  riskReason: string
}

export interface AnalyzerFinding {
  /** Deterministic for the same file bytes, rule and line. */
  id: string
  ruleId: string
  analyzer: 'bugpilot-rules' | 'typescript' | 'tree-sitter' | 'ruff'
  tier: AnalyzerTier
  severity: Severity
  confidence: DiagnosticConfidence
  /** Path inside the upload; never a filesystem path. */
  file: string
  range: FileRange
  evidence: DiagnosticEvidence[]
  message: string
  explanation: string
  fix: AnalyzerFixProposal | null
  verificationSteps: string[]
  limitations: string[]
}

export interface CoverageTier {
  tier: AnalyzerTier
  available: boolean
  ran: boolean
  reason: string
}

export interface FileCoverage {
  file: string
  status: 'analysed' | 'skipped'
  language: SourceLanguage
  languageSource: LanguageSource | 'name-only'
  languageLabel: string
  encoding: TextEncoding | null
  bytes: number
  findings: number
  tiers: CoverageTier[]
  skipReason: string | null
  notes: string[]
}

/** Present only when the upload stopped early and what was read was kept. */
export interface AnalyzerPartialInfo {
  code: string
  message: string
  analysedFiles: number
  plannedFiles: number
  unreachedFiles: number
  producedBytes: number
  plannedBytes: number
}

export interface AnalyzerSession {
  archiveBytes: number
  fileCount: number
  analysedCount: number
  skippedCount: number
  skipped: { file: string; reason: string }[]
  /** A partial report says so in its own data, not only in its prose. */
  partial?: AnalyzerPartialInfo
}

export interface AnalyzerSummary {
  findings: number
  bySeverity: Record<Severity, number>
  byTier: Record<AnalyzerTier, number>
}

/**
 * Present only when the rules matched more findings than the store keeps. The suppressed part is
 * counted per rule rather than vanished, so the user can see which rule produced the flood.
 */
export interface AnalyzerFindingsTruncation {
  /** How many findings the report stores. */
  stored: number
  /** How many matched but are not stored. */
  suppressed: number
  /** Suppressed findings per rule id, highest count first when displayed. */
  perRule: Record<string, number>
}

export interface AnalyzerReport {
  schemaVersion: 1
  generatedAt: string
  includeSnippets: boolean
  session: AnalyzerSession
  summary: AnalyzerSummary
  findings: AnalyzerFinding[]
  coverage: FileCoverage[]
  limitations: string[]
  truncated?: AnalyzerFindingsTruncation
}
