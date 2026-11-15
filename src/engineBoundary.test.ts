/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Only engineWorkerEntry and engineClient may land in assets/engines/, because that directory is
// served under `script-src 'self' 'wasm-unsafe-eval'` while the rest of the app stays under
// `script-src 'self'` (vite.config.ts:7-13, vercel.json). If an analyzer engine file pulled a
// runtime value out of src/diagnostics/**, that code would be bundled under the wider policy: a
// policy escape, not a style preference. The reverse edge protects the other asymmetry —
// src/diagnostics/redos.test.ts:21-23 declares the analyzer domain deliberately NOT-COVERED by
// the ReDoS gate, which only holds while diagnostics stays independent.

const srcRoot = resolve(process.cwd(), 'src')
const DIAGNOSTICS = 'diagnostics'
const ANALYZER = 'features/analyzer'

// The complete legal set, measured on the tree this guard was written for. It is asserted with
// toEqual, never as "no violations": a matcher that silently stopped matching would drop entries
// from this list and fail, instead of reporting a clean run it never earned.
const LEGAL_TYPE_ONLY_IMPORTS = [
  'features/analyzer/analysis/finding.ts:1',
  'features/analyzer/engines/astRules.ts:1',
  'features/analyzer/engines/protocol.ts:1',
  'features/analyzer/engines/ruff.ts:2',
  'features/analyzer/rules/context.ts:1',
  'features/analyzer/rules/generic.ts:1',
  'features/analyzer/rules/secrets.ts:1',
  'features/analyzer/rules/sensitiveFiles.ts:1',
  'features/analyzer/rules/trojanSource.ts:1',
  'features/analyzer/rules/types.ts:1',
  'features/analyzer/types.ts:1',
]

type SpecifierForm = 'bare-import' | 'dynamic' | 'export-from' | 'import-type' | 'import-value'

type Found = { spec: string; form: SpecifierForm; line: number }
type Crossing = Found & { file: string; target: string }

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

function relative(file: string): string {
  return file.replace(/\\/g, '/').split('/src/')[1]
}

const sourceFiles = walk(srcRoot)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file))
  .map(relative)
  .sort()

function isIdent(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch)
}

function lineAt(code: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < code.length; i++) {
    if (code[i] === '\n') line++
  }
  return line
}

type Token = { word: string; start: number; end: number; punct: boolean }

// The code token sitting immediately before a quote, skipping whitespace. `punct` records a `(`,
// which is how a dynamic import is told apart from a static one.
function tokenBefore(code: string, quoteIndex: number): Token | null {
  let j = quoteIndex - 1
  while (j >= 0 && isSpace(code[j])) j--
  if (j < 0) return null
  let punct = false
  if (code[j] === '(') {
    punct = true
    j--
    while (j >= 0 && isSpace(code[j])) j--
  }
  const end = j + 1
  while (j >= 0 && isIdent(code[j])) j--
  if (end === j + 1) return null
  return { word: code.slice(j + 1, end), start: j + 1, end, punct }
}

// Nearest import/export keyword before a `from`, giving up at a semicolon so an unrelated
// statement cannot lend its keyword.
function governingKeyword(code: string, fromStart: number): { word: string; start: number; end: number } | null {
  let j = fromStart - 1
  while (j >= 0) {
    if (code[j] === ';') return null
    if (isIdent(code[j])) {
      const end = j + 1
      while (j >= 0 && isIdent(code[j])) j--
      const word = code.slice(j + 1, end)
      if (word === 'import' || word === 'export') return { word, start: j + 1, end }
    } else {
      j--
    }
  }
  return null
}

function wordAfter(code: string, index: number): string {
  let j = index
  while (j < code.length && isSpace(code[j])) j++
  const start = j
  while (j < code.length && isIdent(code[j])) j++
  return code.slice(start, j)
}

// Returns the string content, or null when the literal is not a static one (an unterminated
// line). `end` is where scanning resumes, which is what keeps prose out of the specifier path:
// text inside a string or a comment is never re-read.
function readStringLiteral(code: string, quoteIndex: number): { value: string | null; end: number } {
  const quote = code[quoteIndex]
  let out = ''
  let i = quoteIndex + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\' && i + 1 < code.length) {
      out += code[i + 1]
      i += 2
      continue
    }
    if (ch === quote) return { value: out, end: i + 1 }
    if (ch === '\n') return { value: null, end: i }
    out += ch
    i++
  }
  return { value: null, end: code.length }
}

// A template literal is never a static specifier, and it must never be re-read as code either.
// Resuming at its first `${` let narrative prose like `Declare or import "${name}" in the scope`
// register as a bare import of `${name}`; a narrative that quoted a real relative path would have
// been reported as a crossing. So the whole literal goes, interpolations included.
function skipTemplate(code: string, startIndex: number): number {
  let i = startIndex + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') return i + 1
    if (ch === '$' && code[i + 1] === '{') {
      i = skipInterpolation(code, i + 2)
      continue
    }
    i++
  }
  return code.length
}

function skipInterpolation(code: string, startIndex: number): number {
  let depth = 1
  let i = startIndex
  while (i < code.length) {
    const ch = code[i]
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      i++
      if (depth === 0) return i
      continue
    }
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') {
      i = skipTemplate(code, i)
      continue
    }
    if (ch === "'" || ch === '"') {
      i = readStringLiteral(code, i).end
      continue
    }
    i++
  }
  return code.length
}

function specifiersIn(code: string): Found[] {
  const found: Found[] = []
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === '`') {
      i = skipTemplate(code, i)
      continue
    }
    if (ch !== "'" && ch !== '"') {
      i++
      continue
    }
    const before = tokenBefore(code, i)
    const literal = readStringLiteral(code, i)
    if (before !== null && literal.value !== null) {
      if (before.word === 'from') {
        const keyword = governingKeyword(code, before.start)
        // No keyword at all still counts as a value import: an unknown statement shape must never
        // be assumed safe.
        const form: SpecifierForm =
          keyword === null
            ? 'import-value'
            : keyword.word === 'export'
              ? 'export-from'
              : wordAfter(code, keyword.end) === 'type'
                ? 'import-type'
                : 'import-value'
        const at = keyword === null ? before.start : keyword.start
        found.push({ spec: literal.value, form, line: lineAt(code, at) })
      } else if (before.punct && before.word === 'import') {
        found.push({ spec: literal.value, form: 'dynamic', line: lineAt(code, before.start) })
      } else if (before.word === 'import') {
        found.push({ spec: literal.value, form: 'bare-import', line: lineAt(code, before.start) })
      }
    }
    i = Math.max(literal.end, i + 1)
  }
  return found
}

// Pure posix-style resolution inside src, so a win32 path join can never rewrite the separators
// the two rules compare against. null means "not an intra-src module": a bare package specifier,
// or one that climbs out of src entirely.
function resolveSpecifier(file: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null
  const parts = file.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join('/').replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
}

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

function crossingsFrom(file: string, code: string, toDir: string): Crossing[] {
  const out: Crossing[] = []
  for (const found of specifiersIn(code)) {
    const target = resolveSpecifier(file, found.spec)
    if (target !== null && isUnder(target, toDir)) out.push({ ...found, file, target })
  }
  return out
}

// The only tolerated shape: a type-only import of the type module itself. Anything else that
// crosses — a value import, a side-effect import, a re-export, a dynamic import, or a type-only
// import of any other diagnostics module — is a violation.
function isLegalTypeOnly(crossing: Crossing): boolean {
  return crossing.form === 'import-type' && crossing.target === `${DIAGNOSTICS}/types`
}

function siteOf(crossing: Crossing): string {
  return `${crossing.file}:${crossing.line}`
}

function read(file: string): string {
  return readFileSync(join(srcRoot, file), 'utf8')
}

function analyzerCrossings(): Crossing[] {
  const out: Crossing[] = []
  for (const file of sourceFiles) {
    if (isUnder(file, ANALYZER)) out.push(...crossingsFrom(file, read(file), DIAGNOSTICS))
  }
  return out
}

function diagnosticsCrossings(): Crossing[] {
  const out: Crossing[] = []
  for (const file of sourceFiles) {
    if (isUnder(file, DIAGNOSTICS)) out.push(...crossingsFrom(file, read(file), ANALYZER))
  }
  return out
}

function describeCrossing(crossing: Crossing): string {
  return `${siteOf(crossing)} ${crossing.form} -> ${crossing.target}`
}

// Lines 1..7 are the specifier forms the guard must classify; lines 8..12 must produce nothing.
// Line 12 is the narrative template shape taken from diagnostics/rules/javascript.ts:265 and
// python.ts:282, which an earlier revision of this scanner misread as a bare import of `${name}`.
const FORM_SAMPLES = [
  "import { runRules } from '../../diagnostics/engine'",
  "import type { DiagnosticEvidence } from '../../diagnostics/types'",
  "import { type DiagnosticEvidence } from '../../diagnostics/types'",
  "import '../../diagnostics/engine'",
  "export { DiagnosticEvidence } from '../../diagnostics/engine'",
  "export * from '../../diagnostics/types'",
  "const engine = await import('../../diagnostics/engine')",
  "// import { runRules } from '../../diagnostics/engine'",
  "/* import type { DiagnosticEvidence } from '../../diagnostics/engine' */",
  "const reason = 'TypeScript parser, syntax diagnostics only (no types or imports).'",
  "const signature = \"ImportError: cannot import name '<name>' from '<module>'\"",
  "? `Declare or import \"${name}\" in the scope where it is used.${other ? ' Move it later.' : ''}`",
].join('\n')

describe('engine boundary', () => {
  it('keeps diagnostics free of any analyzer import', () => {
    const crossings = diagnosticsCrossings()
    expect(crossings.map(describeCrossing).sort()).toEqual([])
    // Non-vacuity: the scanned population is named, and those files really are parsed for imports.
    const diagnosticsFiles = sourceFiles.filter((file) => isUnder(file, DIAGNOSTICS))
    expect(diagnosticsFiles.length).toBe(6)
    const specifiersSeen = diagnosticsFiles.reduce((total, file) => total + specifiersIn(read(file)).length, 0)
    expect(specifiersSeen).toBeGreaterThanOrEqual(4)
  })

  it('lets the analyzer take diagnostics/types as types only', () => {
    const crossings = analyzerCrossings()
    const legal = crossings.filter(isLegalTypeOnly).map(siteOf).sort()
    const violations = crossings.filter((crossing) => !isLegalTypeOnly(crossing)).map(describeCrossing).sort()
    expect(legal).toEqual(LEGAL_TYPE_ONLY_IMPORTS)
    expect(violations).toEqual([])
  })

  it('scans the whole non-test source population', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(140)
    const analyzerFiles = sourceFiles.filter((file) => isUnder(file, ANALYZER))
    expect(analyzerFiles.length).toBeGreaterThan(30)
  })

  it('classifies every module specifier form and ignores comments and prose', () => {
    expect(specifiersIn(FORM_SAMPLES).map((found) => `${found.line}:${found.form}:${found.spec}`)).toEqual([
      "1:import-value:../../diagnostics/engine",
      "2:import-type:../../diagnostics/types",
      "3:import-value:../../diagnostics/types",
      "4:bare-import:../../diagnostics/engine",
      "5:export-from:../../diagnostics/engine",
      "6:export-from:../../diagnostics/types",
      "7:dynamic:../../diagnostics/engine",
    ])
  })

  it('refuses the re-export and dynamic bypasses even onto the legal file', () => {
    const bypass = [
      "export * from '../../diagnostics/types'",
      "export { DiagnosticEvidence } from '../../diagnostics/types'",
      "const mod = await import('../../diagnostics/types')",
    ].join('\n')
    const crossings = crossingsFrom('features/analyzer/probe.ts', bypass, DIAGNOSTICS)
    expect(crossings.map((crossing) => `${crossing.form}:${isLegalTypeOnly(crossing) ? 'legal' : 'violation'}`)).toEqual([
      'export-from:violation',
      'export-from:violation',
      'dynamic:violation',
    ])
  })

  // Fixture (a): the guard has to be able to go red, or it is decoration. The synthetic file sits
  // at analyzer depth 2 so that `../../diagnostics/...` really lands inside diagnostics.
  it('goes red on a value import and on a re-export across the boundary', () => {
    const snippet = [
      "import { runRules } from '../../diagnostics/engine'",
      "export { DiagnosticEvidence } from '../../diagnostics/engine'",
    ].join('\n')
    const crossings = crossingsFrom('features/analyzer/probe.ts', snippet, DIAGNOSTICS)
    expect(crossings.map((crossing) => `${crossing.form}:${crossing.target}`)).toEqual([
      'import-value:diagnostics/engine',
      'export-from:diagnostics/engine',
    ])
    expect(crossings.filter(isLegalTypeOnly)).toEqual([])
  })

  // Fixture (b): the shape the tree actually uses, from analyzer depth 3, exactly as ruff.ts:2.
  it('accepts the committed type-only import of the type module', () => {
    const snippet = "import type { DiagnosticEvidence } from '../../../diagnostics/types'"
    const crossings = crossingsFrom('features/analyzer/engines/probe.ts', snippet, DIAGNOSTICS)
    expect(crossings.map((crossing) => `${crossing.form}:${isLegalTypeOnly(crossing) ? 'legal' : 'violation'}`)).toEqual([
      'import-type:legal',
    ])
  })

  // Fixture (c): §3.6 names five such lines in the tree; this is one of them, verbatim.
  it('reports prose that merely mentions diagnostics as not an import', () => {
    expect(
      specifiersIn("const reason = 'TypeScript parser, syntax diagnostics only (no types or imports).'"),
    ).toEqual([])
    expect(
      specifiersIn(
        "const signature = \"ImportError: cannot import name '<name>' from '<module>'\"",
      ),
    ).toEqual([])
  })

  // The symmetric edge, from diagnostics depth 3, so R1 is red-capable too and not only by claim.
  it('goes red when diagnostics reaches into the analyzer', () => {
    const snippet = "import { analyzeSession } from '../../features/analyzer/analysis/session'"
    const crossings = crossingsFrom('diagnostics/rules/probe.ts', snippet, ANALYZER)
    expect(crossings.map((crossing) => `${crossing.form}:${crossing.target}`)).toEqual([
      'import-value:features/analyzer/analysis/session',
    ])
  })

  it('is narrower than a word search, because prose mentions diagnostics', () => {
    let mentions = 0
    for (const file of sourceFiles) {
      if (!isUnder(file, ANALYZER)) continue
      mentions += read(file)
        .split('\n')
        .filter((line) => line.includes(DIAGNOSTICS)).length
    }
    // Prose bait exists on this tree, so a matcher keyed on the word would fire; the exact site
    // list above proves this one does not.
    expect(mentions).toBeGreaterThan(LEGAL_TYPE_ONLY_IMPORTS.length)
    expect(analyzerCrossings().length).toBe(LEGAL_TYPE_ONLY_IMPORTS.length)
  })
})
