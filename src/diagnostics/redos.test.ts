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
 * regex literal out of the diagnostics domain, times each against adversarial input, and separately pins the
 * behaviour the fix must not lose. A pattern that goes quadratic here fails the budget by name and by file, and the
 * timing runs in node because jsdom would put the measurement inside the thing it is measuring.
 *
 * The domain is the three files whose patterns only ever see text that already passed the `MAX_ERROR_TEXT_LENGTH`
 * refusal, and whose rule tables match one trimmed line of it: `engine.ts` plus `rules/neutral.ts` and
 * `rules/javascript.ts`. The analyzer domain is deliberately NOT-COVERED — `src/features/analyzer/rules/secrets.ts`
 * (15 literals) and `src/features/analyzer/engines/astQueries.ts` (40 `pattern:` values that are strings compiled at
 * their own call site, of which this lift sees 2) take input bounded by archive byte limits rather than by the
 * error-text ceiling, so these log-shaped payloads would measure shapes the shipped code can never receive. Covering
 * them means payloads measured from the analyzer's own input path, not longer versions of these.
 */

/** The one file whose bounded pattern the two javascript stack-frame pins are about. */
const ENGINE_SOURCE_PATH = 'src/diagnostics/engine.ts'

/**
 * The domain this gate times, in the order it is reported. `literals` is the per-file count the lift measured on the
 * tree this gate was written against, so the floor is the measurement itself rather than a fraction of it: a literal
 * appearing or disappearing turns the gate red instead of eating into slack, and a legitimate refactor has to change
 * the number in the commit that changes it. A different key gives different totals — `grep -c "pattern: /"` reports
 * 19 / 23 / 11 for the same files, because the lift also picks up patterns that are not in `pattern:` position.
 */
const GATE_TARGETS: ReadonlyArray<{ readonly path: string; readonly literals: number }> = [
  { path: ENGINE_SOURCE_PATH, literals: 40 },
  { path: 'src/diagnostics/rules/neutral.ts', literals: 24 },
  { path: 'src/diagnostics/rules/javascript.ts', literals: 83 },
]

/** `engine.ts:16` sets this and `:307` refuses anything longer, so it is the real input ceiling. */
const MAX_ERROR_TEXT_LENGTH = 20_000

/** Worst min-of-3 time any lifted pattern may take on an adversarial payload. */
const BUDGET_MS = 500

interface LiftedLiteral {
  readonly token: string
  readonly source: string
  readonly flags: string
}

/** A lifted token that remembers which production file it came from, so a slow pattern is reported with its home. */
interface SourcedLiteral extends LiftedLiteral {
  readonly file: string
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

const LIFTS = GATE_TARGETS.map((target) => ({
  path: target.path,
  expected: target.literals,
  lifted: liftRegexLiterals(readFileSync(resolve(process.cwd(), target.path), 'utf8')).map(
    (literal): SourcedLiteral => ({ ...literal, file: target.path }),
  ),
}))

const LITERALS: readonly SourcedLiteral[] = LIFTS.flatMap((lift) => lift.lifted)

/**
 * Sought by path, not by index: reordering `GATE_TARGETS` must not be able to re-point the two stack-frame pins.
 */
const ENGINE_LITERALS = LIFTS.find((lift) => lift.path === ENGINE_SOURCE_PATH)?.lifted ?? []

/**
 * The two shape markers the javascript stack-frame pattern is keyed on, held as one list so the finder and the
 * domain-wide collision check cannot drift apart, and so neither of them is a line number.
 */
const JAVASCRIPT_FRAME_MARKERS: readonly string[] = ['js|mjs|cjs|jsx|ts|tsx', ':\\d+:\\d+']

function isJavaScriptFrameShaped(literal: LiftedLiteral): boolean {
  return JAVASCRIPT_FRAME_MARKERS.every((marker) => literal.source.includes(marker))
}

/**
 * The three shapes that make an unbounded run expensive: a long run with no match available, a long path-shaped run
 * with a dot but no colon pair, and a long digit/colon run. Written as the audit measured them; their lengths are
 * 20,000 characters — `MAX_ERROR_TEXT_LENGTH`, the longest text any rule scan receives, so none of them probes a
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

/**
 * Same three payloads, same best-of-3 per payload, same worst across payloads as the version that handed back a bare
 * number — no measurement moved. It now also names which payload was worst, because an offender has to be reported
 * with the input that triggered it and a second timing loop would be a fork of this one.
 */
function worstPayloadRun(regexp: RegExp): { readonly ms: number; readonly payload: string } {
  let worst = 0
  let offender = 'none'
  for (const payload of PAYLOADS) {
    let best = Number.POSITIVE_INFINITY
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now()
      regexp.test(payload.text)
      const elapsed = performance.now() - started
      if (elapsed < best) best = elapsed
    }
    if (best > worst) {
      worst = best
      offender = payload.name
    }
  }
  return { ms: worst, payload: offender }
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
const JAVASCRIPT_FRAME = ENGINE_LITERALS.find(isJavaScriptFrameShaped)

/**
 * The same predicate run over the whole domain. One member is the healthy state; more than one means the shape no
 * longer identifies a single pattern, and the last test turns that into a gate instead of an assumption.
 */
const FRAME_SHAPED_IN_DOMAIN = LITERALS.filter(isJavaScriptFrameShaped)

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
  it('lifts every regex literal in the diagnostics domain and compiles each one', () => {
    const drift = LIFTS.filter((lift) => lift.lifted.length !== lift.expected).map(
      (lift) => `${lift.path} lifted ${lift.lifted.length}, pinned ${lift.expected}`,
    )
    expect(
      drift,
      'a per-file lift count moved: either the extractor broke or a literal appeared or disappeared without this ' +
        'gate being updated in the same commit. The floor is the measurement, so there is no slack to absorb it.',
    ).toEqual([])
    const uncompilable = LITERALS.filter((literal) => !compiles(literal)).map(
      (literal) => `${literal.file} ${literal.token}`,
    )
    expect(uncompilable, 'a lifted token is not a real regex literal — the instrument is wrong').toEqual([])
  })

  it('times every lifted pattern against the adversarial payloads', () => {
    expect(PAYLOADS).toHaveLength(3)
    const timings = LITERALS.map((literal) => {
      const run = worstPayloadRun(compile(literal))
      return { file: literal.file, token: literal.token, ms: run.ms, payload: run.payload }
    })
    const ranked = [...timings].sort((a, b) => b.ms - a.ms)
    const slowest = ranked[0] ?? { file: 'none', token: 'none', ms: 0, payload: 'none' }
    const census = LIFTS.map((lift) => `${lift.path} (${lift.lifted.length})`).join(', ')
    console.log(
      `redos gate: lifted ${timings.length} literals from ${census}, ` +
        `slowest ${slowest.file} ${slowest.token} at ${slowest.ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`,
    )
    console.log(
      `redos gate: five slowest — ${ranked
        .slice(0, 5)
        .map((timing) => `${timing.file} ${timing.token} ${timing.ms.toFixed(1)} ms on ${timing.payload}`)
        .join(' | ')}`,
    )
    const offenders = timings
      .filter((timing) => timing.ms > BUDGET_MS)
      .map((timing) => `${timing.file} ${timing.token} ${timing.ms.toFixed(1)} ms on ${timing.payload}`)
    expect(
      offenders,
      `${offenders.length} of ${timings.length} lifted patterns exceeded ${BUDGET_MS} ms on a ` +
        `${MAX_ERROR_TEXT_LENGTH}-character payload (slowest ${slowest.file} ${slowest.token} ${slowest.ms.toFixed(1)} ms)`,
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
    expect(
      FRAME_SHAPED_IN_DOMAIN.length,
      `${FRAME_SHAPED_IN_DOMAIN.length} tokens across the domain carry the stack-frame shape — the finder is scoped ` +
        `to ${ENGINE_SOURCE_PATH} so it cannot re-point, and a second match has to be resolved, not ignored`,
    ).toBe(1)
    expect(
      FRAME_SHAPED_IN_DOMAIN[0]?.file,
      'the one frame-shaped token in the domain has to be the pattern the scoped finder resolved',
    ).toBe(ENGINE_SOURCE_PATH)
    expect(JAVASCRIPT_FRAME?.source, 'the javascript stack-frame pattern must carry a bounded run').toContain('{1,300}')
    expect(JAVASCRIPT_FRAME?.source).toMatch(/^\[\^\\s\(\)\]\{1,300\}/)
  })
})
