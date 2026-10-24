import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TOAST_AUTO_DISMISS_MS,
  Toast,
  type ToastMessage,
} from './Toast'

const infoToast: ToastMessage = {
  id: 1,
  message: 'Status changed to Resolved.',
  tone: 'info',
}

function ToastHarness() {
  const [toast, setToast] = useState<ToastMessage | null>(infoToast)

  return toast ? (
    <Toast toast={toast} onDismiss={() => setToast(null)} />
  ) : (
    <p>No notification</p>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('auto-dismisses an informational toast after six seconds', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast toast={infoToast} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS - 1)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('resets the timer when a new message arrives', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const view = render(<Toast toast={infoToast} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    view.rerender(
      <Toast
        toast={{ ...infoToast, id: 2, message: 'Bug deleted.' }}
        onDismiss={onDismiss}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS - 1)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses while hovered and resumes after the pointer leaves', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast toast={infoToast} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    fireEvent.mouseEnter(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS * 2)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.mouseLeave(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('pauses while focus is inside and resumes after focus leaves', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast toast={infoToast} onDismiss={onDismiss} />)
    const dismissButton = screen.getByRole('button', {
      name: 'Dismiss notification',
    })

    act(() => {
      dismissButton.focus()
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS * 2)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      dismissButton.blur()
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('clears the timer when the toast is manually dismissed', () => {
    vi.useFakeTimers()
    render(<ToastHarness />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    )

    expect(screen.getByText('No notification')).toBeVisible()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps an error toast until it is dismissed', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <Toast
        toast={{ id: 3, message: 'Could not save your changes.', tone: 'error' }}
        onDismiss={onDismiss}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save your changes.',
    )
    act(() => {
      vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS * 10)
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
