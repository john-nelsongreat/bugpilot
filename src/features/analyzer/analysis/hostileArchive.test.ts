import { describe, expect, it } from 'vitest'
import { buildZip } from '../../../test/zipFixtures'
import type { AnalyzerClient } from '../analysis/analyzerClient'
import type { FileAnalysis } from '../analysis/engine'
import { analyzeUpload } from '../analysis/session'
import { readArchive } from '../archive/guard'
import { reportForExport, renderReportMarkdown } from '../export/reportFiles'
import type { AnalyzerFinding, AnalyzerReport } from '../types'

const BIDI_OVERRIDE = '\u202E'
const ZERO_WIDTH = '\u200B'

const HOSTILE_NAMES = [
  `src/invoice${BIDI_OVERRIDE}gnp.js`,
  'src/a\nb.js',
  '<img src=x onerror=alert(1)>.js',
  '[click](https://example.test).js',
  `src/hidden${ZERO_WIDTH}part.js`,
  `deep/${'x'.repeat(300)}.js`,
]

function hostileAnalyzer(): AnalyzerClient {
  return {
    async analyze(entries) {
      const files: FileAnalysis[] = entries.map((entry, index) => {
        const finding: AnalyzerFinding = {
          id: `f-${index}`,
          ruleId: 'bugpilot/test/hostile-name',
          analyzer: 'bugpilot-rules',
          tier: 'pattern',
          severity: 'Medium',
          confidence: { level: 'high', reason: `Checked ${entry.name} \u202E` },
          file: entry.name,
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
          evidence: [
            {
              source: 'code snippet',
              label: `Quote from ${entry.name}`,
              quote: `const value = "x${BIDI_OVERRIDE}y"\n\`\`\`\n<img src=x onerror=alert(1)>`,
              lineNumber: 1,
            },
          ],
          message: `Hostile ${entry.name} <script>alert(1)</script>${ZERO_WIDTH}`,
          explanation: 'Explanation with <b>html</b>, a bidi mark \u202E and a line\nbreak.',
          fix: null,
          verificationSteps: ['Open <x> and check\u202E the line.'],
          limitations: ['This limit \u202E is only text.'],
        }
        return { file: entry.name, findings: [finding], notes: [], rulesRan: [], stoppedEarly: false }
      })
      return { files, cancelled: false, error: null }
    },
  }
}

// eslint-disable-next-line no-control-regex
const UNSAFE_DISPLAY = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/

/** The fixture only marks names as UTF-8 when it is given their bytes, as a real zip writer does. */
function utf8Names(names: readonly string[]): Record<string, Uint8Array> {
  const encoder = new TextEncoder()
  return Object.fromEntries(names.map((name) => [name, encoder.encode(name)]))
}

describe('hostile archive names cannot break the report', () => {
  it('reads the names exactly and renders an escaped, single-line report', async () => {
    const bytes = buildZip(
      HOSTILE_NAMES.map((name, index) => ({ name, content: `const value${index} = ${index}\n` })),
      { rawNames: utf8Names(HOSTILE_NAMES) },
    )
    const read = await readArchive(bytes)
    expect(read.refusal).toBeNull()
    expect(read.entries.map((entry) => entry.name)).toEqual(HOSTILE_NAMES)

    const result = await analyzeUpload(
      { kind: 'archive', bytes },
      { archiveBytes: bytes.length, generatedAt: new Date('2026-11-04T10:00:00.000Z') },
      {
        readArchive: async () => read,
        analyzer: hostileAnalyzer(),
      },
    )
    expect(result.status).toBe('completed')
    const report = result.report as AnalyzerReport
    expect(report.findings.map((finding) => finding.file).sort()).toEqual([...HOSTILE_NAMES].sort())

    const markdown = renderReportMarkdown(reportForExport(report, true))
    expect(markdown).not.toMatch(UNSAFE_DISPLAY)
    expect(markdown).not.toContain('src/a\nb.js')
    expect(markdown).toContain('&lt;script&gt;')
    expect(markdown).toContain('&lt;img')
    expect(markdown).toContain('src/a\\u000Ab.js')
    expect(markdown).toContain('invoice\\u202Egnp.js')
    expect(markdown).toContain('src/hidden\\u200Bpart.js')
    expect(markdown).toContain('x'.repeat(300))
    expect(markdown.split('\n').filter((line) => /^### /.test(line))).toHaveLength(HOSTILE_NAMES.length)
    expect(markdown.split('\n').filter((line) => /^#### /.test(line))).toHaveLength(HOSTILE_NAMES.length)
    // The evidence contains its own three-backtick fence, so the report must use a longer one.
    expect(markdown).toContain('\n````\n')
    // Raw HTML may only survive inside a fenced code block, where Markdown shows it as code.
    const outsideFences: string[] = []
    let fence: string | null = null
    for (const line of markdown.split('\n')) {
      const marker = /^(`{3,})$/.exec(line)
      if (fence === null && marker) fence = marker[1]
      else if (fence !== null && marker && marker[1].length >= fence.length) fence = null
      else if (fence === null) outsideFences.push(line)
    }
    expect(outsideFences.join('\n')).not.toContain('<script')
    expect(outsideFences.join('\n')).not.toContain('<img')
  })

  it('keeps the exact names in the JSON export, which stays valid JSON', async () => {
    const bytes = buildZip([{ name: HOSTILE_NAMES[0], content: 'const value = 1\n' }], {
      rawNames: utf8Names([HOSTILE_NAMES[0]]),
    })
    const read = await readArchive(bytes)
    const result = await analyzeUpload(
      { kind: 'archive', bytes },
      { archiveBytes: bytes.length },
      { readArchive: async () => read, analyzer: hostileAnalyzer() },
    )
    const prepared = reportForExport(result.report as AnalyzerReport, false)
    const parsed = JSON.parse(JSON.stringify(prepared)) as AnalyzerReport

    expect(parsed.findings[0].file).toBe(HOSTILE_NAMES[0])
    expect(parsed.findings[0].evidence).toEqual([])
  })
})
