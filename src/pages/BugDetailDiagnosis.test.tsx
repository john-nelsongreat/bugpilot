import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { formatDateTime } from '../features/bugs/format'
import { loadBugState, saveBugs } from '../features/bugs/storage'
import type { Bug } from '../features/bugs/types'
import { makeBug, makeSavedDiagnosis } from '../test/factories'

function renderDetail(overrides: Partial<Bug> = {}) {
  const bug = makeBug({
    id: 'diagnosis-detail',
    title: 'Checkout total shows NaN after a promo code',
    diagnosis: makeSavedDiagnosis(),
    ...overrides,
  })
  const saved = saveBugs([bug])
  expect(saved.ok).toBe(true)

  const view = render(
    <MemoryRouter initialEntries={[`/bugs/${bug.id}`]}>
      <App />
    </MemoryRouter>,
  )

  return { ...view, bug }
}

async function openRemoveDialog() {
  const user = userEvent.setup()
  const remove = screen.getByRole('button', {
    name: 'Remove saved diagnosis',
  })
  await user.click(remove)
  const dialog = screen.getByRole('dialog', {
    name: 'Remove saved diagnosis?',
  })

  return { user, remove, dialog }
}

describe('Saved diagnosis section', () => {
  it('shows the saved diagnosis with human-readable fields and honest wording', () => {
    renderDetail()

    expect(
      screen.getByRole('heading', { name: 'Saved diagnosis' }),
    ).toBeVisible()
    expect(screen.getByText('Missing module')).toBeVisible()
    expect(
      screen.getByText("ModuleNotFoundError: No module named 'pandas'", {
        selector: 'code.assistant-signature',
      }),
    ).toBeVisible()
    expect(screen.getByText('High confidence')).toBeVisible()
    expect(screen.getByText('Error text')).toBeVisible()
    expect(
      screen.getAllByText("ModuleNotFoundError: No module named 'pandas'"),
    ).toHaveLength(2)
    expect(screen.getByText('Code snippet')).toBeVisible()
    expect(screen.getByText('import pandas as pd')).toBeVisible()

    const savedTime = screen.getByText(
      formatDateTime('2026-10-24T09:30:00.000Z'),
    )
    expect(savedTime).toHaveAttribute(
      'dateTime',
      '2026-10-24T09:30:00.000Z',
    )

    expect(
      screen.getByText(/suggestion from the assistant/i),
    ).toBeVisible()
    expect(screen.getByText(/not a verified fix/i)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Remove saved diagnosis' }),
    ).toBeVisible()
  })

  it('falls back when no specific signature was saved', () => {
    renderDetail({
      diagnosis: makeSavedDiagnosis({ matchedSignature: null }),
    })

    expect(screen.getByText('No specific signature')).toBeVisible()
  })

  it('humanises a future diagnosis category without breaking the page', () => {
    renderDetail({
      diagnosis: makeSavedDiagnosis({
        category: 'dependency-lockfile-drift',
      }),
    })

    expect(screen.getByText('Dependency lockfile drift')).toBeVisible()
  })

  it('shows the readable batch-A category label instead of the raw id', () => {
    renderDetail({
      diagnosis: makeSavedDiagnosis({
        category: 'json-decode-error',
      }),
    })

    expect(screen.getByText('JSON decode error')).toBeVisible()
    expect(screen.queryByText('json-decode-error')).not.toBeInTheDocument()
  })

  it('shows the readable port-in-use label instead of the raw id', () => {
    renderDetail({
      diagnosis: makeSavedDiagnosis({
        category: 'port-in-use',
      }),
    })

    expect(screen.getByText('Port already in use')).toBeVisible()
    expect(screen.queryByText('port-in-use')).not.toBeInTheDocument()
  })

  it('renders evidence as text and never as HTML', () => {
    const quote = '<img src=x onerror="alert(1)">'
    const { container } = renderDetail({
      diagnosis: makeSavedDiagnosis({
        evidence: [{ label: 'Code snippet', quote }],
      }),
    })

    expect(screen.getByText(quote)).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('omits the section entirely when there is no diagnosis', () => {
    renderDetail({ diagnosis: undefined })

    expect(
      screen.queryByRole('heading', { name: 'Saved diagnosis' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove saved diagnosis' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Fix tracking' }),
    ).toBeVisible()
  })
})

describe('Removing a saved diagnosis', () => {
  it('opens an accessible confirmation, cancels with Escape, and returns focus', async () => {
    const { bug } = renderDetail()
    const raw = localStorage.getItem('bugpilot.bugs.v1')
    const { user, remove, dialog } = await openRemoveDialog()
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })

    expect(cancel).toHaveFocus()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent(
      /proposed fix, fix state, status and verification notes are kept/i,
    )

    await user.keyboard('{Escape}')

    expect(
      screen.queryByRole('dialog', { name: 'Remove saved diagnosis?' }),
    ).not.toBeInTheDocument()
    expect(remove).toHaveFocus()
    expect(localStorage.getItem('bugpilot.bugs.v1')).toBe(raw)
    expect(loadBugState(localStorage).bugs[0]?.diagnosis).toEqual(
      bug.diagnosis,
    )
  })

  it('cancels from the cancel button without writing', async () => {
    const { bug } = renderDetail()
    const raw = localStorage.getItem('bugpilot.bugs.v1')
    const { user, dialog } = await openRemoveDialog()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(
      screen.queryByRole('dialog', { name: 'Remove saved diagnosis?' }),
    ).not.toBeInTheDocument()
    expect(localStorage.getItem('bugpilot.bugs.v1')).toBe(raw)
    expect(screen.getByText('Missing module')).toBeVisible()
    expect(loadBugState(localStorage).bugs[0]?.diagnosis).toEqual(
      bug.diagnosis,
    )
  })

  it('traps focus inside the confirmation dialog', async () => {
    renderDetail()
    const { user, dialog } = await openRemoveDialog()
    const close = within(dialog).getByRole('button', { name: 'Close dialog' })
    const remove = within(dialog).getByRole('button', {
      name: 'Remove diagnosis',
    })

    await user.tab({ shift: true })
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(remove).toHaveFocus()

    await user.tab()
    expect(close).toHaveFocus()
  })

  it('removes only the diagnosis and keeps fix, state, notes and status', async () => {
    const { bug } = renderDetail({
      proposedFix: 'Guard the amount before formatting.',
      fixStatus: 'Verified',
      verificationNotes: 'Confirmed on staging after the guard was added.',
      status: 'Resolved',
    })
    const { user, dialog } = await openRemoveDialog()

    await user.click(
      within(dialog).getByRole('button', { name: 'Remove diagnosis' }),
    )

    expect(
      screen.queryByRole('heading', { name: 'Saved diagnosis' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Saved diagnosis removed.')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Fix tracking' }),
    ).toHaveFocus()

    const stored = loadBugState(localStorage).bugs[0]
    expect(stored).not.toHaveProperty('diagnosis')
    expect(stored?.proposedFix).toBe('Guard the amount before formatting.')
    expect(stored?.fixStatus).toBe('Verified')
    expect(stored?.verificationNotes).toBe(
      'Confirmed on staging after the guard was added.',
    )
    expect(stored?.status).toBe('Resolved')
    expect(stored?.title).toBe(bug.title)
    expect(stored?.updatedAt).not.toBe(bug.updatedAt)
  })

  it('shows a persistent error and writes nothing when storage fails', async () => {
    const { bug } = renderDetail()
    const raw = localStorage.getItem('bugpilot.bugs.v1')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    const { user, dialog } = await openRemoveDialog()

    await user.click(
      within(dialog).getByRole('button', { name: 'Remove diagnosis' }),
    )

    expect(
      screen.getByRole('dialog', { name: 'Remove saved diagnosis?' }),
    ).toBeVisible()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      /could not be saved|storage|quota/i,
    )
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(screen.getByText('Missing module')).toBeVisible()
    expect(localStorage.getItem('bugpilot.bugs.v1')).toBe(raw)
    expect(loadBugState(localStorage).bugs[0]?.diagnosis).toEqual(
      bug.diagnosis,
    )
  })
})
