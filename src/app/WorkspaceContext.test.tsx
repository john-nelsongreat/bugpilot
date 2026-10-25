import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../components/Toast'
import { WorkspaceProvider } from './WorkspaceContext'
import { useWorkspace } from './useWorkspace'

function ToastHarness() {
  const { toast, notify, dismissToast } = useWorkspace()

  return (
    <>
      <button
        type="button"
        onClick={() => notify('Could not save your changes.', { tone: 'error' })}
      >
        Trigger error
      </button>
      {toast ? <Toast toast={toast} onDismiss={dismissToast} /> : null}
    </>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WorkspaceContext toast', () => {
  it('keeps an error toast until the user dismisses it', () => {
    vi.useFakeTimers()
    const view = render(
      <WorkspaceProvider>
        <ToastHarness />
      </WorkspaceProvider>,
    )

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Trigger error' }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not save your changes.',
      )

      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(screen.getByRole('alert')).toBeVisible()

      fireEvent.click(
        screen.getByRole('button', { name: 'Dismiss notification' }),
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })
})
