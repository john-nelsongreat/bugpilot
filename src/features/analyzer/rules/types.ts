import type { DiagnosticConfidence, DiagnosticEvidence } from '../../../diagnostics/types'
import type { Severity } from '../../bugs/types'
import type { LanguageSource, SourceLanguage } from '../archive/classify'
import type { TextEncoding } from '../archive/decode'
import type { AnalyzerFixProposal, FileRange } from '../types'

export interface RuleFile {
  file: string
  language: SourceLanguage
  languageSource: LanguageSource
  encoding: TextEncoding
  text: string
  lines: string[]
  /** Offset of the first character of every line. */
  lineStarts: number[]
}

export interface RuleHit {
  range: FileRange
  message: string
  explanation: string
  confidence: DiagnosticConfidence
  evidence: DiagnosticEvidence[]
  /** Overrides the rule's default severity for one hit. */
  severity?: Severity
  fix?: AnalyzerFixProposal | null
  verificationSteps?: string[]
  limitations?: string[]
}

export interface AnalyzerRule {
  id: string
  title: string
  tier: 'syntax' | 'pattern'
  severity: Severity
  languages: readonly SourceLanguage[]
  description: string
  check(file: RuleFile): RuleHit[]
}
