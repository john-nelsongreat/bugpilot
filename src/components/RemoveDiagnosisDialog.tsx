import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface RemoveDiagnosisDialogProps {
  open: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function RemoveDiagnosisDialog({
  open,
  error,
  onCancel,
  onConfirm,
}: RemoveDiagnosisDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    cancelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-diagnosis-dialog-title"
        aria-describedby="remove-diagnosis-dialog-description"
        ref={dialogRef}
      >
        <button
          type="button"
          className="icon-button dialog-close"
          aria-label="Close dialog"
          onClick={onCancel}
        >
          <X size={18} aria-hidden="true" />
        </button>

        <span className="dialog-icon" aria-hidden="true">
          <AlertTriangle size={22} />
        </span>
        <h2 id="remove-diagnosis-dialog-title">Remove saved diagnosis?</h2>
        <p id="remove-diagnosis-dialog-description" className="dialog-copy">
          This removes the saved diagnosis from this report. The proposed fix,
          fix state, status and verification notes are kept. This cannot be
          undone.
        </p>

        {error ? (
          <p className="field-error dialog-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onCancel}
            ref={cancelRef}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={onConfirm}
          >
            Remove diagnosis
          </button>
        </div>
      </div>
    </div>
  )
}
