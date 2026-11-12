import { lineEvidence, manualFix, quoteLine } from '../rules/context'
import type { RuleFile } from '../rules/types'
import type { GrammarId } from './assets'
import type { EngineHit } from './protocol'
import { redactCredentialToken, redactIfCredential } from './redact'

/** A `Node` from web-tree-sitter, narrowed to what this module touches. */
export interface SyntaxNode {
  id: number
  type: string
  startIndex: number
  endIndex: number
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  text: string
  childCount: number
  isError: boolean
  isMissing: boolean
  hasError: boolean
  child(index: number): SyntaxNode | null
}

export const MAX_SYNTAX_HITS_PER_FILE = 12

/**
 * Grammars that produced false syntax errors on known-valid files in the spike (S4):
 * DerekStride SQL rejected `reporting_queries.sql:28` and the YAML grammar rejected
 * `service-config.yml:1`. Their verdict is recorded as coverage, never as a bug.
 */
export const UNTRUSTED_SYNTAX_GRAMMARS = new Set(['sql', 'yaml'])

function safeQuote(line: string): string {
  return redactIfCredential(quoteLine(line))
}

interface ErrorRegion {
  node: SyntaxNode
  /** true when the grammar expected a specific token here. */
  missing: boolean
}

/**
 * Top-level error regions only: descending into an ERROR node reports the parser's own
 * confusion as if it were the user's bug, and multiplies one mistake into dozens.
 */
export function collectErrorRegions(root: SyntaxNode): ErrorRegion[] {
  const regions: ErrorRegion[] = []
  const seen = new Set<number>()

  const visit = (node: SyntaxNode): void => {
    if (!node.hasError && !node.isError && !node.isMissing) return
    if (node.isError || node.isMissing) {
      if (!seen.has(node.id)) {
        seen.add(node.id)
        regions.push({ node, missing: node.isMissing })
      }
      return
    }
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index)
      if (child) visit(child as unknown as SyntaxNode)
    }
  }

  visit(root)
  return regions.sort(
    (left, right) => left.node.startIndex - right.node.startIndex || left.node.id - right.node.id,
  )
}

/** `MISSING ")"` and `MISSING fi` both name the token the grammar wanted. */
function expectedToken(node: SyntaxNode): string {
  const name = node.type.replace(/^MISSING\s*/, '').trim()
  if (name === '') return 'a token'
  return `"${name.replace(/^["']|["']$/g, '')}"`
}

function firstToken(node: SyntaxNode): string {
  const raw = node.text.replace(/\s+/g, ' ').trim()
  if (raw === '') return 'end of file'
  // Redact before truncating: the first 24 characters of a token can be the secret.
  const token = redactCredentialToken(raw.split(' ')[0] ?? '')
  return token.length > 24 ? `${token.slice(0, 24)}…` : token
}

// --- second location: the block the parser could not close ---

interface LexerConfig {
  lineComments: readonly string[]
  blockComments: readonly { start: string; end: string }[]
  strings: readonly { quote: string; escape?: string }[]
}

const C_STYLE: LexerConfig = {
  lineComments: ['//'],
  blockComments: [{ start: '/*', end: '*/' }],
  strings: [
    { quote: '"', escape: '\\' },
    { quote: "'", escape: '\\' },
  ],
}

const QUOTED_STYLE: LexerConfig = {
  lineComments: [],
  blockComments: [],
  strings: [
    { quote: '"', escape: '\\' },
    { quote: "'", escape: '\\' },
  ],
}

/**
 * CSS as a lexer, distinct from `C_STYLE`: plain CSS has no `//` line comment, yet `//` appears
 * routinely inside `url(http://…)` and `url(//cdn…)`. Treating it as a comment (which `C_STYLE`
 * does) makes the delimiter scan jump to end-of-line there, hiding the rest of that line's
 * braces and the `)` of the `url(`, so `findUnclosedOpener` reports a balanced file as broken.
 * That corrupts the whole-file balance probe that decides whether a crossing at-rule region is a
 * harmless grammar leak or a real unfinished block, and it makes a valid dialect file look
 * un-understood. Block comments and quoted strings are kept identical to `C_STYLE`.
 */
const CSS_STYLE: LexerConfig = {
  lineComments: [],
  blockComments: [{ start: '/*', end: '*/' }],
  strings: [
    { quote: '"', escape: '\\' },
    { quote: "'", escape: '\\' },
  ],
}

const LEXERS: Partial<Record<GrammarId, LexerConfig>> = {
  c: C_STYLE,
  cpp: C_STYLE,
  c_sharp: C_STYLE,
  java: C_STYLE,
  go: C_STYLE,
  swift: C_STYLE,
  kotlin: C_STYLE,
  rust: C_STYLE,
  css: CSS_STYLE,
  php: {
    lineComments: ['//', '#'],
    blockComments: [{ start: '/*', end: '*/' }],
    strings: [
      { quote: '"', escape: '\\' },
      { quote: "'", escape: '\\' },
    ],
  },
  python: {
    lineComments: ['#'],
    blockComments: [],
    strings: [
      { quote: '"""', escape: '\\' },
      { quote: "'''", escape: '\\' },
      { quote: '"', escape: '\\' },
      { quote: "'", escape: '\\' },
    ],
  },
  ruby: { lineComments: ['#'], blockComments: [], strings: [{ quote: '"', escape: '\\' }, { quote: "'", escape: '\\' }] },
  bash: { lineComments: ['#'], blockComments: [], strings: [{ quote: '"', escape: '\\' }, { quote: "'", escape: '\\' }] },
  sql: { lineComments: ['--'], blockComments: [{ start: '/*', end: '*/' }], strings: [{ quote: "'" }] },
  yaml: { lineComments: ['#'], blockComments: [], strings: [{ quote: '"' }, { quote: "'" }] },
  html: { lineComments: [], blockComments: [{ start: '<!--', end: '-->' }], strings: [{ quote: '"', escape: '\\' }, { quote: "'", escape: '\\' }] },
}

const OPENING_DELIMITERS = new Set(['(', '{', '['])
const CLOSER_OF: Record<string, string> = { ')': '(', '}': '{', ']': '[' }
// Ruby keywords that open a block closed by `end`. `if`/`unless`/`while`/`until`
// are left out because their modifier forms (`x if y`) need no `end`.
const RUBY_BLOCK_OPENERS = new Set(['begin', 'def', 'do', 'case', 'class', 'module'])

interface OpenBlock {
  opener: string
  line: number
}

/**
 * Scans the text up to `beforeIndex`, skipping strings and comments, and returns
 * the innermost delimiter or ruby block keyword that is still open at that point.
 * The scan is BugPilot's own approximation: heavily broken files can still pick
 * the wrong block, which is why the caller phrases the result as a hint.
 */
function findUnclosedOpener(text: string, beforeIndex: number, grammar: string): OpenBlock | null {
  const config = LEXERS[grammar as GrammarId] ?? QUOTED_STYLE
  const stack: OpenBlock[] = []
  const end = Math.min(Math.max(beforeIndex, 0), text.length)
  let i = 0
  let line = 0

  while (i < end) {
    const ch = text[i]
    if (ch === '\n') {
      line += 1
      i += 1
      continue
    }

    const blockComment = config.blockComments.find((candidate) => text.startsWith(candidate.start, i))
    if (blockComment) {
      const closeAt = text.indexOf(blockComment.end, i + blockComment.start.length)
      if (closeAt === -1 || closeAt + blockComment.end.length > end) break
      line += (text.slice(i, closeAt).match(/\n/g) ?? []).length
      i = closeAt + blockComment.end.length
      continue
    }
    const lineComment = config.lineComments.find((candidate) => text.startsWith(candidate, i))
    if (lineComment) {
      const newlineAt = text.indexOf('\n', i)
      if (newlineAt === -1 || newlineAt >= end) break
      i = newlineAt
      continue
    }
    const string = config.strings.find((candidate) => text.startsWith(candidate.quote, i))
    if (string) {
      i += string.quote.length
      while (i < end) {
        if (text.startsWith(string.quote, i)) {
          i += string.quote.length
          break
        }
        if (string.escape && text[i] === string.escape) {
          i += 2
          continue
        }
        if (text[i] === '\n') line += 1
        i += 1
      }
      continue
    }

    if (grammar === 'ruby' && /[A-Za-z_]/.test(ch)) {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, end))?.[0]
      if (word) {
        const before = i > 0 ? text[i - 1] : '\n'
        if (RUBY_BLOCK_OPENERS.has(word) && before !== '.' && before !== ':') {
          stack.push({ opener: word, line })
        } else if (word === 'end' && before !== '.' && before !== ':') {
          // `end` closes the innermost ruby keyword block. When a delimiter is
          // still open on top the text is already broken, so nothing pops: the
          // delimiter stays the candidate "opened at" location.
          if (stack.length > 0 && RUBY_BLOCK_OPENERS.has(stack[stack.length - 1].opener)) stack.pop()
        }
        i += word.length
        continue
      }
    }

    if (OPENING_DELIMITERS.has(ch)) {
      stack.push({ opener: ch, line })
    } else if (ch in CLOSER_OF) {
      const top = stack[stack.length - 1]
      if (top && top.opener === CLOSER_OF[ch]) stack.pop()
    }
    i += 1
  }

  return stack.length > 0 ? stack[stack.length - 1] : null
}

// --- third location: the CSS dialect the bundled grammar cannot see ---

/**
 * The at-rules defined by the CSS standards track. These are the ones the grammar really
 * implements, so a failure on a listed name stays a finding. Anything else that opens with
 * `@` is a dialect extension point — Tailwind's `@source` and `@variant`, a preprocessor's
 * `@extend`, whatever a framework invents next — and the grammar has no rule for it at all.
 * Listing the standard names, rather than the dialect names, is what keeps this honest: the
 * tolerance is open-ended, so it cannot rot into a per-framework whitelist.
 */
export const KNOWN_CSS_AT_RULES: ReadonlySet<string> = new Set([
  'character-variant',
  'container',
  'counter-style',
  'document',
  'font-face',
  'font-feature-values',
  'font-palette-values',
  'import',
  'keyframes',
  'layer',
  'media',
  'nest',
  'namespace',
  'ornaments',
  'page',
  'position-try',
  'property',
  'scope',
  'starting-style',
  'string',
  'styleset',
  'stylistic',
  'supports',
  'view-transition',
])

/** A `}` or `)` the grammar says is absent is a real mistake, whatever the line opens with. */
const MISSING_CLOSERS = new Set(['}', ')', ']'])

const AT_RULE_OPEN = /^\s*@(?:([A-Za-z][A-Za-z0-9-]*))/

function dialectAtRuleOnLine(input: SyntaxScanInput, row: number): string | null {
  const line = input.file.lines[row] ?? ''
  const open = AT_RULE_OPEN.exec(line)
  if (!open) return null
  const name = open[1].toLowerCase().replace(/^-(?:moz|webkit|ms|o)-/, '')
  return KNOWN_CSS_AT_RULES.has(name) ? null : `@${name}`
}

function cssDialectAtRule(
  input: SyntaxScanInput,
  region: ErrorRegion,
  fileBalanced: () => boolean,
): string[] | null {
  if (input.grammar !== 'css') return null
  if (region.missing) {
    const token = region.node.type.replace(/^MISSING\s*/, '').trim()
    if (MISSING_CLOSERS.has(token)) return null
  }
  // Tolerate a failure only when *every* line it covers opens with an unknown at-rule. A
  // region that reaches a line which does not is the grammar's confusion spilling into
  // ordinary CSS. Checking line by line keeps that mistake visible while still accepting a
  // file that uses several dialect at-rules in a row.
  const names = new Set<string>()
  let crossedOrdinary = false
  for (let row = region.node.startPosition.row; row <= region.node.endPosition.row; row += 1) {
    const line = input.file.lines[row] ?? ''
    // A blank line cannot carry the mistake, and a grammar that runs its ERROR region one
    // statement past the dialect line it gave up on must not lose the tolerance for that.
    if (line.trim() === '') continue
    const name = dialectAtRuleOnLine(input, row)
    if (name === null) {
      crossedOrdinary = true
      continue
    }
    names.add(name)
  }
  if (names.size === 0) return null
  // A region that reaches ordinary CSS is only set aside when the file has no unfinished
  // delimiter anywhere in it. That single condition is what keeps the shape that would
  // otherwise hide a real mistake — a dialect line followed by an unclosed block, which the
  // grammar wraps in one ERROR node — reportable, while a well-formed Tailwind sheet whose
  // confusion leaked onto the next selector is not.
  if (crossedOrdinary || region.node.endPosition.row > region.node.startPosition.row) {
    if (!fileBalanced()) return null
  }
  return [...names]
}

function describeCssDialect(names: readonly string[]): string {
  const one = names.length === 1
  return (
    `Treated as a CSS dialect, not a syntax error: ${names.join(', ')} ${one ? 'is' : 'are'} not defined by the ` +
    `CSS standards track, so the bundled CSS grammar has no rule there and no syntax finding is claimed on the ` +
    `${one ? 'line that opens' : 'lines that open'} with ${one ? 'it' : 'them'}. BugPilot tolerates every unknown ` +
    'at-rule for the same reason, not only the ones a particular framework uses. Unbalanced braces, broken ' +
    'selectors and truncated files are still reported, including in this file. A standards-only CSS parser still ' +
    'rejects these lines, so a build step that is not dialect-aware will fail on them.'
  )
}

export interface SyntaxScanInput {
  file: RuleFile
  root: SyntaxNode
  /** Grammar directory name, used for the untrusted-grammar table. */
  grammar: string
  maxHits?: number
}

export interface SyntaxScanResult {
  hits: EngineHit[]
  understood: boolean
  errorRegions: number
  /** Byte offset where the first ERROR/MISSING node starts; null when the tree is clean. */
  firstErrorIndex: number | null
  notes: string[]
}

/**
 * Part 2: turn ERROR and MISSING nodes into findings. The claim is always about the parse
 * tree ("the grammar could not match this"), never about a cause, because the tree is the
 * only evidence a parser produces.
 */
export function scanSyntax(input: SyntaxScanInput): SyntaxScanResult {
  const regions = collectErrorRegions(input.root)
  const notes: string[] = []

  if (regions.length === 0) return { hits: [], understood: true, errorRegions: 0, firstErrorIndex: null, notes }

  if (UNTRUSTED_SYNTAX_GRAMMARS.has(input.grammar)) {
    return {
      hits: [],
      understood: false,
      errorRegions: regions.length,
      firstErrorIndex: regions[0].node.startIndex,
      notes: [
        `The ${input.grammar} grammar reported ${regions.length} construct(s) it could not match, starting at line ${
          regions[0].node.startPosition.row + 1
        }. BugPilot knows this grammar rejects valid files of this language, so that is recorded as missing coverage instead of as a bug.`,
      ],
    }
  }

  // Part 4: an unknown at-rule is a dialect, so it is set aside before the checks that
  // decide whether the grammar understood the file at all. What is left is judged on its
  // own merits: a broken selector or an unclosed brace after a `@source` line still reports.
  const dialectNames: string[] = []
  const reported: ErrorRegion[] = []
  let balanceProbe: boolean | null = null
  const fileBalanced = () => {
    if (balanceProbe === null) {
      balanceProbe = findUnclosedOpener(input.file.text, input.file.text.length, input.grammar) === null
    }
    return balanceProbe
  }
  for (const region of regions) {
    const dialect = cssDialectAtRule(input, region, fileBalanced)
    if (dialect) {
      for (const name of dialect) {
        if (!dialectNames.includes(name)) dialectNames.push(name)
      }
      continue
    }
    reported.push(region)
  }
  if (dialectNames.length > 0) notes.push(describeCssDialect(dialectNames.sort()))
  if (reported.length === 0) {
    return { hits: [], understood: true, errorRegions: regions.length, firstErrorIndex: null, notes }
  }

  const first = reported[0].node
  const covered = first.endIndex - first.startIndex
  if (first.startPosition.row === 0 && covered >= input.file.text.length * 0.7) {
    return {
      hits: [],
      understood: false,
      errorRegions: regions.length,
      firstErrorIndex: reported[0].node.startIndex,
      notes: [
        'The grammar stopped understanding this file almost immediately (one error region covers most of it). That is usually the grammar, not the code, so no syntax finding is claimed.',
      ],
    }
  }

  const cap = input.maxHits ?? MAX_SYNTAX_HITS_PER_FILE
  const hits: EngineHit[] = []

  for (const region of reported) {
    if (hits.length >= cap) {
      notes.push(
        `${reported.length - hits.length} more syntax error region(s) in this file are not listed; the first ${cap} are shown.`,
      )
      break
    }

    const lineIndex = region.node.startPosition.row
    const token = firstToken(region.node)
    const manyErrors = reported.length > 5

    // Second location: when a delimiter or block keyword is still open at the error,
    // name the line that opened it. Kept out when it equals the finding line (it is
    // not a second location then) and when the file is balanced (the opener is null).
    const opener = findUnclosedOpener(input.file.text, region.node.startIndex, input.grammar)
    const secondLocation = opener && opener.line !== lineIndex ? opener : null

    // A MISSING node has no text of its own, so the only honest sentence names the token the
    // grammar wanted and the place it wanted it.
    const message =
      (region.missing
        ? `Missing ${expectedToken(region.node)} at line ${lineIndex + 1}, column ${region.node.startPosition.column + 1}.`
        : `Syntax error near "${token}" at line ${lineIndex + 1}.`) +
      (secondLocation
        ? region.missing
          ? ` The block that is missing its closer opened at line ${secondLocation.line + 1}.`
          : ` The block that could not be closed opened at line ${secondLocation.line + 1}.`
        : '')

    const explanation = region.missing
      ? `The ${input.grammar} grammar expected the token it names at this position and found something else. The position comes from the parse tree; the reason is not in it.`
      : `The ${input.grammar} grammar could not fit this text into any rule of the language, so it wrapped it in an ERROR node. Everything after this point in the file may be parsed from a wrong state.`

    const limitations = [
      'This is the grammar\'s view of the text, not a compiler: a construct the grammar does not support looks the same as a mistake.',
      region.missing
        ? 'The reported position is where the grammar wanted a token, which can be one line after the real mistake.'
        : 'The reported range is the largest span the grammar could not match, which can be wider than the mistake.',
    ]
    if (secondLocation) {
      limitations.push(
        'The "opened at" line comes from BugPilot\'s own delimiter scan, not from the grammar, so it is a hint about where the block started rather than a proven location.',
      )
    }
    if (manyErrors) {
      limitations.push(
        `This file has ${reported.length} error regions; after that many, the parser's view of the rest of the file is unreliable and later positions are guesses.`,
      )
    }

    hits.push({
      ruleId: region.missing ? 'tree-sitter/missing-node' : 'tree-sitter/syntax-error',
      engine: 'tree-sitter',
      tier: 'syntax',
      severity: 'High',
      confidence: {
        level: region.missing && !manyErrors ? 'high' : 'medium',
        reason: region.missing
          ? 'The grammar names the exact token it expected at this position, which is a strong signal.'
          : manyErrors
            ? 'Several error regions mean the parser lost its place; the first one is the most trustworthy.'
            : 'An ERROR node is what the parser reports when no rule matches, so the position is real but the cause is not.',
      },
      range: {
        startLine: lineIndex + 1,
        startColumn: region.node.startPosition.column + 1,
        endLine: region.node.endPosition.row + 1,
        endColumn: region.node.endPosition.column + 1,
      },
      evidence: secondLocation
        ? [
            lineEvidence(input.file, lineIndex, safeQuote(input.file.lines[lineIndex] ?? '')),
            lineEvidence(
              input.file,
              secondLocation.line,
              safeQuote(input.file.lines[secondLocation.line] ?? ''),
            ),
          ]
        : [lineEvidence(input.file, lineIndex, safeQuote(input.file.lines[lineIndex] ?? ''))],
      message,
      explanation,
      fix: secondLocation
        ? manualFix(
            `Add the missing closing delimiter before line ${lineIndex + 1}; the block opened at line ${secondLocation.line + 1}.`,
            'A file where the parser could not close a block it found earlier; the two lines bracket the unfinished region.',
            'manual-only',
            'The parser cannot describe the file, so no automatic rewrite is safe.',
          )
        : manualFix(
            'Compare this line with the language grammar you are targeting. If the construct is valid, the finding is a grammar limitation and the file may still be correct.',
            'Any file the grammar could not parse; later findings in the same file inherit the same uncertainty.',
            'manual-only',
            'Nothing can be rewritten safely while the parser cannot describe the file.',
          ),
      verificationSteps: [
        `Open line ${lineIndex + 1} and check the quoted text against the language reference.`,
        'Run the official compiler or interpreter for this language; it is the authority on syntax.',
        'Re-run the analysis after the change to see whether the error region moves or disappears.',
      ],
      limitations,
    })
  }

  return { hits, understood: true, errorRegions: regions.length, firstErrorIndex: first.startIndex, notes }
}
