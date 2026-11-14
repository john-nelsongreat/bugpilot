// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SourceLanguage } from '../archive/classify'
import { ALL_TEXT_LANGUAGES } from './context'
import { genericRules } from './generic'
import { trojanSourceRules } from './trojanSource'
import type { AnalyzerRule } from './types'

/**
 * README's Rules table names, for every registered pattern rule it lists, the tier, the headline
 * severity and the languages the registry holds. That is exactly the claim documentation drifts out
 * of: a rule gains a language, changes severity or retires, and the table keeps saying what it always
 * said. Everything here is derived from `genericRules` and `trojanSourceRules` — the same arrays the
 * engine runs — so the table cannot drift without failing the suite. Same model as
 * `engines/astQueries.docs.test.ts`, and for the same reason.
 *
 * Deliberately NOT derived:
 *
 * - The `bugpilot/syntax/json` and `bugpilot/typescript/syntax` rows. One is a syntax rule and the
 *   other is an id the worker synthesises; both are counted by `engines/engineCounts.test.ts`, which
 *   owns the registered-rule totals.
 * - The eight secret rows. README states them as a sentence, not a table, and AN-DOC-2 already pins
 *   the secret-rule ids and their severities through the registry.
 * - The words inside a severity qualifier. The table allows `Low (note)` and
 *   `High (Low in prose-like …)`; this gate checks the headline severity and stops there, because the
 *   qualifier is prose about how the rule demotes a hit, which no field on `AnalyzerRule` states.
 */

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')
const TABLE_HEADER = '| Rule id | Tier | Severity | Languages | Finds |'

/** Every registered pattern rule the table covers: the generic family plus the two trojan-source ids. */
const COVERED: readonly AnalyzerRule[] = [...genericRules, ...trojanSourceRules]

/** The words README uses for a language, in the one cell that enumerates instead of generalising. */
const LANGUAGE_WORD: Record<string, SourceLanguage> = {
  JS: 'javascript',
  JSX: 'jsx',
  TS: 'typescript',
  TSX: 'tsx',
  Java: 'java',
  Kotlin: 'kotlin',
  'C#': 'csharp',
  PHP: 'php',
  Python: 'python',
  Ruby: 'ruby',
  Go: 'go',
}

interface TableRows {
  tier: string
  severity: string
  languages: string
}

function readmeRows(): Map<string, TableRows> {
  const lines = README.split(/\r?\n/)
  const header = lines.indexOf(TABLE_HEADER)
  if (header === -1) {
    throw new Error(`README.md has no "${TABLE_HEADER}" header — the gate cannot find the table it guards`)
  }
  const rows = new Map<string, TableRows>()
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i += 1) {
    const cells = lines[i].replace(/^\| /, '').replace(/ \|$/, '').split(' | ')
    if (cells.length !== 5) {
      throw new Error(`README.md:${i + 1} has ${cells.length} cells in the Rules table, expected 5`)
    }
    rows.set(cells[0].replace(/`/g, ''), { tier: cells[1], severity: cells[2], languages: cells[3] })
  }
  return rows
}

/** A Languages cell read back as the set of languages it names. */
function cellLanguages(cell: string): SourceLanguage[] {
  const text = cell.trim()
  if (text === 'every text language') return [...ALL_TEXT_LANGUAGES]
  if (text === 'every text language except markdown/text') {
    return ALL_TEXT_LANGUAGES.filter((language) => language !== 'markdown' && language !== 'text')
  }
  return text.split(/[,/]\s*/).map((word) => {
    const language = LANGUAGE_WORD[word]
    if (!language) throw new Error(`README names a language this gate has no word for: "${word}"`)
    return language
  })
}

describe('the Rules table cannot drift out of the registry', () => {
  const rows = readmeRows()

  it('covers exactly the registered generic and trojan-source rules, and no others', () => {
    const tableIds = [...rows.keys()]
      .filter((id) => id.startsWith('bugpilot/generic/'))
      .sort()
    expect(tableIds).toEqual(COVERED.map((rule) => rule.id).sort())
  })

  for (const rule of COVERED) {
    it(`states the tier, headline severity and languages of ${rule.id} exactly as the registry has them`, () => {
      const row = rows.get(rule.id)
      if (!row) throw new Error(`README.md has no row for ${rule.id}`)
      expect(row.tier, `${rule.id} Tier cell`).toBe(rule.tier)
      expect(row.severity, `${rule.id} Severity cell`).toMatch(
        new RegExp(`^${rule.severity}( \\(.+\\))?$`),
      )
      expect(cellLanguages(row.languages).sort(), `${rule.id} Languages cell`).toEqual(
        [...rule.languages].sort(),
      )
    })
  }
})
