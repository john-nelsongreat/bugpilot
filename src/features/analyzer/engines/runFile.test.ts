import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import type { GrammarId } from './assets'
import { DownloadError, loadGrammar } from './treeSitter'
import type { RuffDiagnostic } from './ruff'
import { DEFAULT_ENGINE_LIMITS, type EngineHit } from './protocol'
import { dedupeEngineHits, runEngineFile, type EngineRunContext } from './runFile'

/**
 * The engine plumbing is tested here with the wasm modules replaced: which engine ran, what a
 * failure becomes, what the budgets do. The engines themselves are proven against the real
 * binaries in `*.realGrammar.test.ts` and `ruff.wasm.test.ts`.
 */
interface FakeTree {
  rootNode: FakeNode
  delete(): void
}

interface EngineState {
  loadError: unknown
  startError: unknown
  diagnostics: object[]
  parserBuilt: number
  queriesBuilt: number
  queriesDeleted: number
  parse: ((text: string) => FakeTree | null) | null
}

const state = vi.hoisted((): EngineState => ({
  loadError: null,
  startError: null,
  diagnostics: [],
  parserBuilt: 0,
  queriesBuilt: 0,
  queriesDeleted: 0,
  parse: null,
}))

vi.mock('./treeSitter', () => ({
  Language: class {},
  Parser: class {
    language: unknown = null

    constructor() {
      state.parserBuilt += 1
    }

    setLanguage(language: unknown): void {
      this.language = language
    }

    parse(text: string): unknown {
      return state.parse ? state.parse(text) : null
    }

    delete(): void {}
  },
  Query: class {
    constructor(_language: unknown, _source: string) {
      state.queriesBuilt += 1
    }

    matches(_root: unknown): never[] {
      return []
    }

    delete(): void {
      state.queriesDeleted += 1
    }
  },
  initTreeSitter: async (): Promise<void> => undefined,
  loadGrammar: vi.fn(
    async (grammar: string, _maxBytes: number, _signal: unknown, onDownloading?: (url: string) => void): Promise<unknown> => {
      if (state.loadError) throw state.loadError
      onDownloading?.(`/assets/engines/tree-sitter-${grammar}.wasm`)
      return { grammar }
    },
  ),
  grammarUrls: () => [],
  DownloadError: class DownloadError extends Error {
    code: string

    constructor(code: string, message: string) {
      super(message)
      this.name = 'DownloadError'
      this.code = code
    }
  },
}))

vi.mock('./ruff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ruff')>()
  return {
    ...actual,
    RuffRunner: class {
      async start(_maxBytes: number, _signal?: unknown, onDownloading?: (url: string) => void): Promise<void> {
        if (state.startError) throw state.startError
        onDownloading?.('/assets/engines/ruff_wasm_bg.wasm')
      }

      check(): object[] {
        return state.diagnostics
      }
    },
  }
})

interface NodeSpec {
  type?: string
  text?: string
  row?: number
  column?: number
  error?: boolean
  missing?: boolean
  children?: (NodeSpec | FakeNode)[]
}

interface FakeNode {
  id: number
  type: string
  startIndex: number
  endIndex: number
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  text: string
  childCount: number
  isError: boolean
  isMissing: boolean
  hasError: boolean
  child(index: number): FakeNode | null
}

let nextId = 1

function isBuilt(value: NodeSpec | FakeNode): value is FakeNode {
  return 'isError' in value && 'childCount' in value
}

function node(spec: NodeSpec = {}): FakeNode {
  const row = spec.row ?? 0
  const column = spec.column ?? 0
  const children = (spec.children ?? []).map((child) => (isBuilt(child) ? child : node(child)))
  const text = spec.text ?? 'x'
  return {
    id: nextId++,
    type: spec.type ?? 'module',
    text,
    startIndex: 0,
    endIndex: text.length,
    startPosition: { row, column },
    endPosition: { row, column: column + text.length },
    childCount: children.length,
    isError: spec.error === true,
    isMissing: spec.missing === true,
    hasError: children.some((child) => child.isError || child.hasError) || spec.error === true || spec.missing === true,
    child: (index: number) => children[index] ?? null,
  }
}

function tree(rootNode: FakeNode): FakeTree {
  return { rootNode, delete: () => undefined }
}

function cleanTree(): FakeTree {
  return tree(node({ text: 'ok', children: [node({ text: 'import os' })] }))
}

function errorTree(row: number): FakeTree {
  return tree(node({ text: 'whole file', children: [node({ type: 'ERROR', text: 'def load(:', row, error: true })] }))
}

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: text.length,
  }
}

function context(overrides: Partial<EngineRunContext> = {}): EngineRunContext {
  return {
    limits: { ...DEFAULT_ENGINE_LIMITS },
    runStartedAt: Date.now(),
    ...overrides,
  }
}

function diagnostic(code: string, row: number): RuffDiagnostic {
  return {
    code,
    message: `${code} test diagnostic`,
    start_location: { row, column: 0 },
    end_location: { row, column: 5 },
  }
}

const PY = 'import os\ndef load(:\n'

afterEach(() => {
  vi.restoreAllMocks()
  state.loadError = null
  state.startError = null
  state.diagnostics = []
  state.parse = () => cleanTree()
})

describe('engine file run', () => {
  it('skips a language no engine owns', async () => {
    state.parse = () => cleanTree()
    const result = await runEngineFile(entry('notes.scala', 'object A\n'), context())
    expect(result.parse).toBe('no-grammar')
    expect(result.enginesRan).toEqual([])
    expect(result.hits).toEqual([])
  })

  it('refuses an oversized file before any engine loads', async () => {
    state.parse = () => cleanTree()
    const loaded = vi.mocked(loadGrammar)
    const before = loaded.mock.calls.length
    const result = await runEngineFile(entry('big/app.py', 'x'.repeat(500)), context({ limits: { ...DEFAULT_ENGINE_LIMITS, maxFileBytes: 100 } }))

    expect(loaded.mock.calls.length).toBe(before)
    expect(result.notes[0]).toContain('over the 100 character engine limit')
    expect(result.enginesRan).toEqual([])
  })

  it('records an unavailable grammar as missing coverage and still runs Ruff', async () => {
    state.parse = () => cleanTree()
    state.loadError = new DownloadError('too-large', 'the grammar is 40 MB')
    state.diagnostics = [diagnostic('F401', 1)]

    const result = await runEngineFile(entry('app/app.py', PY), context())

    expect(result.parse).toBe('engine-unavailable')
    expect(result.notes.join('\n')).toContain('The python grammar could not be loaded: the grammar is 40 MB')
    expect(result.enginesRan).toEqual(['ruff'])
    expect(result.hits.map((hit) => hit.ruleId)).toEqual(['ruff/F401'])
  })

  it('runs tree-sitter and Ruff over one Python file', async () => {
    state.parse = () => cleanTree()
    state.diagnostics = [diagnostic('F401', 1)]

    const result = await runEngineFile(entry('app/app.py', PY), context())

    expect(result.parse).toBe('parsed')
    expect(result.enginesRan).toEqual(['tree-sitter', 'ruff'])
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]).toMatchObject({ ruleId: 'ruff/F401', tier: 'pattern', engine: 'ruff' })
  })

  it('keeps the syntax findings the grammar produced', async () => {
    state.parse = () => errorTree(1)
    state.diagnostics = []

    const result = await runEngineFile(entry('app/app.py', PY), context())

    expect(result.parse).toBe('parsed')
    expect(result.hits.map((hit) => hit.ruleId)).toEqual(['tree-sitter/syntax-error'])
    expect(result.hits[0]?.range.startLine).toBe(2)
  })

  it('sorts findings from both engines by line', async () => {
    state.parse = () => errorTree(1)
    state.diagnostics = [diagnostic('F841', 5), diagnostic('E722', 2)]

    const result = await runEngineFile(entry('app/app.py', 'a = 1\nimport os\ndef f():\n    x = 1\n    return\n'), context())

    expect(result.hits.map((hit) => hit.range.startLine)).toEqual([2, 2, 5])
  })

  it('collapses a repeated engine result on the same line', async () => {
    state.parse = () => cleanTree()
    state.diagnostics = [diagnostic('F401', 1), diagnostic('F401', 1)]

    const result = await runEngineFile(entry('app/app.py', PY), context())
    expect(result.hits).toHaveLength(1)
  })

  it('records a grammar that rejects the file as coverage, not as a bug', async () => {
    state.parse = () => errorTree(0)
    state.diagnostics = []

    const result = await runEngineFile(entry('db/report.sql', 'SELECT 1\n'), context())

    expect(result.parse).toBe('grammar-did-not-understand')
    expect(result.hits).toEqual([])
    expect(result.notes.join(' ')).toContain('recorded as missing coverage instead of as a bug')
    expect(result.enginesRan).toEqual(['tree-sitter'])
  })

  it('isolates a parser crash and keeps checking with the other engine', async () => {
    state.parse = () => {
      throw new Error('grammar panicked')
    }
    state.diagnostics = [diagnostic('F401', 1)]

    const result = await runEngineFile(entry('app/app.py', PY), context())

    expect(result.parse).toBe('engine-stopped-early')
    expect(result.notes.join(' ')).toContain('The tree-sitter engine stopped on this file (grammar panicked)')
    expect(result.enginesRan).toEqual(['ruff'])
    expect(result.hits).toHaveLength(1)
  })

  it('isolates a Ruff failure without losing the tree-sitter findings', async () => {
    state.parse = () => errorTree(1)
    state.startError = new DownloadError('failed', 'ruff_wasm_bg.wasm is missing')

    const result = await runEngineFile(entry('app/app.py', PY), context())

    expect(result.parse).toBe('parsed')
    expect(result.enginesRan).toEqual(['tree-sitter'])
    expect(result.notes.join(' ')).toContain('Ruff could not check this file: ruff_wasm_bg.wasm is missing')
    expect(result.hits.map((hit) => hit.ruleId)).toEqual(['tree-sitter/syntax-error'])
  })

  it('reports a parser that returned no tree', async () => {
    state.parse = () => null
    state.diagnostics = []

    const result = await runEngineFile(entry('app/app.py', PY), context())

    expect(result.parse).toBe('engine-stopped-early')
    expect(result.notes.join(' ')).toContain('The parser returned no tree for this file.')
  })

  it('stops before parsing when the per-file budget is already spent', async () => {
    state.parse = () => cleanTree()
    state.diagnostics = [diagnostic('F401', 1)]

    const result = await runEngineFile(
      entry('app/app.py', PY),
      context({ limits: { ...DEFAULT_ENGINE_LIMITS, perFileBudgetMs: -1 } }),
    )

    expect(result.parse).toBe('engine-stopped-early')
    expect(result.notes.join(' ')).toContain('time budget ran out before this file could be parsed')
    expect(result.enginesRan).toEqual([])
  })

  it('stops before Ruff when the whole run is out of time', async () => {
    let clock = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    // The grammar loads quickly, then the parse itself eats the remaining budget.
    state.parse = () => {
      clock = 6_000
      return cleanTree()
    }
    state.diagnostics = [diagnostic('F401', 1)]

    const result = await runEngineFile(
      entry('app/app.py', PY),
      context({ runStartedAt: 1_000, limits: { ...DEFAULT_ENGINE_LIMITS, totalBudgetMs: 100 } }),
    )

    expect(result.parse).toBe('parsed')
    expect(result.enginesRan).toEqual(['tree-sitter'])
    expect(result.notes.join(' ')).toContain('before Ruff could check this file')
  })

  it('honours a cancel that arrives while the file is open', async () => {
    state.parse = () => cleanTree()
    state.diagnostics = [diagnostic('F401', 1)]
    const controller = new AbortController()
    controller.abort()

    const result = await runEngineFile(entry('app/app.py', PY), context({ signal: controller.signal }))

    expect(result.parse).toBe('engine-stopped-early')
    expect(result.hits).toEqual([])
  })

  it('keeps the cap and says how many findings were dropped', async () => {
    state.parse = () => cleanTree()
    state.diagnostics = [diagnostic('F401', 1), diagnostic('F841', 3), diagnostic('E722', 5)]

    const result = await runEngineFile(
      entry('app/app.py', PY),
      context({ limits: { ...DEFAULT_ENGINE_LIMITS, maxHitsPerFile: 2 } }),
    )

    expect(result.hits).toHaveLength(2)
    expect(result.notes.join(' ')).toContain('Only the first 2 engine findings are kept; 1 more were dropped.')
  })

  it('announces every engine file before it downloads', async () => {
    state.parse = () => cleanTree()
    state.diagnostics = []
    const onDownloading = vi.fn()

    await runEngineFile(entry('app/app.py', PY), context({ onDownloading }))

    expect(onDownloading.mock.calls.map((call) => call[0])).toEqual([
      '/assets/engines/tree-sitter-python.wasm',
      '/assets/engines/ruff_wasm_bg.wasm',
    ])
  })

  it('builds one parser per grammar and releases every query', async () => {
    state.parse = () => cleanTree()
    state.diagnostics = []
    const before = state.parserBuilt

    await runEngineFile(entry('a/Main.java', 'class A {}\n'), context())
    await runEngineFile(entry('b/Main.java', 'class B {}\n'), context())

    expect(state.parserBuilt - before).toBe(1)
    expect(state.queriesDeleted).toBe(state.queriesBuilt)
  })

  it('never hands an unknown grammar name to the loader', async () => {
    state.parse = () => cleanTree()
    await runEngineFile(entry('src/App.swift', 'struct A {}\n'), context())
    expect(vi.mocked(loadGrammar).mock.calls.at(-1)?.[0]).toBe<GrammarId>('swift')
  })
})

function hit(ruleId: string, startLine: number, level: EngineHit['confidence']['level']): EngineHit {
  return {
    ruleId,
    engine: ruleId.startsWith('ruff/') ? 'ruff' : 'tree-sitter',
    tier: 'pattern',
    severity: 'Medium',
    confidence: { level, reason: 'Test.' },
    range: { startLine, startColumn: 1, endLine: startLine, endColumn: 5 },
    evidence: [],
    message: `${ruleId} at ${startLine}`,
    explanation: 'Test.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  }
}

describe('engine hit de-duplication', () => {
  it('keeps one result per rule per line', () => {
    const kept = dedupeEngineHits([hit('ruff/F401', 1, 'high'), hit('ruff/F401', 1, 'medium'), hit('ruff/F401', 2, 'high')])
    expect(kept.map((item) => `${item.ruleId}:${item.range.startLine}`)).toEqual(['ruff/F401:1', 'ruff/F401:2'])
  })

  it('replaces a pattern-level twin with the engine that describes the same line', () => {
    for (const [ast, ruff] of [
      ['bugpilot/ast/python-bare-except', 'ruff/E722'],
      ['bugpilot/ast/empty-catch', 'ruff/S110'],
      ['bugpilot/ast/sql-built-by-concatenation', 'ruff/S608'],
    ]) {
      const forward = dedupeEngineHits([hit(ast, 7, 'medium'), hit(ruff, 7, 'high')])
      expect(forward.map((item) => item.ruleId)).toEqual([ruff])

      // The order the engines finished in must not change which result survives.
      const backward = dedupeEngineHits([hit(ruff, 7, 'high'), hit(ast, 7, 'medium')])
      expect(backward.map((item) => item.ruleId)).toEqual([ruff])
    }
  })

  it('leaves two different problems on one line alone', () => {
    const kept = dedupeEngineHits([hit('ruff/F401', 3, 'high'), hit('ruff/E722', 3, 'high')])
    expect(kept).toHaveLength(2)
  })

  it('does not merge the same pair on different lines', () => {
    const kept = dedupeEngineHits([hit('bugpilot/ast/python-bare-except', 3, 'medium'), hit('ruff/E722', 9, 'high')])
    expect(kept).toHaveLength(2)
  })
})
