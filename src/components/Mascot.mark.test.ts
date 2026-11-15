import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const favicon = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8')
const mascot = readFileSync(resolve(process.cwd(), 'src/components/Mascot.tsx'), 'utf8')

// The head geometry the logomark is allowed to carry, copied verbatim out of the
// .mascot-headgroup subtree. A redraw of the favicon that changes any of these strings is the
// drift these tests exist to catch.
const HEAD_GEOMETRY = [
  'M56 26 C52 22 50 19 48 16',
  'M72 26 C76 22 78 19 80 16',
  'cx="48" cy="16" r="3.2"',
  'cx="80" cy="16" r="3.2"',
  'cx="64" cy="34" rx="13.5" ry="10"',
  'cx="59.4" cy="35.6" r="2.9"',
  'cx="68.6" cy="35.6" r="2.9"',
]

const CROP_SCALE = 0.72
const PLATE_UNITS = 32
const EYE_SPACING = 9.2

function eyeRadius(source: string): number {
  const match = source.match(/cy="35\.6" r="([\d.]+)"/)
  if (!match) throw new Error('no knocked-out eye circle found in the favicon')
  return Number(match[1])
}

function numbers(source: string, className: string): Array<{ cx: number; cy: number; r: number }> {
  const re = new RegExp(`mascot-${className}" cx="([\\d.]+)" cy="([\\d.]+)" r="([\\d.]+)"`, 'g')
  const found: Array<{ cx: number; cy: number; r: number }> = []
  for (const hit of source.matchAll(re)) {
    found.push({ cx: Number(hit[1]), cy: Number(hit[2]), r: Number(hit[3]) })
  }
  return found
}

describe('the favicon carries the mascot head verbatim', () => {
  it.each(HEAD_GEOMETRY)('head geometry %s appears in both marks', (fragment) => {
    expect(mascot).toContain(fragment)
    expect(favicon).toContain(fragment)
  })

  it('is a one-colour mark with negative space, not a shaded illustration', () => {
    expect(favicon).not.toMatch(/linearGradient|radialGradient|<filter|opacity="/)
  })
})

describe('the mark survives favicon size', () => {
  it('keeps at least one device pixel of gap between the two knocked-out eyes at 16 px', () => {
    const pxPerUnit = CROP_SCALE * (16 / PLATE_UNITS)
    const gapPx = (EYE_SPACING - 2 * eyeRadius(favicon)) * pxPerUnit
    expect(gapPx).toBeGreaterThanOrEqual(1)
  })

  it('draws the antennae at or above one device pixel at 16 px', () => {
    const stroke = Number(favicon.match(/stroke-width="([\d.]+)"/)?.[1])
    expect(stroke * CROP_SCALE * (16 / PLATE_UNITS)).toBeGreaterThanOrEqual(1)
  })
})

describe('the mascot catchlights are real highlights', () => {
  const pupils = numbers(mascot, 'pupil')
  const glints = numbers(mascot, 'glint')

  it('has exactly one pupil and one glint per eye', () => {
    expect(pupils).toHaveLength(2)
    expect(glints).toHaveLength(2)
  })

  it.each([
    ['left', 0],
    ['right', 1],
  ])('puts the %s catchlight fully inside its pupil', (_side, index) => {
    const pupil = pupils[index]
    const glint = glints[index]
    const distance = Math.hypot(glint.cx - pupil.cx, glint.cy - pupil.cy)
    expect(distance + glint.r).toBeLessThanOrEqual(pupil.r)
  })

  it.each([
    ['left', 0],
    ['right', 1],
  ])('lights the %s catchlight from upper-left, the same side on both eyes', (_side, index) => {
    expect(glints[index].cx).toBeLessThan(pupils[index].cx)
    expect(glints[index].cy).toBeLessThan(pupils[index].cy)
  })
})

/**
 * Painter's order in `Mascot.tsx` is `.mascot-legs` first and `.mascot-body` second, and the body carries the two
 * filled elytron halves plus the pronotum. A leg point inside the union of those three shapes is not in the render at
 * all, whatever its `d` string says: the front pair used to run `M40 78 L31 74` and `M88 78 L97 74`, the elytron's left
 * edge passes through x≈29.5-33 across y=63-78, and those two legs were 100% covered — the mark read as a four-legged
 * beetle. This guard recomputes that occlusion out of the shipped text, so a redraw that buries a leg fails CI
 * instead of shipping. Everything it measures is parsed from the source; the one hardcoded string in it is the
 * pre-change leg in the last test, and that is there to prove the guard can go red.
 */

type Point = readonly [number, number]

/** Well past the 200-segment floor the guard needs: the elytron edge is the thing every leg is measured against. */
const CUBIC_SEGMENTS = 240
const ELLIPSE_SEGMENTS = 720
const LEG_SAMPLES = 201

/** The three surviving pairs measure 53.7-57.2% visible, so this floor sits more than 5 points under the worst. */
const VISIBLE_FLOOR = 0.45

/** A buried leg has to measure essentially nothing visible, or the instrument stopped measuring something. */
const BURIED_CEILING = 0.05

/** Half a unit off the mirror axis is a redraw, not a rounding error. */
const MIRROR_TOLERANCE = 0.1

function numbersIn(fragment: string): number[] {
  return (fragment.match(/-?[\d.]+/g) ?? []).map(Number)
}

function legEndpoints(d: string): readonly [number, number, number, number] {
  const nums = numbersIn(d)
  if (!d.startsWith('M') || nums.length !== 4) {
    throw new Error(
      `leg "${d}" is not one straight M x y L x y segment (${nums.length} numbers) — nothing here measures a curved leg`,
    )
  }
  return [nums[0], nums[1], nums[2], nums[3]]
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ]
}

/**
 * The elytra are two cubics closed with a `Z`, and the close is added back here: measured as an open shell, every leg
 * point reads as outside and the guard reports six healthy legs while the render shows four.
 */
function flatten(d: string, label: string): Point[] {
  const points: Point[] = []
  let cursor: Point = [0, 0]
  for (const command of d.match(/[MLCZ][^MLCZ]*/g) ?? []) {
    const kind = command[0]
    if (kind === 'Z') continue
    const args = numbersIn(command.slice(1))
    if (kind === 'C') {
      if (args.length !== 6) throw new Error(`${label}: a cubic needs 6 numbers, got ${args.length} in "${d}"`)
      const next: Point = [args[4], args[5]]
      for (let step = 1; step <= CUBIC_SEGMENTS; step += 1) {
        points.push(cubicPoint(cursor, [args[0], args[1]], [args[2], args[3]], next, step / CUBIC_SEGMENTS))
      }
      cursor = next
    } else {
      if (args.length !== 2) throw new Error(`${label}: ${kind} needs 2 numbers, got ${args.length} in "${d}"`)
      cursor = [args[0], args[1]]
      points.push(cursor)
    }
  }
  if (points.length < 3) {
    throw new Error(`${label}: flattened to ${points.length} points — not a closed shape to cast a ray against`)
  }
  if (d.trim().endsWith('Z')) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) points.push(first)
  }
  return points
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Point[] {
  const points: Point[] = []
  for (let step = 0; step < ELLIPSE_SEGMENTS; step += 1) {
    const angle = (step / ELLIPSE_SEGMENTS) * Math.PI * 2
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)])
  }
  return points
}

/** Even-odd ray cast to the right, which is the fill rule the renderer itself uses for these paths. */
function isCoveredBy(shape: readonly Point[], x: number, y: number): boolean {
  let flipped = false
  for (let i = 0; i < shape.length; i += 1) {
    const a = shape[i]
    const b = shape[(i + 1) % shape.length]
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) flipped = !flipped
  }
  return flipped
}

function requireAnchor(re: RegExp, label: string): RegExpMatchArray {
  const found = mascot.match(re)
  if (!found) throw new Error(`Mascot.tsx no longer carries ${label}, so this guard has nothing to measure`)
  return found
}

function mirrorAxis(): number {
  const box = mascot.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (!box) throw new Error('Mascot.tsx lost its `viewBox="0 0 w h"` — the mirror axis cannot be derived')
  return Number(box[1]) / 2
}

const LEGS: readonly string[] = [...mascot.matchAll(/<path className="mascot-leg" d="([^"]+)"\s*\/>/g)].map((hit) =>
  String(hit[1]),
)

const PRONOTUM = requireAnchor(
  /mascot-pronotum"\s+cx="([\d.]+)"\s+cy="([\d.]+)"\s+rx="([\d.]+)"\s+ry="([\d.]+)"/,
  'the pronotum ellipse',
)

/** The three shapes painted over the legs, in the order the file paints them. */
const SILHOUETTE: readonly (readonly Point[])[] = [
  flatten(requireAnchor(/mascot-half--left"\s+d="([^"]+)"/, 'the left elytron outline')[1], 'left elytron'),
  flatten(requireAnchor(/mascot-half--right"\s+d="([^"]+)"/, 'the right elytron outline')[1], 'right elytron'),
  ellipse(Number(PRONOTUM[1]), Number(PRONOTUM[2]), Number(PRONOTUM[3]), Number(PRONOTUM[4])),
]

/** Fraction of the leg's own centreline that survives all three shapes. */
function visibleFraction(d: string): number {
  const [ax, ay, bx, by] = legEndpoints(d)
  let hidden = 0
  for (let sample = 0; sample < LEG_SAMPLES; sample += 1) {
    const t = sample / (LEG_SAMPLES - 1)
    const x = ax + (bx - ax) * t
    const y = ay + (by - ay) * t
    if (SILHOUETTE.some((shape) => isCoveredBy(shape, x, y))) hidden += 1
  }
  return (LEG_SAMPLES - hidden) / LEG_SAMPLES
}

/**
 * Paired by root height rather than by file order, so reordering the six `<path>` elements cannot silently re-point a
 * comparison at the wrong twin.
 */
function mirroredPairs(): Array<{ readonly left: string; readonly right: string }> {
  const axis = mirrorAxis()
  const byRootY = (a: string, b: string) => legEndpoints(a)[1] - legEndpoints(b)[1]
  const lefts = LEGS.filter((d) => legEndpoints(d)[0] < axis).sort(byRootY)
  const rights = LEGS.filter((d) => legEndpoints(d)[0] > axis).sort(byRootY)
  if (lefts.length !== 3 || rights.length !== 3) {
    throw new Error(`legs split ${lefts.length} left / ${rights.length} right about x=${axis} — pairing needs three of each`)
  }
  return lefts.map((left, index) => ({ left, right: rights[index] }))
}

describe('every leg stays visible through the body painted over it', () => {
  it('measures six legs against three closed filled shapes', () => {
    expect(LEGS).toHaveLength(6)
    expect(SILHOUETTE).toHaveLength(3)
    const counts = SILHOUETTE.map((shape) => shape.length)
    expect(
      counts.filter((count) => count < 200),
      `a filled shape flattened to under 200 vertices makes the ray cast guess at the edge: ${counts.join('/')}`,
    ).toEqual([])
  })

  it('keeps at least 45% of every leg visible', () => {
    const report = LEGS.map((d) => ({ d, visible: visibleFraction(d) }))
    for (const leg of report) {
      console.log(`leg occlusion: ${leg.d.padEnd(16)} visible=${(leg.visible * 100).toFixed(1)}%`)
    }
    const offenders = report
      .filter((leg) => leg.visible < VISIBLE_FLOOR)
      .map((leg) => `${leg.d} is only ${(leg.visible * 100).toFixed(1)}% visible`)
    expect(
      offenders,
      '.mascot-legs is painted before the filled elytra and pronotum, so a leg under that union is not in the render',
    ).toEqual([])
  })

  it('keeps each left leg mirrored about the art axis by its right twin', () => {
    const axis = mirrorAxis()
    const drift = mirroredPairs().flatMap(({ left, right }) => {
      const l = legEndpoints(left)
      const r = legEndpoints(right)
      return [
        { what: `${left}/${right} root x`, error: Math.abs(l[0] + r[0] - 2 * axis) },
        { what: `${left}/${right} tip x`, error: Math.abs(l[2] + r[2] - 2 * axis) },
        { what: `${left}/${right} root y`, error: Math.abs(l[1] - r[1]) },
        { what: `${left}/${right} tip y`, error: Math.abs(l[3] - r[3]) },
      ]
        .filter((check) => check.error > MIRROR_TOLERANCE)
        .map((check) => `${check.what} off by ${check.error.toFixed(2)}`)
    })
    expect(drift, `the logomark is mirrored about x=${axis}; a leg redraw has to keep both sides`).toEqual([])
  })

  it('goes red on the buried front leg it was written for', () => {
    const beforeTheFix = 'M40 78 L31 74'
    const visible = visibleFraction(beforeTheFix)
    console.log(
      `leg occlusion fixture: ${beforeTheFix} visible=${(visible * 100).toFixed(1)}% (ceiling ${BURIED_CEILING * 100}%)`,
    )
    expect(
      visible,
      `the pre-change front leg ${beforeTheFix} measured ${(visible * 100).toFixed(1)}% visible — at or above ` +
        `${BURIED_CEILING * 100}% this guard can no longer detect occlusion, so a re-buried leg would ship`,
    ).toBeLessThan(BURIED_CEILING)
  })
})
