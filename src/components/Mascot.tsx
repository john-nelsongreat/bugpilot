import { useEffect, useReducer } from 'react'
import {
  GLANCE_MS,
  nextMascotState,
  type MascotEvent,
  type MascotState,
} from '../features/mascot/flight'

const PHASE_BY_ANIMATION: Record<
  string,
  'tapped' | 'takeoff' | 'flying' | 'landing'
> = {
  'mascot-tapped': 'tapped',
  'mascot-takeoff': 'takeoff',
  'mascot-flight': 'flying',
  'mascot-landing': 'landing',
}

type FlightAction = {
  event: MascotEvent
  reducedMotion?: boolean
}

function flightReducer(state: MascotState, action: FlightAction): MascotState {
  return nextMascotState(state, action.event, action.reducedMotion ?? false)
}

export function Mascot() {
  const [state, dispatch] = useReducer(flightReducer, 'idle')

  useEffect(() => {
    if (state !== 'glance') return undefined

    const timer = window.setTimeout(() => {
      dispatch({ event: { type: 'GLANCE_ENDED' } })
    }, GLANCE_MS)

    return () => window.clearTimeout(timer)
  }, [state])

  const handleTap = () => {
    dispatch({
      event: { type: 'TAP' },
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches,
    })
  }

  const handlePhaseEnd = (animationName: string) => {
    const phase = PHASE_BY_ANIMATION[animationName]
    if (phase === undefined) return

    dispatch({ event: { type: 'PHASE_ENDED', phase } })
  }

  return (
    <div className="mascot-stage">
      <div className="mascot-copy">
        <p className="eyebrow">Companion</p>
        <p className="page-lede">
          Tap the ladybug and it opens its wings and flies a loop back to its
          perch.
        </p>
      </div>
      <button
        type="button"
        className="mascot"
        data-mascot-state={state}
        aria-label="Send the BugPilot ladybug on a flight"
        onClick={handleTap}
      >
        <svg
          className="mascot-art"
          viewBox="0 0 120 112"
          aria-hidden="true"
          focusable="false"
          onAnimationEnd={(event) => handlePhaseEnd(event.animationName)}
        >
          <ellipse className="mascot-shadow" cx="60" cy="101" rx="30" ry="5" />
          <g className="mascot-legs">
            <path d="M48 88 L34 97" />
            <path d="M52 89 L40 100" />
            <path d="M56 90 L48 100" />
            <path d="M72 88 L86 97" />
            <path d="M68 89 L80 100" />
            <path d="M64 90 L72 100" />
          </g>
          <g className="mascot-wings">
            <path
              className="mascot-wing mascot-wing--left"
              d="M60 58 C45 41 22 40 14 58 C22 74 45 74 60 58 Z"
            />
            <path
              className="mascot-wing mascot-wing--right"
              d="M60 58 C75 41 98 40 106 58 C98 74 75 74 60 58 Z"
            />
          </g>
          <g className="mascot-shell">
            <g className="mascot-half mascot-half--left">
              <path className="mascot-skin" d="M60 32 A34 30 0 0 0 60 92" />
              <g className="mascot-motif">
                <circle
                  className="mascot-motif-ring"
                  cx="42"
                  cy="60"
                  r="9"
                />
                <line
                  className="mascot-motif-arm"
                  x1="29"
                  y1="60"
                  x2="55"
                  y2="60"
                />
                <line
                  className="mascot-motif-arm"
                  x1="42"
                  y1="47"
                  x2="42"
                  y2="73"
                />
                <circle
                  className="mascot-motif-dot"
                  cx="42"
                  cy="60"
                  r="2.2"
                />
              </g>
              <circle className="mascot-spot" cx="52" cy="44" r="3.4" />
              <circle className="mascot-spot" cx="30" cy="72" r="3.4" />
              <circle className="mascot-spot" cx="50" cy="80" r="3.4" />
            </g>
            <g className="mascot-half mascot-half--right">
              <path className="mascot-skin" d="M60 32 A34 30 0 0 1 60 92" />
              <circle className="mascot-spot" cx="74" cy="48" r="3.4" />
              <circle className="mascot-spot" cx="80" cy="74" r="3.4" />
            </g>
            <line className="mascot-split" x1="60" y1="34" x2="60" y2="90" />
          </g>
          <path
            className="mascot-pronotum"
            d="M42 32 C46 20 76 20 80 38 C76 52 46 52 42 32 Z"
          />
          <circle className="mascot-pronotum-dot" cx="54" cy="29" r="2" />
          <circle className="mascot-pronotum-dot" cx="70" cy="31" r="2" />
          <ellipse className="mascot-head" cx="44" cy="34" rx="20" ry="17" />
          <g className="mascot-eyes">
            <g className="mascot-eye">
              <ellipse className="mascot-sclera" cx="34" cy="32" rx="8" ry="9" />
              <circle className="mascot-iris" cx="35" cy="32" r="3.8" />
              <circle className="mascot-pupil" cx="35" cy="32" r="2" />
              <circle className="mascot-glint" cx="33" cy="29" r="1" />
            </g>
            <g className="mascot-eye">
              <ellipse className="mascot-sclera" cx="54" cy="30" rx="8" ry="9" />
              <circle className="mascot-iris" cx="55" cy="30" r="3.8" />
              <circle className="mascot-pupil" cx="55" cy="30" r="2" />
              <circle className="mascot-glint" cx="53" cy="27" r="1" />
            </g>
          </g>
          <path className="mascot-smile" d="M33 42 Q40 48 47 42" />
          <g className="mascot-antennae">
            <path className="mascot-antenna" d="M38 20 C35 13 30 10 26 6" />
            <path className="mascot-antenna" d="M52 18 C55 12 59 8 62 4" />
            <circle className="mascot-halo" cx="26" cy="6" r="6" />
            <circle className="mascot-tip" cx="26" cy="6" r="3" />
            <circle className="mascot-halo" cx="62" cy="4" r="6" />
            <circle className="mascot-tip" cx="62" cy="4" r="3" />
          </g>
          <g className="mascot-marks">
            <path d="M96 46 L106 44" />
            <path d="M98 58 L110 58" />
            <path d="M96 70 L106 72" />
          </g>
        </svg>
      </button>
    </div>
  )
}
