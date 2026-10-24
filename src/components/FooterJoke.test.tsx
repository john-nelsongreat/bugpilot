import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOOTER_JOKES } from '../content/footerJokes'
import { FooterJoke } from './FooterJoke'

function jokeText(container: HTMLElement) {
  return container.querySelector('.footer-joke')?.textContent ?? ''
}

afterEach(() => {
  vi.useRealTimers()
})

describe('FooterJoke', () => {
  it('shows one joke from the active page and no live region', () => {
    const view = render(<FooterJoke pageKey="bug-detail" random={() => 0} />)
    const element = screen.getByText(FOOTER_JOKES['bug-detail'][0], {
      exact: false,
    })

    expect(element).toHaveClass('footer-joke')
    expect(element.closest('[aria-live]')).toBeNull()
    expect(view.container.querySelectorAll('.footer-joke')).toHaveLength(1)
  })

  it('picks a different joke after the page is revisited', () => {
    const random = vi.fn(() => 0)
    const first = render(<FooterJoke pageKey="overview" random={random} />)
    const firstJoke = jokeText(first.container)
    first.unmount()

    const second = render(<FooterJoke pageKey="overview" random={random} />)
    expect(jokeText(second.container)).not.toBe(firstJoke)
  })

  it('advances to a different joke after sixty seconds', () => {
    vi.useFakeTimers()
    const random = vi.fn(() => 0)
    const view = render(<FooterJoke pageKey="assistant" random={random} />)
    const firstJoke = jokeText(view.container)

    act(() => {
      vi.advanceTimersByTime(59_999)
    })
    expect(jokeText(view.container)).toBe(firstJoke)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(jokeText(view.container)).not.toBe(firstJoke)
  })

  it('accepts an injected interval', () => {
    vi.useFakeTimers()
    const view = render(
      <FooterJoke
        pageKey="bug-form"
        intervalMs={1000}
        random={() => 0}
      />,
    )
    const firstJoke = jokeText(view.container)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(jokeText(view.container)).not.toBe(firstJoke)
  })

  it('cleans up its rotation timer on unmount', () => {
    vi.useFakeTimers()
    const view = render(<FooterJoke pageKey="not-found" random={() => 0} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still shows and rotates jokes when sessionStorage fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.useFakeTimers()

    const random = vi.fn(() => 0)
    const first = render(<FooterJoke pageKey="bug-log" random={random} />)
    const firstJoke = jokeText(first.container)
    expect(FOOTER_JOKES['bug-log']).toContain(firstJoke)

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(jokeText(first.container)).not.toBe(firstJoke)

    first.unmount()
    const second = render(<FooterJoke pageKey="bug-log" random={random} />)
    expect(FOOTER_JOKES['bug-log']).toContain(jokeText(second.container))
  })
})
