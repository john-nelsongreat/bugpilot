/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

type Tokens = Record<string, string>

function readTokens(selector: string): Tokens {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!block) throw new Error(`Missing ${selector} block in index.css`)

  const tokens: Tokens = {}
  for (const match of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim()
  }
  return tokens
}

function channel(value: number): number {
  const srgb = value / 255
  return srgb <= 0.03928
    ? srgb / 12.92
    : Math.pow((srgb + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const digits = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(digits)) throw new Error(`Expected a hex colour, received "${hex}"`)
  const [r, g, b] = [0, 2, 4].map((offset) => channel(parseInt(digits.slice(offset, offset + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const themes = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: ":root[data-theme='dark']" },
]

const pairs = [
  { label: 'added marker on added row', foreground: '--diff-add-line', background: '--diff-add-surface' },
  { label: 'added marker on neighbour surface', foreground: '--diff-add-line', background: '--surface-raised' },
  { label: 'removed marker on removed row', foreground: '--diff-remove-line', background: '--diff-remove-surface' },
  { label: 'removed marker on neighbour surface', foreground: '--diff-remove-line', background: '--surface-raised' },
]

describe.each(themes)('$name diff markers', ({ selector }) => {
  const tokens = readTokens(selector)

  it('defines the diff tokens', () => {
    const missing = pairs.flatMap(({ foreground, background }) =>
      [foreground, background].filter((name) => !tokens[name]),
    )
    expect([...new Set(missing)], 'missing tokens').toEqual([])
  })

  it('meets the 3:1 non-text contrast for both markers', () => {
    const failures = pairs.flatMap(({ label, foreground, background }) => {
      const ratio = contrast(tokens[foreground], tokens[background])
      return ratio >= 3 ? [] : [`${label}: ${ratio.toFixed(2)}:1 (needs 3:1)`]
    })
    expect(failures, failures.join('\n')).toEqual([])
  })
})
