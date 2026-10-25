import { useEffect, useRef, useState } from 'react'
import { Save, Stethoscope, X } from 'lucide-react'
import { CONFIDENCE_LABELS, diagnosticCategoryLabel } from '../diagnostics/labels'
import type { DiagnosticResult, PossibleFix } from '../diagnostics/types'
import type { Bug } from '../features/bugs/types'
import { formatDateTime } from '../features/bugs/format'
import {
  composeProposedFix,
  type SaveDiagnosisSelection,
} from '../features/assistant/savePreview'

interface SaveDiagnosisDialogProps {
  bug: Bug
  result: DiagnosticResult
  possibleFix: PossibleFix
  error: string | null
  onCancel: () => void
  onConfirm: (selection: SaveDiagnosisSelection) => void
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SaveDiagnosisDialog({
  bug,
  result,
  possibleFix,
  error,
  onCancel,
  onConfirm,
}: SaveDiagnosisDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [selectedEvidence, setSelectedEvidence] = useState<boolean[]>(() =>
    result.evidence.map(() => true),
  )
  const [replaceFix, setReplaceFix] = useState(false)

  const composition = composeProposedFix(possibleFix)
  const hasExistingFix = bug.proposedFix.trim() !== ''

  let stateNotice: string | null = null
  if (hasExistingFix && bug.fixStatus === null) {
    stateNotice = 'The fix state will be set to Proposed.'
  } else if (hasExistingFix && bug.fixStatus !== 'Proposed') {
    stateNotice = `Fix state stays ${bug.fixStatus}.`
  }

  useEffect(() => {
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
  }, [onCancel])

  function handleConfirm() {
    if (composition.exceedsLimit) return
    onConfirm({
      evidence: result.evidence
        .filter((_, index) => selectedEvidence[index])
        .map((item) => ({ label: item.label, quote: item.quote })),
      replaceFix,
    })
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="dialog dialog--save"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-diagnosis-dialog-title"
        aria-describedby="save-diagnosis-dialog-description"
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

        <span className="dialog-icon dialog-icon--save" aria-hidden="true">
          <Stethoscope size={22} />
        </span>
        <h2 id="save-diagnosis-dialog-title">Save diagnosis to this bug?</h2>
        <p id="save-diagnosis-dialog-description" className="dialog-copy">
          Review exactly what will be stored on <strong>{bug.title}</strong>.
          Saving records an assistant suggestion, not a verified fix.
        </p>

        <dl className="fact-list save-preview-facts">
          <div>
            <dt>Category</dt>
            <dd>{diagnosticCategoryLabel(result.category)}</dd>
          </div>
          <div>
            <dt>Matched signature</dt>
            <dd>
              <code className="assistant-signature">
                {result.matchedSignature ?? 'No specific signature'}
              </code>
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{CONFIDENCE_LABELS[result.confidence.level]} confidence</dd>
          </div>
        </dl>

        <fieldset className="save-evidence-fieldset">
          <legend>Evidence to save</legend>
          {result.evidence.length > 0 ? (
            <ul className="assistant-evidence-list save-evidence-list">
              {result.evidence.map((item, index) => (
                <li
                  key={`${item.source}-${item.lineNumber ?? 'none'}-${index}`}
                  className="assistant-evidence"
                >
                  <label className="save-evidence-option">
                    <input
                      type="checkbox"
                      checked={selectedEvidence[index] ?? false}
                      onChange={() =>
                        setSelectedEvidence((current) =>
                          current.map((checked, itemIndex) =>
                            itemIndex === index ? !checked : checked,
                          ),
                        )
                      }
                    />
                    <span className="save-evidence-text">
                      <span className="assistant-evidence-meta">
                        <span>{item.label}</span>
                        {item.lineNumber ? (
                          <span>Line {item.lineNumber}</span>
                        ) : null}
                        <span className="assistant-source">{item.source}</span>
                      </span>
                      <code className="assistant-quote">{item.quote}</code>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-hint">
              No evidence will be saved with this diagnosis.
            </p>
          )}
        </fieldset>

        <section
          className="save-fix-preview"
          aria-labelledby="save-fix-preview-heading"
        >
          <h3 id="save-fix-preview-heading">Proposed fix</h3>
          <pre className="code-block" tabIndex={0}>
            <code>{composition.text}</code>
          </pre>
          {composition.droppedExampleCode && !composition.exceedsLimit ? (
            <p className="field-hint">
              The example code was left out because the full fix would be
              longer than the 20,000-character limit.
            </p>
          ) : null}
          {composition.exceedsLimit ? (
            <p className="field-error" role="alert">
              The explanation alone is longer than 20,000 characters, so it
              cannot be saved. Shorten the source text and analyze again.
            </p>
          ) : null}
        </section>

        <div className="save-consequences">
          {hasExistingFix ? (
            <p className="dialog-copy">
              This bug already has a proposed fix: it will be KEPT and only the
              diagnosis is saved.
            </p>
          ) : (
            <p className="dialog-copy">
              This bug has no proposed fix yet: saving will store this one and
              set the fix state to Proposed.
            </p>
          )}

          {hasExistingFix ? (
            <label className="save-replace-option">
              <input
                type="checkbox"
                checked={replaceFix}
                onChange={(event) => setReplaceFix(event.target.checked)}
              />
              <span>Replace the existing proposed fix with this one</span>
            </label>
          ) : null}

          {stateNotice ? <p className="dialog-copy">{stateNotice}</p> : null}

          {bug.diagnosis ? (
            <p className="dialog-copy">
              This bug already has a saved diagnosis from{' '}
              {formatDateTime(bug.diagnosis.savedAt)}. Saving will replace it.
            </p>
          ) : null}

          <p className="field-hint">
            Nothing is marked as verified. Saving records an assistant
            suggestion, not a verified fix.
          </p>
        </div>

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
            className="button button--primary"
            onClick={handleConfirm}
            disabled={composition.exceedsLimit}
          >
            <Save size={16} aria-hidden="true" />
            Save diagnosis
          </button>
        </div>
      </div>
    </div>
  )
}
