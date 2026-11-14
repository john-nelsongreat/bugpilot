// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { javascriptRules } from './rules/javascript'
import { GIT_SUB_SIGNATURES, neutralRules } from './rules/neutral'
import { pythonRules } from './rules/python'

/**
 * README states eight numbers about the Assistant's rule set: the 30 language rules and their 16/14
 * split, the 22 anchored Git patterns and the 21 distinct shapes under them, the 17 named rows of the
 * sub-signature table, and the 31 registered rules. None of them was derived anywhere before this
 * file — `registry.test.ts` asserts behaviour and `engine.test.ts` asserts shape, and a number that
 * lives only in a sentence is the one kind of claim a documentation slice can leave behind. Every
 * figure below comes from the arrays the engine actually runs, or from counting the table the same
 * sentence points at.
 *
 * Deliberately NOT derived:
 *
 * - Which shapes share a row. The 21 shapes reach 19 narrative branches because two case pairs
 *   (`identity` with `identity-banner`, `line-endings` with `line-endings-short`) fall through to a
 *   shared branch; the table then prints `permission-denied`, `http-403` and `publickey` as one
 *   "Account lacks access" row, and that is how 19 branches become 17 named rows. Only the first
 *   merge exists in code, so the grouping lives in prose and a re-titled row cannot be caught here.
 *   The row *count* is checked against the table, which catches the drift the sentence can suffer.
 * - The `GitShape` union. It is a type, so nothing runs it: 22 members, one of which
 *   (`generic-fatal`) has no sub-signature because the fallback is built by the `default:` branch.
 */

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')
const LANGUAGE_RULES = pythonRules.length + javascriptRules.length
const REGISTERED_RULES = LANGUAGE_RULES + neutralRules.length

/** The sub-signature table under "Supported language-neutral rules", counted from its own rows. */
function neutralTable(): { named: number; fallback: number } {
  const lines = README.split(/\r?\n/)
  const header = lines.indexOf('| Sub-signature | Matched signature | What the result says |')
  if (header === -1) {
    throw new Error('README.md has no sub-signature table — the gate cannot find the table it guards')
  }
  let named = 0
  let fallback = 0
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i += 1) {
    if (/^\|\s*Any other/.test(lines[i])) fallback += 1
    else named += 1
  }
  return { named, fallback }
}

/** Lift one number out of the prose, and refuse to let a reworded sentence pass as a green suite. */
function stated(pattern: RegExp, label: string, group = 1): string {
  const found = pattern.exec(README)
  if (!found) throw new Error(`README.md no longer says what this gate reads (${label})`)
  return found[group]
}

const SHAPES = GIT_SUB_SIGNATURES.map((entry) => entry.shape)
const REPEATED = SHAPES.filter((shape, index) => SHAPES.indexOf(shape) !== index)

describe('the Assistant rule counts cannot drift out of the rule modules', () => {
  it('states the language-rule total and split exactly as the two rule modules export them', () => {
    const sentence = /contain the (\d+) language rules \((\d+) Python and (\d+) JavaScript\)/
    expect(Number(stated(sentence, 'the Diagnostics paragraph'))).toBe(LANGUAGE_RULES)
    expect(Number(stated(sentence, 'the Diagnostics paragraph', 2))).toBe(pythonRules.length)
    expect(Number(stated(sentence, 'the Diagnostics paragraph', 3))).toBe(javascriptRules.length)
  })

  it('counts the neutral scan against the same language rules', () => {
    expect(Number(stated(/the (\d+) language rules behave exactly as before/, 'the neutral-scan sentence')))
      .toBe(LANGUAGE_RULES)
  })

  it('states the registered rule count as the three exported arrays sum to', () => {
    const sentence = /the registered rule count is (\d+): (\d+) Python, (\d+) JavaScript, and this one language-neutral rule/
    expect(Number(stated(sentence, 'the closing count of the language-neutral paragraph'))).toBe(REGISTERED_RULES)
    expect(Number(stated(sentence, 'the closing count of the language-neutral paragraph', 2))).toBe(
      pythonRules.length,
    )
    expect(Number(stated(sentence, 'the closing count of the language-neutral paragraph', 3))).toBe(
      javascriptRules.length,
    )
    expect(neutralRules, 'the prose calls it "this one language-neutral rule"').toHaveLength(1)
  })

  it('states the pattern and shape counts exactly as the sub-signature table holds them', () => {
    const sentence = /(\d+) anchored patterns covering the (\d+) distinct shapes grouped into the (\d+) named rows/
    expect(Number(stated(sentence, 'the batch sentence')), 'anchored patterns').toBe(
      GIT_SUB_SIGNATURES.length,
    )
    expect(Number(stated(sentence, 'the batch sentence', 2)), 'distinct shapes').toBe(
      new Set(SHAPES).size,
    )
    expect(Number(stated(sentence, 'the batch sentence', 3)), 'named rows').toBe(neutralTable().named)
  })

  it('names the shape matched twice exactly as the sub-signature table repeats it', () => {
    expect(stated(/one (\w[\w-]*) message is matched twice/, 'the parenthetical')).toEqual(
      REPEATED.join(','),
    )
  })

  it('promises one generic fallback row and ships exactly that', () => {
    expect(README).toContain('plus the generic `fatal:` fallback row')
    expect(neutralTable().fallback).toBe(1)
  })
})
