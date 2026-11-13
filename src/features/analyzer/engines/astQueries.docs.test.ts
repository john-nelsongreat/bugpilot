// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AST_RULES, GRAMMAR_LABEL } from './astQueries'
import type { GrammarId } from './assets'

/**
 * The Languages column of the "What each engine can report" table names, for each AST rule id, the
 * grammars the engine actually holds a query for. That is exactly the claim documentation drifts out
 * of: a query is added for one more grammar, or a grammar the table names was never written, and the
 * README keeps saying what it always said. Everything here is derived from AST_RULES and the same
 * label map the engine uses to write its own messages, so the table cannot drift without failing the
 * suite. Same shape as dialectDocs.test.ts.
 */

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')

function label(grammar: GrammarId): string {
  return GRAMMAR_LABEL[grammar] ?? grammar
}

/** rule id -> the language labels the engine defines a query for, in define order. */
function engineLanguages(): Map<string, string[]> {
  const byId = new Map<string, string[]>()
  for (const rule of AST_RULES) {
    let list = byId.get(rule.id)
    if (!list) {
      list = []
      byId.set(rule.id, list)
    }
    const name = label(rule.grammar)
    if (!list.includes(name)) list.push(name)
  }
  return byId
}

/** The AST rows of the "What each engine can report" table. */
function readmeAstRows(): { id: string; languages: string }[] {
  const rows: { id: string; languages: string }[] = []
  for (const line of README.split(/\r?\n/)) {
    const match =
      /^\| `(bugpilot\/ast\/[a-z-]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ?$/.exec(line)
    if (match) rows.push({ id: match[1], languages: match[5].trim() })
  }
  return rows
}

function cellNames(cell: string): string[] {
  return cell.split(',').map((name) => name.trim()).filter(Boolean)
}

describe('the AST rules table cannot drift out of the engine', () => {
  const engine = engineLanguages()
  const rows = readmeAstRows()

  it('has exactly one README row per rule id the engine defines', () => {
    expect(rows.length, 'README rows vs rule ids').toBe(engine.size)
    expect(rows.map((row) => row.id).sort()).toEqual([...engine.keys()].sort())
  })

  for (const [id, names] of engine) {
    it(`states the languages of ${id} exactly as the engine has them`, () => {
      const row = rows.find((candidate) => candidate.id === id)
      if (!row) throw new Error(`README.md has no row for ${id}`)
      expect(cellNames(row.languages).sort(), `${id} Languages cell`).toEqual([...names].sort())
    })
  }

  it('counts the tree-sitter query ids the deep pass adds the same as the engine', () => {
    expect(README).toContain(`${engine.size} tree-sitter query ids`)
  })
})
