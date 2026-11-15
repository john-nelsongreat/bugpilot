import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GLANCE_MS } from '../features/mascot/flight'
import { Mascot } from './Mascot'

const ACCESSIBLE_NAME = 'Send the BugPilot ladybug on a flight'

function button(view: ReturnType<typeof render>) {
  return view.container.querySelector<HTMLButtonElement>('.mascot')!
}

function art(view: ReturnType<typeof render>) {
  return view.container.querySelector('.mascot-art')!
}

function stateOf(view: ReturnType<typeof render>) {
  return button(view).dataset.mascotState
}

// React resolves onAnimationEnd's native type through a vendor-prefix table. jsdom has no
// AnimationEvent, so the table yields "webkitAnimationEnd"; a real browser yields
// "animationend". A synthetic event must use the resolved type to reach the handler here.
const ANIMATION_END_TYPE = 'webkitAnimationEnd'

function endAnimation(
  target: Element,
  animation: string,
  type: string = ANIMATION_END_TYPE,
) {
  // jsdom implements no AnimationEvent constructor, so the name is attached by hand.
  const event = new window.Event(type, { bubbles: true, cancelable: false })
  Object.assign(event, { animationName: animation })
  act(() => {
    target.dispatchEvent(event)
  })
}

function endPhase(view: ReturnType<typeof render>, animation: string) {
  endAnimation(art(view), animation)
}

function reducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Mascot', () => {
  it('renders exactly one button named by the action it performs', () => {
    const view = render(<Mascot />)

    expect(screen.getByRole('button', { name: ACCESSIBLE_NAME })).toBe(
      button(view),
    )
    expect(view.container.querySelectorAll('button')).toHaveLength(1)
    expect(button(view)).toHaveAttribute('type', 'button')
    expect(button(view)).toHaveAttribute('data-mascot-state', 'idle')
  })

  it('hides the artwork from assistive technology', () => {
    const view = render(<Mascot />)

    expect(art(view)).toHaveAttribute('aria-hidden', 'true')
    expect(art(view)).toHaveAttribute('focusable', 'false')
    expect(view.container.querySelector('[aria-live], [role="status"]')).toBeNull()
  })

  it('marks the first tap as tapped', () => {
    const view = render(<Mascot />)
    fireEvent.click(button(view))

    expect(stateOf(view)).toBe('tapped')
  })

  it('advances exactly one phase per matching animationend', () => {
    const view = render(<Mascot />)
    fireEvent.click(button(view))

    endPhase(view, 'mascot-tapped')
    expect(stateOf(view)).toBe('takeoff')

    endPhase(view, 'mascot-tapped')
    expect(stateOf(view)).toBe('takeoff')

    endPhase(view, 'mascot-takeoff')
    expect(stateOf(view)).toBe('flying')
  })

  it('a plain animationend leaves the state at tapped but webkitAnimationEnd advances it to takeoff', () => {
    const view = render(<Mascot />)
    fireEvent.click(button(view))

    endAnimation(art(view), 'mascot-tapped', 'animationend')
    expect(stateOf(view)).toBe('tapped')

    endPhase(view, 'mascot-tapped')
    expect(stateOf(view)).toBe('takeoff')
  })

  it('drops an animationend that names another phase', () => {
    const view = render(<Mascot />)
    fireEvent.click(button(view))

    endPhase(view, 'mascot-flight')
    expect(stateOf(view)).toBe('tapped')

    const eye = view.container.querySelector('.mascot-eye')!
    endAnimation(eye, 'mascot-blink')
    expect(stateOf(view)).toBe('tapped')

    // Positive control, last so the test reads "wrong phase dropped, unknown name dropped, and the
    // listener is live": without it both drops also pass on a component that never installed the handler.
    endPhase(view, 'mascot-tapped')
    expect(stateOf(view)).toBe('takeoff')
  })

  it('completes the loop back to idle', () => {
    const view = render(<Mascot />)
    fireEvent.click(button(view))

    endPhase(view, 'mascot-tapped')
    endPhase(view, 'mascot-takeoff')
    endPhase(view, 'mascot-flight')
    expect(stateOf(view)).toBe('landing')

    endPhase(view, 'mascot-landing')
    expect(stateOf(view)).toBe('idle')
  })

  it('leaves the phase the first of five rapid clicks started', () => {
    const view = render(<Mascot />)

    fireEvent.click(button(view))
    fireEvent.click(button(view))
    fireEvent.click(button(view))
    fireEvent.click(button(view))
    fireEvent.click(button(view))

    expect(stateOf(view)).toBe('tapped')

    endPhase(view, 'mascot-tapped')
    fireEvent.click(button(view))
    expect(stateOf(view)).toBe('takeoff')
  })

  it('glances instead of flying when motion is reduced', () => {
    vi.useFakeTimers()
    reducedMotion(true)
    const view = render(<Mascot />)

    fireEvent.click(button(view))
    expect(stateOf(view)).toBe('glance')

    act(() => {
      vi.advanceTimersByTime(GLANCE_MS - 1)
    })
    expect(stateOf(view)).toBe('glance')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(stateOf(view)).toBe('idle')
  })

  it('holds one glance timer and clears it on unmount', () => {
    vi.useFakeTimers()
    reducedMotion(true)
    const view = render(<Mascot />)

    fireEvent.click(button(view))
    expect(stateOf(view)).toBe('glance')
    expect(vi.getTimerCount()).toBe(1)

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('writes nothing to either storage API', () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

    const view = render(<Mascot />)
    fireEvent.click(button(view))
    endPhase(view, 'mascot-tapped')
    endPhase(view, 'mascot-takeoff')
    endPhase(view, 'mascot-flight')
    endPhase(view, 'mascot-landing')

    reducedMotion(true)
    fireEvent.click(button(view))
    act(() => {
      vi.advanceTimersByTime(GLANCE_MS)
    })

    view.unmount()

    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('sizes the collar against the head so the mark reads as a beetle, not a stack of balls', () => {
    const view = render(<Mascot />)
    const head = view.container.querySelector('.mascot-head')!
    const pronotum = view.container.querySelector('.mascot-pronotum')!

    const headRx = Number(head.getAttribute('rx'))
    const pronotumRx = Number(pronotum.getAttribute('rx'))
    expect(pronotumRx, 'collar half-width must be at least 2x the head').toBeGreaterThanOrEqual(
      headRx * 2,
    )

    const headTop = Number(head.getAttribute('cy')) - Number(head.getAttribute('ry'))
    const collarTop =
      Number(pronotum.getAttribute('cy')) - Number(pronotum.getAttribute('ry'))
    expect(collarTop - headTop, 'head must not rise more than 14px above the collar').toBeLessThanOrEqual(
      14,
    )
  })
})
