// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jsonSyntaxRule } from './rules/json'
import { LANGUAGE_LABELS } from './languages'
import { TEMPLATE_EXTENSIONS } from './archive/classify'
import { KNOWN_CSS_AT_RULES, UNTRUSTED_SYNTAX_GRAMMARS } from './engines/syntax'

/**
 * The dialect layer added in AN-P1 is a set of things BugPilot deliberately does NOT report. That
 * is exactly the kind of claim documentation gets wrong: the code tolerates a case, the README
 * keeps saying the language is checked, and the reader has no way to notice. Every assertion here
 * is derived from the registry or the rule itself, so a dialect added, renamed or widened without
 * a matching sentence fails the suite instead of quietly making the docs a lie.
 */

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')

function section(start: string, stop: string): string {
  const from = README.indexOf(start)
  if (from === -1) throw new Error(`README.md has no section "${start}"`)
  const after = README.slice(from + start.length)
  const end = after.indexOf(stop)
  return end === -1 ? after : after.slice(0, end)
}

/** The rows of the "What runs, per language" table, lowercased for name matching. */
function perLanguageTable(): string {
  return section('### What runs, per language', '## Code analysis engines')
}

function dialectSection(): string {
  return section('#### Dialects that are tolerated', '### Limits, applied before analysis')
}

describe('the dialect layer cannot drift out of the README', () => {
  it('names every language the registry can detect in the per-language table', () => {
    const table = perLanguageTable().toLowerCase()
    for (const [id, label] of Object.entries(LANGUAGE_LABELS)) {
      // `JavaScript (JSX)` is written as `JSX` in the table, so both the full label and the
      // parenthesised short form count as documenting the language.
      const accepted = [label.toLowerCase(), label.replace(/\s*\([^)]*\)\s*$/, '').trim()]
      const inner = /\(([^)]*)\)/.exec(label)
      if (inner?.[1]) accepted.push(inner[1].toLowerCase())
      const hit = accepted.some((name) => table.includes(name))
      expect(hit, `${id} ("${label}") is missing from the per-language table`).toBe(true)
    }
  })

  it('lists every template extension the classifier admits', () => {
    const section = dialectSection().toLowerCase()
    for (const extension of TEMPLATE_EXTENSIONS) {
      expect(section, `.${extension} is not stated as a template dialect`).toContain(`.${extension}`)
    }
  })

  it('says what the JSON-config tolerance accepts and what it hides', () => {
    const section = dialectSection().toLowerCase()
    expect(jsonSyntaxRule.coverageNotes, 'the JSON rule must still carry its dialect note').toBeDefined()
    expect(section).toContain('jsonc')
    expect(section).toContain('comment')
    expect(section).toContain('trailing comma')
    // The false negative has to be named, or the docs imply strict JSON is enforced.
    expect(section).toContain('strict')
    expect(section).toContain('package.json')
  })

  it('states that unknown CSS at-rules are tolerated and braces still are not', () => {
    const section = dialectSection().toLowerCase()
    expect(section).toContain('@source')
    expect(section).toContain('at-rule')
    expect(section).toContain('unbalanced brace')
    expect(section).toContain('broken selector')
    expect(section).toContain('truncated')
  })

  it('keeps the CSS standards list about standards, not about frameworks', () => {
    // Widening this set with a dialect name is how a false positive gets "fixed" by hiding it.
    for (const dialectName of ['source', 'variant', 'custom-variant', 'utility', 'apply', 'screen']) {
      expect(KNOWN_CSS_AT_RULES.has(dialectName), `@${dialectName} is not a CSS standard`).toBe(false)
    }
    for (const standard of ['media', 'keyframes', 'import', 'supports', 'layer', 'container']) {
      expect(KNOWN_CSS_AT_RULES.has(standard), `@${standard} is missing from the standard set`).toBe(true)
    }
  })

  it('derives the untrusted-grammar row from the same set the engine uses', () => {
    const table = perLanguageTable().toLowerCase()
    const labels = [...UNTRUSTED_SYNTAX_GRAMMARS].map((grammar) => grammar.toUpperCase())
    expect(labels.length, 'the untrusted set is meant to be small but not empty').toBeGreaterThan(0)
    for (const label of labels) {
      expect(table, `${label} is not stated as untrusted`).toContain(label.toLowerCase())
    }
  })

  it('says the bundled C grammar cannot see macro syntax', () => {
    // AN-P1 Part 3 measured that this is a real, unfixed limit; the docs may not imply otherwise.
    const section = dialectSection().toLowerCase()
    expect(section).toContain('macro')
    expect(section).toContain('preprocessor')
  })
})
