import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveSkippedEntry } from '../archive/guard'
import type { FileAnalysis } from './engine'
import { buildCoverage } from './coverage'

function entry(name: string, text: string, encoding: ArchiveEntry['encoding'] = 'utf-8'): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding,
    bytes: text.length,
  }
}

function analysis(file: string, rulesRan: string[], notes: string[] = []): FileAnalysis {
  return { file, findings: [], notes, rulesRan, stoppedEarly: false }
}

describe('coverage builder', () => {
  it('records language, encoding and which tiers really ran', () => {
    const entries = [entry('src/app.ts', 'const a = 1\n'), entry('data/config.json', '{"a":1}\n')]
    const coverage = buildCoverage(
      entries,
      [],
      [analysis('src/app.ts', ['bugpilot/generic/todo-marker']), analysis('data/config.json', ['bugpilot/syntax/json'])],
      new Map([['src/app.ts', { ran: true, reason: 'TypeScript parser, syntax diagnostics only.' }]]),
    )

    expect(coverage.map((file) => file.status)).toEqual(['analysed', 'analysed'])
    expect(coverage[0].languageLabel).toBe('TypeScript')
    expect(coverage[0].tiers.find((tier) => tier.tier === 'syntax')?.ran).toBe(true)
    expect(coverage[0].tiers.find((tier) => tier.tier === 'pattern')?.ran).toBe(true)
    expect(coverage[1].tiers.find((tier) => tier.tier === 'syntax')?.ran).toBe(true)
  })

  it('marks a JS syntax tier as not run when no TypeScript status was supplied', () => {
    const [file] = buildCoverage([entry('src/app.js', 'const a = 1\n')], [], [analysis('src/app.js', [])])

    expect(file.tiers.find((tier) => tier.tier === 'syntax')?.ran).toBe(false)
    expect(file.tiers.find((tier) => tier.tier === 'syntax')?.available).toBe(true)
  })

  it('keeps skipped files visible with their reason and no tiers run', () => {
    const skipped: ArchiveSkippedEntry[] = [
      { name: 'assets/logo.png', code: 'binary_content', message: 'Binary file skipped.' },
    ]
    const [file] = buildCoverage([], skipped, [])

    expect(file.status).toBe('skipped')
    expect(file.skipReason).toBe('Binary file skipped.')
    expect(file.languageSource).toBe('name-only')
    expect(file.encoding).toBeNull()
    expect(file.tiers.every((tier) => !tier.ran)).toBe(true)
  })

  it('explains a Latin-1 fallback and content-sniffed language', () => {
    const latin = entry('src/legacy.js', 'const caf\u00e9 = 1\n', 'latin-1')
    const sniffed = entry('tools/run', '#!/usr/bin/env python3\nprint(1)\n')
    const coverage = buildCoverage([latin, sniffed], [], [analysis(latin.name, []), analysis(sniffed.name, [])])

    expect(coverage[0].notes.join(' ')).toMatch(/Latin-1/)
    expect(coverage[1].notes.join(' ')).toMatch(/shebang/)
  })

  it('passes per-file analysis notes through', () => {
    const [file] = buildCoverage([entry('src/app.js', 'x\n')], [], [analysis('src/app.js', [], ['Rule stopped early.'])])
    expect(file.notes).toContain('Rule stopped early.')
  })
})
