import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { AlertTriangle, Download, Upload, X } from 'lucide-react'
import {
  MAX_IMPORT_FILE_BYTES,
  countExistingBugIds,
  parseBugImport,
  type ApplyBugImportResult,
  type ApplyBugImportSuccess,
  type ImportMode,
  type ImportParseSuccess,
} from '../features/bugs/exportImport'
import type { Bug } from '../features/bugs/types'

interface ImportBugDialogProps {
  open: boolean
  currentBugs: Bug[]
  onClose: () => void
  onExport: () => void
  onApply: (
    importedBugs: Bug[],
    invalidCount: number,
    mode: ImportMode,
  ) => ApplyBugImportResult
  onImported: (result: ApplyBugImportSuccess) => void
  onFailed: (message: string) => void
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function reportLabel(count: number): string {
  return count === 1 ? 'report' : 'reports'
}

export function ImportBugDialog(props: ImportBugDialogProps) {
  const { open, ...contentProps } = props
  if (!open) return null
  return <ImportBugDialogContent {...contentProps} />
}

type ImportBugDialogContentProps = Omit<ImportBugDialogProps, 'open'>

function ImportBugDialogContent({
  currentBugs,
  onClose,
  onExport,
  onApply,
  onImported,
  onFailed,
}: ImportBugDialogContentProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const readToken = useRef(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ImportParseSuccess | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [replaceAcknowledged, setReplaceAcknowledged] = useState(false)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    fileInputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
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
  }, [onClose])

  const existingIdCount = parsed
    ? countExistingBugIds(parsed.bugs, currentBugs)
    : 0
  const newCount = parsed ? parsed.bugs.length - existingIdCount : 0
  const validCount = parsed?.bugs.length ?? 0
  const canConfirm =
    parsed !== null &&
    validCount > 0 &&
    (mode === 'merge' || replaceAcknowledged)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    readToken.current += 1
    const token = readToken.current
    setFileName(file?.name ?? null)
    setParsed(null)
    setParseError(null)
    setApplyError(null)
    setMode('merge')
    setReplaceAcknowledged(false)
    setReading(false)

    if (!file) return

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setParseError('This file is larger than 5 MB. Choose a smaller export.')
      return
    }

    setReading(true)
    const reader = new FileReader()
    reader.onload = () => {
      if (readToken.current !== token) return
      setReading(false)
      const text = typeof reader.result === 'string' ? reader.result : ''
      const result = parseBugImport(text)
      if (!result.ok) {
        setParseError(result.message)
        return
      }
      setParsed(result)
    }
    reader.onerror = () => {
      if (readToken.current !== token) return
      setReading(false)
      setParseError('The selected file could not be read.')
    }
    reader.readAsText(file)
  }

  function handleConfirm() {
    if (!parsed || !canConfirm) return
    const result = onApply(parsed.bugs, parsed.invalidCount, mode)
    if (!result.ok) {
      setApplyError(result.message)
      onFailed(result.message)
      return
    }
    setApplyError(null)
    onImported(result)
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="dialog dialog--import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        aria-describedby="import-dialog-description"
        ref={dialogRef}
      >
        <button
          type="button"
          className="icon-button dialog-close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>

        <h2 id="import-dialog-title">Import bug reports</h2>
        <p id="import-dialog-description" className="dialog-copy">
          Choose a BugPilot JSON export. Nothing is saved until you confirm.
        </p>

        <div className="field import-field">
          <label htmlFor="import-file">BugPilot export file</label>
          <input
            id="import-file"
            className="import-file-input"
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            ref={fileInputRef}
          />
          <p className="field-hint">
            JSON files only, up to 5 MB and 5,000 reports.
          </p>
        </div>

        <div className="import-backup-row">
          <button
            type="button"
            className="button button--quiet"
            onClick={onExport}
            disabled={currentBugs.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export current reports first
          </button>
        </div>

        {reading ? (
          <p className="field-hint" role="status">
            Reading file…
          </p>
        ) : null}

        {parseError ? (
          <p className="field-error dialog-error" role="alert">
            {parseError}
          </p>
        ) : null}

        {parsed ? (
          <div className="import-preview">
            <h3>Preview</h3>
            {fileName ? (
              <p className="import-file-name">{fileName}</p>
            ) : null}

            <ul className="import-stats">
              <li>Valid reports: {validCount}</li>
              <li>Invalid reports: {parsed.invalidCount}</li>
              <li>Already in your log: {existingIdCount}</li>
            </ul>

            {parsed.issues.length > 0 ? (
              <>
                <ol className="import-issues" aria-label="Invalid reports">
                  {parsed.issues.slice(0, 10).map((issue) => (
                    <li key={`${issue.position}-${issue.reason}`}>
                      Report {issue.position}: {issue.reason}
                    </li>
                  ))}
                </ol>
                {parsed.issues.length > 10 ? (
                  <p className="field-hint">
                    {parsed.issues.length - 10} more invalid reports are not
                    listed.
                  </p>
                ) : null}
              </>
            ) : null}

            <fieldset className="import-modes">
              <legend>Import mode</legend>
              <label className="radio-option">
                <input
                  type="radio"
                  name="import-mode"
                  value="merge"
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                />
                <span>
                  <strong>Add new reports only</strong>
                  <small>
                    Keep every current report. Imported reports whose ids
                    already exist are skipped.
                  </small>
                </span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="import-mode"
                  value="replace"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                <span>
                  <strong>Replace all reports</strong>
                  <small>
                    Delete every current report and use only this file.
                  </small>
                </span>
              </label>
            </fieldset>

            {mode === 'replace' ? (
              <div className="notice notice--alert import-warning" role="alert">
                <AlertTriangle size={18} aria-hidden="true" />
                <div>
                  <strong>This replaces your entire bug log.</strong>
                  <p>
                    All {currentBugs.length} current{' '}
                    {reportLabel(currentBugs.length)} will be deleted and
                    replaced by {validCount} imported {reportLabel(validCount)}.
                    Export a backup first if you might need them.
                  </p>
                </div>
              </div>
            ) : null}

            {mode === 'merge' ? (
              <p className="import-outcome">
                {newCount} new {reportLabel(newCount)} will be added.{' '}
                {existingIdCount} matching existing{' '}
                {reportLabel(existingIdCount)} and {parsed.invalidCount} invalid{' '}
                {reportLabel(parsed.invalidCount)} will be skipped.
              </p>
            ) : null}

            {mode === 'replace' ? (
              <label className="import-ack">
                <input
                  type="checkbox"
                  checked={replaceAcknowledged}
                  onChange={(event) =>
                    setReplaceAcknowledged(event.target.checked)
                  }
                />
                <span>
                  I understand this replaces all {currentBugs.length} current{' '}
                  {reportLabel(currentBugs.length)}.
                </span>
              </label>
            ) : null}

            {validCount === 0 ? (
              <p className="field-error">
                No valid reports were found in this file. Nothing can be
                imported.
              </p>
            ) : null}
          </div>
        ) : null}

        {applyError ? (
          <p className="field-error dialog-error" role="alert">
            {applyError}
          </p>
        ) : null}

        <div className="dialog-actions import-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            <Upload size={16} aria-hidden="true" />
            {mode === 'merge' ? 'Add reports' : 'Replace all reports'}
          </button>
        </div>
      </div>
    </div>
  )
}
