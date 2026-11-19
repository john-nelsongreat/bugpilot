// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANALYZER_RULES } from '../rules/registry'
import { SENSITIVE_RULE_IDS } from '../rules/sensitiveFiles'
import { GRAMMAR_URLS } from './assets'
import { AST_RULES } from './astQueries'
import { ENGINE_IDS } from './registry'
import { RUFF_SELECTED_RULES } from './ruff'

/**
 * The engine counts in the documentation used to be prose someone typed. They are now derived from
 * the registry and the build configuration, so a grammar added or dropped cannot leave a stale
 * number in README.md or docs/ENGINE-LICENCES.md — the slice B report had exactly that bug ("19
 * shipped binaries" against a manifest of 18).
 *
 * Each claim is checked twice: that its sentence is still present (a matched-occurrence count, so a
 * reworded or deleted claim fails instead of silently passing) and that the number inside it equals
 * the number the build derives. Docs prose spells some of these out as words, so `asNumber()` takes
 * both forms.
 */

const GRAMMAR_COUNT = Object.keys(GRAMMAR_URLS).length

/** The two non-grammar binaries, read from the same module that publishes their URLs. */
const RUNTIME_WASM_COUNT = 2

const WASM_COUNT = GRAMMAR_COUNT + RUNTIME_WASM_COUNT

/** The script chunks the build is allowed to place in the engine directory. */
function engineChunkCount(): number {
  const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
  const match = /const ENGINE_CHUNK_ROOTS = \[([^\]]*)\]/.exec(config)
  return (match?.[1] ?? '').split(',').filter((entry) => entry.trim() !== '').length
}

const TOTAL_ASSET_COUNT = WASM_COUNT + engineChunkCount()

/** Python is the only language the Ruff pass covers and the only one with a deep AST pass today. */
const PYTHON_AST_QUERIES = AST_RULES.filter((rule) => rule.grammar === 'python').length

/** How many distinct questions the AST table asks, however many grammars answer them. */
const AST_PATTERN_COUNT = new Set(AST_RULES.map((rule) => rule.id)).size

const DOCS = ['README.md', 'docs/ENGINE-LICENCES.md'] as const

function readDoc(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8')
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
}

function asNumber(token: string, where: string): number {
  if (/^\d[\d,]*$/.test(token)) return Number(token.replaceAll(',', ''))
  const lower = token.toLowerCase()
  if (lower.includes('-')) {
    const halves = lower.split('-')
    const values = halves.map((part) => WORD_NUMBERS[part])
    if (halves.length === 2 && values[0] !== undefined && values[1] !== undefined) return values[0] + values[1]
    throw new Error(`${where}: "${token}" is not a sum of two known number words.`)
  }
  const word = WORD_NUMBERS[lower]
  if (word === undefined) throw new Error(`${where}: "${token}" is neither digits nor a known number word.`)
  return word
}

interface DocClaim {
  /** Quoted in the failure message, so a red run says which sentence went stale. */
  label: string
  doc: (typeof DOCS)[number]
  /**
   * Exactly one capture group, holding the number. Anchor it to enough of the sentence that it
   * matches `occurrences` times in the file: an unanchored pattern checks the claim in the wrong
   * place and misses it in the right one. Flags on the literal are ignored — the loop applies `gm`.
   */
  pattern: RegExp
  occurrences: number
  expected: number
}

const CLAIMS: readonly DocClaim[] = [
  // The headline summary.
  {
    label: 'the registered rule count',
    doc: 'README.md',
    pattern: /get findings from (\d+) registered pattern\/syntax rules/,
    occurrences: 1,
    expected: ANALYZER_RULES.length,
  },
  {
    label: 'the sensitive-file-name count',
    doc: 'README.md',
    pattern: /rules, (eleven|\d+) sensitive-file-name rules, and a lazy TypeScript/,
    occurrences: 1,
    expected: SENSITIVE_RULE_IDS.length,
  },
  {
    label: 'the tree-sitter language coverage',
    doc: 'README.md',
    pattern: /\(tree-sitter, (\d+) languages\)/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    // Two more sentences that carry the grammar count and were never in this table: LOOP2-L5 found
    // them stale-by-construction, since nothing failed when a grammar was added.
    label: 'the limit-list language coverage',
    doc: 'README.md',
    pattern: /(\d+) further languages can be parsed/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the deliberate non-goal',
    doc: 'README.md',
    pattern: /the (\d+) opt-in tree-sitter grammars/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },

  // The per-language and per-engine tables.
  {
    label: "Python's AST query count",
    doc: 'README.md',
    pattern: /Generic and secret rules, (\d+) AST queries/,
    occurrences: 1,
    expected: PYTHON_AST_QUERIES,
  },
  {
    label: "Python's Ruff rule count",
    doc: 'README.md',
    pattern: /Generic and secret rules, \d+ AST queries, (\d+) Ruff rules/,
    occurrences: 1,
    expected: RUFF_SELECTED_RULES.length,
  },
  {
    label: 'the grammar count in the engine tables',
    doc: 'README.md',
    pattern: /2\.0\.4 \((\d+) grammars\)/,
    occurrences: 2,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the engine table coverage cell',
    doc: 'README.md',
    pattern: /\| (\d+) \(see the table above\) \|/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the Ruff role cell',
    doc: 'README.md',
    pattern: /Lints Python with (\d+) hand-picked rules/,
    occurrences: 1,
    expected: RUFF_SELECTED_RULES.length,
  },
  {
    label: 'the grammar module count',
    doc: 'README.md',
    pattern: /\((\d+) grammar modules plus/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the published chunk count',
    doc: 'README.md',
    pattern: /the (two|\d+) JavaScript chunks published beside/,
    occurrences: 1,
    expected: engineChunkCount(),
  },
  {
    label: 'the syntax-error coverage cell',
    doc: 'README.md',
    pattern: /\| (\d+) grammars, SQL and YAML excluded/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the ruff row severity cell',
    doc: 'README.md',
    pattern: /Per rule, from a table of (\d+)/,
    occurrences: 1,
    expected: RUFF_SELECTED_RULES.length,
  },
  {
    label: 'the ruff row coverage cell',
    doc: 'README.md',
    pattern: /The (\d+) selected rules; the Ruff code/,
    occurrences: 1,
    expected: RUFF_SELECTED_RULES.length,
  },

  // The rule-id census and the architecture map.
  {
    label: 'the registry census',
    doc: 'README.md',
    pattern: /There are (\d+) registered pattern\/syntax rules plus/,
    occurrences: 1,
    expected: ANALYZER_RULES.length,
  },
  {
    label: 'the out-of-registry sensitive ids',
    doc: 'README.md',
    pattern: /and (eleven|\d+) sensitive-file-name rule ids produced outside/,
    occurrences: 1,
    expected: SENSITIVE_RULE_IDS.length,
  },
  {
    label: 'the tree-sitter query id count',
    doc: 'README.md',
    pattern: /(\d+) tree-sitter query ids/,
    occurrences: 1,
    expected: AST_PATTERN_COUNT,
  },
  {
    label: 'the ruff id arithmetic',
    doc: 'README.md',
    pattern: /for each of the (\d+) selected rules/,
    occurrences: 1,
    expected: RUFF_SELECTED_RULES.length,
  },
  {
    label: 'the shipped binary count',
    doc: 'README.md',
    pattern: /All (\d+) shipped\s+`\.wasm`\s+binaries/,
    occurrences: 1,
    expected: WASM_COUNT,
  },
  {
    label: 'the published manifest total',
    doc: 'README.md',
    pattern: /Total published: (\d+) files/,
    occurrences: 1,
    expected: TOTAL_ASSET_COUNT,
  },
  {
    label: 'the sensitive-file-name section heading',
    doc: 'README.md',
    pattern: /^(Eleven|\d+) sensitive-file-name rules \(`bugpilot\/sensitive\/\*`\)/m,
    occurrences: 1,
    expected: SENSITIVE_RULE_IDS.length,
  },
  {
    label: 'the architecture map',
    doc: 'README.md',
    pattern: /the (\d+)-rule Ruff mapping/,
    occurrences: 1,
    expected: RUFF_SELECTED_RULES.length,
  },

  // docs/ENGINE-LICENCES.md.
  {
    label: 'the licence census',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /All (\d+) shipped\s+`\.wasm`\s+binaries/,
    occurrences: 1,
    expected: WASM_COUNT,
  },
  {
    label: 'the grammar count in the licence census',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /\((\d+) grammars plus the tree-sitter/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the chunk count in the licence census',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /the (two|\d+) JavaScript files in the same directory/,
    occurrences: 1,
    expected: engineChunkCount(),
  },
  {
    label: 'the grammar binaries row',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /(\d+) grammar binaries/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the grammar section heading',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /^## The (\d+) grammars$/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the missing per-grammar notice',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /- The (\d+) grammars have/,
    occurrences: 1,
    expected: GRAMMAR_COUNT,
  },
  {
    label: 'the distributed binary count',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /distributes the (\d+) `\.wasm`/,
    occurrences: 1,
    expected: WASM_COUNT,
  },
  {
    // The attribution bullet names the larger set too, so the 18-grammar scope and the 21-binary
    // scope cannot be quietly conflated by a future edit to either sentence.
    label: 'the binary set the attribution is NOT for',
    doc: 'docs/ENGINE-LICENCES.md',
    pattern: /for the whole (\d+)-binary set/,
    occurrences: 1,
    expected: WASM_COUNT,
  },
  {
    label: 'the hashed-shaped response enumeration',
    doc: 'README.md',
    pattern: /enumerated \*\*(\d+) hashed-shaped 200 responses\*\*/,
    occurrences: 1,
    expected: 35,
  },
  {
    label: 'the real build outputs among the responses',
    doc: 'README.md',
    pattern: /\*\*(\d+) real build outputs plus one/,
    occurrences: 1,
    expected: 34,
  },
  {
    label: 'the responses already immutable (phantom included)',
    doc: 'README.md',
    pattern: /(Twenty-four) were already immutable/,
    occurrences: 1,
    expected: 24,
  },
  {
    label: 'the responses that revalidated',
    doc: 'README.md',
    pattern: /other \*\*(eleven) revalidated/,
    occurrences: 1,
    expected: 11,
  },
  {
    label: 'the revalidated bytes',
    doc: 'README.md',
    pattern: /visit: ([\d,]+) bytes of build output/,
    occurrences: 1,
    expected: 4589033,
  },
]

/**
 * Numbers the docs state that are deliberately NOT derived here, because no single symbol owns them
 * or because they are measurements of one run rather than properties of the build:
 *
 * - README "15 `.wasm` reads" and "18 languages" in the measurements section: corpus figures from a
 *   specific run, not engine facts. Pinning them would turn a doc gate into a perf baseline.
 * - README "the opt-in deep pass adds 29 ids — 2 tree-sitter syntax ids … and 22 Ruff ids": the two
 *   syntax ids and the one `ruff/syntax-error` id are inline ternary literals in `syntax.ts` and
 *   `ruff.ts`, not exported lists. Gating 2, 22 and 29 would mean hard-coding them in the gate,
 *   which is the same weakness as `RUNTIME_WASM_COUNT` below and is fixed by exporting the lists.
 */

describe('engine counts stated in the docs', () => {
  it('derives a sane set of numbers from the registry and the build', () => {
    expect(GRAMMAR_COUNT).toBe(19)
    expect(WASM_COUNT).toBe(21)
    expect(engineChunkCount()).toBe(2)
    expect(TOTAL_ASSET_COUNT).toBe(23)
    expect(ENGINE_IDS).toEqual(['tree-sitter', 'ruff'])
    expect(AST_PATTERN_COUNT).toBe(5)
    expect(RUFF_SELECTED_RULES).toHaveLength(21)
    expect(CLAIMS.length).toBe(36)
  })

  it('states the same number in every sentence that carries an engine count', () => {
    const seen = new Set<string>()
    for (const claim of CLAIMS) {
      // Keyed by doc as well as pattern, because the same sentence legitimately appears in both
      // files — README's licence summary and the licence doc's own census say it in the same words.
      const key = `${claim.doc}\u0000${claim.pattern.source}`
      expect(seen.has(key), `duplicate claim entry for ${claim.doc}: ${claim.pattern.source}`).toBe(false)
      seen.add(key)

      const text = readDoc(claim.doc)
      const matches = [...text.matchAll(new RegExp(claim.pattern.source, 'gm'))]
      expect(
        matches.length,
        `${claim.doc}: the sentence "${claim.label}" should appear exactly ${claim.occurrences} time(s), ` +
          `found ${matches.length}. If the wording moved, update the anchor; if a new copy of the claim ` +
          `was written, check its number and raise the count here.`,
      ).toBe(claim.occurrences)

      const token = matches[0]?.[1]
      expect(token, `${claim.doc}: "${claim.label}" must capture the number`).toBeDefined()
      // Every occurrence, not just the first: a claim that appears twice and disagrees in one of
      // them is exactly the stale sentence this table exists to catch.
      const values = matches.map((match) => asNumber(String(match[1]), `${claim.doc}: ${claim.label}`))
      expect(
        values,
        `${claim.doc}: ${claim.label} — every copy of this sentence must state ${claim.expected}`,
      ).toEqual(new Array<number>(claim.occurrences).fill(claim.expected))
    }
  })

  it('names exactly the Ruff rules the engine selects, in the same order', () => {
    const text = readDoc('README.md')
    const stated = /Ruff's (\d+) rules are `([^`]+)`/.exec(text)
    expect(stated, 'README.md: the sentence listing the selected Ruff rules should still exist').not.toBeNull()
    const codes = String(stated?.[2]).trim().split(/\s+/)
    expect(codes, 'README.md: the listed Ruff codes').toHaveLength(RUFF_SELECTED_RULES.length)
    expect(asNumber(String(stated?.[1]), 'README.md: the Ruff rule count')).toBe(codes.length)
    expect(codes).toEqual([...RUFF_SELECTED_RULES])
  })

  it('keeps per-grammar query counts out of the tree-sitter role cell', () => {
    // The role cell used to read "answers five saved-pattern queries", which looked like the number
    // of queries the engine runs when it is really the number of patterns, and went stale the moment
    // a second grammar joined. Counts belong in the rule table below, which is derived from AST_RULES.
    // Forbid a *number* in that position — not every word, or the corrected sentence ("answers the
    // saved-pattern queries listed in the table below") would be rejected too.
    const anyCount = `\\d+|${Object.keys(WORD_NUMBERS).join('|')}`
    expect(readDoc('README.md'), 'README.md: the tree-sitter role cell must not state a query count').not.toMatch(
      new RegExp(`(?:${anyCount}) saved-pattern queries`, 'i'),
    )
  })

  it('no longer calls the enumerated responses hashed files', () => {
    const readme = readDoc('README.md')
    expect(readme).not.toMatch(/\*\*35 hashed files\*\*/)
    expect(readme).toMatch(/a string inside the worker\s+bundle, discussed below/)
  })
})
