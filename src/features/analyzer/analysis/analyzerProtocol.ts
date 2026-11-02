import type { ArchiveEntry } from '../archive/guard'
import type { AnalysisBatchResult, AnalysisLimits, AnalysisProgress } from './engine'

export interface AnalyzeRequest {
  type: 'analyze'
  id: number
  entries: ArchiveEntry[]
  limits: AnalysisLimits
}

export interface AnalyzerCancelRequest {
  type: 'cancel'
  id: number
}

export type AnalyzerRequest = AnalyzeRequest | AnalyzerCancelRequest

export interface AnalyzerProgressMessage {
  type: 'progress'
  id: number
  progress: AnalysisProgress
}

export interface AnalyzerDoneMessage {
  type: 'done'
  id: number
  result: AnalysisBatchResult
  error: string | null
}

export type AnalyzerResponse = AnalyzerProgressMessage | AnalyzerDoneMessage

/** The subset of the module Worker surface the worker entry needs. */
export interface WorkerScope {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
}
