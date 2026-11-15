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
