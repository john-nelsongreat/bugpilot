import type { DiagnosticConfidence } from '../../../diagnostics/types'
import {
  ALL_TEXT_LANGUAGES,
  MAX_RULE_HITS,
  lineEvidence,
  lineIndexAt,
  manualFix,
  rangeFromOffsets,
} from './context'
import type { AnalyzerRule, RuleFile, RuleHit } from './types'

/**
 * Invisible characters that change how a line is READ. A bidi control character can make the
 * rendered line say the opposite of what it compiles to; a zero-width character can hide inside an
 * identifier or a string. The evidence and messages never print the character itself — they show
 * its escape, because a character whose whole attack is being invisible must not be rendered raw.
 */

const BIDI_NAMES: Readonly<Record<string, string>> = {
  '\u202a': 'LEFT-TO-RIGHT EMBEDDING',
  '\u202b': 'RIGHT-TO-LEFT EMBEDDING',
  '\u202c': 'POP DIRECTIONAL FORMATTING',
  '\u202d': 'LEFT-TO-RIGHT OVERRIDE',
  '\u202e': 'RIGHT-TO-LEFT OVERRIDE',
  '\u2066': 'LEFT-TO-RIGHT ISOLATE',
  '\u2067': 'RIGHT-TO-LEFT ISOLATE',
  '\u2068': 'FIRST STRONG ISOLATE',
  '\u2069': 'POP DIRECTIONAL ISOLATE',
}

const ZERO_WIDTH_NAMES: Readonly<Record<string, string>> = {
  '\u200b': 'ZERO WIDTH SPACE',
  '\u200c': 'ZERO WIDTH NON-JOINER',
  '\u200d': 'ZERO WIDTH JOINER',
  '\u2060': 'WORD JOINER',
  '\ufeff': 'ZERO WIDTH NO-BREAK SPACE (BOM)',
}

const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g
const ZERO_WIDTH_CHARS = /[\u200b-\u200d\u2060\ufeff]/g
/** Every invisible character the evidence renders as an escape, plus the RLM/LRM marks. */
const INVISIBLE_ESCAPED = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g

const PROSE_LIKE_EXTENSION = /\.(?:md|markdown|txt|html?)$/i
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

function escapeFor(codepoint: number): string {
  return `\\u${codepoint.toString(16).padStart(4, '0')}`
}

function escapedLine(line: string): string {
  return line.replace(INVISIBLE_ESCAPED, (character) => escapeFor(character.charCodeAt(0)))
}

function nameOf(table: Readonly<Record<string, string>>, character: string): string {
  const name = table[character]
  return name ? ` (${name})` : ''
}

function isProseLike(file: RuleFile): boolean {
  return PROSE_LIKE_EXTENSION.test(file.file)
}

const BIDI_CONFIDENCE: DiagnosticConfidence = {
  level: 'medium',
  reason:
    'The control character is certain, but BugPilot cannot tell from the bytes alone whether the reordering hides hostile code or is the leftover of a legitimate right-to-left edit.',
}

const ZERO_WIDTH_CONFIDENCE: DiagnosticConfidence = {
  level: 'medium',
  reason:
    'The character is certain, but zero-width joiners and non-joiners also occur in emoji sequences and some scripts, and only uses outside those are reported.',
}

function bidiHit(file: RuleFile, index: number, character: string): RuleHit {
  const lineIndex = lineIndexAt(file.lineStarts, index)
  return {
    range: rangeFromOffsets(file.lineStarts, index, index + 1),
    message: `Bidirectional control character ${escapeFor(character.charCodeAt(0))}${nameOf(BIDI_NAMES, character)}.`,
    explanation:
      'This character changes the direction in which the rest of the line is read. Source that looks innocuous when rendered can compile differently, which is how a reviewer is shown safe code while the compiler sees something else.',
    confidence: BIDI_CONFIDENCE,
    severity: isProseLike(file) ? 'Low' : undefined,
    evidence: [lineEvidence(file, lineIndex, escapedLine(file.lines[lineIndex] ?? ''))],
    fix: manualFix(
      'Delete the control character. If the line genuinely mixes right-to-left and left-to-right text, rewrite it so the order is explicit without a control character.',
      'The line holding the character; the escape shown in the message is what to search for.',
      'needs-review',
      'Removing a bidi control changes how the line renders, so the author should confirm the visible text still says what it should.',
    ),
    verificationSteps: [
      'Search the file for the escape shown in the message.',
      'Read the line the way it renders and the way it is stored, and decide which is correct.',
      'Delete the control character and re-run the analysis.',
    ],
    limitations: [
      'Only the nine bidi control characters U+202A-202E and U+2066-2069 are reported. Right-to-left text made of letters, marks and the RLM/LRM marks U+200E/U+200F is not flagged.',
    ],
  }
}

/** Returns the full code point before `index` (pairing a low surrogate with its high one). */
function codePointBefore(text: string, index: number): number {
  if (index === 0) return -1
  const low = text.charCodeAt(index - 1)
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2)
    if (high >= 0xd800 && high <= 0xdbff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000
  }
  return low
}

/** Returns the full code point after `index` (pairing a high surrogate with its low one). */
function codePointAfter(text: string, index: number): number {
  if (index + 1 >= text.length) return -1
  const high = text.charCodeAt(index + 1)
  if (high >= 0xd800 && high <= 0xdbff && index + 2 < text.length) {
    const low = text.charCodeAt(index + 2)
    if (low >= 0xdc00 && low <= 0xdfff) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000
  }
  return high
}

function isEmojiCodePoint(codepoint: number): boolean {
  return (
    (codepoint >= 0x1f000 && codepoint <= 0x1faff) ||
    (codepoint >= 0x1f1e6 && codepoint <= 0x1f1ff) ||
    (codepoint >= 0x2600 && codepoint <= 0x27bf) ||
    (codepoint >= 0x2b00 && codepoint <= 0x2bff) ||
    (codepoint >= 0x2300 && codepoint <= 0x23ff) ||
    (codepoint >= 0x2190 && codepoint <= 0x21ff) ||
    codepoint === 0xfe0f
  )
}

/** A ZWJ between two emoji code points is the glue of a ZWJ emoji sequence, not an attack. */
function insideEmojiSequence(text: string, index: number): boolean {
  return isEmojiCodePoint(codePointBefore(text, index)) && isEmojiCodePoint(codePointAfter(text, index))
}

/** True when the offset sits inside a string on its line, honouring backslash escapes. */
function insideStringOnLine(text: string, lineStart: number, offset: number): boolean {
  let single = 0
  let double = 0
  let backtick = 0
  let escaped = false
  for (let i = lineStart; i < offset; i += 1) {
    const character = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === "'") single += 1
    else if (character === '"') double += 1
    else if (character === '`') backtick += 1
  }
  return single % 2 === 1 || double % 2 === 1 || backtick % 2 === 1
}

/**
 * A line that starts like a comment is prose, not an identifier. The marker set is the common
 * intersection across the languages BugPilot reads; a block comment opened earlier on the same
 * line counts too.
 */
function insideCommentOnLine(line: string, offsetInLine: number): boolean {
  if (/^(?:\/\/|\/\*|\*|#|--|<!--)/.test(line.trimStart())) return true
  const prefix = line.slice(0, offsetInLine)
  const blockOpen = prefix.lastIndexOf('/*')
  return blockOpen !== -1 && prefix.indexOf('*/', blockOpen) === -1
}

function zeroWidthHit(file: RuleFile, index: number, character: string): RuleHit {
  const lineIndex = lineIndexAt(file.lineStarts, index)
  return {
    range: rangeFromOffsets(file.lineStarts, index, index + 1),
    message: `Zero-width character ${escapeFor(character.charCodeAt(0))}${nameOf(ZERO_WIDTH_NAMES, character)}.`,
    explanation:
      'This character takes no space, so it can hide inside an identifier or a string and make the stored text differ from what a reviewer reads. It is reported because it sits inside an identifier or a string literal, outside an emoji sequence.',
    confidence: ZERO_WIDTH_CONFIDENCE,
    evidence: [lineEvidence(file, lineIndex, escapedLine(file.lines[lineIndex] ?? ''))],
    fix: manualFix(
      'Delete the zero-width character. If it is intentional (a ligature break or an invisible separator), replace it with an escape or a comment that a reviewer can see.',
      'The line holding the character; the escape shown in the message is what to search for.',
      'needs-review',
      'Zero-width joiners and non-joiners are meaningful in some scripts, so the author should confirm the character was not doing work before it is removed.',
    ),
    verificationSteps: [
      'Search the file for the escape shown in the message.',
      'Confirm the character is not part of a ligature, emoji sequence or other intentional form.',
      'Delete it and re-run the analysis.',
    ],
    limitations: [
      'Only zero-width characters inside identifiers or string literals are reported; occurrences in comments, plain text files and markdown prose are ignored, and a ZWJ inside an emoji sequence is not flagged.',
      'A line that starts with a common comment marker is treated as a comment even in languages where the marker can also open code.',
      'The RLM/LRM marks U+200E/U+200F are directional marks of ordinary right-to-left text and are never reported.',
    ],
  }
}

const bidiRule: AnalyzerRule = {
  id: 'bugpilot/generic/bidi-control-character',
  title: 'Bidirectional control character',
  tier: 'pattern',
  severity: 'High',
  languages: ALL_TEXT_LANGUAGES,
  description:
    'Finds the bidi control characters U+202A-202E and U+2066-2069, which can make a line render differently from the way it compiles.',
  check: (file) => {
    const hits: RuleHit[] = []
    BIDI_CONTROLS.lastIndex = 0
    for (const match of file.text.matchAll(BIDI_CONTROLS)) {
      if (hits.length >= MAX_RULE_HITS) break
      hits.push(bidiHit(file, match.index ?? 0, match[0]))
    }
    return hits
  },
}

const zeroWidthRule: AnalyzerRule = {
  id: 'bugpilot/generic/zero-width-character',
  title: 'Zero-width character in an identifier or string',
  tier: 'pattern',
  severity: 'Medium',
  languages: ALL_TEXT_LANGUAGES.filter((language) => language !== 'markdown' && language !== 'text'),
  description:
    'Finds the zero-width characters U+200B-200D, U+2060 and a mid-file U+FEFF when they sit inside an identifier or a string literal, outside comments, prose and emoji sequences.',
  check: (file) => {
    // Prose has words, not identifiers; this rule reports hidden characters in code only.
    if (file.language === 'markdown' || file.language === 'text') return []
    const hits: RuleHit[] = []
    ZERO_WIDTH_CHARS.lastIndex = 0
    for (const match of file.text.matchAll(ZERO_WIDTH_CHARS)) {
      if (hits.length >= MAX_RULE_HITS) break
      const index = match.index ?? 0
      const character = match[0]
      if (character === '\ufeff' && index === 0) continue
      if (character === '\u200d' && insideEmojiSequence(file.text, index)) continue
      const lineIndex = lineIndexAt(file.lineStarts, index)
      const lineStart = file.lineStarts[lineIndex] ?? 0
      const line = file.lines[lineIndex] ?? ''
      if (insideCommentOnLine(line, index - lineStart)) continue
      const before = index > 0 ? file.text[index - 1] : ''
      const after = file.text[index + 1] ?? ''
      const touchesIdentifier = IDENTIFIER_CHAR.test(before) || IDENTIFIER_CHAR.test(after)
      if (!touchesIdentifier && !insideStringOnLine(file.text, lineStart, index)) continue
      hits.push(zeroWidthHit(file, index, character))
    }
    return hits
  },
}

export const trojanSourceRules: readonly AnalyzerRule[] = [bidiRule, zeroWidthRule]
