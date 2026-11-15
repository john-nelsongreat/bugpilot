export type MascotState =
  | 'idle'
  | 'tapped'
  | 'takeoff'
  | 'flying'
  | 'landing'
  | 'glance'

export type MascotEvent =
  | { type: 'TAP' }
  | { type: 'PHASE_ENDED'; phase: 'tapped' | 'takeoff' | 'flying' | 'landing' }
  | { type: 'GLANCE_ENDED' }

/** The only duration JS owns; the four flight timings live in App.css. */
export const GLANCE_MS = 900

const NEXT_PHASE: Record<
  'tapped' | 'takeoff' | 'flying' | 'landing',
  MascotState
> = {
  tapped: 'takeoff',
  takeoff: 'flying',
  flying: 'landing',
  landing: 'idle',
}

export function nextMascotState(
  state: MascotState,
  event: MascotEvent,
  reducedMotion: boolean,
): MascotState {
  switch (event.type) {
    case 'TAP': {
      // A second tap mid-flight is dropped rather than queued: overlapping
      // flights would pile up and announce a stream of state changes.
      if (state !== 'idle') return state

      return reducedMotion ? 'glance' : 'tapped'
    }
    case 'PHASE_ENDED': {
      // Ignored unless it names the phase we are in, so a stray or bubbled
      // animationend cannot skip a phase ahead.
      return state === event.phase ? NEXT_PHASE[event.phase] : state
    }
    case 'GLANCE_ENDED': {
      return state === 'glance' ? 'idle' : state
    }
  }
}
