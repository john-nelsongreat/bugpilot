import type { FixRiskClass } from '../types'

export interface FixEdit {
  file: string
  startOffset: number
  endOffset: number
  newText: string
}

/** A slice of the original text that must never be shown in full in the review view. */
export interface FixMaskedSpan {
  startOffset: number
  endOffset: number
  maskedText: string
}

export interface FixCandidate {
  findingId: string
  ruleId: string
  file: string
  targetStartLine: number
  targetEndLine: number
  edits: FixEdit[]
  description: string
  riskClass: Extract<FixRiskClass, 'safe' | 'needs-review'>
  behaviourChange: boolean
  warnings: string[]
  maskedSpans: FixMaskedSpan[]
}

export interface OverlapDrop {
  candidate: FixCandidate
  kept: FixCandidate
  reason: string
}

export interface FixDrop {
  candidate: FixCandidate
  reason: string
}

export interface FixResolution {
  kept: FixCandidate[]
  dropped: OverlapDrop[]
}
