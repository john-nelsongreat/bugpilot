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
})
