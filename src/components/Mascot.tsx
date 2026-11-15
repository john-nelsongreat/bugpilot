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
          viewBox="0 0 128 128"
          aria-hidden="true"
          focusable="false"
          onAnimationEnd={(event) => handlePhaseEnd(event.animationName)}
        >
          <ellipse className="mascot-shadow" cx="64" cy="118" rx="24" ry="4" />
          <g className="mascot-legs">
            <path className="mascot-leg" d="M40 78 L31 74" />
            <path className="mascot-leg" d="M38 90 L29 94" />
            <path className="mascot-leg" d="M48 101 L43 110" />
            <path className="mascot-leg" d="M88 78 L97 74" />
            <path className="mascot-leg" d="M90 90 L99 94" />
            <path className="mascot-leg" d="M80 101 L85 110" />
          </g>
          <g className="mascot-body">
            <g className="mascot-hindwings">
              <g className="mascot-hindwing mascot-hindwing--left">
                <path d="M64 60 C44 56 22 66 16 88 C30 102 54 94 64 76 Z" />
                <path className="mascot-vein" d="M62 64 C46 64 30 72 22 84" />
                <path className="mascot-vein" d="M62 72 C50 75 38 82 32 92" />
              </g>
              <g className="mascot-hindwing mascot-hindwing--right">
                <path d="M64 60 C84 56 106 66 112 88 C98 102 74 94 64 76 Z" />
                <path className="mascot-vein" d="M66 64 C82 64 98 72 106 84" />
                <path className="mascot-vein" d="M66 72 C78 75 90 82 96 92" />
              </g>
            </g>
            <g className="mascot-elytra">
              <path
                className="mascot-half mascot-half--left"
                d="M64 48 C49 48 30 57 29.5 74 C29 92 43 110 64 110 Z"
              />
              <path
                className="mascot-half mascot-half--right"
                d="M64 48 C79 48 98 57 98.5 74 C99 92 85 110 64 110 Z"
              />
              <line className="mascot-split" x1="64" y1="49" x2="64" y2="109" />
              <g className="mascot-spots">
                <circle className="mascot-spot" cx="41" cy="70" r="4.8" />
                <circle className="mascot-spot" cx="50" cy="95" r="3.6" />
                <circle className="mascot-spot" cx="87" cy="70" r="4.8" />
                <circle className="mascot-spot" cx="78" cy="95" r="3.6" />
              </g>
            </g>
            <ellipse
              className="mascot-pronotum"
              cx="64"
              cy="47"
              rx="28"
              ry="12.5"
            />
            <g className="mascot-headgroup">
              <g className="mascot-antennae">
                <circle className="mascot-halo" cx="48" cy="16" r="5" />
                <circle className="mascot-halo" cx="80" cy="16" r="5" />
                <path className="mascot-antenna" d="M56 26 C52 22 50 19 48 16" />
                <path className="mascot-antenna" d="M72 26 C76 22 78 19 80 16" />
                <circle className="mascot-tip" cx="48" cy="16" r="3.2" />
                <circle className="mascot-tip" cx="80" cy="16" r="3.2" />
              </g>
              <ellipse className="mascot-head" cx="64" cy="34" rx="13.5" ry="10" />
              <g className="mascot-eye">
                <ellipse
                  className="mascot-sclera"
                  cx="58"
                  cy="34.5"
                  rx="5.4"
                  ry="6.2"
                />
                <circle className="mascot-pupil" cx="59.4" cy="35.6" r="2.9" />
                <circle className="mascot-glint" cx="57.4" cy="33" r="1.1" />
              </g>
              <g className="mascot-eye">
                <ellipse
                  className="mascot-sclera"
                  cx="70"
                  cy="34.5"
                  rx="5.4"
                  ry="6.2"
                />
                <circle className="mascot-pupil" cx="68.6" cy="35.6" r="2.9" />
                <circle className="mascot-glint" cx="66.6" cy="33" r="1.1" />
              </g>
            </g>
          </g>
        </svg>
      </button>
    </div>
  )
}
