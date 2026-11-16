// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_STORAGE_ENTRIES } from './storageCore'

/**
 * README's "Saved browser data." section names every key the app keeps in the browser, and the
 * bulk clear walks `APP_STORAGE_ENTRIES`. Both claims drift the same way: a key gains a writer, or
 * a bullet is rewritten, and the other side keeps saying what it always said. So the two are
 * pinned in both directions against the array the code walks, the same model as
 * `rules/generic.docs.test.ts` uses for the Rules table.
 */

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')

describe('the storage inventory in README cannot drift out of the registry', () => {
  it('names every registered key and prefix in its own bullet', () => {
    for (const entry of APP_STORAGE_ENTRIES) {
      expect(README, `README.md never names \`${entry.key}\``).toContain(`\`${entry.key}`)
    }
  })

  // The complete legal set, with toEqual rather than "no unknown keys": a tokeniser that stopped
  // matching would otherwise report a clean run it never earned.
  it('introduces no bugpilot.-prefixed key the registry does not own', () => {
    const tokens = [...new Set(README.match(/bugpilot\.[A-Za-z][A-Za-z0-9.]*/g) ?? [])].sort()
    expect(tokens).toEqual([...APP_STORAGE_ENTRIES.map((entry) => entry.key)].sort())
  })
})
