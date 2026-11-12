// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Language, Parser } from 'web-tree-sitter'
import { beforeAll, describe, expect, it } from 'vitest'
import { detectLanguage } from './archive/classify'
import { makeRuleFile } from './rules/context'
import { jsonSyntaxRule } from './rules/json'
import { scanSyntax, type SyntaxNode } from './engines/syntax'

/**
 * The files in `src/test/dialects/` are the ones the manual checklist tells a human to upload, so
 * this test is the contract between those files and the sentences written about them. Each fixture
 * is checked in the direction the docs claim: tolerated shapes produce no finding, and the deliberate
 * mistakes sitting next to them still produce one. A fixture that stops meaning what the checklist
 * says fails here rather than teaching a tester to expect the wrong thing.
 */

const FIXTURES = resolve(process.cwd(), 'src/test/dialects')
const NODE_MODULES = resolve(process.cwd(), 'node_modules')
const CORE_WASM = resolve(NODE_MODULES, 'web-tree-sitter/web-tree-sitter.wasm')
const CSS_WASM = resolve(NODE_MODULES, 'tree-sitter-wasm/out/css/tree-sitter-css.wasm')

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8')
}

function jsonHits(name: string) {
  const text = fixture(name)
  const detection = detectLanguage(name, text)
  const file = makeRuleFile({
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
  })
  return { file, hits: jsonSyntaxRule.check(file) ?? [], notes: jsonSyntaxRule.coverageNotes?.(file) ?? [] }
}

let css: Language

function cssScan(name: string) {
  const text = fixture(name)
  const detection = detectLanguage(name, text)
  const parser = new Parser()
  parser.setLanguage(css)
  const tree = parser.parse(text)
  if (!tree) throw new Error('The CSS parser returned no tree.')
  try {
    return scanSyntax({
      file: makeRuleFile({
        name,
        text,
        language: detection.language,
        languageSource: detection.source,
        encoding: 'utf-8',
      }),
      root: tree.rootNode as unknown as SyntaxNode,
      grammar: 'css',
    })
  } finally {
    tree.delete()
    parser.delete()
  }
}

describe('the dialect fixtures mean what the checklist says', () => {
  beforeAll(async () => {
    await Parser.init({ locateFile: () => CORE_WASM })
    css = await Language.load(new Uint8Array(readFileSync(CSS_WASM)))
  }, 240_000)

  it('ships every fixture the checklist names', () => {
    for (const name of [
      'tsconfig.jsonc-shape.json',
      'json-double-comma.json',
      'tailwind-dialect.css',
      'tailwind-plus-bug.css',
      'unclosed-brace.css',
      'home.ejs',
    ]) {
      expect(fixture(name).length, name).toBeGreaterThan(0)
    }
  })

  it('tolerates the JSONC-shaped config and says why', () => {
    const { hits, notes } = jsonHits('tsconfig.jsonc-shape.json')
    expect(hits).toEqual([])
    // Pinned character-for-character: docs/MANUAL_TEST_CHECKLIST.md 18.1 quotes this sentence to
    // a human tester, so a wording change here has to be a wording change there.
    expect(notes).toEqual([
      'Treated as JSONC (JSON with comments), not strict JSON: it parses once // or /* */ comments ' +
        'outside strings and a comma before a closing } or ] are allowed. The `.json` name offered the ' +
        'candidate and the content confirmed it, so no Invalid JSON finding is reported. A strict JSON ' +
        'parser still rejects this document, so any consumer that is not JSONC-aware will fail on it.',
    ])
  })

  it('still reports the double comma, which is not one of the two tolerated deviations', () => {
    const { hits, notes } = jsonHits('json-double-comma.json')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.message).toContain('Invalid JSON')
    expect(notes).toEqual([])
  })

  it('tolerates a whole Tailwind-style dialect file and keeps the rules it understands', () => {
    const result = cssScan('tailwind-dialect.css')
    expect(result.hits.map((hit) => hit.message)).toEqual([])
    expect(result.understood).toBe(true)
    expect(result.notes).toHaveLength(1)
    const [note] = result.notes
    // Pinned for docs/MANUAL_TEST_CHECKLIST.md 18.3, including the alphabetical name list.
    expect(note).toBe(
      'Treated as a CSS dialect, not a syntax error: @custom-variant, @source are not defined by the ' +
        'CSS standards track, so the bundled CSS grammar has no rule there and no syntax finding is ' +
        'claimed on the lines that open with them. BugPilot tolerates every unknown at-rule for the same ' +
        'reason, not only the ones a particular framework uses. Unbalanced braces, broken selectors and ' +
        'truncated files are still reported, including in this file. A standards-only CSS parser still ' +
        'rejects these lines, so a build step that is not dialect-aware will fail on them.',
    )
  })

  it('reports the broken selector that sits under a dialect line in the same file', () => {
    const result = cssScan('tailwind-plus-bug.css')
    expect(result.hits).toHaveLength(1)
    const [hit] = result.hits
    expect(hit?.ruleId).toBe('tree-sitter/syntax-error')
    expect(hit?.range.startLine).toBe(2)
    expect(hit?.message).toBe('Syntax error near "{" at line 2.')
    expect(result.notes.join(' ')).toContain('Treated as a CSS dialect')
  })

  it('reports a plain unbalanced brace with no dialect excuse available', () => {
    const result = cssScan('unclosed-brace.css')
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]?.ruleId).toBe('tree-sitter/missing-node')
    expect(result.notes).toEqual([])
  })

  it('classifies the EJS fixture as a template, so no syntax engine is claimed for it', () => {
    const detection = detectLanguage('home.ejs', fixture('home.ejs'))
    expect(detection.language).toBe('template')
    expect(detection.source).toBe('extension')
  })
})
