import { describe, expect, it } from 'vitest'
import { makeRuleFile } from '../rules/context'
import type { RuleFile } from '../rules/types'
import {
  collectErrorRegions,
  MAX_SYNTAX_HITS_PER_FILE,
  scanSyntax,
  UNTRUSTED_SYNTAX_GRAMMARS,
  type SyntaxNode,
} from './syntax'

interface RegionSpec {
  type?: string
  text?: string
  row?: number
  column?: number
  endRow?: number
  endColumn?: number
  startIndex?: number
  endIndex?: number
  error?: boolean
  missing?: boolean
  children?: (RegionSpec | SyntaxNode)[]
}

let nextId = 1

// Assembled at run time from fragments so no file in the repository carries a
// credential-shaped literal (GitHub push protection treats one as a real leak).
const FAKE_GITHUB = ['gh', 'p_', 'K7mN2pQ9rS4tV6wX8yZ1', 'aB3cD5eF7gH9jK2mN4pQ6'].join('')

/** A tree already built by a nested `node()` call, passed down as a child. */
function isBuilt(value: RegionSpec | SyntaxNode): value is SyntaxNode {
  return 'isError' in value && 'childCount' in value
}

/** A stand-in for a web-tree-sitter node: only the fields syntax.ts touches. */
function node(spec: RegionSpec = {}): SyntaxNode {
  const row = spec.row ?? 0
  const column = spec.column ?? 0
  const children = (spec.children ?? []).map((child) => (isBuilt(child) ? child : node(child)))
  const id = nextId++
  const hasChildError = children.some((child) => child.isError || child.hasError)
  return {
    id,
    type: spec.type ?? 'module',
    text: spec.text ?? 'x',
    startIndex: spec.startIndex ?? 0,
    endIndex: spec.endIndex ?? (spec.text ?? 'x').length,
    startPosition: { row, column },
    endPosition: { row: spec.endRow ?? row, column: spec.endColumn ?? column + 1 },
    childCount: children.length,
    isError: spec.error === true,
    isMissing: spec.missing === true,
    hasError: hasChildError || spec.error === true || spec.missing === true,
    child: (index: number) => children[index] ?? null,
  }
}

function ruleFile(text: string, language = 'python'): RuleFile {
  return makeRuleFile({
    name: `sample.${language === 'python' ? 'py' : language}`,
    text,
    language: language as never,
    languageSource: 'extension',
    encoding: 'utf-8',
  })
}

describe('tree-sitter syntax findings', () => {
  it('collects the top-level error region instead of the parser confusion inside it', () => {
    const inner = node({ type: 'ERROR', text: 'def broken(:', error: true, row: 3 })
    const outer = node({
      type: 'ERROR',
      text: 'def broken(:\n  pass',
      error: true,
      row: 3,
      children: [inner],
    })
    const root = node({ type: 'module', children: [outer] })

    const regions = collectErrorRegions(root)
    expect(regions).toHaveLength(1)
    expect(regions[0].node.text).toBe('def broken(:\n  pass')
    expect(regions[0].missing).toBe(false)
  })

  it('keeps separate error regions in document order', () => {
    const root = node({
      children: [
        node({ text: 'second', error: true, row: 8, startIndex: 80 }),
        node({ text: 'first', error: true, row: 2, startIndex: 20 }),
      ],
    })
    expect(collectErrorRegions(root).map((region) => region.node.text)).toEqual(['first', 'second'])
  })

  it('reports nothing when the grammar understood the file', () => {
    const result = scanSyntax({ file: ruleFile('x = 1\n'), root: node(), grammar: 'python' })
    expect(result).toEqual({ hits: [], understood: true, errorRegions: 0, firstErrorIndex: null, notes: [] })
  })

  it('never claims a syntax bug from a grammar it does not trust', () => {
    for (const grammar of UNTRUSTED_SYNTAX_GRAMMARS) {
      const root = node({ text: 'bad', error: true, row: 0 })
      const result = scanSyntax({ file: ruleFile('whatever'), root, grammar })
      expect(result.hits).toEqual([])
      expect(result.understood).toBe(false)
      expect(result.errorRegions).toBe(1)
      expect(result.notes[0]).toContain('recorded as missing coverage instead of as a bug')
    }
    expect([...UNTRUSTED_SYNTAX_GRAMMARS].sort()).toEqual(['sql', 'yaml'])
  })

  it('blames the grammar, not the code, when parsing dies almost immediately', () => {
    const text = 'A'.repeat(100)
    const root = node({ text, error: true, row: 0, startIndex: 0, endIndex: 90 })
    const result = scanSyntax({ file: ruleFile(text), root, grammar: 'java' })
    expect(result.hits).toEqual([])
    expect(result.understood).toBe(false)
    expect(result.notes[0]).toContain('That is usually the grammar, not the code')
  })

  it('turns an ERROR node into a finding that only claims what the tree shows', () => {
    const text = 'def ok():\n    return 1\nfunc broken(:\n'
    const root = node({
      text: 'func broken(:',
      error: true,
      row: 2,
      column: 5,
      endRow: 2,
      endColumn: 13,
      startIndex: 22,
      endIndex: 35,
    })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit).toBeDefined()
    expect(hit.ruleId).toBe('tree-sitter/syntax-error')
    expect(hit.engine).toBe('tree-sitter')
    expect(hit.tier).toBe('syntax')
    expect(hit.severity).toBe('High')
    expect(hit.confidence.level).toBe('medium')
    expect(hit.message).toBe('Syntax error near "func" at line 3.')
    expect(hit.range).toEqual({ startLine: 3, startColumn: 6, endLine: 3, endColumn: 14 })
    expect(hit.evidence[0].quote).toContain('func broken(:')
    // The tree shows a place, never a cause.
    expect(hit.explanation).toContain('could not fit this text into any rule')
    expect(hit.explanation).not.toMatch(/because you (forgot|missed)/)
    expect(hit.fix?.riskClass).toBe('manual-only')
    expect(hit.verificationSteps.join(' ')).toContain('official compiler or interpreter')
  })

  it('raises confidence for a MISSING node because the grammar names the token', () => {
    const root = node({
      type: 'MISSING ")"',
      text: 'MISSING ")"',
      missing: true,
      row: 4,
      column: 11,
    })
    const [hit] = scanSyntax({ file: ruleFile('print(1\n'), root, grammar: 'python' }).hits
    expect(hit.ruleId).toBe('tree-sitter/missing-node')
    expect(hit.confidence.level).toBe('high')
    expect(hit.message).toBe('Missing ")" at line 5, column 12.')
    expect(hit.limitations.join(' ')).toContain('one line after the real mistake')
  })

  it('caps the list and says how much was suppressed', () => {
    const regions = Array.from({ length: MAX_SYNTAX_HITS_PER_FILE + 8 }, (_, index) =>
      node({ text: `bad${index}`, error: true, row: index, startIndex: index * 10 }),
    )
    const root = node({ children: regions })
    const result = scanSyntax({ file: ruleFile('x'.repeat(4000)), root, grammar: 'ruby' })
    expect(result.hits).toHaveLength(MAX_SYNTAX_HITS_PER_FILE)
    expect(result.errorRegions).toBe(20)
    expect(result.notes.join(' ')).toContain('8 more syntax error region(s)')
    expect(result.notes.join(' ')).toContain('the first 12 are shown')
  })

  it('warns that a file full of errors has unreliable positions after the first one', () => {
    const regions = Array.from({ length: 6 }, (_, index) =>
      node({ text: `bad${index}`, error: true, row: index, startIndex: index * 5 }),
    )
    const result = scanSyntax({ file: ruleFile('y'.repeat(400)), root: node({ children: regions }), grammar: 'go' })
    expect(result.hits.length).toBeGreaterThan(1)
    for (const hit of result.hits) {
      expect(hit.confidence.level).toBe('medium')
      expect(hit.limitations.join(' ')).toContain('later positions are guesses')
    }
  })

  it('redacts a credential-shaped line instead of quoting it into the report', () => {
    const text = `password = "${FAKE_GITHUB}"\n`
    const root = node({ text: 'password =', error: true, row: 0, column: 11 })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit.evidence[0].quote).not.toContain(FAKE_GITHUB)
    expect(hit.evidence[0].quote).toContain('credential-shaped value on this line was redacted')
  })

  it('masks a credential-shaped first token before truncating it', () => {
    // The message would otherwise carry the first 24 characters of the token, which is most
    // of a real key.
    const text = `x = 1\ny = "${FAKE_GITHUB}"\n`
    const root = node({
      text: `"${FAKE_GITHUB}"`,
      error: true,
      row: 1,
      startIndex: 6,
      endIndex: 6 + FAKE_GITHUB.length + 2,
    })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit.message).not.toContain(FAKE_GITHUB)
    expect(hit.message).not.toContain('K7mN2pQ9rS4tV6wX8yZ1')
    expect(hit.message).toContain('Syntax error near')
  })

  it('shortens an unreasonably long token and describes end of file honestly', () => {
    const long = node({ text: `${'z'.repeat(40)} tail`, error: true, row: 1 })
    const [longHit] = scanSyntax({ file: ruleFile('a\nb\n'), root: long, grammar: 'java' }).hits
    expect(longHit.message).toContain(`${'z'.repeat(24)}…`)

    const empty = node({ text: '   \n  ', error: true, row: 2 })
    const [eofHit] = scanSyntax({ file: ruleFile('a\nb\nc\n'), root: empty, grammar: 'java' }).hits
    expect(eofHit.message).toContain('near "end of file"')
  })
})

describe('second location: the block the parser could not close', () => {
  it('names the line that opened the unclosed delimiter in an ERROR finding', () => {
    const text = 'x = (\ny = 2\ndef broken(:\n'
    const root = node({
      text: 'def broken(:',
      error: true,
      row: 2,
      column: 0,
      startIndex: 11,
      endIndex: 23,
    })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit.message).toBe(
      'Syntax error near "def" at line 3. The block that could not be closed opened at line 1.',
    )
    expect(hit.evidence).toHaveLength(2)
    expect(hit.evidence[0].label).toBe('Line 3')
    expect(hit.evidence[1].label).toBe('Line 1')
    expect(hit.evidence[1].quote).toContain('x = (')
    expect(hit.fix?.explanation).toContain(
      'Add the missing closing delimiter before line 3; the block opened at line 1.',
    )
    expect(hit.limitations.join(' ')).toContain('own delimiter scan')
    // The original location stays the primary one.
    expect(hit.range.startLine).toBe(3)
  })

  it('names the opener for a MISSING node too', () => {
    const text = 'if (x {\n  y\nz = 1\n'
    const root = node({
      type: 'MISSING "}"',
      text: 'MISSING "}"',
      missing: true,
      row: 1,
      column: 2,
      startIndex: 10,
      endIndex: 10,
    })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'c' }).hits
    expect(hit.message).toBe(
      'Missing "}" at line 2, column 3. The block that is missing its closer opened at line 1.',
    )
    expect(hit.evidence[1].label).toBe('Line 1')
    expect(hit.evidence[1].quote).toContain('if (x {')
    expect(hit.fix?.explanation).toContain(
      'Add the missing closing delimiter before line 2; the block opened at line 1.',
    )
  })

  it('stays silent when every delimiter is balanced', () => {
    const text = 'x = (1 + 2)\ny = 2\nfunc broken(:\n'
    const root = node({ text: 'func broken(:', error: true, row: 2, startIndex: 15, endIndex: 27 })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit.message).not.toContain('opened at')
    expect(hit.evidence).toHaveLength(1)
    expect(hit.fix?.explanation).toContain('Compare this line with the language grammar')
  })

  it('does not repeat the finding line as a second location', () => {
    const text = 'x = ( y = 2\n'
    const root = node({ text: 'y = 2', error: true, row: 0, column: 6, startIndex: 6, endIndex: 11 })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit.message).not.toContain('opened at')
    expect(hit.evidence).toHaveLength(1)
  })

  it('ignores delimiters inside strings', () => {
    const text = 's = "("\nx = 1\ndef broken(:\n'
    const root = node({ text: 'def broken(:', error: true, row: 2, startIndex: 13, endIndex: 25 })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit.message).not.toContain('opened at')
  })

  it('ignores delimiters inside block comments and finds the real opener', () => {
    const text = '/* } */\nint f(void) {\n  int x = 1;\nint broken(void) {\n'
    const root = node({ text: 'int broken(void) {', error: true, row: 3, startIndex: 34, endIndex: 52 })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'c' }).hits
    expect(hit.message).toContain('opened at line 2')
    expect(hit.evidence[1].quote).toContain('int f(void) {')
  })

  it('reports the ruby delimiter when `end` cannot close it', () => {
    const text =
      'def normalise_region(text)\n  text.downcase(\nend\n\ndef evaluate_region\n  text.strip\nend\n'
    const root = node({ text: 'def evaluate_region', error: true, row: 4, startIndex: 49, endIndex: 67 })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'ruby' }).hits
    expect(hit.message).toContain('Syntax error near "def" at line 5')
    expect(hit.message).toContain('opened at line 2')
    expect(hit.evidence[1].label).toBe('Line 2')
    expect(hit.evidence[1].quote).toContain('text.downcase(')
    expect(hit.fix?.explanation).toContain('before line 5; the block opened at line 2')
  })

  it('redacts a credential on the opened-at line', () => {
    const text = `password = "${FAKE_GITHUB}"  (\ndef broken(:\n`
    const root = node({ text: 'def broken(:', error: true, row: 1, startIndex: 61, endIndex: 73 })
    const [hit] = scanSyntax({ file: ruleFile(text), root, grammar: 'python' }).hits
    expect(hit.evidence).toHaveLength(2)
    expect(hit.evidence[1].quote).not.toContain(FAKE_GITHUB)
    expect(hit.evidence[1].quote).toContain('redacted')
  })
})
