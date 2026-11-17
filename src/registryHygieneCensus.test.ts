/// <reference types="node" />
// The anti-vacuity half of the pair. The victim's own assertions pass when it runs first, so on their
// own they cannot tell a closed leak from an untested arrangement. This file therefore has to run last
// of the three, and that is enforced rather than hoped for: RegistryOrderSequencer in vite.config.ts
// pins the trio's relative order. Without that pin the default sequencer's failed-first rule can put
// this file ahead of the victim, where the only mark on disk is one a previous run left behind.
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
