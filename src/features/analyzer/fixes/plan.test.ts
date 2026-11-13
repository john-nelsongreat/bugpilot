import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerClient } from '../analysis/analyzerClient'
import { analyzeEntries } from '../analysis/engine'
import type { TsCheckResult, TsSyntaxClient } from '../analysis/typescript/tsClient'
import { prepareFixPlan } from './plan'

const FAKE_AWS = ['AK', 'IA', 'Q7W2', 'E4R6', 'T8Y0', 'U2I4'].join('')
const HTTP_RULE = 'bugpilot/generic/insecure-http-url'

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

function realAnalyzer(): AnalyzerClient {
  return {
    async analyze(entries) {
      return { files: analyzeEntries(entries).files, cancelled: false, error: null }
    },
  }
}

function tsResult(): TsCheckResult {
  return { findings: [], timedOut: false, cancelled: false, error: null }
}

function tsClient(): TsSyntaxClient {
  return {
    async check() {
      return tsResult()
    },
    dispose() {},
  }
}

describe('fix plan', () => {
  it('keeps one of two overlapping fixes and explains the dropped one', async () => {
    const source = entry('src/config.js', `const apiKey = "${FAKE_AWS}"\n`)
    const findings = analyzeEntries([source]).files[0].findings
    expect(findings.filter((item) => item.ruleId.startsWith('bugpilot/secret/'))).toHaveLength(2)

    const plan = await prepareFixPlan(findings, [source], {
      analyzer: realAnalyzer(),
      createTsClient: async () => tsClient(),
    })

    expect(plan.available).toHaveLength(1)
    expect(plan.unavailable.size).toBe(1)
    const reason = [...plan.unavailable.values()][0]
    expect(reason).toContain('overlaps')
    expect(reason).toContain(plan.available[0].findingId)
  })

  it('reports verification failures through the unavailable map', async () => {
    // The defect is one whose fixer is reachable from a reported finding; the JSON trailing-comma
    // fixer is not, so it cannot be used to drive this path.
    const source = entry('public/page.html', '<a href="http://cdn.acme-widgets.com/assets.json">files</a>\n')
    const findings = analyzeEntries([source]).files[0].findings
    const sourceFinding = findings.find((item) => item.ruleId === HTTP_RULE)
    expect(sourceFinding).toBeDefined()

    const analyzer: AnalyzerClient = {
      async analyze(entries) {
        return {
          files: entries.map((item) => ({
            file: item.name,
            findings: sourceFinding ? [{ ...sourceFinding, file: item.name }] : [],
            notes: [],
            rulesRan: [],
            stoppedEarly: false,
          })),
          cancelled: false,
          error: null,
        }
      },
    }
    const plan = await prepareFixPlan(findings, [source], { analyzer })

    expect(plan.available).toHaveLength(0)
    expect(plan.unavailable.get(sourceFinding?.id ?? '')).toContain('still present')
  })

  it('returns nothing when no finding has a fixer', async () => {
    const source = entry('src/notes.js', '// TODO: finish this\n')
    const findings = analyzeEntries([source]).files[0].findings
    const plan = await prepareFixPlan(findings, [source], { analyzer: realAnalyzer() })
    expect(plan.available).toHaveLength(0)
    expect(plan.unavailable.size).toBe(0)
  })
})
