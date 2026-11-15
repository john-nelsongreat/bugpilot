import { describe, expect, it } from 'vitest'
import * as flight from './flight'
import { GLANCE_MS, nextMascotState } from './flight'

const phaseEnded = (phase: 'tapped' | 'takeoff' | 'flying' | 'landing') =>
  ({ type: 'PHASE_ENDED', phase }) as const

describe('nextMascotState', () => {
  it('starts the flight from idle on a tap', () => {
    expect(nextMascotState('idle', { type: 'TAP' }, false)).toBe('tapped')
  })

  it('ignores a second tap while tapped', () => {
    expect(nextMascotState('tapped', { type: 'TAP' }, false)).toBe('tapped')
  })

  it('ignores a second tap while taking off', () => {
    expect(nextMascotState('takeoff', { type: 'TAP' }, false)).toBe('takeoff')
  })

  it('ignores a second tap while flying', () => {
    expect(nextMascotState('flying', { type: 'TAP' }, false)).toBe('flying')
  })

  it('ignores a second tap while landing', () => {
    expect(nextMascotState('landing', { type: 'TAP' }, false)).toBe('landing')
  })

  it('ignores a second tap while glancing', () => {
    expect(nextMascotState('glance', { type: 'TAP' }, false)).toBe('glance')
  })

  it('runs every phase in order and returns to idle', () => {
    expect(nextMascotState('tapped', phaseEnded('tapped'), false)).toBe('takeoff')
    expect(nextMascotState('takeoff', phaseEnded('takeoff'), false)).toBe('flying')
    expect(nextMascotState('flying', phaseEnded('flying'), false)).toBe('landing')
    expect(nextMascotState('landing', phaseEnded('landing'), false)).toBe('idle')
  })

  it('ignores a PHASE_ENDED that names a different phase', () => {
    expect(nextMascotState('tapped', phaseEnded('takeoff'), false)).toBe('tapped')
    expect(nextMascotState('takeoff', phaseEnded('flying'), false)).toBe('takeoff')
    expect(nextMascotState('flying', phaseEnded('tapped'), false)).toBe('flying')
    expect(nextMascotState('landing', phaseEnded('flying'), false)).toBe('landing')
    expect(nextMascotState('idle', phaseEnded('landing'), false)).toBe('idle')
    expect(nextMascotState('glance', phaseEnded('tapped'), false)).toBe('glance')
  })

  it('ends only the glance on GLANCE_ENDED', () => {
    expect(nextMascotState('glance', { type: 'GLANCE_ENDED' }, false)).toBe('idle')
    expect(nextMascotState('idle', { type: 'GLANCE_ENDED' }, false)).toBe('idle')
    expect(nextMascotState('flying', { type: 'GLANCE_ENDED' }, false)).toBe('flying')
  })

  it('chooses glance instead of takeoff when motion is reduced', () => {
    const next = nextMascotState('idle', { type: 'TAP' }, true)

    expect(next).toBe('glance')
    expect(next).not.toBe('takeoff')
    expect(next).not.toBe('tapped')
  })

  it('still ignores a tap under reduced motion when already flying', () => {
    expect(nextMascotState('flying', { type: 'TAP' }, true)).toBe('flying')
  })
})

describe('flight timings', () => {
  it('exports the glance hold as the only duration JS owns', () => {
    expect(GLANCE_MS).toBe(900)
  })

  it('duplicates no flight timing in the module surface', () => {
    expect(Object.keys(flight).sort()).toEqual(['GLANCE_MS', 'nextMascotState'])
  })
})
