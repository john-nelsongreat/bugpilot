import type { AnalyzerFinding } from '../../types'

export interface TsCheckRequest {
  type: 'check'
  id: number
  name: string
  text: string
}

export interface TsCheckResultMessage {
  type: 'result'
  id: number
  findings: AnalyzerFinding[]
}

export interface TsCheckErrorMessage {
  type: 'error'
  id: number
  message: string
}

export type TsWorkerMessage = TsCheckResultMessage | TsCheckErrorMessage

/** The subset of the classic Worker surface the worker entry needs. */
export interface WorkerScope {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
}
