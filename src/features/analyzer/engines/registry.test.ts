import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { grammarLabel, hasDeepEngine, NOT_CHECKED_BY_LANGUAGE, tierAvailability } from '../languages'
import { GRAMMAR_URLS } from './assets'
import { MINIMAL_WASM } from './featureProbe'
import { ENGINES_NOT_RUN_REASON } from '../analysis/coverage'
import { ENGINE_IDS, grammarFor, LANGUAGE_ENGINES, needsRuff, enginesFor } from './registry'

const PROMISED_LANGUAGES = [
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'php',
  'ruby',
  'shell',
  'html',
  'css',
  'sql',
  'yaml',
  'kotlin',
  'swift',
] as const

describe('engine language registry', () => {
  it('covers exactly the languages the slice promised', () => {
    expect(Object.keys(LANGUAGE_ENGINES).sort()).toEqual([...PROMISED_LANGUAGES].sort())
  })

  it('leaves JavaScript, TypeScript and JSON to the slice A engines', () => {
    // The TypeScript compiler already parses JS/TS and JSON.parse handles JSON: a second
    // parser would only produce duplicate findings on the same line.
    expect(LANGUAGE_ENGINES.javascript).toBeUndefined()
    expect(LANGUAGE_ENGINES.typescript).toBeUndefined()
    expect(LANGUAGE_ENGINES.json).toBeUndefined()
    expect(hasDeepEngine('javascript')).toBe(false)
    expect(hasDeepEngine('typescript')).toBe(false)
    expect(hasDeepEngine('json')).toBe(false)
  })

  it('ships only grammars that have a bundled URL', () => {
    for (const [language, profile] of Object.entries(LANGUAGE_ENGINES)) {
      if (profile?.grammar) {
        expect(GRAMMAR_URLS[profile.grammar], `${language} grammar`).toBeTypeOf('string')
        expect(GRAMMAR_URLS[profile.grammar]).toMatch(/\.wasm$/)
      }
    }
  })

  it('runs Ruff only for Python', () => {
    for (const [language, profile] of Object.entries(LANGUAGE_ENGINES)) {
      const expectsRuff = language === 'python'
      expect(profile?.engines.includes('ruff'), `${language} ruff`).toBe(expectsRuff)
      expect(profile?.engines.includes('tree-sitter'), `${language} tree-sitter`).toBe(
        profile?.grammar !== null,
      )
    }
    expect([...ENGINE_IDS]).toEqual(['tree-sitter', 'ruff'])
    expect(needsRuff(['java', 'go'])).toBe(false)
    expect(needsRuff(['java', 'python'])).toBe(true)
    expect(needsRuff([])).toBe(false)
  })

  it('maps the language a file is detected as, not just the extension', () => {
    const cases: [string, string, (typeof PROMISED_LANGUAGES)[number] | 'python'][] = [
      ['app.py', 'x = 1\n', 'python'],
      ['Main.java', 'class Main {}', 'java'],
      ['main.go', 'package main\n', 'go'],
      ['Style.css', 'a { color: red }', 'css'],
      ['page.html', '<!doctype html>\n<p>hi</p>', 'html'],
      ['script.sh', '#!/bin/bash\necho hi\n', 'shell'],
    ]
    for (const [name, text, expected] of cases) {
      expect(detectLanguage(name, text).language, name).toBe(expected)
      expect(hasDeepEngine(detectLanguage(name, text).language), name).toBe(true)
    }
  })

  it('names a shebang-only script by the engine it can open', () => {
    const detected = detectLanguage('deploy', '#!/usr/bin/env bash\necho hi\n')
    expect(detected.language).toBe('shell')
    expect(detected.source).toBe('shebang')
    expect(grammarFor('shell')).toBe('bash')
    expect(hasDeepEngine(detected.language)).toBe(true)
  })

  it('reaches an engine through content sniffing, and stops where no grammar exists', () => {
    // A name that says nothing: `readme` and `dockerfile` are known basenames in slice A and
    // would be resolved by the name, not by the content.
    const sniffed = detectLanguage('notes', '<!doctype html>\n<html></html>')
    expect(sniffed.language).toBe('html')
    expect(sniffed.source).toBe('content')
    expect(hasDeepEngine(sniffed.language)).toBe(true)

    // XML and Scala keep slice A coverage: no permissive grammar is bundled for them.
    const xml = detectLanguage('config', '<?xml version="1.0"?>\n<a/>')
    expect(xml.language).toBe('xml')
    expect(hasDeepEngine('xml')).toBe(false)
    expect(hasDeepEngine('scala')).toBe(false)
  })

  it('labels a grammar for a human, not for the tree-sitter directory', () => {
    expect(grammarLabel('csharp')).toBe('c_sharp')
    expect(grammarLabel('shell')).toBe('bash')
    expect(grammarLabel('javascript')).toBeNull()
  })

  it('keeps the syntax tier available for every engine-covered language', () => {
    for (const language of PROMISED_LANGUAGES) {
      const tiers = tierAvailability(language)
      expect(tiers.map((tier) => tier.tier), language).toEqual(['syntax', 'pattern'])
    }
  })

  it('records honest limits for every engine-covered language', () => {
    for (const language of PROMISED_LANGUAGES) {
      const lines = NOT_CHECKED_BY_LANGUAGE[language]
      expect(lines?.length ?? 0, language).toBeGreaterThan(0)
      const text = lines.join(' ')
      // Nothing may read these lines as "the code was compiled or executed".
      expect(text, language).not.toMatch(/\b(compiles|runs the code|executes your code)\b/i)
    }
  })

  it('says plainly when the engines were not used', () => {
    expect(ENGINES_NOT_RUN_REASON).toContain('built-in rules')
  })

  it('probes WebAssembly with a module that is valid but does nothing', () => {
    expect([...MINIMAL_WASM]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    expect(MINIMAL_WASM.byteLength).toBe(8)
    expect(enginesFor('python')?.engines).toEqual(['tree-sitter', 'ruff'])
    expect(enginesFor('scala' as never)).toBeNull()
  })
})
