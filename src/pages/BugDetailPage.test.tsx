import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { saveBugs } from '../features/bugs/storage'
import type { Bug } from '../features/bugs/types'
import { makeBug } from '../test/factories'

const ERROR_MESSAGE = [
  "TypeError: Cannot read properties of undefined (reading 'amount')",
  '    at applyDiscount (src/pricing/discounts.ts:42:18)',
  '    at CartSummary (src/cart/CartSummary.tsx:88:7)',
].join('\n')

const PROPOSED_FIX = [
  'Guard the discount amount before formatting:',
  '',
  'const amount = discount?.amount ?? 0',
  'return formatCurrency(amount)',
].join('\n')

const COPY_FAILURE =
  'Could not copy automatically. Select the text and copy it manually.'

function renderDetail(overrides: Partial<Bug> = {}) {
  const bug = makeBug({
    id: 'detail-copy-bug',
    errorMessage: ERROR_MESSAGE,
    proposedFix: PROPOSED_FIX,
    ...overrides,
  })
  const saved = saveBugs([bug])
  expect(saved.ok).toBe(true)

  return render(
    <MemoryRouter initialEntries={[`/bugs/${bug.id}`]}>
      <App />
    </MemoryRouter>,
  )
}

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

function snapshotStorage() {
  return Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index)
    return [key, key ? localStorage.getItem(key) : null] as const
  }).sort(([left], [right]) => String(left).localeCompare(String(right)))
}

describe('Bug detail copy controls', () => {
  it('copies the exact multi-line error message and confirms success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    mockClipboard(writeText)
    renderDetail()

    const button = screen.getByRole('button', { name: 'Copy error message' })
    button.focus()
    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(ERROR_MESSAGE)
    const status = await screen.findByText(
      'Error message copied to the clipboard.',
    )
    expect(status.closest('[role="status"]')).not.toBeNull()
    expect(button).toHaveFocus()
  })

  it('copies the exact proposed fix and confirms success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    mockClipboard(writeText)
    renderDetail()

    const button = screen.getByRole('button', { name: 'Copy proposed fix' })
    button.focus()
    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledWith(PROPOSED_FIX)
    const status = await screen.findByText(
      'Proposed fix copied to the clipboard.',
    )
    expect(status.closest('[role="status"]')).not.toBeNull()
    expect(button).toHaveFocus()
  })

  it('supports keyboard activation without moving focus', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    mockClipboard(writeText)
    renderDetail()

    const button = screen.getByRole('button', { name: 'Copy error message' })
    button.focus()
    expect(button).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(writeText).toHaveBeenCalledWith(ERROR_MESSAGE)
    expect(button).toHaveFocus()
  })

  it('shows an alert fallback when the clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    renderDetail()

    const button = screen.getByRole('button', { name: 'Copy proposed fix' })
    button.focus()
    fireEvent.click(button)

    const message = await screen.findByText(COPY_FAILURE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(button).toHaveFocus()
  })

  it('shows an alert fallback when the clipboard rejects the write', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'))
    mockClipboard(writeText)
    renderDetail()

    const button = screen.getByRole('button', { name: 'Copy error message' })
    button.focus()
    fireEvent.click(button)

    expect(writeText).toHaveBeenCalledWith(ERROR_MESSAGE)
    const message = await screen.findByText(COPY_FAILURE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(button).toHaveFocus()
  })

  it('omits each button when its field is empty', () => {
    renderDetail({ errorMessage: '', proposedFix: '' })

    expect(
      screen.queryByRole('button', { name: 'Copy error message' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Copy proposed fix' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('No error output was recorded.')).toBeVisible()
    expect(screen.getByText('No fix has been proposed yet.')).toBeVisible()
  })

  it('shows only the button whose field has text', () => {
    const { unmount } = renderDetail({
      errorMessage: '',
      proposedFix: PROPOSED_FIX,
    })

    expect(
      screen.queryByRole('button', { name: 'Copy error message' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy proposed fix' }),
    ).toBeVisible()

    unmount()

    renderDetail({
      errorMessage: 'NameError: name x is not defined',
      proposedFix: '',
    })

    expect(
      screen.getByRole('button', { name: 'Copy error message' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Copy proposed fix' }),
    ).not.toBeInTheDocument()
  })

  it('does not write to localStorage when copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    mockClipboard(writeText)
    renderDetail()

    const before = snapshotStorage()

    fireEvent.click(screen.getByRole('button', { name: 'Copy error message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy proposed fix' }))

    expect(snapshotStorage()).toEqual(before)
  })
})
