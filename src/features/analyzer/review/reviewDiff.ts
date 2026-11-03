import type { FixMaskedSpan } from '../fixes/types'
import { buildDiffViews, masksByLine, type FileDiff } from './diffModel'

export interface ReviewDiffInput {
  file: string
  before: string
  after: string
  maskedSpans: readonly FixMaskedSpan[]
}

export interface ReviewDiffResult {
  file: string
  unified: FileDiff | null
  split: FileDiff | null
  error: string | null
}

export type ReviewDiffBuilder = (
  inputs: readonly ReviewDiffInput[],
  signal?: AbortSignal,
) => Promise<ReviewDiffResult[]>

export function buildReviewDiff(input: ReviewDiffInput): ReviewDiffResult {
  try {
    const views = buildDiffViews(
      input.file,
      input.before,
      input.after,
      masksByLine(input.before, input.maskedSpans),
    )
    return { file: input.file, unified: views.unified, split: views.split, error: null }
  } catch (error) {
    return {
      file: input.file,
      unified: null,
      split: null,
      error: error instanceof Error ? error.message : 'The diff could not be built.',
    }
  }
}
