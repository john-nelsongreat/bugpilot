import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  BUGS_STORAGE_KEY,
  loadBugState,
  saveBugs,
} from './features/bugs/storage'
import type { Bug } from './features/bugs/types'
import { THEME_STORAGE_KEY } from './features/theme/theme'
import { makeBug } from './test/factories'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function storeBugs(...bugs: Bug[]) {
  const result = saveBugs(bugs)
  expect(result.ok).toBe(true)
}

describe('dashboard', () => {
  it('shows saved counts and recent reports instead of placeholder numbers', () => {
    const critical = makeBug({
      id: 'critical-open',
      title: 'Checkout fails during peak traffic',
      severity: 'Critical',
      status: 'Open',
      createdAt: '2026-10-22T10:00:00.000Z',
    })
    const high = makeBug({
      id: 'high-progress',
      title: 'Exports stall on large tables',
      severity: 'High',
      status: 'In Progress',
      createdAt: '2026-10-21T10:00:00.000Z',
    })
    const resolved = makeBug({
      id: 'medium-resolved',
      title: 'Avatar disappears after refresh',
      severity: 'Medium',
      status: 'Resolved',
      createdAt: '2026-10-20T10:00:00.000Z',
    })
    const closed = makeBug({
      id: 'low-closed',
      title: 'Old footer typo',
      severity: 'Low',
      status: 'Closed',
      createdAt: '2026-10-19T10:00:00.000Z',
    })
    storeBugs(critical, high, resolved, closed)

    renderAt('/')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Total bugs: 4' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Open: 1' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'In progress: 1' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Resolved: 1' })).toBeVisible()
    expect(
      screen.getByRole('group', { name: 'High and critical: 2' }),
    ).toBeVisible()

    const recent = screen.getByRole('region', { name: 'Recent reports' })
    expect(
      within(recent).getByRole('link', { name: critical.title }),
    ).toBeVisible()
    expect(
      within(recent).getByRole('link', { name: high.title }),
    ).toBeVisible()
  })

  it('loads fictional sample data on first run without a saved workspace', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    expect(screen.getByText(/sample workspace loaded/i)).toBeVisible()
    expect(
      screen.getByRole('group', { name: /Total bugs: [1-9]/ }),
    ).toBeVisible()
  })
})

describe('bug workflow', () => {
  it('creates a bug, persists it, and shows it after a fresh render', async () => {
    storeBugs()
    const view = renderAt('/bugs/new')

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Export writes an empty file' },
    })
    fireEvent.change(screen.getByLabelText('Project or application'), {
      target: { value: 'Fieldnote' },
    })
    fireEvent.change(screen.getByLabelText('Programming language'), {
      target: { value: 'TypeScript' },
    })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Downloading a CSV export creates a zero-byte file.' },
    })
    fireEvent.change(screen.getByLabelText('Severity'), {
      target: { value: 'High' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create bug' }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Export writes an empty file',
      }),
    ).toBeVisible()

    const saved = loadBugState(localStorage).bugs
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      title: 'Export writes an empty file',
      projectName: 'Fieldnote',
      language: 'TypeScript',
      severity: 'High',
      status: 'Open',
    })

    view.unmount()
    renderAt('/bugs')

    expect(
      screen.getByRole('link', { name: 'Export writes an empty file' }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Bug log' })).toBeVisible()
  })

  it('blocks an invalid submission and keeps the workspace unchanged', async () => {
    storeBugs()
    renderAt('/bugs/new')

    fireEvent.click(screen.getByRole('button', { name: 'Create bug' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /fix the highlighted fields/i,
    )
    expect(screen.getByText('Enter a title.')).toBeVisible()
    expect(loadBugState(localStorage).bugs).toEqual([])
  })

  it('edits a report and records an accepted fix', async () => {
    const bug = makeBug({
      id: 'editable-bug',
      title: 'Old report title',
      status: 'Open',
    })
    storeBugs(bug)
    renderAt(`/bugs/${bug.id}/edit`)

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Updated report title' },
    })
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'Resolved' },
    })
    fireEvent.change(screen.getByLabelText('Fix status'), {
      target: { value: 'Accepted' },
    })
    fireEvent.change(screen.getByLabelText('Proposed fix'), {
      target: { value: 'Validate the amount before formatting the total.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Updated report title',
      }),
    ).toBeVisible()

    expect(loadBugState(localStorage).bugs[0]).toMatchObject({
      id: 'editable-bug',
      title: 'Updated report title',
      status: 'Resolved',
      fixStatus: 'Accepted',
      proposedFix: 'Validate the amount before formatting the total.',
      createdAt: bug.createdAt,
    })
  })

  it('updates status from the report view', async () => {
    const bug = makeBug({ id: 'status-bug', title: 'Status needs changing' })
    storeBugs(bug)
    renderAt(`/bugs/${bug.id}`)

    fireEvent.change(screen.getByLabelText('Update status'), {
      target: { value: 'Resolved' },
    })

    await waitFor(() => {
      expect(loadBugState(localStorage).bugs[0].status).toBe('Resolved')
    })
    expect(screen.getByText('Status changed to Resolved.')).toBeVisible()
  })

  it('auto-dismisses the status toast after six seconds', () => {
    vi.useFakeTimers()
    const bug = makeBug({ id: 'timed-toast-bug', title: 'Timed toast' })
    storeBugs(bug)
    const view = renderAt(`/bugs/${bug.id}`)

    try {
      fireEvent.change(screen.getByLabelText('Update status'), {
        target: { value: 'Resolved' },
      })
      expect(screen.getByText('Status changed to Resolved.')).toBeVisible()

      act(() => {
        vi.advanceTimersByTime(5999)
      })
      expect(screen.getByText('Status changed to Resolved.')).toBeVisible()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(
        screen.queryByText('Status changed to Resolved.'),
      ).not.toBeInTheDocument()
      expect(loadBugState(localStorage).bugs[0].status).toBe('Resolved')
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('dismisses the status toast manually', () => {
    const bug = makeBug({ id: 'manual-toast-bug', title: 'Manual toast' })
    storeBugs(bug)
    renderAt(`/bugs/${bug.id}`)

    fireEvent.change(screen.getByLabelText('Update status'), {
      target: { value: 'Resolved' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    )

    expect(
      screen.queryByText('Status changed to Resolved.'),
    ).not.toBeInTheDocument()
  })

  it('confirms before deleting and supports cancelling and keyboard dismissal', async () => {
    const user = userEvent.setup()
    const bug = makeBug({ id: 'delete-bug', title: 'Temporary report' })
    storeBugs(bug)
    renderAt(`/bugs/${bug.id}`)

    const deleteTrigger = screen.getByRole('button', { name: 'Delete bug report' })
    await user.click(deleteTrigger)

    const dialog = screen.getByRole('dialog', { name: 'Delete bug report?' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteTrigger).toHaveFocus()
    expect(loadBugState(localStorage).bugs).toHaveLength(1)

    await user.click(deleteTrigger)
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete bug report?' })).getByRole(
        'button',
        { name: 'Delete report' },
      ),
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bug log' }),
    ).toBeVisible()
    expect(loadBugState(localStorage).bugs).toEqual([])
    expect(screen.getByText('Bug deleted.')).toBeVisible()
  })
})

describe('search, filters, and sorting', () => {
  it('filters the saved records and offers a clear recovery from no matches', async () => {
    const critical = makeBug({
      id: 'filter-critical',
      title: 'Cache stampede after deploy',
      projectName: 'Lumen API',
      severity: 'Critical',
      status: 'Open',
    })
    const high = makeBug({
      id: 'filter-high',
      title: 'Export freezes on large result',
      projectName: 'Fieldnote',
      severity: 'High',
      status: 'In Progress',
    })
    const resolved = makeBug({
      id: 'filter-resolved',
      title: 'Invite email is not sent',
      projectName: 'Lumen API',
      severity: 'Medium',
      status: 'Resolved',
    })
    storeBugs(critical, high, resolved)
    renderAt('/bugs')

    expect(screen.getByRole('heading', { level: 1, name: 'Bug log' })).toBeVisible()
    const search = screen.getByLabelText('Search bugs')
    fireEvent.change(search, { target: { value: 'export' } })

    expect(
      screen.getByRole('link', { name: 'Export freezes on large result' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Cache stampede after deploy' }),
    ).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter by severity'), {
      target: { value: 'Critical' },
    })
    expect(
      screen.getByRole('link', { name: 'Cache stampede after deploy' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Invite email is not sent' }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by severity'), {
      target: { value: 'All' },
    })
    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'Resolved' },
    })
    expect(
      screen.getByRole('link', { name: 'Invite email is not sent' }),
    ).toBeVisible()

    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'All' },
    })
    fireEvent.change(screen.getByLabelText('Sort reports'), {
      target: { value: 'title' },
    })
    const table = screen.getByRole('table', { name: 'Saved bug reports' })
    const links = within(table).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Cache stampede after deploy',
      'Export freezes on large result',
      'Invite email is not sent',
    ])

    fireEvent.change(search, { target: { value: 'no report has this phrase' } })
    expect(screen.getByText('No reports match these filters.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(
      screen.getByRole('link', { name: 'Cache stampede after deploy' }),
    ).toBeVisible()
  })
})

describe('theme and empty states', () => {
  it('persists the light/dark preference across renders', async () => {
    const user = userEvent.setup()
    const view = renderAt('/')

    const toDark = screen.getByRole('button', { name: 'Switch to dark theme' })
    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(toDark)

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    ).toBeVisible()

    view.unmount()
    renderAt('/')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' }),
    ).toBeVisible()
  })

  it('shows a useful empty state when there are no saved reports', () => {
    storeBugs()
    renderAt('/bugs')

    expect(screen.getByText('No bugs recorded yet.')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Report your first bug' }),
    ).toBeVisible()
  })

  it('surfaces corrupt stored data without crashing or replacing the raw value', () => {
    const raw = '{broken storage'
    localStorage.setItem(BUGS_STORAGE_KEY, raw)

    renderAt('/')

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /stored bug data could not be read/i,
    )
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
  })

  it('keeps footer joke state in sessionStorage, not localStorage', () => {
    renderAt('/')

    const localKeys = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.key(index),
    ).filter((key): key is string => key !== null)

    for (const key of localKeys) {
      expect([BUGS_STORAGE_KEY, THEME_STORAGE_KEY]).toContain(key)
    }

    const sessionKeys = Array.from(
      { length: sessionStorage.length },
      (_, index) => sessionStorage.key(index),
    ).filter((key): key is string => key !== null)

    expect(
      sessionKeys.some((key) => key.startsWith('bugpilot.footerJoke.')),
    ).toBe(true)
  })
})
