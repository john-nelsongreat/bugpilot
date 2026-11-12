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
  /**
   * Coverage reasons for a file this rule deliberately did not report on, routed to the
   * report's Notes channel instead of the finding list. A rule that stays quiet because it
   * recognised a dialect has to say so here: silence about a file it could not judge would
   * otherwise read as a claim that the file is clean.
   */
  coverageNotes?(file: RuleFile): string[]
}
