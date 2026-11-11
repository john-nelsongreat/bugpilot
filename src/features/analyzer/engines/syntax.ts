import { lineEvidence, manualFix, quoteLine } from '../rules/context'
import type { RuleFile } from '../rules/types'
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

  const first = regions[0].node
  const covered = first.endIndex - first.startIndex
  if (first.startPosition.row === 0 && covered >= input.file.text.length * 0.7) {
    return {
      hits: [],
      understood: false,
      errorRegions: regions.length,
      firstErrorIndex: regions[0].node.startIndex,
      notes: [
        'The grammar stopped understanding this file almost immediately (one error region covers most of it). That is usually the grammar, not the code, so no syntax finding is claimed.',
      ],
    }
  }

  const cap = input.maxHits ?? MAX_SYNTAX_HITS_PER_FILE
  const hits: EngineHit[] = []

  for (const region of regions) {
    if (hits.length >= cap) {
      notes.push(
        `${regions.length - hits.length} more syntax error region(s) in this file are not listed; the first ${cap} are shown.`,
      )
      break
    }

    const lineIndex = region.node.startPosition.row
    const token = firstToken(region.node)
    const manyErrors = regions.length > 5

    // A MISSING node has no text of its own, so the only honest sentence names the token the
    // grammar wanted and the place it wanted it.
    const message = region.missing
      ? `Missing ${expectedToken(region.node)} at line ${lineIndex + 1}, column ${region.node.startPosition.column + 1}.`
      : `Syntax error near "${token}" at line ${lineIndex + 1}.`

    const explanation = region.missing
      ? `The ${input.grammar} grammar expected the token it names at this position and found something else. The position comes from the parse tree; the reason is not in it.`
      : `The ${input.grammar} grammar could not fit this text into any rule of the language, so it wrapped it in an ERROR node. Everything after this point in the file may be parsed from a wrong state.`

    const limitations = [
      'This is the grammar\'s view of the text, not a compiler: a construct the grammar does not support looks the same as a mistake.',
      region.missing
        ? 'The reported position is where the grammar wanted a token, which can be one line after the real mistake.'
        : 'The reported range is the largest span the grammar could not match, which can be wider than the mistake.',
    ]
    if (manyErrors) {
      limitations.push(
        `This file has ${regions.length} error regions; after that many, the parser's view of the rest of the file is unreliable and later positions are guesses.`,
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
      evidence: [lineEvidence(input.file, lineIndex, safeQuote(input.file.lines[lineIndex] ?? ''))],
      message,
      explanation,
      fix: manualFix(
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
