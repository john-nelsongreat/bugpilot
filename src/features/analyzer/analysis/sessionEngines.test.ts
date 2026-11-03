import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveSkippedEntry } from '../archive/guard'
import { manualFix } from '../rules/context'
import type { AnalyzerFinding } from '../types'
import type { AnalyzerClient } from './analyzerClient'
import type { FileAnalysis } from './engine'
import { makeFinding } from './finding'
import { analyzeUpload, type AnalyzeUploadOptions } from './session'
import { ENGINES_NOT_RUN_REASON } from './coverage'
import { ENGINES_UNAVAILABLE_MESSAGE } from '../engines/featureProbe'
import type { EngineClient, EngineRunOptions, EngineRunOutcome } from '../engines/engineClient'
import type { EngineFileResult, EngineHit } from '../engines/protocol'

const STATS = {
  walkedRecords: 1,
  producedBytes: 10,
  entries: 1,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 10,
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

function readResult(entries: ArchiveEntry[], skipped: ArchiveSkippedEntry[] = []): ArchiveReadResult {
  return { refusal: null, entries, skipped, stats: { ...STATS, entries: entries.length, skipped: skipped.length } }
}

function patternFinding(file: string, ruleId: string, startLine: number): AnalyzerFinding {
  return makeFinding({
    ruleId,
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: 'Medium',
    confidence: { level: 'low', reason: 'Text pattern.' },
    file,
    range: { startLine, startColumn: 1, endLine: startLine, endColumn: 5 },
    evidence: [{ source: 'code snippet', label: `Line ${startLine}`, quote: 'try {', lineNumber: startLine }],
    message: 'Pattern match.',
    explanation: 'Pattern match.',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

function analysis(file: string, findings: AnalyzerFinding[] = []): FileAnalysis {
  return { file, findings, notes: [], rulesRan: ['bugpilot/generic/empty-catch'], stoppedEarly: false }
}

function fakeAnalyzer(result: FileAnalysis[]): AnalyzerClient {
  return {
    async analyze(entries, options) {
      options?.onProgress?.({ phase: 'rules', filesDone: entries.length, filesTotal: entries.length, findings: 0 })
      return { files: result, cancelled: false, error: null }
    },
  }
}

function engineHit(overrides: Partial<EngineHit> & { ruleId: string; startLine: number }): EngineHit {
  const isRuff = overrides.ruleId.startsWith('ruff/')
  return {
    engine: isRuff ? 'ruff' : 'tree-sitter',
    tier: 'pattern',
    severity: 'Medium',
    confidence: { level: 'medium', reason: 'The grammar matched this node.' },
    range: { startLine: overrides.startLine, startColumn: 1, endLine: overrides.startLine, endColumn: 5 },
    evidence: [
      { source: 'code snippet', label: `Line ${overrides.startLine}`, quote: 'except: pass', lineNumber: overrides.startLine },
    ],
    message: 'Engine message.',
    explanation: 'Engine explanation.',
    fix: manualFix('Rewrite the construct.', 'Any file with this shape.', 'manual-only', 'Only a person can judge intent here.'),
    verificationSteps: ['Read the line.'],
    limitations: ['The grammar reads shape, not behaviour.'],
    ...overrides,
  }
}

function outcome(overrides: Partial<EngineRunOutcome> = {}): EngineRunOutcome {
  return {
    files: [],
    filesNotRun: [],
    cancelled: false,
    unavailable: null,
    error: null,
    ...overrides,
  }
}

function fakeEngineClient(result: EngineRunOutcome, files: EngineFileResult[] = []) {
  const run = vi.fn(async (_entries: readonly ArchiveEntry[], _options?: EngineRunOptions) => ({ ...result, files }))
  const client: EngineClient = { run }
  return { client, run }
}

function options(overrides: Partial<AnalyzeUploadOptions> = {}): AnalyzeUploadOptions {
  return { archiveBytes: 4, generatedAt: new Date('2026-01-02T03:04:05Z'), ...overrides }
}

describe('analysis session deep pass', () => {
  it('never starts the engine worker when the user did not approve the pass', async () => {
    const entries = [entry('app.py', 'import os\n'), entry('notes.md', '# hi\n')]
    const createEngineClient = vi.fn(async () => {
      throw new Error('must not be constructed')
    })

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options(),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py'), analysis('notes.md')]),
        createEngineClient,
      },
    )

    expect(createEngineClient).not.toHaveBeenCalled()
    const python = result.report?.coverage.find((item) => item.file === 'app.py')
    expect(python?.tiers.find((tier) => tier.tier === 'syntax')?.ran).toBe(false)
    expect(python?.tiers.find((tier) => tier.tier === 'syntax')?.reason).toBe(ENGINES_NOT_RUN_REASON)
  })

  it('does not offer the deep pass at all for a pattern-only upload', async () => {
    const entries = [entry('notes.md', '# hi\n')]
    const createEngineClient = vi.fn(async () => {
      throw new Error('must not be constructed')
    })

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      { readLoose: async () => readResult(entries), analyzer: fakeAnalyzer([analysis('notes.md')]), createEngineClient },
    )

    expect(result.status).toBe('completed')
    expect(createEngineClient).not.toHaveBeenCalled()
  })

  it('merges engine findings and marks the tiers that ran', async () => {
    const entries = [entry('app.py', 'import os\nexcept: pass\n')]
    const engine = fakeEngineClient(
      outcome(),
      [
        {
          file: 'app.py',
          hits: [engineHit({ ruleId: 'tree-sitter/syntax-error', startLine: 2, tier: 'syntax', severity: 'High' })],
          enginesRan: ['tree-sitter', 'ruff'],
          parse: 'parsed',
          notes: ['Ruff checked 1 file at a time.'],
        },
      ],
    )

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py')]),
        createEngineClient: async () => engine.client,
      },
    )

    const finding = result.report?.findings.find((item) => item.ruleId === 'tree-sitter/syntax-error')
    expect(finding).toMatchObject({ analyzer: 'tree-sitter', tier: 'syntax', severity: 'High' })
    const coverage = result.report?.coverage.find((item) => item.file === 'app.py')
    expect(coverage?.tiers.find((tier) => tier.tier === 'syntax')?.ran).toBe(true)
    expect(coverage?.tiers.find((tier) => tier.tier === 'pattern')?.ran).toBe(true)
    expect(coverage?.notes).toContain('Ruff checked 1 file at a time.')
    expect(coverage?.tiers.find((tier) => tier.tier === 'syntax')?.reason).toContain('tree-sitter and ruff')
  })

  it('sends only the languages a deep engine owns to the worker', async () => {
    const entries = [entry('app.py', 'x = 1\n'), entry('Main.java', 'class A {}\n'), entry('notes.md', '# hi\n')]
    const engine = fakeEngineClient(outcome())

    await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py'), analysis('Main.java'), analysis('notes.md')]),
        createEngineClient: async () => engine.client,
      },
    )

    expect(engine.run.mock.calls[0][0].map((item) => item.name)).toEqual(['app.py', 'Main.java'])
  })

  it('replaces a pattern match the syntax tree confirms on the same line', async () => {
    const entries = [entry('app.py', 'try:\n    x = 1\nexcept:\n    pass\n')]
    const engine = fakeEngineClient(
      outcome(),
      [
        {
          file: 'app.py',
          hits: [engineHit({ ruleId: 'bugpilot/ast/empty-catch', startLine: 3 })],
          enginesRan: ['tree-sitter'],
          parse: 'parsed',
          notes: [],
        },
      ],
    )

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([
          analysis('app.py', [patternFinding('app.py', 'bugpilot/generic/empty-catch', 3)]),
        ]),
        createEngineClient: async () => engine.client,
      },
    )

    const rules = result.report?.findings.filter((item) => item.file === 'app.py').map((item) => item.ruleId)
    expect(rules).toEqual(['bugpilot/ast/empty-catch'])
    const coverage = result.report?.coverage.find((item) => item.file === 'app.py')
    expect(coverage?.notes.join(' ')).toContain('replaced by the syntax-tree result for the same line')
  })

  it('keeps a pattern match on a different line', async () => {
    const entries = [entry('app.py', 'x = 1\n')]
    const engine = fakeEngineClient(
      outcome(),
      [
        {
          file: 'app.py',
          hits: [engineHit({ ruleId: 'bugpilot/ast/empty-catch', startLine: 9 })],
          enginesRan: ['tree-sitter'],
          parse: 'parsed',
          notes: [],
        },
      ],
    )

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py', [patternFinding('app.py', 'bugpilot/generic/empty-catch', 3)])]),
        createEngineClient: async () => engine.client,
      },
    )

    expect(result.report?.findings.map((item) => item.ruleId)).toEqual([
      'bugpilot/generic/empty-catch',
      'bugpilot/ast/empty-catch',
    ])
  })

  it('says the engines were unavailable instead of inventing a time budget', async () => {
    const entries = [entry('app.py', 'x = 1\n')]
    const engine = fakeEngineClient(
      outcome({
        unavailable: { ok: false, code: 'blocked-by-policy', message: 'CSP refuses wasm-unsafe-eval' },
        filesNotRun: ['app.py'],
      }),
    )

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py')]),
        createEngineClient: async () => engine.client,
      },
    )

    expect(result.status).toBe('completed')
    expect(result.report?.limitations).toContain(ENGINES_UNAVAILABLE_MESSAGE)
    expect(result.report?.limitations.join(' ')).not.toContain('time budget ran out')
    const coverage = result.report?.coverage.find((item) => item.file === 'app.py')
    expect(coverage?.skipReason ?? '').toBe('')
    expect(coverage?.tiers.find((tier) => tier.tier === 'syntax')?.ran).toBe(false)
    expect(coverage?.tiers.find((tier) => tier.tier === 'syntax')?.reason).toContain('WebAssembly was refused')
  })

  it('names the files the budget did not reach', async () => {
    const entries = [entry('a.py', 'x = 1\n'), entry('b.py', 'y = 2\n')]
    const engine = fakeEngineClient(
      outcome({ filesNotRun: ['b.py'] }),
      [
        {
          file: 'a.py',
          hits: [engineHit({ ruleId: 'ruff/F401', startLine: 1 })],
          enginesRan: ['tree-sitter', 'ruff'],
          parse: 'parsed',
          notes: [],
        },
      ],
    )

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('a.py'), analysis('b.py')]),
        createEngineClient: async () => engine.client,
      },
    )

    expect(result.report?.limitations.join(' ')).toContain('1 file(s) were not reached by the deep engines')
    const coverage = result.report?.coverage.find((item) => item.file === 'b.py')
    expect(coverage?.tiers.find((tier) => tier.tier === 'syntax')?.reason).toContain('time budget for the deep engines ran out')
  })

  it('keeps the report when the engine run stops early', async () => {
    const entries = [entry('app.py', 'x = 1\n')]
    const engine = fakeEngineClient(outcome({ error: 'The deep engines stopped unexpectedly.' }))

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py')]),
        createEngineClient: async () => engine.client,
      },
    )

    expect(result.status).toBe('completed')
    expect(result.report?.limitations.join(' ')).toContain('The deep engines stopped early')
  })

  it('records an engine worker that cannot start as missing coverage', async () => {
    const entries = [entry('app.py', 'x = 1\n')]
    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py')]),
        createEngineClient: async () => {
          throw new Error('new Worker is blocked')
        },
      },
    )

    const coverage = result.report?.coverage.find((item) => item.file === 'app.py')
    expect(coverage?.tiers.find((tier) => tier.tier === 'syntax')?.reason).toContain(
      'The deep-engine worker could not start (new Worker is blocked)',
    )
  })

  it('cancels the whole session when the deep pass is cancelled', async () => {
    const entries = [entry('app.py', 'x = 1\n')]
    const engine = fakeEngineClient(outcome({ cancelled: true, filesNotRun: ['app.py'] }))

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py')]),
        createEngineClient: async () => engine.client,
      },
    )

    expect(result.status).toBe('cancelled')
  })

  it('reports the engine progress phase for each file', async () => {
    const entries = [entry('app.py', 'x = 1\n')]
    const engine: EngineClient = {
      run: async (_files, runOptions) => {
        runOptions?.onProgress?.(1, 1, 'app.py')
        return outcome()
      },
    }
    const onProgress = vi.fn()

    await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved', onProgress }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py')]),
        createEngineClient: async () => engine,
      },
    )

    const phases = onProgress.mock.calls.map((call) => (call[0] as { phase: string }).phase)
    expect(phases).toContain('engines')
    expect(phases[phases.length - 1]).toBe('engines')
    expect(onProgress.mock.calls.map((call) => (call[0] as { detail: string }).detail).join(' ')).toContain(
      'probing WebAssembly support',
    )
  })

  it('keeps engine findings manual-only, including the Ruff ones', async () => {
    const entries = [entry('app.py', 'import os\n')]
    const engine = fakeEngineClient(
      outcome(),
      [
        {
          file: 'app.py',
          hits: [engineHit({ ruleId: 'ruff/F401', startLine: 1 })],
          enginesRan: ['ruff'],
          parse: 'parsed',
          notes: [],
        },
      ],
    )

    const result = await analyzeUpload(
      { kind: 'files', sources: [] },
      options({ engines: 'approved' }),
      {
        readLoose: async () => readResult(entries),
        analyzer: fakeAnalyzer([analysis('app.py')]),
        createEngineClient: async () => engine.client,
      },
    )

    const finding = result.report?.findings.find((item) => item.ruleId === 'ruff/F401')
    expect(finding?.fix?.riskClass).toBe('manual-only')
    expect(finding?.analyzer).toBe('ruff')
  })
})
