import type { DiagnosticResult, PossibleFix } from '../../diagnostics/types'
import type { DiagnosisAttachment } from '../bugs/diagnosis'
import type { Bug, SavedDiagnosisEvidence } from '../bugs/types'
import { FIELD_LIMITS } from '../bugs/validation'

export const EXAMPLE_CODE_HEADING = 'Example code:'

export interface ComposedDiagnosisFix {
  text: string
  droppedExampleCode: boolean
  exceedsLimit: boolean
}

export interface SaveDiagnosisSelection {
  evidence: SavedDiagnosisEvidence[]
  replaceFix: boolean
}

export function composeProposedFix(
  possibleFix: PossibleFix,
): ComposedDiagnosisFix {
  const explanation = possibleFix.explanation.trim()
  const exampleCode = possibleFix.exampleCode.trim()
  const limit = FIELD_LIMITS.proposedFix
  const exceedsLimit = explanation.length > limit

  if (exampleCode === '') {
    return { text: explanation, droppedExampleCode: false, exceedsLimit }
  }

  const full = `${explanation}\n\n${EXAMPLE_CODE_HEADING}\n${exampleCode}`
  if (full.length <= limit) {
    return { text: full, droppedExampleCode: false, exceedsLimit: false }
  }

  return { text: explanation, droppedExampleCode: true, exceedsLimit }
}

export function canSaveDiagnosis(
  bug: Bug | null,
  result: DiagnosticResult | null,
): boolean {
  return Boolean(
    bug &&
      result &&
      result.category !== 'unrecognized' &&
      result.possibleFix !== null,
  )
}

export function diagnosisAttachmentFor(
  result: DiagnosticResult,
  evidence: SavedDiagnosisEvidence[],
): DiagnosisAttachment {
  return {
    category: result.category,
    matchedSignature: result.matchedSignature,
    confidence: result.confidence.level,
    evidence,
  }
}
