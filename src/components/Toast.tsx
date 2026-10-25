import { useEffect, useRef, useState, type FocusEvent } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'

export type ToastTone = 'info' | 'error'

export type ToastMessage = {
  id: number
  message: string
  tone: ToastTone
  link?: { to: string; label: string }
}

export const TOAST_AUTO_DISMISS_MS = 6000

type ToastProps = {
  toast: ToastMessage
  onDismiss: () => void
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const [paused, setPaused] = useState(false)
  const hovered = useRef(false)
  const focused = useRef(false)

  useEffect(() => {
    if (toast.tone === 'error' || paused) return

    const timer = window.setTimeout(onDismiss, TOAST_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [onDismiss, paused, toast.id, toast.tone])

  function updatePaused() {
    setPaused(hovered.current || focused.current)
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }
    focused.current = false
    updatePaused()
  }

  return (
    <div
      className="toast"
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => {
        hovered.current = true
        updatePaused()
      }}
      onMouseLeave={() => {
        hovered.current = false
        updatePaused()
      }}
      onFocus={() => {
        focused.current = true
        updatePaused()
      }}
      onBlur={handleBlur}
    >
      <span className="toast-mark" aria-hidden="true" />
      <div className="toast-body">
        <p>{toast.message}</p>
        {toast.link ? (
          <Link className="toast-link" to={toast.link.to}>
            {toast.link.label}
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        className="icon-button toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
