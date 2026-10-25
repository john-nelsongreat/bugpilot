import type { DiagnosticLanguage } from '../../diagnostics/types'
import type { Bug } from '../bugs/types'
import { FIELD_LIMITS } from '../bugs/validation'

const JAVASCRIPT_LANGUAGES = new Set([
  'javascript',
  'typescript',
  'js',
  'ts',
  'node',
])

export interface AssistantPrefill {
  language: DiagnosticLanguage
  errorText: string
  reproductionDetails: string
}

export function assistantLanguageFor(language: string): DiagnosticLanguage {
  const normalized = language.trim().toLowerCase()
  if (normalized === 'python') return 'python'
  if (JAVASCRIPT_LANGUAGES.has(normalized)) return 'javascript'
  return 'auto'
}

export function composeReproductionDetails(
  stepsToReproduce: string,
  actualBehavior: string,
): string {
  const steps = stepsToReproduce
    .trim()
    .slice(0, FIELD_LIMITS.stepsToReproduce)
  const actual = actualBehavior.trim().slice(0, FIELD_LIMITS.actualBehavior)
  const sections: string[] = []

  if (steps !== '') sections.push(`Steps to reproduce:\n${steps}`)
  if (actual !== '') sections.push(`Actual behavior:\n${actual}`)

  return sections.join('\n\n')
}

export function assistantPrefillFor(bug: Bug): AssistantPrefill | null {
  if (bug.errorMessage.trim() === '') return null

  return {
    language: assistantLanguageFor(bug.language),
    errorText: bug.errorMessage,
    reproductionDetails: composeReproductionDetails(
      bug.stepsToReproduce,
      bug.actualBehavior,
    ),
  }
}
