import type { SourceLanguage } from '../archive/classify'
import { buildLineStarts, redactSecret } from '../rules/context'
import type { AnalyzerFinding } from '../types'
import { buildEnvLookup, ROTATE_CREDENTIAL_WARNING } from './envLookup'
import {
  assignmentNameBefore,
  findEnclosingQuotedLiteral,
  findFirstQuotedLiteralWithin,
  type QuotedLiteral,
} from './literals'
import type { FixCandidate, FixMaskedSpan } from './types'

const ENV_SECRET_RULES = new Set([
  'bugpilot/secret/aws-access-key',
  'bugpilot/secret/github-token',
  'bugpilot/secret/slack-token',
  'bugpilot/secret/stripe-live-key',
  'bugpilot/secret/private-key-block',
  'bugpilot/secret/jwt',
  'bugpilot/secret/connection-string',
  'bugpilot/secret/credential-assignment',
])

function offsetAt(text: string, lineStarts: readonly number[], line: number, column: number): number {
  const start = lineStarts[Math.max(0, Math.min(line - 1, lineStarts.length - 1))] ?? 0
  return Math.max(0, Math.min(text.length, start + Math.max(0, column - 1)))
}

function passwordSpan(text: string, rangeStart: number, rangeEnd: number): FixMaskedSpan {
  const url = text.slice(rangeStart, rangeEnd)
  const match = /:\/\/[^\s:/@]+:([^\s@/]{3,})@/.exec(url)
  if (match) {
    const passwordAt = match.index + match[0].indexOf(`:${match[1]}@`) + 1
    const start = rangeStart + passwordAt
    return {
      startOffset: start,
      endOffset: start + match[1].length,
      maskedText: redactSecret(match[1]),
    }
  }
  return { startOffset: rangeStart, endOffset: rangeEnd, maskedText: redactSecret(url) }
}

interface SecretTarget {
  literal: QuotedLiteral
  maskedSpan: FixMaskedSpan
  description: string
}

function targetFor(finding: AnalyzerFinding, text: string, language: SourceLanguage, rangeStart: number, rangeEnd: number): SecretTarget | null {
  if (finding.ruleId === 'bugpilot/secret/credential-assignment') {
    const literal = findFirstQuotedLiteralWithin(text, rangeStart, rangeEnd, language)
    if (!literal) return null
    return {
      literal,
      maskedSpan: {
        startOffset: literal.contentStart,
        endOffset: literal.contentEnd,
        maskedText: redactSecret(literal.content),
      },
      description: 'Replace the hard-coded credential with an environment lookup.',
    }
  }

  const literal = findEnclosingQuotedLiteral(text, rangeStart, language)
  if (!literal) return null
  const matched = text.slice(rangeStart, rangeEnd)
  const content = literal.content.trim()

  if (finding.ruleId === 'bugpilot/secret/connection-string') {
    if (content !== matched.trim()) return null
    return {
      literal,
      maskedSpan: passwordSpan(text, rangeStart, rangeEnd),
      description:
        'Replace the connection-string literal with an environment lookup; the environment variable then holds the whole URL.',
    }
  }

  if (finding.ruleId === 'bugpilot/secret/private-key-block') {
    if (!content.startsWith('-----BEGIN') || !content.includes('-----END')) return null
    return {
      literal,
      maskedSpan: {
        startOffset: literal.contentStart,
        endOffset: literal.contentEnd,
        maskedText: redactSecret(literal.content),
      },
      description: 'Replace the private-key literal with an environment lookup.',
    }
  }

  if (content !== matched.trim()) return null
  return {
    literal,
    maskedSpan: {
      startOffset: rangeStart,
      endOffset: rangeEnd,
      maskedText: redactSecret(matched),
    },
    description: 'Replace the hard-coded credential with an environment lookup.',
  }
}

export function proposeSecretFix(
  finding: AnalyzerFinding,
  text: string,
  language: SourceLanguage,
  fileName: string,
): FixCandidate | null {
  if (!ENV_SECRET_RULES.has(finding.ruleId)) return null

  const lineStarts = buildLineStarts(text)
  const rangeStart = offsetAt(text, lineStarts, finding.range.startLine, finding.range.startColumn ?? 1)
  const rangeEnd = offsetAt(text, lineStarts, finding.range.endLine, finding.range.endColumn ?? 1)
  if (rangeEnd <= rangeStart) return null

  const target = targetFor(finding, text, language, rangeStart, rangeEnd)
  if (!target) return null

  const assignment = assignmentNameBefore(text, target.literal.start, language)
  if (!assignment) return null

  const lookup = buildEnvLookup({
    language,
    fileName,
    text,
    name: assignment.name,
    jsxAttribute: assignment.jsxAttribute,
  })
  if (!lookup) return null

  const name = lookup.expression
  return {
    findingId: finding.id,
    ruleId: finding.ruleId,
    file: finding.file,
    targetStartLine: finding.range.startLine,
    targetEndLine: finding.range.endLine,
    edits: [
      {
        file: finding.file,
        startOffset: target.literal.start,
        endOffset: target.literal.end,
        newText: lookup.expression,
      },
      ...lookup.extraEdits,
    ],
    description: `${target.description} Lookup expression: ${name}.`,
    riskClass: 'needs-review',
    behaviourChange: true,
    warnings: [ROTATE_CREDENTIAL_WARNING, ...lookup.warnings],
    maskedSpans: [target.maskedSpan],
  }
}
