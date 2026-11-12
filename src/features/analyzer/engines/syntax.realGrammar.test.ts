// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Language, Parser } from 'web-tree-sitter'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SourceLanguage } from '../archive/classify'
import { makeRuleFile } from '../rules/context'
import type { GrammarId } from './assets'
import { scanSyntax, UNTRUSTED_SYNTAX_GRAMMARS, type SyntaxNode } from './syntax'

/**
 * Part 2 proved against the real grammars rather than against a hand-written tree: a clean
 * file in every shipped language must produce no syntax finding, and a broken one must produce
 * a finding that names a place. The grammars that cannot see a mistake are recorded here as
 * the limit they are, so the coverage table can say so honestly.
 */

const NODE_MODULES = resolve(process.cwd(), 'node_modules')
const CORE_WASM = resolve(NODE_MODULES, 'web-tree-sitter/web-tree-sitter.wasm')

interface Sample {
  grammar: GrammarId
  name: string
  language: SourceLanguage
  valid: string
  broken: string
}

const SAMPLES: readonly Sample[] = [
  { grammar: 'python', name: 's.py', language: 'python', valid: 'x = 1\nprint(x)\n', broken: 'def f(:\n    pass\n' },
  {
    grammar: 'java',
    name: 'S.java',
    language: 'java',
    valid: 'class S {\n    void m() {\n        int x = 1;\n    }\n}\n',
    broken: 'class S {\n    void m( {\n    }\n}\n',
  },
  {
    grammar: 'c',
    name: 's.c',
    language: 'c',
    valid: 'int main(void) {\n    return 0;\n}\n',
    broken: 'int main(void) {\n    return 0;\n',
  },
  {
    grammar: 'cpp',
    name: 's.cpp',
    language: 'cpp',
    valid: 'int main() {\n    return 0;\n}\n',
    broken: 'int main() {\n    return 0;\n',
  },
  {
    grammar: 'c_sharp',
    name: 'S.cs',
    language: 'csharp',
    valid: 'class S {\n    void M() {\n        int x = 1;\n    }\n}\n',
    broken: 'class S {\n    void M( {\n    }\n}\n',
  },
  {
    grammar: 'go',
    name: 's.go',
    language: 'go',
    valid: 'package main\n\nfunc main() {\n}\n',
    broken: 'package main\n\nfunc main( {\n}\n',
  },
  { grammar: 'rust', name: 's.rs', language: 'rust', valid: 'fn main() {\n}\n', broken: 'fn main( {\n}\n' },
  {
    grammar: 'php',
    name: 's.php',
    language: 'php',
    valid: '<?php\nfunction f() {\n    return 1;\n}\n',
    broken: '<?php\nfunction f( {\n    return 1;\n}\n',
  },
  { grammar: 'ruby', name: 's.rb', language: 'ruby', valid: 'def m\n  1\nend\n', broken: 'def m(\n  1\nend\n' },
  {
    grammar: 'bash',
    name: 's.sh',
    language: 'shell',
    valid: '#!/bin/sh\necho hi\n',
    broken: 'if [ -f x ]; then\n  echo hi\n',
  },
  {
    grammar: 'html',
    name: 's.html',
    language: 'html',
    valid: '<!doctype html>\n<html><body><p>hi</p></body></html>\n',
    broken: '<!doctype html>\n<html><body><p>hi</p>\n',
  },
  { grammar: 'css', name: 's.css', language: 'css', valid: 'a {\n    color: red;\n}\n', broken: 'a {\n    color: ;\n' },
  {
    grammar: 'sql',
    name: 's.sql',
    language: 'sql',
    valid: 'SELECT id FROM t WHERE id = 1;\n',
    broken: 'SELECT FROM WHERE;\n',
  },
  { grammar: 'yaml', name: 's.yml', language: 'yaml', valid: 'name: demo\nversion: 1\n', broken: 'name: demo\n  bad: [1,\n' },
  { grammar: 'kotlin', name: 'S.kt', language: 'kotlin', valid: 'fun main() {\n}\n', broken: 'fun main( {\n}\n' },
  { grammar: 'swift', name: 's.swift', language: 'swift', valid: 'func f() {\n}\n', broken: 'func f( {\n}\n' },
]

/**
 * The grammars that reported the mistake in the broken sample above. `html` and `sql` accepted
 * it (HTML permits an unclosed `p`, and the SQL grammar is loose), `css` lost the file
 * entirely and `yaml` is not trusted with a verdict at all — all four are separate tests.
 */
const SEES_SYNTAX_ERRORS: readonly GrammarId[] = [
  'python',
  'java',
  'c',
  'cpp',
  'c_sharp',
  'go',
  'rust',
  'php',
  'ruby',
  'bash',
  'kotlin',
  'swift',
]

const languages = new Map<GrammarId, Language>()

function scan(sample: Sample, code: string) {
  const language = languages.get(sample.grammar)
  if (!language) throw new Error(`Grammar ${sample.grammar} was not loaded.`)
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(code)
  if (!tree) throw new Error(`The ${sample.grammar} parser returned no tree.`)
  try {
    return scanSyntax({
      file: makeRuleFile({
        name: sample.name,
        text: code,
        language: sample.language,
        languageSource: 'extension',
        encoding: 'utf-8',
      }),
      root: tree.rootNode as unknown as SyntaxNode,
      grammar: sample.grammar,
    })
  } finally {
    tree.delete()
    parser.delete()
  }
}

describe('syntax findings against the shipped grammars', () => {
  beforeAll(async () => {
    await Parser.init({ locateFile: () => CORE_WASM })
    for (const sample of SAMPLES) {
      const path = resolve(NODE_MODULES, `tree-sitter-wasm/out/${sample.grammar}/tree-sitter-${sample.grammar}.wasm`)
      languages.set(sample.grammar, await Language.load(new Uint8Array(readFileSync(path))))
    }
  }, 240_000)

  it('ships every grammar the sample table needs', () => {
    expect(languages.size).toBe(SAMPLES.length)
    expect(SEES_SYNTAX_ERRORS.length).toBe(12)
  })

  it('finds no syntax error in a clean file of any shipped language', () => {
    for (const sample of SAMPLES) {
      const result = scan(sample, sample.valid)
      expect(result.hits, `${sample.grammar} clean file\n${sample.valid}`).toEqual([])
      expect(result.errorRegions, sample.grammar).toBe(0)
      expect(result.understood, sample.grammar).toBe(true)
    }
  })

  it('reports the broken file once, at a real position, for the grammars that see it', () => {
    for (const sample of SAMPLES.filter((one) => SEES_SYNTAX_ERRORS.includes(one.grammar))) {
      const result = scan(sample, sample.broken)
      const [hit] = result.hits
      expect(hit, `${sample.grammar} missed\n${sample.broken}\nregions=${result.errorRegions}`).toBeDefined()
      expect(result.hits).toHaveLength(1)
      expect(hit.ruleId).toMatch(/^tree-sitter\/(syntax-error|missing-node)$/)
      expect(hit.engine).toBe('tree-sitter')
      expect(hit.tier).toBe('syntax')
      expect(hit.severity).toBe('High')
      expect(hit.range.startLine).toBeGreaterThanOrEqual(1)
      expect(hit.range.startLine).toBeLessThanOrEqual(sample.broken.split('\n').length)
      expect(hit.evidence[0].lineNumber).toBe(hit.range.startLine)
      expect(hit.fix?.riskClass).toBe('manual-only')
      // The tree shows a place, never a cause.
      expect(hit.message).toMatch(/^(Syntax error near|Missing) .* at line \d+(, column \d+)?\.$/)
      expect(hit.message.toLowerCase()).not.toMatch(/because you|you forgot|probably/)
    }
  })

  it('says which token the grammar expected without inventing a cause', () => {
    const python = SAMPLES.find((sample) => sample.grammar === 'python')
    if (!python) throw new Error('python sample missing')
    const [hit] = scan(python, python.broken).hits
    expect(hit.ruleId).toBe('tree-sitter/missing-node')
    expect(hit.confidence.level).toBe('high')
    expect(hit.message).toBe('Missing ")" at line 1, column 7.')
  })

  it('names the opened-at line when a ruby call swallows the following defs', () => {
    // The cascade shape from the campaign: `text.downcase(` never closes, the parser
    // consumes the next `end`, and the reported error lands on a later `def`.
    const code = [
      'def normalise_region(text)',
      '  text.downcase(',
      'end',
      '',
      'def resolve_region(supplied)',
      '  candidate = supplied',
      'end',
      '',
      'def evaluate_region(expression)',
      '  expression.strip',
      'end',
      '',
    ].join('\n')
    const sample: Sample = { grammar: 'ruby', name: 'cascade.rb', language: 'ruby', valid: code, broken: code }
    const result = scan(sample, code)
    expect(result.hits).toHaveLength(1)
    const [hit] = result.hits
    expect(hit.ruleId).toBe('tree-sitter/syntax-error')
    expect(hit.message).toBe(
      'Syntax error near "def" at line 9. The block that could not be closed opened at line 2.',
    )
    expect(hit.evidence).toHaveLength(2)
    expect(hit.evidence[0].lineNumber).toBe(9)
    expect(hit.evidence[1].lineNumber).toBe(2)
    expect(hit.evidence[1].quote).toContain('text.downcase(')
    expect(hit.fix?.explanation).toBe(
      'Add the missing closing delimiter before line 9; the block opened at line 2.',
    )
    expect(hit.limitations.join(' ')).toContain('own delimiter scan')
  })

  it('keeps the finding when the file really is invalid, like C-style try in swift', () => {
    // The campaign generator wrote `try {` / `} catch {`, which is not Swift. That is a
    // true error in the file, not a grammar limitation, so the finding stays at full
    // strength; the generic cascade hint still names the block that was open when the
    // parser hit `catch`.
    const code = [
      'func parseRows(_ text: String) throws -> String {',
      '    try {',
      '        return text.trimmingCharacters(in: .whitespaces)',
      '    } catch {',
      '        return ""',
      '    }',
      '}',
      '',
    ].join('\n')
    const sample: Sample = { grammar: 'swift', name: 'LedgerTotals.swift', language: 'swift', valid: code, broken: code }
    const result = scan(sample, code)
    expect(result.hits).toHaveLength(1)
    const [hit] = result.hits
    expect(hit.ruleId).toBe('tree-sitter/syntax-error')
    expect(hit.message).toBe(
      'Syntax error near "catch" at line 4. The block that could not be closed opened at line 1.',
    )
    expect(hit.confidence.level).toBe('medium')
    expect(hit.evidence[1].lineNumber).toBe(1)
    expect(hit.evidence[1].quote).toContain('func parseRows')
  })

  it('does not invent a finding for a grammar that accepted the mistake', () => {
    // Honest limits: HTML allows an unclosed <p>, and the SQL grammar accepts this text.
    for (const grammar of ['html', 'sql'] as GrammarId[]) {
      const sample = SAMPLES.find((one) => one.grammar === grammar)
      if (!sample) throw new Error(`${grammar} sample missing`)
      const result = scan(sample, sample.broken)
      expect(result.hits, grammar).toEqual([])
    }
  })

  it('blames the grammar when a file collapses into one giant error region', () => {
    const css = SAMPLES.find((sample) => sample.grammar === 'css')
    if (!css) throw new Error('css sample missing')
    const result = scan(css, css.broken)
    expect(result.hits).toEqual([])
    expect(result.understood).toBe(false)
    expect(result.notes.join(' ')).toContain('That is usually the grammar, not the code')
  })

  it('records an untrusted grammar as missing coverage, never as a bug', () => {
    expect(UNTRUSTED_SYNTAX_GRAMMARS.has('yaml')).toBe(true)
    const yaml = SAMPLES.find((sample) => sample.grammar === 'yaml')
    if (!yaml) throw new Error('yaml sample missing')
    const result = scan(yaml, yaml.broken)
    expect(result.hits).toEqual([])
    expect(result.understood).toBe(false)
    expect(result.errorRegions).toBeGreaterThan(0)
    expect(result.notes.join(' ')).toContain('recorded as missing coverage instead of as a bug')
  })

  /**
   * Part 4: modern CSS ships at-rules the bundled grammar has never heard of. The tolerance is
   * defined by what the standards track does NOT list, not by a table of framework names, so it
   * cannot rot — and every shape below was read off the real parse tree, including the region
   * counts, which prove the grammar really did fail rather than the file really being clean.
   */
  describe('CSS dialect tolerance', () => {
    const cssSample = (): Sample => {
      const sample = SAMPLES.find((one) => one.grammar === 'css')
      if (!sample) throw new Error('css sample missing')
      return sample
    }

    const DIALECT_SHAPES: readonly [string, string][] = [
      ['@source glob', '@source "../src/**/*.{html,js}";\n.a { color: red; }\n'],
      ['@source inline', '@source inline("{,sm:,md:,lg:}text-white");\n'],
      ['@variant', '@variant hover:focus-within { .a { color: red; } }\n'],
      ['@custom-variant', '@custom-variant dark (&:where(.dark, .dark *));\n'],
      ['an at-rule nobody has heard of', '@foo bar baz;\n.a { color: red; }\n'],
      ['indented dialect line', '  @custom-variant dark (&:where(.dark));\n'],
      ['dialect after a real rule', '.a { color: red; }\n@source "../b/**/*.ts";\n'],
      ['two dialect lines in a row', '@source "a";\n@utility b { .x { top: 0; } }\n'],
    ]

    it('tolerates each unknown at-rule shape the grammar cannot see', () => {
      for (const [name, code] of DIALECT_SHAPES) {
        const result = scan(cssSample(), code)
        expect(result.hits, name).toEqual([])
        // The grammar did fail; the tolerance is what kept it from being called a bug.
        expect(result.errorRegions, name).toBeGreaterThan(0)
        expect(result.understood, name).toBe(true)
        const note = result.notes.join(' ')
        expect(note, name).toContain('Treated as a CSS dialect, not a syntax error')
        expect(note, name).toContain('@')
      }
    })

    it('names every dialect at-rule it set aside and says a strict parser still rejects it', () => {
      const result = scan(cssSample(), DIALECT_SHAPES[7][1])
      const note = result.notes.join(' ')
      expect(note).toContain('@source, @utility are not defined by the CSS standards track')
      expect(note).toContain('Unbalanced braces, broken selectors and truncated files are still')
      expect(note).toContain('BugPilot tolerates every unknown at-rule for the same reason, not only')
      expect(note).toContain('A standards-only CSS parser still rejects these lines')
    })

    it('still reports unbalanced braces, broken selectors and truncated files', () => {
      const cases: [string, string, number][] = [
        ['missing closing brace', '.a { color: red;\n', 1],
        ['broken selector', '.a{{ color: red; }\n', 1],
        ['truncated file', '.a { color: red; }\n.b { padd', 2],
      ]
      for (const [name, code, line] of cases) {
        const result = scan(cssSample(), code)
        expect(result.hits, name).toHaveLength(1)
        expect(result.hits[0]?.range.startLine, name).toBe(line)
        expect(result.understood, name).toBe(true)
        expect(result.notes.join(' '), name).not.toContain('Treated as a CSS dialect')
      }
    })

    it('reports a real mistake that sits on the line after a dialect line', () => {
      const result = scan(cssSample(), '@source "../src/*.html";\n.a{{ color: red; }\n')
      expect(result.hits).toHaveLength(1)
      const [hit] = result.hits
      expect(hit?.ruleId).toBe('tree-sitter/syntax-error')
      expect(hit?.range.startLine).toBe(2)
      // Both halves are true here, so both halves are said.
      expect(result.notes.join(' ')).toContain('Treated as a CSS dialect')
    })

    it('never tolerates a missing closer, even when the line opens with an unknown at-rule', () => {
      // `@theme {` with no closing brace is a real defect, and brace counting is something
      // the grammar can see regardless of whether it knows the at-rule.
      const result = scan(cssSample(), '@theme {\n  --color-a: red;\n')
      expect(result.hits).toHaveLength(1)
      expect(result.hits[0]?.ruleId).toBe('tree-sitter/missing-node')
      expect(result.notes.join(' ')).not.toContain('Treated as a CSS dialect')
    })

    it('enforces the at-rules the standard does define, so the tolerance is not a name whitelist', () => {
      for (const code of ['@media (min-width: ) { .a { top: 0; } }\n', '@keyframes spin { 0% { top: 0; } 100% top: 1; }\n']) {
        const result = scan(cssSample(), code)
        expect(result.hits, code).toHaveLength(1)
        expect(result.notes.join(' '), code).not.toContain('Treated as a CSS dialect')
      }
    })

    it('records the limit it cannot clear: a dialect line fused to a later unclosed block', () => {
      // The grammar wraps `@source "x";` and the unfinished `.a {` in one ERROR node, so the
      // tolerance declines (the region reaches a non-dialect line) and the pre-existing
      // whole-file collapse says the grammar gave up. No finding is claimed — this is the
      // false negative the README has to state.
      const result = scan(cssSample(), '@source "x";\n.a { color: red;\n')
      expect(result.hits).toEqual([])
      expect(result.understood).toBe(false)
      expect(result.notes.join(' ')).not.toContain('Treated as a CSS dialect')
      expect(result.notes.join(' ')).toContain('That is usually the grammar, not the code')
    })
  })
})
