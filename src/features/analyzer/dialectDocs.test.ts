// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jsonSyntaxRule } from './rules/json'
import { LANGUAGE_LABELS } from './languages'
import { TEMPLATE_EXTENSIONS, detectLanguage } from './archive/classify'
import { PASTE_LANGUAGES } from './upload/paste'
import { describeCssDialect, KNOWN_CSS_AT_RULES, UNTRUSTED_SYNTAX_GRAMMARS } from './engines/syntax'

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

/** The CSS row of the dialects table, as one string. */
function cssDialectRow(): string {
  const row = dialectSection()
    .split('\n')
    .find((line) => line.startsWith('| CSS dialect at-rules'))
  if (!row) throw new Error('README.md has no `| CSS dialect at-rules` row in the dialects table')
  return row
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** Section 18 of the manual checklist, as written and with its case preserved. */
function checklistSection18(): string {
  const text = readFileSync(resolve(process.cwd(), 'docs/MANUAL_TEST_CHECKLIST.md'), 'utf8')
  const heading = '## 18. Dialects that are tolerated'
  const from = text.indexOf(heading)
  if (from === -1) throw new Error(`the checklist has no "${heading}" section`)
  const after = text.slice(from + heading.length)
  const end = after.indexOf('\n## ')
  return end === -1 ? after : after.slice(0, end)
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

  it('states the one closer shape the css engine does NOT report, in every copy', () => {
    // Measured 2026-11-18 with the shipped CLI over 18 css shapes. A missing closer is reported in
    // every shape except one: when the grammar's first error region starts on line 1 AND covers at
    // least 70% of the bytes, `scanSyntax` claims nothing at all (syntax.ts:453). Two blocks left
    // open to end of file hit that guard; a single unclosed block never does, because the missing
    // token is a zero-width node. So "a closer is never tolerated" is false, and the sentence a
    // tester reads has to carry the exception. The clause below is written once, in the note the
    // product prints and in both docs; `dialectFixtures.test.ts` pins the note byte-for-byte, so if
    // the shipped string drifts away from this clause that test goes red and this one stays green
    // only for the docs — which is the pair that has to fail together.
    const clause = 'the grammar stops understanding the file from its first line'
    const row = cssDialectRow()
    expect(row, 'the README dialect row must name the collapse').toContain(clause)
    expect(row).toContain('70%')
    // The absolute wording is what this item exists to keep out.
    expect(row).not.toMatch(/closer is never tolerated/)
    const checklist = readFileSync(resolve(process.cwd(), 'docs/MANUAL_TEST_CHECKLIST.md'), 'utf8')
    expect(checklist, 'the checklist must not promise a closer is always reported').not.toMatch(
      /closer is never tolerated/,
    )
    expect(checklist, 'the checklist must state the collapse clause').toContain(clause)
    expect(describeCssDialect(['theme']), 'the shipped note must state the collapse clause').toContain(clause)
  })

  it('names every fixture on disk in the checklist, and states the count it derives', () => {
    // The checklist described "the four fixtures" of section 18 while the directory held six, and the
    // sentence is the kind no reader re-counts. Three things have to agree now: the files in
    // `src/test/dialects/`, the paths section 18 tells a human to upload, and the number in its prose.
    const checklist = checklistSection18().toLowerCase()
    const named = [...checklist.matchAll(/src\/test\/dialects\/([^\s`]+)/g)].map((m) => m[1] as string).sort()
    const onDisk = readdirSync(resolve(process.cwd(), 'src/test/dialects')).sort()
    expect(named, 'the fixtures section 18 names and the fixtures on disk must be the same set').toEqual(onDisk)
    const word = NUMBER_WORDS[onDisk.length]
    expect(word, `${onDisk.length} fixtures: extend NUMBER_WORDS`).toBeDefined()
    expect(checklist, `section 18 must state ${onDisk.length} fixtures, the number on disk`).toContain(`${word} fixture`)
  })

  it('names a language the intake can be told on every paste section 18 asks for', () => {
    // A paste has no file behind it, so the only thing the classifier reads is the virtual name the
    // intake builds. Left on Auto an extension-less paste is named `.txt`, and `.txt` has no syntax
    // engine and matches no language-keyed rule. Section 18 used to tell a human to paste CSS, and to
    // paste JSON, and to expect a finding from a source the intake could not name as either. The
    // choice is therefore part of the item, and this reads it out of the document and into the list.
    const items = checklistSection18()
      .split('\n')
      .filter((line) => line.includes('paste box'))
    expect(items.length, 'section 18 is meant to keep its two paste items').toBeGreaterThanOrEqual(2)
    for (const item of items) {
      const named = /\*\*Language of the pasted code\*\* to `([^`]+)`/.exec(item)
      if (!named) throw new Error(`section 18 has a paste item that names no choice, so it runs on Auto: ${item.slice(0, 72)}`)
      const label = named[1] as string
      const option = PASTE_LANGUAGES.find((choice) => choice.label === label)
      if (!option) {
        throw new Error(`the paste box offers no ${label} choice; it offers ${PASTE_LANGUAGES.map((c) => c.label).join(', ')}`)
      }
      const language = detectLanguage(`pasted/snippet.${option.extension}`, '').language
      expect(language, `${label} must not fall through to the text fallback`).not.toBe('text')
      expect(language, `${label} must not fall through as unrecognised`).not.toBe('unknown')
    }
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
