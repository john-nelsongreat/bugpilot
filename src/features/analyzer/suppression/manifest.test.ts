import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveReadResult, ArchiveSkippedEntry } from '../archive/guard'
import type { AnalyzerClient } from '../analysis/analyzerClient'
import type { FileAnalysis } from '../analysis/engine'
import { generatedSkipReason } from '../analysis/generated'
import { analyzeUpload, type AnalysisSessionResult } from '../analysis/session'
import { IGNORE_MANIFEST_NAME, matchIgnoreManifest, parseIgnoreManifest } from './manifest'

/**
 * #72a: the archive's own ignore list. The unit cases below prove the syntax subset; the session cases
 * prove the one property that matters — a file the list sets aside still reports its credential, because
 * the sensitive pass ran before any set-aside was decided.
 *
 * The harness is `analysis/sensitiveSession.test.ts` in shape: the same four local helpers, so
 * `analyzer.seen` says which names really reached the pattern rules rather than only that no finding
 * came out.
 */

const STATS = {
  walkedRecords: 1,
  producedBytes: 10,
  entries: 1,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 10,
}

const NPM_TOKEN = ['npm', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8'].join('_')

/** A byte-order mark without putting an invisible byte in this file's own bytes. */
const BOM = String.fromCharCode(0xfeff)

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return { name, text, language: detection.language, languageSource: detection.source, encoding: 'utf-8', bytes: text.length }
}

function readResult(entries: ArchiveEntry[], skippedEntries: ArchiveSkippedEntry[] = []): ArchiveReadResult {
  return {
    refusal: null,
    entries,
    skipped: skippedEntries,
    stats: { ...STATS, entries: entries.length, skipped: skippedEntries.length },
  }
}

/** Mirrors the real worker: one analysis per entry, so skipped entries never reach it. */
function fakeAnalyzer(): AnalyzerClient & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    async analyze(entries) {
      seen.push(...entries.map((item) => item.name))
      const files: FileAnalysis[] = entries.map((item) => ({
        file: item.name,
        findings: [],
        notes: [],
        rulesRan: ['bugpilot/generic/todo-marker'],
        stoppedEarly: false,
      }))
      return { files, cancelled: false, error: null }
    },
  }
}

function manifestEntry(text: string): ArchiveEntry {
  return entry(IGNORE_MANIFEST_NAME, text)
}

async function runSession(
  entries: ArchiveEntry[],
  options: { includeGenerated?: boolean } = {},
): Promise<{ analyzer: AnalyzerClient & { seen: string[] }; result: AnalysisSessionResult }> {
  const analyzer = fakeAnalyzer()
  const result = await analyzeUpload(
    { kind: 'archive', bytes: new Uint8Array([1]) },
    { archiveBytes: 1, ...options },
    { readArchive: async () => readResult(entries), analyzer },
  )
  return { analyzer, result }
}

function manifestSkips(result: AnalysisSessionResult): ArchiveSkippedEntry[] {
  return (result.skipped ?? []).filter((item) => item.code === 'ignored_by_manifest')
}

describe('the archive ignore manifest', () => {
  it('ignores nothing when the archive holds no manifest or an empty one', () => {
    for (const text of [null, '']) {
      const manifest = parseIgnoreManifest(text)
      expect(manifest).toEqual({ patterns: [], invalidCount: 0, ruleCount: 0 })
      expect(matchIgnoreManifest('src/a.py', manifest)).toEqual({ ignored: false, pattern: null })
    }
  })

  it('skips blank and comment lines without counting them, and tolerates a BOM and CRLF', () => {
    const manifest = parseIgnoreManifest(`${BOM}\r\n# a comment\r\n\r\n   \r\nsrc/app.js\r\nscratch/\r\n`)
    expect(manifest.ruleCount).toBe(2)
    expect(manifest.invalidCount).toBe(0)
    // The `raw` of each rule proves the `\r` was trimmed and the BOM skipped, rather than absorbed
    // into a pattern that could then never match anything.
    expect(manifest.patterns.map((pattern) => pattern.raw)).toEqual(['src/app.js', 'scratch/'])
    expect(matchIgnoreManifest('src/app.js', manifest).ignored).toBe(true)
    expect(matchIgnoreManifest('scratch/old.js', manifest).ignored).toBe(true)
    expect(matchIgnoreManifest('a comment.py', manifest).ignored).toBe(false)
  })

  it('matches an exact path at the archive root, and nothing that merely looks like it', () => {
    const manifest = parseIgnoreManifest('src/a.py')
    expect(matchIgnoreManifest('src/a.py', manifest)).toEqual({ ignored: true, pattern: 'src/a.py' })
    expect(matchIgnoreManifest('src/a.pyx', manifest).ignored).toBe(false)
    expect(matchIgnoreManifest('lib/src/a.py', manifest).ignored).toBe(false)
  })

  it('matches a folder pattern against everything under it, at any depth', () => {
    const manifest = parseIgnoreManifest('vendor/')
    expect(matchIgnoreManifest('vendor/a.py', manifest).ignored).toBe(true)
    expect(matchIgnoreManifest('src/vendor/a.py', manifest).ignored).toBe(true)
    expect(matchIgnoreManifest('vendorship/a.py', manifest).ignored).toBe(false)
    // The folder's own name is not "under" it, so the run has to leave a segment below it.
    expect(matchIgnoreManifest('vendor', manifest).ignored).toBe(false)
  })

  it('keeps a single star inside one path segment', () => {
    const loose = parseIgnoreManifest('*.min.js')
    expect(matchIgnoreManifest('a.min.js', loose).ignored).toBe(true)
    expect(matchIgnoreManifest('src/a.min.js', loose).ignored).toBe(true)
    expect(matchIgnoreManifest('src/b.min.js', loose).ignored).toBe(true)
    // §4.5 item 5 also asks that `*.min.js` refuse `src/b/c.min.js`. A pattern holding no separator is
    // allowed to start at any segment (§4.1), and starting at the last one matches `c.min.js`, so the
    // two sentences cannot both hold; §4.5's own words are open. The anchored form is the one that proves
    // a star never crosses a `/`, and that is asserted here.
    const anchored = parseIgnoreManifest('src/*.min.js')
    expect(matchIgnoreManifest('src/b.min.js', anchored).ignored).toBe(true)
    expect(matchIgnoreManifest('src/b/c.min.js', anchored).ignored).toBe(false)
  })

  it('lets one ** segment span any number of folders', () => {
    const manifest = parseIgnoreManifest('src/**/test.py')
    for (const path of ['src/test.py', 'src/a/test.py', 'src/a/b/test.py']) {
      expect(matchIgnoreManifest(path, manifest).ignored, path).toBe(true)
    }
    // The pattern holds a separator, so its `src` is the archive root, not a name at any depth.
    expect(matchIgnoreManifest('lib/src/test.py', manifest).ignored).toBe(false)
  })

  it('records unsupported syntax as invalid and never matches it', () => {
    const lines = ['!keep.py', 'a[0].py', 'a\\b.py', '**/**/x.py']
    const manifest = parseIgnoreManifest(lines.join('\n'))
    expect(manifest.ruleCount).toBe(4)
    expect(manifest.invalidCount).toBe(4)
    expect(manifest.patterns.map((pattern) => pattern.raw)).toEqual(lines)
    for (const pattern of manifest.patterns) {
      expect([pattern.invalid, pattern.segments], pattern.raw).toEqual([true, []])
    }
    for (const path of ['keep.py', 'a/0.py', 'a/b.py', 'x.py', 'a/x.py', '**/x.py']) {
      expect(matchIgnoreManifest(path, manifest).ignored, path).toBe(false)
    }
  })

  it('names the first matching line when two of them would match', () => {
    const first = parseIgnoreManifest('*.js\nsrc/app.js')
    expect(matchIgnoreManifest('src/app.js', first)).toEqual({ ignored: true, pattern: '*.js' })
    const second = parseIgnoreManifest('src/app.js\n*.js')
    expect(matchIgnoreManifest('src/app.js', second).pattern).toBe('src/app.js')
  })

  it('sets nothing aside when the archive holds no manifest, and an empty one changes only the count', async () => {
    const entries = [entry('src/app.js', 'const x = 1\n'), entry('scratch/old.js', 'var a = 1\n')]
    const bare = await runSession(entries)
    const empty = await runSession([...entries, manifestEntry('')])
    expect(manifestSkips(bare.result)).toEqual([])
    expect(manifestSkips(empty.result)).toEqual([])
    // D7 keeps the manifest itself analysed, so the second run holds exactly one more file and nothing
    // else moved. §4.5 item 9 says "equals"; with the manifest in the set that cannot be the same number,
    // so the additive reading is asserted here and raised in the report.
    expect(bare.result.report?.session.analysedCount).toBe(2)
    expect(empty.result.report?.session.analysedCount).toBe(3)
    expect(empty.result.report?.session.skippedCount).toBe(0)
  })

  it('sets a folder aside and names the pattern that did it', async () => {
    const { analyzer, result } = await runSession([
      manifestEntry('scratch/\n'),
      entry('scratch/old.js', 'var a = 1\n'),
      entry('src/app.js', 'const x = 1\n'),
    ])
    expect(result.status).toBe('completed')
    expect(analyzer.seen).toEqual([IGNORE_MANIFEST_NAME, 'src/app.js'])
    const skips = manifestSkips(result)
    expect(skips.map((item) => item.name)).toEqual(['scratch/old.js'])
    expect(skips[0]?.message).toContain(`(matched "scratch/")`)
    expect(result.report?.session.skipped.map((item) => item.file)).toEqual(['scratch/old.js'])
    expect(result.report?.session).toMatchObject({ analysedCount: 2, skippedCount: 1, fileCount: 3 })
    const row = result.report?.coverage.find((item) => item.file === 'scratch/old.js')
    expect([row?.status, row?.findings]).toEqual(['skipped', 0])
    expect(row?.skipReason).toBe(skips[0]?.message)
  })

  it('still reports a name-derived credential in a file the manifest set aside', async () => {
    const { analyzer, result } = await runSession([
      manifestEntry('.env\n'),
      entry('.env', 'A=1\n'),
      entry('src/app.py', 'print(1)\n'),
    ])
    expect(analyzer.seen).toEqual([IGNORE_MANIFEST_NAME, 'src/app.py'])
    expect(manifestSkips(result).map((item) => item.name)).toEqual(['.env'])
    const finding = result.report?.findings.find((item) => item.ruleId === 'bugpilot/sensitive/env-file')
    expect(finding?.file).toBe('.env')
    expect(finding?.evidence).toEqual([])
    const row = result.report?.coverage.find((item) => item.file === '.env')
    expect([row?.status, row?.findings]).toEqual(['skipped', 1])
    expect(row?.skipReason).toContain('did not analyse it')
  })

  it('still reports a content-derived credential in a file the manifest set aside, and never quotes it', async () => {
    const { analyzer, result } = await runSession([
      manifestEntry('server/\n'),
      entry('server/.npmrc', `_authToken=${NPM_TOKEN}\n`),
      entry('src/app.js', 'const x = 1\n'),
    ])
    expect(analyzer.seen).toEqual([IGNORE_MANIFEST_NAME, 'src/app.js'])
    const finding = result.report?.findings.find((item) => item.ruleId === 'bugpilot/sensitive/npmrc')
    expect(finding?.file).toBe('server/.npmrc')
    expect(finding?.evidence).toEqual([])
    expect(JSON.stringify(result.report)).not.toContain(NPM_TOKEN)
    const row = result.report?.coverage.find((item) => item.file === 'server/.npmrc')
    expect([row?.status, row?.findings]).toEqual(['skipped', 1])
    expect(manifestSkips(result).map((item) => item.name)).toEqual(['server/.npmrc'])
    // `coverage.ts:129-133` words the skipped tier with "a rule that reads only the file name still
    // reported it". That is true of the `.env` row above and imprecise here, where the finding came from
    // the body; the wording is pre-existing and shared with the generated path, so it is quoted rather
    // than worked around, and raised for close-out.
    const reasons = row?.tiers.map((tier) => tier.reason) ?? []
    const skippedTierReason = 'The file was skipped before analysis; a rule that reads only the file name still reported it.'
    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of reasons) expect(reason).toBe(skippedTierReason)
    for (const tier of row?.tiers ?? []) {
      expect([tier.available, tier.ran], tier.tier).toEqual([false, false])
    }
  })

  it('caps how many files one manifest may set aside, and says so in the report', async () => {
    const pages: ArchiveEntry[] = []
    for (let index = 0; index < 201; index += 1) {
      pages.push(entry(`src/p${index}.js`, `const x = ${index}\n`))
    }
    const { analyzer, result } = await runSession([manifestEntry('src/*.js\n'), ...pages])
    const skips = manifestSkips(result)
    expect(skips.length).toBe(200)
    expect(analyzer.seen.filter((name) => name.startsWith('src/p')).length).toBe(1)
    expect(result.report?.session).toMatchObject({ analysedCount: 2, skippedCount: 200, fileCount: 202 })
    const capLine = (result.report?.limitations ?? []).find((line) => line.includes(IGNORE_MANIFEST_NAME))
    expect(capLine).toBe(
      `The archive's own ${IGNORE_MANIFEST_NAME} matched 201 file(s), but the cap allows 200 to be set aside, so 1 of them were analysed anyway.`,
    )
  })

  it('bounds the matcher by pattern shape, so an exponential case never reaches it', () => {
    const lines = [
      'a*a*a*a*a*a*a*a*b',
      'a*a*a*a*a*a*a*a*a*a*b',
      'x*y*x*y*x*y*x*y',
      '**/deep.py',
      'src/**/a*a*a*a*a*b',
    ]
    const manifest = parseIgnoreManifest(lines.join('\n'))
    expect(manifest.ruleCount).toBe(lines.length)
    // The structural bound, asserted separately from any clock: one `**` per pattern is legal, a second
    // one is invalid, so the case that would be exponential is refused at parse time.
    expect(manifest.patterns.filter((pattern) => pattern.invalid)).toEqual([])
    const doubled = parseIgnoreManifest('**/**/x.py')
    expect(doubled.patterns[0]?.invalid).toBe(true)
    expect(doubled.invalidCount).toBe(1)
    expect(matchIgnoreManifest('a/x.py', doubled).ignored).toBe(false)

    const segments: string[] = []
    for (let index = 0; index < 1000; index += 1) {
      segments.push(`${'a'.repeat(40)}${index}`)
    }
    const path = segments.join('/')
    const started = Date.now()
    const match = matchIgnoreManifest(path, manifest)
    const elapsed = Date.now() - started
    expect(match.ignored).toBe(false)
    // Measured on this tree (log loop2l9-72a-m2-item13-probe-20261117T021631Z): the scan above takes
    // 1 ms cold and 1 ms warm, at Date.now()'s 1 ms granularity. The brief asks for a ceiling at roughly
    // 10x the measurement; 10 ms of a 1 ms reading is inside the clock's own resolution and would go red
    // on a scheduler hiccup, so the ceiling is 200 ms — still two orders of magnitude above the
    // measurement and, per control C1, more than three orders below the regex form this guards against
    // (`c1-regex-probe.cjs` measured one segment comparison of the mutated matcher at over 5,000 ms).
    expect(elapsed).toBeLessThan(200)
  })

  it('applies the manifest at every include-generated setting and still never reads .git', async () => {
    const entries = [
      manifestEntry('scratch/\n'),
      entry('scratch/old.js', 'var a = 1\n'),
      entry('.git/config', '[core]\n'),
      entry('dist/app.min.js', 'var a = 1\n'),
    ]
    const off = await runSession(entries)
    const on = await runSession(entries, { includeGenerated: true })
    expect(off.analyzer.seen).toEqual([IGNORE_MANIFEST_NAME])
    // `includeGenerated: true` keeps the minified bundle, which is what the checkbox is for; the
    // manifest is still the only thing that can set `scratch/old.js` aside, and it does at both settings.
    expect(on.analyzer.seen).toEqual([IGNORE_MANIFEST_NAME, 'dist/app.min.js'])
    for (const { result } of [off, on]) {
      expect(manifestSkips(result).map((item) => item.name)).toEqual(['scratch/old.js'])
    }
    expect(off.result.report?.coverage.find((item) => item.file === '.git/config')?.status).toBe('skipped')
    expect(on.result.report?.coverage.find((item) => item.file === '.git/config')?.status).toBe('skipped')
    expect(on.result.report?.coverage.find((item) => item.file === 'dist/app.min.js')?.status).toBe('analysed')
  })

  it('honours a list written in a file that itself looks generated', async () => {
    const { analyzer, result } = await runSession([
      manifestEntry('# AUTO-GENERATED FILE - DO NOT EDIT\nlib/\n'),
      entry('lib/bundle.js', 'var a = 1\n'),
      entry('src/app.js', 'const x = 1\n'),
    ])
    expect(manifestSkips(result).map((item) => item.name)).toEqual(['lib/bundle.js'])
    // The manifest is itself set aside by the generated rule — its first line is a marker — so it never
    // reaches the analyzer, and D7's "the manifest stays analysed" yields to that rule here. The list is
    // still honoured because §4.4 piece (i) reads it before the split, which is what control C5 tests:
    // look it up afterwards and this file is in `generated.skipped`, the feature switches off, and
    // `lib/bundle.js` is analysed.
    expect((result.skipped ?? []).map((item) => `${item.name}:${item.code}`).sort()).toEqual([
      `${IGNORE_MANIFEST_NAME}:generated_file`,
      'lib/bundle.js:ignored_by_manifest',
    ])
    expect(analyzer.seen).toEqual(['src/app.js'])
    expect(generatedSkipReason(IGNORE_MANIFEST_NAME, '# AUTO-GENERATED FILE - DO NOT EDIT\nlib/\n')).not.toBeNull()
  })

  it('keeps the fixture paths this brief chose outside the generated rule', () => {
    // The general form of the fixture-path trap: any path a manifest test relies on has to survive the
    // generated/vendored split first, or the manifest is not the thing doing the skipping.
    expect(generatedSkipReason('server/.npmrc', '_authToken=x')).toBeNull()
    expect(generatedSkipReason('scratch/old.js', 'var a=1')).toBeNull()
    expect(generatedSkipReason('lib/bundle.js', 'var a=1')).toBeNull()
    expect(generatedSkipReason('node_modules/pkg/.npmrc', '_authToken=x')).not.toBeNull()
  })
})
