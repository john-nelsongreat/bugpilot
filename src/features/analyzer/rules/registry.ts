import type { SourceLanguage } from '../archive/classify'
import { genericRules } from './generic'
import { jsonSyntaxRule } from './json'
import { secretRules } from './secrets'
import type { AnalyzerRule } from './types'

export const ANALYZER_RULES: readonly AnalyzerRule[] = [
  ...genericRules,
  ...secretRules,
  jsonSyntaxRule,
]

/** Synthesized by the TypeScript worker; kept here so the report and the UI share one id. */
export const TS_SYNTAX_RULE_ID = 'bugpilot/typescript/syntax'

export function rulesForLanguage(language: SourceLanguage): AnalyzerRule[] {
  return ANALYZER_RULES.filter((rule) => rule.languages.includes(language))
}

export function ruleById(id: string): AnalyzerRule | undefined {
  return ANALYZER_RULES.find((rule) => rule.id === id)
}
