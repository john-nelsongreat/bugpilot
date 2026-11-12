import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerClient } from './analyzerClient'
import { analyzeEntries } from './engine'
import { makeFinding } from './finding'
import type { AnalyzerFinding } from '../types'
import type { TsCheckResult, TsSyntaxClient } from './typescript/tsClient'
import type { FixCandidate } from '../fixes/types'
import { proposeFix } from '../fixes/proposeFix'
import { verifyFixCandidates } from './verifyFixes'

const FAKE = ['Zq9', 'vT4k', 'Wm8p', 'Rc2s', 'Ld7N'].join('')
const CREDENTIAL_RULE = 'bugpilot/secret/credential-assignment'
const HTTP_RULE = 'bugpilot/generic/insecure-http-url'
const JSON_RULE = 'bugpilot/syntax/json'
const TS_RULE = 'bugpilot/typescript/syntax'

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

function findingsOf(source: ArchiveEntry): AnalyzerFinding[] {
  return analyzeEntries([source]).files[0].findings
}

function findingFor(source: ArchiveEntry, ruleId: string): AnalyzerFinding {
  const finding = findingsOf(source).find((item) => item.ruleId === ruleId)
  if (!finding) throw new Error(`No ${ruleId} finding`)
  return finding
}

function realAnalyzer(): AnalyzerClient {
  return {
    async analyze(entries) {
      return { files: analyzeEntries(entries).files, cancelled: false, error: null }
    },
  }
}

function tsResult(overrides: Partial<TsCheckResult> = {}): TsCheckResult {
  return { findings: [], timedOut: false, cancelled: false, error: null, ...overrides }
}

function tsClient(result: TsCheckResult): TsSyntaxClient {
  return {
    async check() {
      return result
    },
    dispose() {},
  }
}

/**
 * A document the JSONC dialect read does NOT rescue: a doubled comma is still a syntax error
 * after comments and single trailing commas are tolerated, so `bugpilot/syntax/json` genuinely
 * reports it. Used only by the test whose subject is the verifier's own JSON re-parse guard,
 * which needs a real finding and a deliberately broken hand-made edit.
 */
const TOLERANCE_PROOF = '{"a": 1,,}\n'

function httpSource(): ArchiveEntry {
  return entry('src/api.js', 'const endpoint = "http://cdn.acme-widgets.com/assets.json"\n')
}

function tsFinding(message: string): AnalyzerFinding {
  return makeFinding({
    ruleId: TS_RULE,
    analyzer: 'typescript',
    tier: 'syntax',
    severity: 'High',
    confidence: { level: 'high', reason: 'test' },
    file: 'src/app.ts',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
    evidence: [],
    message,
    explanation: 'test',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

function criticalFinding(message: string): AnalyzerFinding {
  return makeFinding({
    ruleId: 'bugpilot/secret/aws-access-key',
    analyzer: 'bugpilot-rules',
    tier: 'pattern',
    severity: 'Critical',
    confidence: { level: 'high', reason: 'test' },
    file: 'src/app.ts',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
    evidence: [],
    message,
    explanation: 'test',
    fix: null,
    verificationSteps: [],
    limitations: [],
  })
}

describe('fix verification', () => {
  it('verifies a fix by re-running the real rules on the changed copy', async () => {
    const source = httpSource()
    const finding = findingFor(source, HTTP_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate
    expect(candidate.ruleId).toBe(HTTP_RULE)
    const seen: string[] = []

    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        entries.forEach((item) => seen.push(item.name))
        return { files: analyzeEntries(entries).files, cancelled: false, error: null }
      },
    }
    const outcome = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer,
      createTsClient: async () => tsClient(tsResult()),
    })

    expect(outcome.verified).toHaveLength(1)
    expect(outcome.dropped).toHaveLength(0)
    expect(seen[0]).toContain('__bugpilot_verify__/0/src/api.js')
  })

  it('drops a fix when the target finding is still reported', async () => {
    const source = entry('src/app.ts', `const apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate

    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item) => ({
            file: item.name,
            findings: [{ ...finding, file: item.name }],
            notes: [],
            rulesRan: [],
            stoppedEarly: false,
          })),
          cancelled: false,
          error: null,
        }
      },
    }
    const outcome = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer,
      createTsClient: async () => tsClient(tsResult()),
    })

    expect(outcome.verified).toHaveLength(0)
    expect(outcome.dropped[0].reason).toContain('still present')
  })

  it('drops a fix that introduces a finding of equal or higher severity', async () => {
    const source = entry('src/app.ts', `const apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate

    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item) => ({
            file: item.name,
            findings: [criticalFinding('A new critical problem')],
            notes: [],
            rulesRan: [],
            stoppedEarly: false,
          })),
          cancelled: false,
          error: null,
        }
      },
    }
    const outcome = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer,
      createTsClient: async () => tsClient(tsResult()),
    })

    expect(outcome.verified).toHaveLength(0)
    expect(outcome.dropped[0].reason).toContain('introduced a new')
  })

  it('allows a new lower-severity finding when the target is critical', async () => {
    const source = entry('src/app.ts', `const apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate
    const low = makeFinding({
      ruleId: 'bugpilot/generic/todo-marker',
      analyzer: 'bugpilot-rules',
      tier: 'pattern',
      severity: 'Low',
      confidence: { level: 'high', reason: 'test' },
      file: 'src/app.ts',
      range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
      evidence: [],
      message: 'TODO at line 1',
      explanation: 'test',
      fix: null,
      verificationSteps: [],
      limitations: [],
    })

    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item) => ({
            file: item.name,
            findings: [low],
            notes: [],
            rulesRan: [],
            stoppedEarly: false,
          })),
          cancelled: false,
          error: null,
        }
      },
    }
    const outcome = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer,
      createTsClient: async () => tsClient(tsResult()),
    })

    expect(outcome.verified).toHaveLength(1)
  })

  it('drops a JSON fix whose result still does not parse', async () => {
    const source = entry('data/config.json', TOLERANCE_PROOF)
    const finding = findingFor(source, JSON_RULE)
    const candidate: FixCandidate = {
      findingId: finding.id,
      ruleId: JSON_RULE,
      file: source.name,
      targetStartLine: 1,
      targetEndLine: 1,
      edits: [{ file: source.name, startOffset: 1, endOffset: 2, newText: '' }],
      description: 'test',
      riskClass: 'safe',
      behaviourChange: false,
      warnings: [],
      maskedSpans: [],
    }

    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item) => ({ file: item.name, findings: [], notes: [], rulesRan: [], stoppedEarly: false })),
          cancelled: false,
          error: null,
        }
      },
    }
    const outcome = await verifyFixCandidates([candidate], [source], findingsOf(source), { analyzer })
    expect(outcome.verified).toHaveLength(0)
    expect(outcome.dropped[0].reason).toContain('not valid JSON')
  })

  it('drops a TS fix that introduces a new syntax diagnostic', async () => {
    const source = entry('src/app.ts', `const apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate

    const outcome = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer: realAnalyzer(),
      createTsClient: async () => tsClient(tsResult({ findings: [tsFinding("TypeScript syntax error TS1005: ';' expected.")] })),
    })

    expect(outcome.verified).toHaveLength(0)
    expect(outcome.dropped[0].reason).toContain('introduced a new syntax diagnostic')
  })

  it('allows a pre-existing syntax diagnostic to remain', async () => {
    const source = entry('src/app.ts', `const apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate
    const baseline = [...findingsOf(source), tsFinding('TypeScript syntax error TS1005: legacy.')]

    const outcome = await verifyFixCandidates([candidate], [source], baseline, {
      analyzer: realAnalyzer(),
      createTsClient: async () => tsClient(tsResult({ findings: [tsFinding('TypeScript syntax error TS1005: legacy.')] })),
    })

    expect(outcome.verified).toHaveLength(1)
  })

  it('drops TS candidates when the syntax checker fails or times out', async () => {
    const source = entry('src/app.ts', `const apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate

    const failed = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer: realAnalyzer(),
      createTsClient: async () => tsClient(tsResult({ error: 'worker crashed' })),
    })
    expect(failed.dropped[0].reason).toContain('syntax re-check failed')

    const timedOut = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer: realAnalyzer(),
      createTsClient: async () => tsClient(tsResult({ timedOut: true })),
    })
    expect(timedOut.dropped[0].reason).toContain('did not finish')
  })

  it('drops everything when the verification analysis fails or is cancelled', async () => {
    const source = httpSource()
    const finding = findingFor(source, HTTP_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate

    const errored = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer: { async analyze() { return { files: [], cancelled: false, error: 'worker stopped' } } },
    })
    expect(errored.dropped[0].reason).toContain('could not run')

    const cancelled = await verifyFixCandidates([candidate], [source], findingsOf(source), {
      analyzer: { async analyze() { return { files: [], cancelled: true, error: null } } },
    })
    expect(cancelled.dropped[0].reason).toContain('cancelled')
  })

  it('drops a candidate whose analysed text is no longer available', async () => {
    const source = httpSource()
    const finding = findingFor(source, HTTP_RULE)
    const candidate = proposeFix(finding, source) as FixCandidate
    const outcome = await verifyFixCandidates([candidate], [], findingsOf(source), { analyzer: realAnalyzer() })
    expect(outcome.dropped[0].reason).toContain('no longer available')
  })
})
