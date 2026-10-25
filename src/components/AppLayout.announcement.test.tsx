import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { createSampleBugs } from '../features/bugs/samples'
import { saveBugs } from '../features/bugs/storage'

const SAMPLE_NOW = new Date('2026-10-24T12:00:00.000Z')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function ProbeNavigator({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      Change the query string
    </button>
  )
}

function liveRegionText() {
  const region = screen.getByRole('status', { name: 'Current page' })
  expect(region).toHaveAttribute('aria-live', 'polite')
  return region.textContent ?? ''
}

beforeEach(() => {
  expect(saveBugs(createSampleBugs(SAMPLE_NOW)).ok).toBe(true)
})

describe('route change announcements', () => {
  it('stays silent on the first page load', () => {
    renderAt('/')

    expect(document.title).toBe('Overview · BugPilot')
    expect(liveRegionText()).toBe('')
  })

  it('announces the page entered by clicking a navigation link', async () => {
    const user = userEvent.setup()
    renderAt('/')

    await user.click(screen.getByRole('link', { name: 'Bug log' }))

    await waitFor(() =>
      expect(liveRegionText()).toBe('Bug log · BugPilot'),
    )
    expect(document.title).toBe('Bug log · BugPilot')
  })

  it('announces a bug detail page with that report’s title', async () => {
    const user = userEvent.setup()
    renderAt('/bugs')

    await user.click(
      screen.getByRole('link', {
        name: 'Checkout total shows NaN after a promo code',
      }),
    )

    await waitFor(() =>
      expect(liveRegionText()).toBe(
        'Checkout total shows NaN after a promo code · BugPilot',
      ),
    )
  })

  it('announces the page reached with history back and forward', async () => {
    const router = createMemoryRouter([{ path: '*', element: <App /> }], {
      initialEntries: ['/', '/assistant', '/bugs'],
      initialIndex: 2,
    })
    render(<RouterProvider router={router} />)

    expect(liveRegionText()).toBe('')

    await act(async () => {
      router.navigate(-1)
    })
    expect(liveRegionText()).toBe('Debug assistant · BugPilot')

    await act(async () => {
      router.navigate(1)
    })
    expect(liveRegionText()).toBe('Bug log · BugPilot')
  })

  it('does not announce when only the query string changes', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/bugs']}>
        <App />
        <ProbeNavigator to="/bugs?severity=Critical" />
      </MemoryRouter>,
    )

    expect(liveRegionText()).toBe('')

    await user.click(screen.getByRole('button', { name: 'Change the query string' }))

    expect(liveRegionText()).toBe('')
  })

  it('does not announce a re-render of the same route', async () => {
    const user = userEvent.setup()
    renderAt('/bugs')

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(liveRegionText()).toBe('')

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))

    expect(liveRegionText()).toBe('')
  })

  it('leaves focus on the control that caused the navigation', async () => {
    const user = userEvent.setup()
    renderAt('/')

    const navLink = screen.getByRole('link', { name: 'Bug log' })
    await user.click(navLink)

    await waitFor(() => expect(liveRegionText()).toBe('Bug log · BugPilot'))
    expect(document.activeElement).toBe(navLink)
  })
})
