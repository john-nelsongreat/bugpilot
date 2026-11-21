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
 * behaviour the fix must not lose. A pattern that goes quadratic here is refused by its own growth — one shape
 * measured at `L` and again at `2L`, interleaved so a starved stretch lands on both arms — rather than by a
 * wall-clock budget, which measures machine state as easily as it measures a pattern. The absolute timings are still
 * printed beside the verdict, and the timing runs in node because jsdom would put the measurement inside the thing
 * it is measuring.
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

/**
 * Worst min-of-3 time any lifted pattern takes on an adversarial payload. Printed, never asserted: across the
 * observations this line stays comparable with, the same code has measured 117 ms and 504 ms, so a verdict keyed to
 * it decides on machine state. The growth ratio below is what decides.
 */
const BUDGET_MS = 500

/**
 * The matched pair the growth gate measures: `L` and `2L`, where `2L` is the shipped input ceiling. A longer arm
 * would time a payload the engine refuses to receive, so this is the only legal pair.
 */
const LENGTH_HALF = MAX_ERROR_TEXT_LENGTH / 2

/** Samples per arm, the min rather than the mean: a starved sample inflates the one arm it landed on and fakes growth. */
const RATIO_ATTEMPTS = 5

/** Below this on the `L` arm a pattern is timed at clock resolution rather than at signal, so its ratio is noise. */
const RATIO_FLOOR_MS = 1

/**
 * Quadratic backtracking quadruples when the input doubles; a bounded window only doubles. 3 is the agreed boundary
 * between the two, and the unbounded clone below is what proves the boundary still discriminates.
 */
const RATIO_MAX = 3

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
 * The same three shapes as builders that take a length, so the growth ladder can measure a shape at `L` and at `2L`
 * without a second copy of the construction. `PAYLOADS` above stays the `2L` instance the ms diagnostic reports on,
 * and the two are pinned equal in the test rather than assumed equal here: a builder that drifted from the shipped
 * payload would be timing a shape this gate has no history of.
 */
const SHAPES: ReadonlyArray<{ readonly name: string; readonly build: (length: number) => string }> = [
  { name: 'unbroken letter run', build: (length) => '"' + 'A'.repeat(length - 2) + ' ' },
  { name: 'path-shaped run with one dot', build: (length) => 'at ' + 'p'.repeat(length - 6) + '.js' },
  { name: 'digit and colon run', build: (length) => 'x:'.repeat(length / 4) + ' ' + '9'.repeat(length / 2 - 2) + ':' },
]

// The ceiling holds for everything the ladder builds at either arm, not only for the three hand-written payloads.
for (const shape of SHAPES) {
  for (const length of [LENGTH_HALF, MAX_ERROR_TEXT_LENGTH]) {
    const built = shape.build(length)
    if (built.length > MAX_ERROR_TEXT_LENGTH) {
      throw new Error(`ladder payload ${shape.name} at ${length} is ${built.length} chars — past MAX_ERROR_TEXT_LENGTH`)
    }
  }
}

/**
 * Same three payloads, same best-of-3 per payload, same worst across payloads as the version that handed back a bare
 * number — no measurement moved. It now also names which payload was worst, because an offender has to be reported
 * with the input that triggered it and a second timing loop would be a fork of this one. Every call starts by clearing
 * `lastIndex`, because a pattern carrying `g` resumes `test` where its previous match ended: an arm timed from there
 * scanned the tail of somebody else's input, and its ms would be a function of what the last call matched.
 */
function worstPayloadRun(regexp: RegExp): { readonly ms: number; readonly payload: string } {
  let worst = 0
  let offender = 'none'
  for (const payload of PAYLOADS) {
    let best = Number.POSITIVE_INFINITY
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now()
      regexp.lastIndex = 0
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

interface ShapeGrowth {
  readonly shape: string
  readonly shortMs: number
  readonly longMs: number
  readonly ratio: number
  /** False when the `L` arm sits under `RATIO_FLOOR_MS` — the ratio is then a clock artefact, not a measurement. */
  readonly eligible: boolean
}

/**
 * One interleaved ladder for one pattern: `L` and `2L` alternate inside the same attempt loop, so a scheduler hiccup
 * lands on both arms of the same shape and the ratio survives it. Timed arm-then-arm, a starved stretch inflates
 * whichever arm happened to run inside it, which is the failure mode this gate was rewritten to remove. The min of
 * each arm feeds the ratio, and the worst ratio across the three shapes is what a pattern is judged on. `lastIndex` is
 * cleared in front of every timed call so both arms of a shape start at the same offset: with `g` on a pattern the
 * `2L` arm would otherwise run from wherever the `L` arm's match stopped, and the ratio would then be measuring a
 * difference in start position instead of a difference in length.
 */
function growthLadder(regexp: RegExp): ShapeGrowth[] {
  return SHAPES.map((shape) => {
    const shortText = shape.build(LENGTH_HALF)
    const longText = shape.build(MAX_ERROR_TEXT_LENGTH)
    let shortMs = Number.POSITIVE_INFINITY
    let longMs = Number.POSITIVE_INFINITY
    for (let attempt = 0; attempt < RATIO_ATTEMPTS; attempt += 1) {
      const shortStarted = performance.now()
      regexp.lastIndex = 0
      regexp.test(shortText)
      const shortElapsed = performance.now() - shortStarted
      const longStarted = performance.now()
      regexp.lastIndex = 0
      regexp.test(longText)
      const longElapsed = performance.now() - longStarted
      if (shortElapsed < shortMs) shortMs = shortElapsed
      if (longElapsed < longMs) longMs = longElapsed
    }
    return {
      shape: shape.name,
      shortMs,
      longMs,
      ratio: longMs / shortMs,
      eligible: shortMs >= RATIO_FLOOR_MS,
    }
  })
}

/** The steepest growth among the arms the clock can resolve, or nothing when no arm of this pattern clears the floor. */
function worstEligibleGrowth(ladder: ShapeGrowth[]): ShapeGrowth | undefined {
  return ladder
    .filter((growth) => growth.eligible)
    .sort((a, b) => b.ratio - a.ratio)[0]
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
    const globalLiterals = LITERALS.filter((literal) => literal.flags.includes('g'))
    const flaggedTokens = globalLiterals.map((literal) => `${literal.file} ${literal.token}`).join(', ') || 'none'
    console.log(
      `redos gate: ${globalLiterals.length} of ${LITERALS.length} lifted literals carry the g flag, so those scans ` +
        `resume from lastIndex unless the helpers clear it — ${flaggedTokens}`,
    )
    console.log(
      `redos gate: five slowest — ${ranked
        .slice(0, 5)
        .map((timing) => `${timing.file} ${timing.token} ${timing.ms.toFixed(1)} ms on ${timing.payload}`)
        .join(' | ')}`,
    )
    // The shapes the ms diagnostic reports on and the shapes the ladder times are pinned equal here: a builder that
    // drifted from its payload would leave the growth verdict measuring a text this file has no history of, which is
    // a green that means nothing.
    expect(
      SHAPES.map((shape, index) => shape.build(MAX_ERROR_TEXT_LENGTH) === PAYLOADS[index]?.text),
      'a ladder shape builder no longer rebuilds the payload it was derived from',
    ).toEqual([true, true, true])

    const ladders = LITERALS.map((literal) => ({
      file: literal.file,
      token: literal.token,
      growth: growthLadder(compile(literal)),
    }))
    const offenders: string[] = []
    let asserted = 0
    for (const entry of ladders) {
      const worst = worstEligibleGrowth(entry.growth)
      if (worst === undefined) continue
      asserted += 1
      if (worst.ratio <= RATIO_MAX) continue
      offenders.push(
        `${entry.file} ${entry.token} ratio ${worst.ratio.toFixed(2)} on ${worst.shape} ` +
          `(t(${LENGTH_HALF})=${worst.shortMs.toFixed(1)} ms, t(${MAX_ERROR_TEXT_LENGTH})=${worst.longMs.toFixed(1)} ms)`,
      )
    }
    console.log(
      `redos gate: growth ladder ${RATIO_ATTEMPTS} interleaved attempts per arm at ${LENGTH_HALF} and ` +
        `${MAX_ERROR_TEXT_LENGTH} characters — ${asserted} of ${ladders.length} lifted patterns ratio-asserted, ` +
        `${ladders.length - asserted} under ${RATIO_FLOOR_MS} ms on the L arm and so not timed at signal`,
    )
    const frame = ladders.find((entry) => entry.token === JAVASCRIPT_FRAME?.token)
    const frameLongestShortMs = Math.max(...(frame?.growth.map((growth) => growth.shortMs) ?? [0]))
    // Anti-vacuity: the count above only means something if the pattern this gate exists for is inside it. If that
    // literal fell below the floor the growth verdict would assert nothing and still read green, so it is a red.
    expect(
      worstEligibleGrowth(frame?.growth ?? []),
      `the stack-frame literal ${String(JAVASCRIPT_FRAME?.token)} is not in the ratio-asserted set — its largest L ` +
        `arm measured ${frameLongestShortMs.toFixed(2)} ms against the ${RATIO_FLOOR_MS} ms floor, so the growth ` +
        `verdict would be deciding on nothing the gate was written for`,
    ).toBeDefined()
    expect(
      offenders,
      `${offenders.length} of ${asserted} ratio-asserted patterns grew more than ${RATIO_MAX}x when the input ` +
        `doubled from ${LENGTH_HALF} to ${MAX_ERROR_TEXT_LENGTH} characters`,
    ).toEqual([])
  })

  it('rejects an unbounded clone of the pattern it was written for', () => {
    const shippedSource = String(JAVASCRIPT_FRAME?.source)
    // Two guards before and after the replace, so the control cannot decay into a no-op if the shipped token ever
    // loses its bound: a replace that matched nothing would time a copy of the bounded pattern, and the assertion at
    // the bottom of this test would then be read as proof the gate discriminates when it proves nothing.
    expect(
      (shippedSource.match(/\{1,300\}/g) ?? []).length,
      'the clone is built by replacing the bound, so the shipped source has to carry exactly one {1,300} to replace',
    ).toBe(1)
    const cloneSource = shippedSource.replace('{1,300}', '+')
    expect(cloneSource, 'the replace left the shipped source untouched, so the clone is not a clone').not.toBe(shippedSource)
    expect(cloneSource).toContain('+')
    expect(cloneSource).not.toContain('{1,300}')
    const ladder = growthLadder(new RegExp(cloneSource, String(JAVASCRIPT_FRAME?.flags)))
    console.log(
      `redos gate: unbounded clone ${cloneSource} — ${ladder
        .map(
          (growth) =>
            `${growth.shape}: t(L)=${growth.shortMs.toFixed(1)} ms t(2L)=${growth.longMs.toFixed(1)} ms ratio=${growth.ratio.toFixed(2)}`,
        )
        .join(' | ')}`,
    )
    const steepest = worstEligibleGrowth(ladder)
    const longestShortMs = Math.max(...ladder.map((growth) => growth.shortMs))
    expect(
      steepest,
      `the unbounded clone never measured ${RATIO_FLOOR_MS} ms on an L arm (largest ${longestShortMs.toFixed(2)} ms) ` +
        '— a control too fast to time is how a linear pattern hides inside a gate that believes it is quadratic',
    ).toBeDefined()
    const cloneRatio = String(steepest?.ratio)
    expect(
      steepest?.ratio,
      `the unbounded clone grew ${cloneRatio}x on doubled input, at or under the ${RATIO_MAX} the gate refuses — a ` +
        'control the gate accepts means the gate is no longer a redos detector',
    ).toBeGreaterThan(RATIO_MAX)
  })

  it('keeps the javascript stack-frame pattern matching every real shape it matched before', () => {
    expect(JAVASCRIPT_FRAME, `${ENGINE_SOURCE_PATH} no longer carries the javascript stack-frame pattern`).toBeDefined()
    const pattern = new RegExp(String(JAVASCRIPT_FRAME?.source), String(JAVASCRIPT_FRAME?.flags))
    // Insurance rather than a fix: this literal's flags carry no `g` today, so `test` cannot resume anywhere, and an
    // assertion about a state the tree cannot reach would be the vacuous-guard class. The reset costs nothing and is
    // the reason a `g` appearing on the shipped token could not silently make the second frame start inside the first.
    const missed = REAL_SHAPED_FRAMES.filter((frame) => !((pattern.lastIndex = 0), pattern.test(frame.text))).map((frame) => frame.name)
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

  it('starts every scan the timing helpers run at index zero', () => {
    // Derived at run time, never typed: this row has a subject only while some lifted literal actually carries `g`, and
    // an empty set is made a red for the same reason the ratio row refuses to pass when its own pattern has left the
    // asserted set — a guard that cannot be reached is not a guard.
    const globalLiterals = LITERALS.filter((literal) => literal.flags.includes('g'))
    const carrier = globalLiterals[0]
    expect(
      carrier,
      'no lifted literal carries the g flag, so no scan can inherit a start position and the reset this row guards has ' +
        'become unobservable — the literal went away or the lifter broke',
    ).toBeDefined()

    // A probe built from the lifted literal itself, not from a typed pattern, recording the offset each scan starts
    // from. The push happens inside the override: what the previous scan left behind is not the offset the next one
    // actually used, and reading it from outside would report drift in the arm that has none.
    const instrument = () => {
      const regexp = compile(carrier)
      const starts: number[] = []
      const scan = RegExp.prototype.test
      regexp.test = (text: string) => {
        starts.push(regexp.lastIndex)
        return scan.call(regexp, text)
      }
      return { regexp, starts }
    }
    const drifted = (starts: readonly number[]) => starts.filter((start) => start !== 0)

    // Drift control first, because the two rows under it are only worth anything if this instrument can fire at all:
    // the same payloads through a loop that never resets have to show a non-zero start.
    const drift = instrument()
    for (const payload of PAYLOADS) drift.regexp.test(payload.text)
    expect(drift.starts, 'the naive loop never called the probe').toHaveLength(PAYLOADS.length)
    expect(
      drifted(drift.starts),
      `the no-reset loop recorded starts of ${drift.starts.join(', ')} — the instrument cannot see lastIndex residue, ` +
        'so the helpers below would pass on a blind recorder rather than on a reset that works',
    ).not.toHaveLength(0)

    const payloadRun = instrument()
    worstPayloadRun(payloadRun.regexp)
    expect(payloadRun.starts.length, 'worstPayloadRun scanned fewer times than it has payloads').toBeGreaterThanOrEqual(
      PAYLOADS.length,
    )
    expect(
      drifted(payloadRun.starts),
      `worstPayloadRun started ${drifted(payloadRun.starts).length} of ${payloadRun.starts.length} scans at ` +
        `${drifted(payloadRun.starts).join(', ')} instead of 0 — an arm timed from a previous match scanned the tail of ` +
        'another payload, so the ms it prints is not the cost of the payload it names',
    ).toEqual([])

    const ladderRun = instrument()
    growthLadder(ladderRun.regexp)
    expect(ladderRun.starts.length, 'growthLadder does not time both arms of every shape once per attempt').toBe(
      SHAPES.length * RATIO_ATTEMPTS * 2,
    )
    expect(
      drifted(ladderRun.starts),
      `growthLadder started ${drifted(ladderRun.starts).length} of ${ladderRun.starts.length} arms at ` +
        `${drifted(ladderRun.starts).join(', ')} — the arms of a shape then differ in where they began, which is the ` +
        'one thing a growth ratio may not vary by, since the ratio is taken to be length alone',
    ).toEqual([])
  })
})
