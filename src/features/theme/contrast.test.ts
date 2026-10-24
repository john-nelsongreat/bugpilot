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
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`Expected a hex colour, received "${hex}"`)
  }
  const [r, g, b] = [0, 2, 4].map((offset) =>
    channel(parseInt(full.slice(offset, offset + 2), 16)),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

type Pair = {
  label: string
  foreground: string
  background: string
  minimum: number
}

const textPairs: Pair[] = [
  { label: 'body text on page', foreground: '--ink', background: '--bg', minimum: 4.5 },
  { label: 'body text on surface', foreground: '--ink', background: '--surface', minimum: 4.5 },
  { label: 'body text on raised surface', foreground: '--ink', background: '--surface-raised', minimum: 4.5 },
  { label: 'secondary text on page', foreground: '--ink-soft', background: '--bg', minimum: 4.5 },
  { label: 'secondary text on surface', foreground: '--ink-soft', background: '--surface', minimum: 4.5 },
  { label: 'secondary text on raised surface', foreground: '--ink-soft', background: '--surface-raised', minimum: 4.5 },
  { label: 'muted text on page', foreground: '--ink-muted', background: '--bg', minimum: 4.5 },
  { label: 'muted text on surface', foreground: '--ink-muted', background: '--surface', minimum: 4.5 },
  { label: 'muted text on raised surface', foreground: '--ink-muted', background: '--surface-raised', minimum: 4.5 },
  { label: 'muted text on sunken surface', foreground: '--ink-muted', background: '--surface-sunken', minimum: 4.5 },
  { label: 'accent text on page', foreground: '--accent-text', background: '--bg', minimum: 4.5 },
  { label: 'accent text on surface', foreground: '--accent-text', background: '--surface', minimum: 4.5 },
  { label: 'accent text on sunken surface', foreground: '--accent-text', background: '--surface-sunken', minimum: 4.5 },
  { label: 'accent text on accent soft', foreground: '--accent-text', background: '--accent-soft', minimum: 4.5 },
  { label: 'primary button label', foreground: '--accent-ink', background: '--accent', minimum: 4.5 },
  { label: 'primary button hover label', foreground: '--accent-ink', background: '--accent-hover', minimum: 4.5 },
  { label: 'danger text on page', foreground: '--danger', background: '--bg', minimum: 4.5 },
  { label: 'danger text on surface', foreground: '--danger', background: '--surface', minimum: 4.5 },
  { label: 'danger text on raised surface', foreground: '--danger', background: '--surface-raised', minimum: 4.5 },
  { label: 'danger text on danger soft', foreground: '--danger', background: '--danger-soft', minimum: 4.5 },
  { label: 'danger button label', foreground: '--danger-ink', background: '--danger-fill', minimum: 4.5 },
  { label: 'danger button hover label', foreground: '--danger-ink', background: '--danger-fill-hover', minimum: 4.5 },
  { label: 'panel text', foreground: '--panel-ink', background: '--panel', minimum: 4.5 },
  { label: 'panel muted text', foreground: '--panel-muted', background: '--panel', minimum: 4.5 },
  { label: 'code text', foreground: '--code-ink', background: '--code-bg', minimum: 4.5 },
  { label: 'disabled text', foreground: '--disabled-ink', background: '--disabled-bg', minimum: 4.5 },
  { label: 'low severity badge', foreground: '--tone-low', background: '--surface-sunken', minimum: 4.5 },
  { label: 'medium severity badge', foreground: '--tone-medium', background: '--surface-sunken', minimum: 4.5 },
  { label: 'high severity badge', foreground: '--tone-high', background: '--surface-sunken', minimum: 4.5 },
  { label: 'critical severity badge', foreground: '--tone-critical', background: '--surface-sunken', minimum: 4.5 },
  { label: 'open status badge', foreground: '--tone-open', background: '--surface-sunken', minimum: 4.5 },
  { label: 'in progress status badge', foreground: '--tone-progress', background: '--surface-sunken', minimum: 4.5 },
  { label: 'resolved status badge', foreground: '--tone-resolved', background: '--surface-sunken', minimum: 4.5 },
  { label: 'closed status badge', foreground: '--tone-closed', background: '--surface-sunken', minimum: 4.5 },
]

const uiPairs: Pair[] = [
  { label: 'strong border on surface', foreground: '--line-strong', background: '--surface', minimum: 3 },
  { label: 'strong border on raised surface', foreground: '--line-strong', background: '--surface-raised', minimum: 3 },
  { label: 'accent line on sunken surface', foreground: '--accent-line', background: '--surface-sunken', minimum: 3 },
  { label: 'focus ring on page', foreground: '--focus', background: '--bg', minimum: 3 },
  { label: 'focus ring on surface', foreground: '--focus', background: '--surface', minimum: 3 },
  { label: 'focus ring on raised surface', foreground: '--focus', background: '--surface-raised', minimum: 3 },
]

const requiredTokens = [
  '--amber',
  '--gold',
  '--slate',
  '--bg',
  '--surface',
  '--surface-raised',
  '--surface-sunken',
  '--ink',
  '--ink-soft',
  '--ink-muted',
  '--line-strong',
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--accent-ink',
  '--accent-text',
  '--accent-line',
  '--focus',
  '--danger',
  '--danger-fill',
  '--danger-fill-hover',
  '--danger-ink',
  '--danger-soft',
  '--panel',
  '--panel-ink',
  '--panel-muted',
  '--code-bg',
  '--code-ink',
  '--disabled-bg',
  '--disabled-ink',
  '--tone-low',
  '--tone-medium',
  '--tone-high',
  '--tone-critical',
  '--tone-open',
  '--tone-progress',
  '--tone-resolved',
  '--tone-closed',
]

const themes = [
  {
    name: 'light',
    selector: ':root',
    expected: {
      '--amber': '#FFBF00',
      '--gold': '#F4D700',
      '--slate': '#425262',
      '--bg': '#FFF8E0',
      '--surface': '#FFF6CB',
      '--accent': '#FFBF00',
    },
  },
  {
    name: 'dark',
    selector: ":root[data-theme='dark']",
    expected: {
      '--amber': '#FFBF00',
      '--gold': '#F4D700',
      '--slate': '#425262',
      '--bg': '#262626',
      '--surface': '#1F1F1F',
      '--accent': '#FFBF00',
    },
  },
]

describe.each(themes)('$name theme tokens', ({ selector, expected }) => {
  const tokens = readTokens(selector)

  it('defines the amber identity and page tokens', () => {
    for (const [name, value] of Object.entries(expected)) {
      expect(tokens[name]?.toUpperCase(), `${name} token`).toBe(value)
    }
  })

  it('defines every token used by the contrast checks', () => {
    const missing = requiredTokens.filter((name) => !tokens[name])
    expect(missing, 'missing tokens').toEqual([])
  })

  it('meets WCAG AA for text and badge colours', () => {
    const failures = textPairs.flatMap(({ label, foreground, background, minimum }) => {
      const fg = tokens[foreground]
      const bg = tokens[background]
      if (!fg || !bg) {
        return [`${label}: missing ${!fg ? foreground : background}`]
      }
      const ratio = contrast(fg, bg)
      return ratio >= minimum
        ? []
        : [`${label}: ${ratio.toFixed(2)}:1 (needs ${minimum}:1)`]
    })
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('meets WCAG AA for borders and focus rings', () => {
    const failures = uiPairs.flatMap(({ label, foreground, background, minimum }) => {
      const fg = tokens[foreground]
      const bg = tokens[background]
      if (!fg || !bg) {
        return [`${label}: missing ${!fg ? foreground : background}`]
      }
      const ratio = contrast(fg, bg)
      return ratio >= minimum
        ? []
        : [`${label}: ${ratio.toFixed(2)}:1 (needs ${minimum}:1)`]
    })
    expect(failures, failures.join('\n')).toEqual([])
  })
})
