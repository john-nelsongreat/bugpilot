// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One pattern in `src/diagnostics/engine.ts` was measured quadratic: `[^\s()]+` before a required `\.` re-walks a
 * long run of non-space characters from every start position, so a pasted log froze the tab for ~15 s at 60 KB and
 * ~3.5 s at the engine's own 20,000-character input ceiling. It is now bounded to `{1,300}`, which costs nothing:
 * a match may start later inside the run, so paths far longer than 300 characters still match, and `LANGUAGE_SIGNALS`
 * patterns are read at exactly one site — `engine.ts:978`, `signal.pattern.test(text)` — a boolean whose captured
 * text is never surfaced.
 *
 * The risk is not that one pattern, it is the next one. So this gate does not name the offender: it lifts every
 * regex literal out of the file, times each against adversarial input, and separately pins the behaviour the fix
 * must not lose. A pattern that goes quadratic here fails the budget by name, and the timing runs in node because
 * jsdom would put the measurement inside the thing it is measuring.
 */

const ENGINE_SOURCE_PATH = 'src/diagnostics/engine.ts'

/** `engine.ts:16` sets this and `:307` refuses anything longer, so it is the real input ceiling. */
const MAX_ERROR_TEXT_LENGTH = 20_000

/** Worst min-of-3 time any lifted pattern may take on an adversarial payload. */
const BUDGET_MS = 500

/** Below this the lift is broken rather than the data clean — `grep -c "pattern: /"` says 15 today. */
const MIN_LITERALS = 12

interface LiftedLiteral {
  readonly token: string
  readonly source: string
  readonly flags: string
}

/**
 * A regex literal in value position: after an operator or delimiter, after a keyword that can take one, or at the
 * start of a line (array elements are written one per line here). The body allows escapes and character classes, and
 * excludes newlines, so `//` and `/** … *\/` cannot be read as patterns — a comment is the one thing that looks
 * exactly like a delimited literal and is not one.
 */
const REGEX_LITERAL =
  /(?:[=:,([{!&|;?+-]\s*|\b(?:return|typeof|case|in|of|new|await|yield|do|else)\b\s*|^[ \t]*)(\/(?!\/|\*)(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[dgimsuvy]*)/gm

function liftRegexLiterals(source: string): LiftedLiteral[] {
  const found: LiftedLiteral[] = []
  for (const match of source.matchAll(REGEX_LITERAL)) {
    const token = String(match[1])
    // Flags cannot contain '/', so the last one is the closing delimiter.
    const closing = token.lastIndexOf('/')
    found.push({ token, source: token.slice(1, closing), flags: token.slice(closing + 1) })
  }
  return found
}

const ENGINE_SOURCE = readFileSync(resolve(process.cwd(), ENGINE_SOURCE_PATH), 'utf8')
const LITERALS = liftRegexLiterals(ENGINE_SOURCE)

if (LITERALS.length < MIN_LITERALS) {
  throw new Error(
    `lifted only ${LITERALS.length} regex literals from ${ENGINE_SOURCE_PATH} — instrument broken, not the data`,
  )
}

/**
 * The three shapes that make an unbounded run expensive: a long run with no match available, a long path-shaped run
 * with a dot but no colon pair, and a long digit/colon run. Written as the audit measured them; their lengths are
 * 20,000 characters — `MAX_ERROR_TEXT_LENGTH`, the longest input the engine accepts, so none of them probes a
 * path the shipped code can never reach.
 */
const PAYLOADS: ReadonlyArray<{ readonly name: string; readonly text: string }> = [
  { name: 'unbroken letter run', text: '"' + 'A'.repeat(19998) + ' ' },
  { name: 'path-shaped run with one dot', text: 'at ' + 'p'.repeat(19994) + '.js' },
  { name: 'digit and colon run', text: 'x:'.repeat(5000) + ' ' + '9'.repeat(9998) + ':' },
]

for (const payload of PAYLOADS) {
  if (payload.text.length > MAX_ERROR_TEXT_LENGTH) {
    throw new Error(`payload ${payload.name} is ${payload.text.length} chars — past MAX_ERROR_TEXT_LENGTH`)
  }
}

function worstPayloadMs(regexp: RegExp): number {
  let worst = 0
  for (const payload of PAYLOADS) {
    let best = Number.POSITIVE_INFINITY
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now()
      regexp.test(payload.text)
      const elapsed = performance.now() - started
      if (elapsed < best) best = elapsed
    }
    if (best > worst) worst = best
  }
  return worst
}

/** The two lines of §1.1 that are written by hand, plus the three generated path lengths. */
function longPathFrame(pathChars: number): string {
  return `    at x (${'p'.repeat(pathChars)}.ts:12:3)`
}

const REAL_SHAPED_FRAMES: ReadonlyArray<{ readonly name: string; readonly text: string }> = [
  { name: 'frame with a dotted repo path', text: '  at foo (src/features/analyzer/engines/syntax.ts:131:7)' },
  { name: 'frame with a Windows path', text: '    at Object.<anonymous> (C:\\Users\\great\\app.js:1:1)' },
  { name: 'bare hashed bundle file', text: 'File index.d13fb498.js:3105:38' },
  { name: '260-character path', text: longPathFrame(260) },
  { name: '600-character path', text: longPathFrame(600) },
  { name: '3000-character path', text: longPathFrame(3000) },
]

/** The bounded offender, found by its shape rather than its line number, and lifted from the file like the rest. */
const JAVASCRIPT_FRAME = LITERALS.find(
  (literal) => literal.source.includes('js|mjs|cjs|jsx|ts|tsx') && literal.source.includes(':\\d+:\\d+'),
)

function compiles(literal: LiftedLiteral): boolean {
  try {
    return Boolean(new RegExp(literal.source, literal.flags))
  } catch {
    return false
  }
}

function compile(literal: LiftedLiteral): RegExp {
  return new RegExp(literal.source, literal.flags)
}

describe('the diagnostics engine keeps its regexes inside a time budget', () => {
  it('lifts every regex literal in the engine and compiles each one', () => {
    expect(LITERALS.length, `the lift found ${LITERALS.length} literals in ${ENGINE_SOURCE_PATH}`).toBeGreaterThanOrEqual(
      MIN_LITERALS,
    )
    const uncompilable = LITERALS.filter((literal) => !compiles(literal)).map((literal) => literal.token)
    expect(uncompilable, 'a lifted token is not a real regex literal — the instrument is wrong').toEqual([])
  })

  it('times every lifted pattern against the adversarial payloads', () => {
    expect(PAYLOADS).toHaveLength(3)
    const timings = LITERALS.map((literal) => ({ token: literal.token, ms: worstPayloadMs(compile(literal)) }))
    const slowest = timings.reduce((worst, entry) => (entry.ms > worst.ms ? entry : worst), {
      token: 'none',
      ms: 0,
    })
    console.log(
      `redos gate: lifted ${timings.length} literals from ${ENGINE_SOURCE_PATH}, ` +
        `slowest ${slowest.token} at ${slowest.ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`,
    )
    const offenders = timings
      .filter((timing) => timing.ms > BUDGET_MS)
      .map((timing) => `${timing.token} ${timing.ms.toFixed(1)} ms`)
    expect(
      offenders,
      `${offenders.length} of ${timings.length} lifted patterns exceeded ${BUDGET_MS} ms on a ` +
        `${MAX_ERROR_TEXT_LENGTH}-character payload (slowest ${slowest.token} ${slowest.ms.toFixed(1)} ms)`,
    ).toEqual([])
  })

  it('keeps the javascript stack-frame pattern matching every real shape it matched before', () => {
    expect(JAVASCRIPT_FRAME, `${ENGINE_SOURCE_PATH} no longer carries the javascript stack-frame pattern`).toBeDefined()
    const pattern = new RegExp(String(JAVASCRIPT_FRAME?.source), String(JAVASCRIPT_FRAME?.flags))
    const missed = REAL_SHAPED_FRAMES.filter((frame) => !pattern.test(frame.text)).map((frame) => frame.name)
    expect(missed, 'the bounded pattern stopped matching these real frames').toEqual([])
    // Six, the number the brief pins: three written frames and the 260-, 600- and 3000-character paths.
    expect(REAL_SHAPED_FRAMES).toHaveLength(6)
  })

  it('bounds the offender it was written for, in the file as shipped', () => {
    expect(JAVASCRIPT_FRAME?.source, 'the javascript stack-frame pattern must carry a bounded run').toContain('{1,300}')
    expect(JAVASCRIPT_FRAME?.source).toMatch(/^\[\^\\s\(\)\]\{1,300\}/)
  })
})
