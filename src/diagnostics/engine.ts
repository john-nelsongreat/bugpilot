import { javascriptRules } from './rules/javascript'
import { neutralRules } from './rules/neutral'
import { pythonRules } from './rules/python'
import type {
  DiagnosticConfidence,
  DiagnosticEvidence,
  DiagnosticInput,
  DiagnosticLanguage,
  DiagnosticResult,
  DiagnosticRule,
  ResolvedLanguage,
  RuleContext,
  RuleMatch,
} from './types'

export const MAX_ERROR_TEXT_LENGTH = 20_000

const ALL_RULES: readonly DiagnosticRule[] = [
  ...pythonRules,
  ...javascriptRules,
  ...neutralRules,
]

/** Rules that describe one runtime and compete with each other for a line. */
const LANGUAGE_RULES: readonly LanguageDiagnosticRule[] = ALL_RULES.filter(
  (rule): rule is LanguageDiagnosticRule => rule.language !== 'any',
)

/**
 * Rules that describe a tool with no programming language. They are consulted
 * only when no language rule claimed anything in the paste, so they can never
 * take a line a Python or JavaScript rule already explains.
 */
const NEUTRAL_RULES: readonly DiagnosticRule[] = ALL_RULES.filter(
  (rule) => rule.language === 'any',
)

const SUPPORTED_LANGUAGES: readonly DiagnosticLanguage[] = [
  'auto',
  'python',
  'javascript',
]

const LANGUAGE_LABELS: Record<ResolvedLanguage, string> = {
  python: 'Python',
  javascript: 'JavaScript',
}

const EXCEPTION_LINE =
  /^(?:Uncaught\s+(?:\(in promise\)\s+)?)?(?:(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Error|Exception)):\s*\S/

const NODE_ERROR_LINE =
  /^(?:Uncaught\s+(?:\(in promise\)\s+)?)?Error(?:\s+\[[A-Z][A-Z0-9_]*\])?:\s+\S/

const REACT_COMPONENT_TRAILER = /^The above error occurred in the <.+> component:$/

const REACT_BOUNDARY_TRAILER =
  /^Consider adding an error boundary to your tree to customize error handling behavior\.$/

/**
 * Tool-written summary lines that follow the real error. They are never
 * selected as the line to diagnose, so an earlier recognised error still wins.
 * Lines that carry their own meaning, such as the npm lifecycle line that names
 * the failed script, are not listed here: the context-line mechanism resolves
 * those instead.
 */
const SUMMARY_TRAILERS: readonly RegExp[] = [
  /^Found \d+ errors?\b/,
  /^Errors\s+Files$/,
  /^\d+\s+\S+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs):\d+$/,
  /^npm (?:ERR!|error)\s*$/,
  /^npm (?:ERR!|error)\s*>/,
  /^npm (?:ERR!|error)\s+A complete log\b/i,
  /^npm (?:ERR!|error)\s+This is probably not a problem\b/i,
  /^npm (?:ERR!|error)\s+command failed\b/i,
  /^(?:npm (?:ERR!|error)\s*)?\S*(?:\.npm|npm-cache)[\\/]_logs[\\/]\S+\.log$/i,
  // Git writes the advice that follows an error one hint: line at a time, and
  // names the remote it pushed to before saying whether the push was refused.
  /^hint: /,
  /^To\s+(?:[a-z][a-z0-9+.-]*:\/\/\S+|\S+@\S+:\S+)$/i,
]

const SAFETY_LIMITATION =
  'This is local, rule-based guidance based only on the pasted text; it has not inspected or executed your project.'

const GENERAL_DEBUGGING_STEPS = [
  'Copy the final exception line and the nearest stack frame that points to your own code.',
  'Note the exact runtime, command, and environment in which the error appeared.',
  'Reproduce the failure with the smallest input and the same command.',
  'Compare the failing value, key, or path with what the code expects before changing dependencies.',
]

const GENERAL_VERIFICATION_STEPS = [
  'Rerun the same reproduction after one focused change.',
  'Check that the original failure is gone and nearby behavior still works.',
  'If the error changes, use the new final exception line as the next diagnostic input.',
]

interface SelectedLine {
  text: string
  lineNumber: number
}

interface EvaluatedCandidate {
  rule: DiagnosticRule
  match: RuleMatch
  contextLine?: SelectedLine
}

type LanguageDiagnosticRule = DiagnosticRule & { language: ResolvedLanguage }

type CandidateGroups = Record<ResolvedLanguage, EvaluatedCandidate[]>

interface LanguageSignal {
  label: string
  weight: number
}

interface LanguageSignals {
  python: LanguageSignal[]
  javascript: LanguageSignal[]
}

type LanguageCertainty =
  | 'explicit'
  | 'trace'
  | 'signature'
  | 'specificity'
  | 'conflict'
  | 'neutral'

/** The runtime a match is attributed to, or none for a tool-written message. */
type SelectionLanguage = ResolvedLanguage | 'neutral'

interface CandidateSelection {
  candidate: EvaluatedCandidate
  language: SelectionLanguage
  certainty: LanguageCertainty
  conflictDetail?: string
}

type SelectionOutcome =
  | { kind: 'match'; selection: CandidateSelection }
  | { kind: 'ambiguous' }
  | { kind: 'none' }

interface UnrecognizedOptions {
  confidenceReason?: string
  alternativeExplanations?: string[]
}

const LANGUAGE_SIGNALS: ReadonlyArray<{
  language: ResolvedLanguage
  label: string
  weight: number
  pattern: RegExp
}> = [
  {
    language: 'python',
    label: 'a Python traceback header',
    weight: 3,
    pattern: /Traceback \(most recent call last\):/i,
  },
  {
    language: 'python',
    label: 'Python file frames',
    weight: 2,
    pattern: /^\s*File "[^"]+\.py", line \d+/m,
  },
  {
    language: 'python',
    label: 'a .py filename',
    weight: 1,
    pattern: /\b[\w.-]+\.py\b/i,
  },
  {
    language: 'python',
    label: 'a Python command',
    weight: 1,
    pattern: /^\s*python(?:\d+(?:\.\d+)*)?\s+\S+/mi,
  },
  {
    language: 'javascript',
    label: 'a JavaScript stack frame with file positions',
    weight: 3,
    pattern: /[^\s()]+\.(?:js|mjs|cjs|jsx|ts|tsx):\d+:\d+/i,
  },
  {
    language: 'javascript',
    label: 'JavaScript-style stack frames',
    weight: 2,
    pattern: /^\s+at\s+\S+/m,
  },
  {
    language: 'javascript',
    label: 'Node.js internal frames',
    weight: 2,
    pattern: /\bnode:internal\b/i,
  },
  {
    language: 'javascript',
    label: 'a Node.js command',
    weight: 1,
    pattern: /\b(?:node|nodejs)\s+\S+/i,
  },
  {
    language: 'javascript',
    label: 'an Uncaught console prefix',
    weight: 1,
    pattern: /^\s*Uncaught\s+(?:\(in promise\)\s+)?/m,
  },
  {
    language: 'javascript',
    label: 'a .js or .ts filename',
    weight: 1,
    pattern: /\b[\w.-]+\.(?:js|mjs|cjs|jsx|ts|tsx)\b/i,
  },
  {
    language: 'javascript',
    label: 'a Node.js error code',
    weight: 2,
    pattern: /\b(?:ERR_MODULE_NOT_FOUND|EADDRINUSE|EACCES|EPERM|ENOENT)\b/,
  },
  {
    language: 'javascript',
    label: 'a Node.js require stack',
    weight: 2,
    pattern: /^Require stack:\s*$/m,
  },
  {
    language: 'javascript',
    label: 'a network error message',
    weight: 2,
    pattern:
      /(?:TypeError: (?:Failed to fetch|NetworkError when attempting to fetch resource|Load failed|fetch failed)\b|net::ERR_|has been blocked by CORS policy)/,
  },
  {
    language: 'javascript',
    label: 'a JSON parser error message',
    weight: 2,
    pattern:
      /(?:is not valid JSON|JSON\.parse|JSON Parse error|in JSON at position|Unexpected end of JSON input)/,
  },
  {
    language: 'javascript',
    label: 'a React error message',
    weight: 2,
    pattern:
      /(?:Invalid hook call|Objects are not valid as a React child|Too many re-renders|Maximum update depth exceeded)/,
  },
  {
    language: 'javascript',
    label: 'a TypeScript compiler error code',
    weight: 2,
    pattern: /(?:^|\s)error TS\d{3,5}:/,
  },
  {
    language: 'javascript',
    label: 'an editor TypeScript marker',
    weight: 2,
    pattern: /\.[cm]?[jt]sx?\((?:\d{3,5})\)\s*$/i,
  },
  {
    language: 'javascript',
    label: 'an npm log line',
    weight: 2,
    // "ERR!" ends on punctuation, so the boundary has to be the whitespace.
    pattern: /^npm (?:ERR!|error)(?:\s|$)/m,
  },
]

export function diagnose(input: DiagnosticInput): DiagnosticResult {
  const request = input as unknown
  if (typeof request !== 'object' || request === null) {
    return unrecognized(
      'The diagnostic request was not readable, so no cause can be determined.',
      'No readable diagnostic request was supplied.',
    )
  }

  const record = request as Record<string, unknown>
  if (
    typeof record.language !== 'string' ||
    !SUPPORTED_LANGUAGES.includes(record.language as DiagnosticLanguage)
  ) {
    return unrecognized(
      'The requested language is not supported, so no cause can be determined.',
      'Only auto, Python, and JavaScript requests are supported.',
    )
  }

  if (typeof record.errorText !== 'string') {
    return unrecognized(
      'The error text was not readable text, so no cause can be determined.',
      'The error text must be plain text containing the final exception line.',
    )
  }

  const errorText = record.errorText
  if (errorText.trim() === '') {
    return unrecognized(
      'No error text was provided, so no cause can be determined.',
      'Add the final exception line to receive a supported diagnosis.',
    )
  }

  if (errorText.length > MAX_ERROR_TEXT_LENGTH) {
    return unrecognized(
      `The error text is longer than ${MAX_ERROR_TEXT_LENGTH.toLocaleString()} characters, so no cause can be determined.`,
      `The engine did not analyze text over ${MAX_ERROR_TEXT_LENGTH.toLocaleString()} characters.`,
    )
  }

  const language = record.language as DiagnosticLanguage
  const codeSnippet =
    typeof record.codeSnippet === 'string' ? record.codeSnippet : ''
  const reproductionDetails =
    typeof record.reproductionDetails === 'string'
      ? record.reproductionDetails
      : ''
  const selectedLine = selectExceptionLine(errorText)

  if (!selectedLine) {
    return unrecognized(
      'No exception line was found in the supplied text, so no cause can be determined.',
      'The supplied text did not contain a readable exception line.',
    )
  }

  const primaryLine = stripConsolePrefix(selectedLine.text)
  const candidatesByLanguage = collectCandidates(primaryLine)
  mergeContextCandidates(
    candidatesByLanguage,
    collectContextCandidates(primaryLine, errorText, selectedLine),
  )
  const signals = collectLanguageSignals(errorText, reproductionDetails)
  const outcome = chooseSelection(language, candidatesByLanguage, signals)
  let selection: CandidateSelection | null =
    outcome.kind === 'match' ? outcome.selection : null

  if (
    selection === null &&
    outcome.kind === 'none' &&
    candidatesByLanguage.python.length === 0 &&
    candidatesByLanguage.javascript.length === 0
  ) {
    selection = selectNeutralCandidate(primaryLine, errorText, selectedLine)
  }

  if (selection === null) {
    if (outcome.kind === 'ambiguous') {
      return unrecognized(
        'The final exception line has a signature shared by Python and JavaScript, and there is not enough evidence to determine the runtime.',
        'Add the traceback header or JavaScript stack frame surrounding the error line so the language can be identified.',
        {
          confidenceReason:
            'No language-specific evidence was available, so no cause has been inferred.',
          alternativeExplanations: [
            'The error could come from a Python runtime.',
            'The error could come from a JavaScript runtime.',
          ],
        },
      )
    }

    if (language !== 'auto') {
      const otherLanguage = oppositeLanguage(language)
      const otherMatch = candidatesByLanguage[otherLanguage].length > 0
      return unrecognized(
        `No supported ${LANGUAGE_LABELS[language]} signature matched the final exception line, so no cause can be determined.`,
        otherMatch
          ? `The text resembles a ${LANGUAGE_LABELS[otherLanguage]} signature, but ${LANGUAGE_LABELS[language]} was selected, so the engine did not switch languages.`
          : `No supported ${LANGUAGE_LABELS[language]} signature matched "${selectedLine.text}".`,
      )
    }

    return unrecognized(
      'No supported exception signature was found, so no cause can be determined.',
      `No supported signature matched "${selectedLine.text}".`,
    )
  }

  const context: RuleContext = {
    primaryLine,
    errorText,
    codeSnippet,
    reproductionDetails,
  }
  const narrative = selection.candidate.rule.explain(
    selection.candidate.match,
    context,
  )
  const competingLanguage =
    selection.language === 'neutral'
      ? null
      : oppositeLanguage(selection.language)
  const hasCompetingCandidate =
    competingLanguage !== null &&
    candidatesByLanguage[competingLanguage].length > 0
  const confidence = applyConfidenceCeiling(
    buildConfidence(
      selection,
      signals,
      hasCompetingCandidate ? competingLanguage : null,
    ),
    selection.candidate.match,
  )

  return {
    category: selection.candidate.rule.category,
    matchedSignature: selection.candidate.match.signature,
    likelyCause: narrative.likelyCause,
    evidence: buildEvidence(
      selectedLine,
      selection.candidate.match,
      codeSnippet,
      selection.candidate.contextLine,
    ),
    debuggingSteps: narrative.debuggingSteps,
    possibleFix: narrative.possibleFix,
    verificationSteps: narrative.verificationSteps,
    confidence,
    limitations: [...narrative.limitations, SAFETY_LIMITATION],
    alternativeExplanations: narrative.alternativeExplanations,
  }
}

function collectCandidates(primaryLine: string): CandidateGroups {
  const groups: CandidateGroups = { python: [], javascript: [] }

  for (const rule of LANGUAGE_RULES) {
    const match = rule.match(primaryLine)
    if (match) {
      groups[rule.language].push({ rule, match })
    }
  }

  groups.python = applySupersedes(groups.python)
  groups.javascript = applySupersedes(groups.javascript)

  return groups
}

function applySupersedes(
  candidates: EvaluatedCandidate[],
): EvaluatedCandidate[] {
  const superseded = new Set<string>()

  for (const candidate of candidates) {
    for (const id of candidate.rule.supersedes ?? []) {
      if (candidates.some((other) => other.rule.id === id)) {
        superseded.add(id)
      }
    }
  }

  return superseded.size === 0
    ? candidates
    : candidates.filter((candidate) => !superseded.has(candidate.rule.id))
}

function collectContextCandidates(
  primaryLine: string,
  errorText: string,
  selectedLine: SelectedLine,
): CandidateGroups {
  const groups: CandidateGroups = { python: [], javascript: [] }
  const lines = errorText.split(/\r?\n/)

  for (const rule of LANGUAGE_RULES) {
    if (
      !rule.contextSymptoms ||
      !rule.contextSymptoms.some((symptom) => symptom.test(primaryLine))
    ) {
      continue
    }

    const step = rule.firstMatchWins ? 1 : -1
    for (
      let index = rule.firstMatchWins ? 0 : lines.length - 1;
      index >= 0 && index < lines.length;
      index += step
    ) {
      if (index === selectedLine.lineNumber - 1) {
        continue
      }

      const text = stripConsolePrefix(lines[index].trim())
      if (text === '') {
        continue
      }

      const match = rule.match(text)
      if (!match) {
        continue
      }

      groups[rule.language].push({
        rule,
        match,
        contextLine: { text: lines[index].trim(), lineNumber: index + 1 },
      })
      break
    }
  }

  return groups
}

function mergeContextCandidates(
  groups: CandidateGroups,
  contextGroups: CandidateGroups,
): void {
  for (const language of ['python', 'javascript'] as const) {
    for (const contextCandidate of contextGroups[language]) {
      const index = groups[language].findIndex(
        (candidate) => candidate.rule.id === contextCandidate.rule.id,
      )
      if (index === -1) {
        groups[language].push(contextCandidate)
        continue
      }
      if (
        groups[language][index].match.signature !==
          contextCandidate.match.signature ||
        contextCandidate.rule.firstMatchWins
      ) {
        groups[language][index] = contextCandidate
      }
    }
  }
}

/**
 * A neutral rule describes a tool that has no programming language, so it reads
 * the whole paste: every line it recognises becomes a candidate, the most
 * specific line wins, and between two equally specific lines the lower one
 * wins, because a tool repeats the outcome last. Lines the engine will never
 * select as the error line are never scanned either.
 */
function selectNeutralCandidate(
  primaryLine: string,
  errorText: string,
  selectedLine: SelectedLine,
): CandidateSelection | null {
  const candidates = applySupersedes(
    collectNeutralCandidates(primaryLine, errorText, selectedLine),
  )
  let best: EvaluatedCandidate | null = null

  for (const candidate of candidates) {
    if (
      best === null ||
      specificityScore(candidate.match) >= specificityScore(best.match)
    ) {
      best = candidate
    }
  }

  if (best === null) {
    return null
  }

  return { candidate: best, language: 'neutral', certainty: 'neutral' }
}

function collectNeutralCandidates(
  primaryLine: string,
  errorText: string,
  selectedLine: SelectedLine,
): EvaluatedCandidate[] {
  const candidates: EvaluatedCandidate[] = []
  const lines = errorText.split(/\r?\n/)

  for (const rule of NEUTRAL_RULES) {
    for (const [index, rawLine] of lines.entries()) {
      const text = rawLine.trim()
      if (text === '' || isSummaryTrailer(text)) {
        continue
      }

      const isPrimary = index === selectedLine.lineNumber - 1
      const match = rule.match(isPrimary ? primaryLine : text)
      if (match === null) {
        continue
      }

      candidates.push({
        rule,
        match,
        contextLine: isPrimary
          ? undefined
          : { text, lineNumber: index + 1 },
      })
    }
  }

  return candidates
}

function isSummaryTrailer(text: string): boolean {
  return SUMMARY_TRAILERS.some((trailer) => trailer.test(text))
}

function chooseSelection(
  language: DiagnosticLanguage,
  groups: CandidateGroups,
  signals: LanguageSignals,
): SelectionOutcome {
  const pythonBest = bestCandidate(groups.python)
  const javascriptBest = bestCandidate(groups.javascript)

  if (language !== 'auto') {
    const best = language === 'python' ? pythonBest : javascriptBest
    if (!best) {
      return { kind: 'none' }
    }

    const otherLanguage = oppositeLanguage(language)
    const ownScore = signalScore(signals[language])
    const otherScore = signalScore(signals[otherLanguage])
    let certainty: LanguageCertainty = 'explicit'
    let conflictDetail: string | undefined

    if (otherScore >= 2 && otherScore > ownScore + 1) {
      certainty = 'conflict'
      conflictDetail = `${formatSignalLabels(
        signals[otherLanguage],
      )} that ${signalVerb(
        signals[otherLanguage],
        'point',
        'points',
      )} to ${LANGUAGE_LABELS[otherLanguage]}`
    } else if (ownScore >= 2 && otherScore >= 2) {
      certainty = 'conflict'
      conflictDetail =
        'evidence in the surrounding text for both Python and JavaScript'
    }

    return {
      kind: 'match',
      selection: { candidate: best, language, certainty, conflictDetail },
    }
  }

  const inferredLanguage = inferLanguage(signals)
  if (inferredLanguage) {
    const inferredBest =
      inferredLanguage === 'python' ? pythonBest : javascriptBest
    const otherLanguage = oppositeLanguage(inferredLanguage)
    const otherBest =
      otherLanguage === 'python' ? pythonBest : javascriptBest

    if (inferredBest) {
      if (
        otherBest &&
        specificityScore(otherBest.match) > specificityScore(inferredBest.match)
      ) {
        return {
          kind: 'match',
          selection: {
            candidate: otherBest,
            language: otherLanguage,
            certainty: 'conflict',
            conflictDetail: `${formatSignalLabels(
              signals[inferredLanguage],
            )} that ${signalVerb(
              signals[inferredLanguage],
              'point',
              'points',
            )} to ${LANGUAGE_LABELS[inferredLanguage]}, but the final line has a more specific ${
              LANGUAGE_LABELS[otherLanguage]
            } signature`,
          },
        }
      }

      const conflictingSignals =
        signalScore(signals.python) >= 2 &&
        signalScore(signals.javascript) >= 2

      return {
        kind: 'match',
        selection: {
          candidate: inferredBest,
          language: inferredLanguage,
          certainty: conflictingSignals ? 'conflict' : 'trace',
          conflictDetail: conflictingSignals
            ? 'evidence in the surrounding text for both Python and JavaScript'
            : undefined,
        },
      }
    }

    if (otherBest) {
      return {
        kind: 'match',
        selection: {
          candidate: otherBest,
          language: otherLanguage,
          certainty: 'conflict',
          conflictDetail: `${formatSignalLabels(
            signals[inferredLanguage],
          )} that ${signalVerb(
            signals[inferredLanguage],
            'point',
            'points',
          )} to ${LANGUAGE_LABELS[inferredLanguage]}, but no supported ${
            LANGUAGE_LABELS[inferredLanguage]
          } signature matched the final line`,
        },
      }
    }

    return { kind: 'none' }
  }

  if (pythonBest && javascriptBest) {
    const pythonSpecificity = specificityScore(pythonBest.match)
    const javascriptSpecificity = specificityScore(javascriptBest.match)

    if (pythonSpecificity === javascriptSpecificity) {
      return { kind: 'ambiguous' }
    }

    const [best, otherLanguage] =
      pythonSpecificity > javascriptSpecificity
        ? [pythonBest, 'javascript' as const]
        : [javascriptBest, 'python' as const]
    const selectedLanguage = otherLanguage === 'python' ? 'javascript' : 'python'

    return {
      kind: 'match',
      selection: {
        candidate: best,
        language: selectedLanguage,
        certainty: 'specificity',
        conflictDetail: `the line also matches a more generic ${LANGUAGE_LABELS[otherLanguage]} rule`,
      },
    }
  }

  if (pythonBest) {
    return {
      kind: 'match',
      selection: {
        candidate: pythonBest,
        language: 'python',
        certainty: 'signature',
      },
    }
  }

  if (javascriptBest) {
    return {
      kind: 'match',
      selection: {
        candidate: javascriptBest,
        language: 'javascript',
        certainty: 'signature',
      },
    }
  }

  return { kind: 'none' }
}

function buildConfidence(
  selection: CandidateSelection,
  signals: LanguageSignals,
  competingLanguage: ResolvedLanguage | null,
): DiagnosticConfidence {
  if (selection.language === 'neutral') {
    return neutralConfidence(selection.candidate)
  }

  const languageLabel = LANGUAGE_LABELS[selection.language]
  const otherLabel = competingLanguage
    ? LANGUAGE_LABELS[competingLanguage]
    : null
  const matchingSignals = formatSignalLabels(signals[selection.language])
  const competingNote =
    otherLabel && selection.certainty !== 'specificity'
      ? ` A competing ${otherLabel} signature was also considered.`
      : ''
  const contextLine = selection.candidate.contextLine
  const specificSignatureText = contextLine
    ? `A specific ${languageLabel} message on line ${contextLine.lineNumber} explains the final line`
    : `The final exception line contains a specific ${languageLabel} signature`
  const genericSignatureText = contextLine
    ? `A ${languageLabel} message on line ${contextLine.lineNumber} explains the final line, but it is a generic error shape`
    : `The final exception line is a generic ${languageLabel} error shape`

  if (selection.certainty === 'conflict') {
    return {
      level: 'low',
      reason: `The ${languageLabel} signature conflicts with ${
        selection.conflictDetail ?? 'the surrounding language evidence'
      }. Treat this match as uncertain.${competingNote}`,
    }
  }

  if (selection.certainty === 'explicit') {
    return selection.candidate.match.specificity === 'specific'
      ? {
          level: 'high',
          reason: `${specificSignatureText}, and ${languageLabel} was selected explicitly.${competingNote}`,
        }
      : {
          level: 'medium',
          reason: `${genericSignatureText}. The explicit language narrows the runtime, but the message has fewer identifying details.${competingNote}`,
        }
  }

  if (selection.certainty === 'trace') {
    const verb = signalVerb(signals[selection.language], 'support', 'supports')
    return selection.candidate.match.specificity === 'specific'
      ? {
          level: 'high',
          reason: `${specificSignatureText}, and ${matchingSignals} ${verb} the ${languageLabel} runtime.${competingNote}`,
        }
      : {
          level: 'medium',
          reason: `${genericSignatureText}. ${startSentence(
            matchingSignals,
          )} ${verb} ${languageLabel}, but the specific cause remains less certain.${competingNote}`,
        }
  }

  if (selection.certainty === 'specificity') {
    return {
      level:
        selection.candidate.match.specificity === 'specific' ? 'medium' : 'low',
      reason: contextLine
        ? `A ${languageLabel} message on line ${contextLine.lineNumber} explains the final line more specifically than the competing ${otherLabel ?? 'other'} match, but no traceback or explicit language confirms the runtime.`
        : `The final exception line has a more specific ${languageLabel} signature than the competing ${otherLabel ?? 'other'} match, but no traceback or explicit language confirms the runtime.`,
    }
  }

  return {
    level: selection.candidate.match.specificity === 'specific' ? 'medium' : 'low',
    reason:
      selection.candidate.match.specificity === 'specific'
        ? `${specificSignatureText}, but no traceback or explicit language setting confirms the runtime.${competingNote}`
        : `${genericSignatureText}, and no traceback or explicit language setting confirms the runtime.${competingNote}`,
  }
}

const CONFIDENCE_ORDER: readonly DiagnosticConfidence['level'][] = [
  'low',
  'medium',
  'high',
]

/**
 * A tool writes its own messages, so a neutral match is judged on the signature
 * only: language clues never raise it and a selected language never lowers it.
 * The wording names the failing command, never a programming language.
 */
function neutralConfidence(
  candidate: EvaluatedCandidate,
): DiagnosticConfidence {
  const contextLine = candidate.contextLine
  const specific = candidate.match.specificity === 'specific'

  if (specific) {
    return {
      level: 'high',
      reason: contextLine
        ? `A message the failing command wrote itself appears on line ${contextLine.lineNumber}, and a specific signature recognises it, so no language evidence was needed.`
        : 'The final line is a message the failing command wrote itself, and a specific signature recognises it, so no language evidence was needed.',
    }
  }

  return {
    level: 'low',
    reason: contextLine
      ? `An error line from the failing command appears on line ${contextLine.lineNumber}, but no specific signature covers it, so it is quoted rather than explained.`
      : 'The final line is an error line from the failing command, but no specific signature covers it, so it is quoted rather than explained.',
  }
}

function applyConfidenceCeiling(
  confidence: DiagnosticConfidence,
  match: RuleMatch,
): DiagnosticConfidence {
  const ceiling = match.confidenceCeiling
  if (
    !ceiling ||
    CONFIDENCE_ORDER.indexOf(confidence.level) <=
      CONFIDENCE_ORDER.indexOf(ceiling)
  ) {
    return confidence
  }

  return {
    level: ceiling,
    reason: `${confidence.reason} The matched wording is generic, so the confidence is capped at ${ceiling}.`,
  }
}

const IDENTIFIER_CHARACTERS = 'A-Za-z0-9_$'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wholeIdentifierPattern(token: string): RegExp {
  return new RegExp(
    `(?:^|[^${IDENTIFIER_CHARACTERS}])${escapeRegExp(token)}(?![${IDENTIFIER_CHARACTERS}])`,
  )
}

function buildEvidence(
  selectedLine: SelectedLine,
  match: RuleMatch,
  codeSnippet: string,
  contextLine?: SelectedLine,
): DiagnosticEvidence[] {
  const evidence: DiagnosticEvidence[] = [
    {
      source: 'error text',
      label: 'Final exception line',
      quote: selectedLine.text,
      lineNumber: selectedLine.lineNumber,
    },
  ]

  if (contextLine) {
    evidence.push({
      source: 'error text',
      label: 'Matched context line',
      quote: contextLine.text,
      lineNumber: contextLine.lineNumber,
    })
  }

  if (codeSnippet.trim() === '') {
    return evidence
  }

  const tokens = Object.entries(match.captures)
    .filter(([key, value]) => key !== 'detail' && key !== 'reason' && value.length >= 3)
    .map(([, value]) => value)

  if (tokens.length === 0) {
    return evidence
  }

  const patterns = tokens.map(wholeIdentifierPattern)
  const lines = codeSnippet.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const quote = line.trim()
    if (quote !== '' && patterns.some((pattern) => pattern.test(quote))) {
      evidence.push({
        source: 'code snippet',
        label: 'Related line from the supplied code',
        quote,
        lineNumber: index + 1,
      })
      break
    }
  }

  return evidence
}

function collectLanguageSignals(
  errorText: string,
  reproductionDetails: string,
): LanguageSignals {
  const text = reproductionDetails
    ? `${errorText}\n${reproductionDetails}`
    : errorText
  const signals: LanguageSignals = { python: [], javascript: [] }

  for (const signal of LANGUAGE_SIGNALS) {
    if (signal.pattern.test(text)) {
      signals[signal.language].push({
        label: signal.label,
        weight: signal.weight,
      })
    }
  }

  return signals
}

function inferLanguage(signals: LanguageSignals): ResolvedLanguage | null {
  const pythonScore = signalScore(signals.python)
  const javascriptScore = signalScore(signals.javascript)

  if (pythonScore >= 2 && pythonScore - javascriptScore >= 2) {
    return 'python'
  }

  if (javascriptScore >= 2 && javascriptScore - pythonScore >= 2) {
    return 'javascript'
  }

  return null
}

function signalScore(signals: LanguageSignal[]): number {
  return signals.reduce((total, signal) => total + signal.weight, 0)
}

function formatSignalLabels(signals: LanguageSignal[]): string {
  const labels = distinctSignalLabels(signals)
  if (labels.length === 0) {
    return 'the matched signature'
  }
  if (labels.length === 1) {
    return labels[0]
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

function distinctSignalLabels(signals: LanguageSignal[]): string[] {
  return Array.from(new Set(signals.map((signal) => signal.label)))
}

/**
 * The clue list is the grammatical subject of these sentences, so the verb has
 * to agree with how many distinct clues it names.
 */
function signalVerb(
  signals: LanguageSignal[],
  plural: string,
  singular: string,
): string {
  return distinctSignalLabels(signals).length > 1 ? plural : singular
}

function startSentence(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function bestCandidate(
  candidates: EvaluatedCandidate[],
): EvaluatedCandidate | undefined {
  return candidates.reduce<EvaluatedCandidate | undefined>(
    (best, candidate) =>
      !best || candidateScore(candidate) > candidateScore(best)
        ? candidate
        : best,
    undefined,
  )
}

function candidateScore(candidate: EvaluatedCandidate): number {
  const contextBonus =
    candidate.contextLine !== undefined &&
    candidate.match.specificity === 'specific'
      ? 2
      : 0
  return contextBonus + specificityScore(candidate.match)
}

function specificityScore(match: RuleMatch): number {
  return match.specificity === 'specific' ? 2 : 1
}

function oppositeLanguage(language: ResolvedLanguage): ResolvedLanguage {
  return language === 'python' ? 'javascript' : 'python'
}

function selectExceptionLine(errorText: string): SelectedLine | null {
  const lines = errorText.split(/\r?\n/)
  let lastNonEmpty: SelectedLine | null = null
  let lastException: SelectedLine | null = null
  let lastNodeError: SelectedLine | null = null
  let insideReactTrailer = false

  lines.forEach((line, index) => {
    const text = line.trim()
    if (text === '') {
      return
    }

    if (REACT_COMPONENT_TRAILER.test(text)) {
      insideReactTrailer = true
      return
    }

    if (REACT_BOUNDARY_TRAILER.test(text)) {
      insideReactTrailer = false
      return
    }

    if (SUMMARY_TRAILERS.some((trailer) => trailer.test(text))) {
      return
    }

    if (insideReactTrailer) {
      if (/^\s/.test(line)) {
        return
      }
      insideReactTrailer = false
    }

    lastNonEmpty = { text, lineNumber: index + 1 }
    if (EXCEPTION_LINE.test(text)) {
      lastException = { text, lineNumber: index + 1 }
    } else if (NODE_ERROR_LINE.test(text)) {
      lastNodeError = { text, lineNumber: index + 1 }
    }
  })

  return lastException ?? lastNodeError ?? lastNonEmpty
}

function stripConsolePrefix(line: string): string {
  return line.replace(/^Uncaught\s+(?:\(in promise\)\s+)?/, '')
}

function unrecognized(
  likelyCause: string,
  limitation: string,
  options: UnrecognizedOptions = {},
): DiagnosticResult {
  return {
    category: 'unrecognized',
    matchedSignature: null,
    likelyCause,
    evidence: [],
    debuggingSteps: [...GENERAL_DEBUGGING_STEPS],
    possibleFix: null,
    verificationSteps: [...GENERAL_VERIFICATION_STEPS],
    confidence: {
      level: 'low',
      reason:
        options.confidenceReason ??
        'No supported exception signature was matched, so no cause has been inferred.',
    },
    limitations: [limitation, SAFETY_LIMITATION],
    alternativeExplanations: options.alternativeExplanations ?? [],
  }
}
