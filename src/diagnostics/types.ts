export type DiagnosticLanguage = 'auto' | 'python' | 'javascript'

export type ResolvedLanguage = Exclude<DiagnosticLanguage, 'auto'>

export type SupportedDiagnosticCategory =
  | 'missing-module'
  | 'import-failure'
  | 'undefined-name'
  | 'type-mismatch'
  | 'missing-attribute'
  | 'missing-key'
  | 'index-out-of-range'
  | 'missing-file'
  | 'permission-denied'
  | 'syntax-error'
  | 'indentation-error'
  | 'division-by-zero'
  | 'invalid-value'
  | 'recursion-error'
  | 'unicode-error'
  | 'json-decode-error'
  | 'port-in-use'
  | 'network-request-failed'
  | 'cors-blocked'
  | 'react-error'
  | 'typescript-error'
  | 'npm-error'

export type DiagnosticCategory =
  | SupportedDiagnosticCategory
  | 'unrecognized'

export type ConfidenceLevel = 'low' | 'medium' | 'high'

export interface DiagnosticInput {
  language: DiagnosticLanguage
  errorText: string
  codeSnippet?: string
  reproductionDetails?: string
}

export type EvidenceSource =
  | 'error text'
  | 'code snippet'
  | 'reproduction details'

export interface DiagnosticEvidence {
  source: EvidenceSource
  label: string
  quote: string
  lineNumber?: number
}

export interface DiagnosticConfidence {
  level: ConfidenceLevel
  reason: string
}

export interface PossibleFix {
  explanation: string
  whereItMayApply: string
  exampleCode: string
}

export interface DiagnosticResult {
  category: DiagnosticCategory
  matchedSignature: string | null
  likelyCause: string
  evidence: DiagnosticEvidence[]
  debuggingSteps: string[]
  possibleFix: PossibleFix | null
  verificationSteps: string[]
  confidence: DiagnosticConfidence
  limitations: string[]
  alternativeExplanations: string[]
}

export interface RuleContext {
  primaryLine: string
  errorText: string
  codeSnippet: string
  reproductionDetails: string
}

export interface RuleMatch {
  signature: string
  specificity: 'specific' | 'generic'
  /** Upper bound for this match when its wording cannot justify more certainty. */
  confidenceCeiling?: ConfidenceLevel
  captures: Readonly<Record<string, string>>
}

export interface RuleNarrative {
  likelyCause: string
  debuggingSteps: string[]
  possibleFix: PossibleFix
  verificationSteps: string[]
  limitations: string[]
  alternativeExplanations: string[]
}

export interface DiagnosticRule {
  id: string
  language: ResolvedLanguage
  category: SupportedDiagnosticCategory
  /** Rule ids this rule overrides when both match the same final line. */
  supersedes?: readonly string[]
  /**
   * Generic final lines this rule can explain from another line in the paste.
   * When the selected final line matches one of these symptoms, the engine
   * also applies `match` to the other lines and lets this rule represent the
   * more specific message it finds there.
   */
  contextSymptoms?: readonly RegExp[]
  /**
   * Read the paste from the top instead of the bottom when this rule explains
   * another line. Compiler and package manager output prints the identifying
   * line first and repeats details below it, so the first match is the one to
   * report.
   */
  firstMatchWins?: boolean
  match(line: string): RuleMatch | null
  explain(match: RuleMatch, context: RuleContext): RuleNarrative
}
