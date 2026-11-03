import type { DiagnosticConfidence, DiagnosticEvidence } from '../../../diagnostics/types'
import type { Severity } from '../../bugs/types'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerFixProposal, AnalyzerTier, FileRange } from '../types'
import type { EngineId } from './registry'

/** One engine result before it becomes a finding; identical shape to a rule hit. */
export interface EngineHit {
  ruleId: string
  engine: EngineId
  tier: AnalyzerTier
  severity: Severity
  confidence: DiagnosticConfidence
  range: FileRange
  evidence: DiagnosticEvidence[]
  message: string
  explanation: string
  fix: AnalyzerFixProposal | null
  verificationSteps: string[]
  limitations: string[]
}

export type EngineParseStatus =
  | 'parsed'
  | 'no-grammar'
  | 'not-attempted'
  | 'grammar-did-not-understand'
  | 'engine-stopped-early'
  | 'engine-unavailable'

export interface EngineFileResult {
  file: string
  hits: EngineHit[]
  enginesRan: EngineId[]
  parse: EngineParseStatus
  notes: string[]
}

export interface EngineLimits {
  perFileBudgetMs: number
  totalBudgetMs: number
  /** Refuse to hand a file this long to an engine; compared against decoded text length. */
  maxFileBytes: number
  /** Grammar and Ruff binaries are fetched whole; anything bigger is refused. */
  maxDownloadBytes: number
  /** Findings kept per file per engine; the rest are counted, not stored. */
  maxHitsPerFile: number
}

export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  perFileBudgetMs: 3_000,
  totalBudgetMs: 120_000,
  maxFileBytes: 2 * 1024 * 1024,
  // Measured from the build: the Ruff binary is 10,038,888 bytes and the largest grammar
  // (`c_sharp`) is 5,334,256, so the ceiling sits above both and still refuses an asset that
  // grew far beyond what this app ships.
  maxDownloadBytes: 12 * 1024 * 1024,
  maxHitsPerFile: 100,
}

export interface EngineProbeResult {
  ok: boolean
  /** Machine-readable reason, stable enough to test and to print. */
  code: 'available' | 'no-webassembly' | 'blocked-by-policy' | 'worker-error'
  message: string
}

export interface EngineRunResult {
  files: EngineFileResult[]
  /** Files the run never reached because the budget or a cancel stopped it. */
  filesNotRun: string[]
  cancelled: boolean
  unavailable: EngineProbeResult | null
}

export type EngineRequest =
  | { type: 'probe'; id: number }
  | { type: 'analyse'; id: number; entries: ArchiveEntry[]; limits: EngineLimits }
  | { type: 'cancel'; id: number }

export type EngineResponse =
  | { type: 'probe-result'; id: number; result: EngineProbeResult }
  | { type: 'progress'; id: number; filesDone: number; filesTotal: number; note: string }
  | { type: 'downloading'; id: number; url: string }
  | { type: 'done'; id: number; result: EngineRunResult; error: string | null }
