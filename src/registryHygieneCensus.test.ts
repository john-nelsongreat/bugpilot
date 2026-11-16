/// <reference types="node" />
// The anti-vacuity half of the pair. The victim's own assertions pass when it runs first, so on their
// own they cannot tell a closed leak from an untested arrangement. This file is both the smallest and
// the cheapest of the three, which puts it last in the cold size ordering and last in the warm
// duration ordering too, so by the time it runs the victim has recorded which case happened.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const victimMark = join(tmpdir(), 'bugpilot-registry-victim.txt')

describe('registry hygiene census', () => {
  it('the victim ran after the polluter in this run and still got the real module', () => {
    expect(existsSync(victimMark)).toBe(true)
    expect(readFileSync(victimMark, 'utf8')).toBe(`REAL_AFTER_STUB-${process.pid}`)
    rmSync(victimMark)
  })
})
