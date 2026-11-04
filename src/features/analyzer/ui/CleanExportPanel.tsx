import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import type { ArchiveEntry } from '../archive/guard'
import {
  buildCleanExport,
  DEFAULT_CLEAN_EXPORT_SELECTIONS,
  type CleanExportResult,
  type CleanExportSelections,
} from '../cleanExport/build'
import { authorizeCleanExport } from '../cleanExport/gate'
import type { FixCandidate } from '../fixes/types'
import { sanitizeForDisplay } from '../sanitize/display'
import type { AnalyzerReport } from '../types'
import { downloadCleanFile } from './downloadClean'

export interface CleanExportPanelProps {
  report: AnalyzerReport
  sources: readonly ArchiveEntry[]
  candidates: readonly FixCandidate[]
  onReportOnly: () => void
}

const OPTIONS: { key: keyof CleanExportSelections; label: string; hint: string }[] = [
  { key: 'patch', label: 'changes.patch', hint: 'Unified diff with a/ and b/ paths that git apply accepts.' },
  { key: 'zip', label: 'clean.zip', hint: 'Fixed text files at their original paths, plus MANIFEST.md.' },
  { key: 'changelog', label: 'CHANGELOG.md', hint: 'One entry per applied change, with no secret values.' },
  { key: 'report', label: 'report.md and report.json', hint: 'The analysis report plus an included-fixes section.' },
]

export function CleanExportPanel({ report, sources, candidates, onReportOnly }: CleanExportPanelProps) {
  const [selections, setSelections] = useState<CleanExportSelections>(DEFAULT_CLEAN_EXPORT_SELECTIONS)
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState<CleanExportResult | null>(null)
  const [downloaded, setDownloaded] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const nothingSelected = !selections.patch && !selections.zip && !selections.changelog && !selections.report

  function toggle(key: keyof CleanExportSelections, checked: boolean): void {
    setSelections((current) => ({ ...current, [key]: checked }))
    setResult(null)
    setDownloaded(null)
  }

  async function handleBuild(): Promise<void> {
    if (building) return
    const authorization = authorizeCleanExport()
    if (!authorization.allowed) {
      setResult({ status: 'blocked', message: authorization.reason })
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBuilding(true)
    setResult(null)
    setDownloaded(null)
    try {
      const outcome = await buildCleanExport(
        { report, sources, candidates },
        selections,
        {},
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(outcome)
    } catch (error) {
      if (!controller.signal.aborted) {
        setResult({
          status: 'blocked',
          message:
            error instanceof Error
              ? `The clean export failed: ${error.message}. Nothing was kept.`
              : 'The clean export failed. Nothing was kept.',
        })
      }
    } finally {
      if (!controller.signal.aborted) setBuilding(false)
    }
  }

  return (
    <section className="panel clean-export" aria-labelledby="clean-export-heading">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Step 3</p>
          <h2 id="clean-export-heading">Clean export</h2>
          <p className="field-hint">
            Built in this tab from the in-memory upload. Before anything is offered, the selected
            changes are verified again and the patch is applied forwards and backwards in memory.
          </p>
        </div>
      </div>
      <div className="analyze-body">
        <fieldset className="clean-export-options">
          <legend>Files to build</legend>
          {OPTIONS.map((option) => (
            <label key={option.key} className="analyze-check clean-export-option">
              <input
                type="checkbox"
                checked={selections[option.key]}
                onChange={(event) => toggle(option.key, event.target.checked)}
              />
              <span>
                {option.label}
                <span className="field-hint"> {option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="notice notice--alert clean-export-warning">
          <strong>changes.patch contains your original lines.</strong> Git needs them to check the
          change, so if the upload had credentials the patch can contain their original values.
          Do not share or commit changes.patch. The changelog, report and manifest never reproduce
          a secret.
        </p>

        <div className="clean-export-actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void handleBuild()}
            disabled={building || nothingSelected}
          >
            Build clean export
          </button>
          {nothingSelected ? (
            <p className="field-hint">Tick at least one output to build.</p>
          ) : (
            <p className="field-hint">
              Nothing is saved. The outputs exist only until this result is cleared or you leave.
            </p>
          )}
        </div>

        {building ? (
          <p className="field-hint">Verifying the selected changes again and building the files…</p>
        ) : null}

        {result?.status === 'blocked' ? (
          <div className="notice notice--alert clean-export-blocked" role="alert">
            <div>
              <strong>Clean export blocked</strong>
              <p>{sanitizeForDisplay(result.message)}</p>
              <button type="button" className="button button--secondary" onClick={onReportOnly}>
                <Download size={16} aria-hidden="true" />
                Download report only
              </button>
            </div>
          </div>
        ) : null}

        {result?.status === 'ready' ? (
          <div className="clean-export-ready">
            <p className="field-hint">
              Built {result.files.length} file{result.files.length === 1 ? '' : 's'} from{' '}
              {result.cleanFiles.length} fixed file{result.cleanFiles.length === 1 ? '' : 's'}.
              Each button downloads one file.
            </p>
            <ul className="clean-export-downloads">
              {result.files.map((file) => (
                <li key={file.name}>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => {
                      downloadCleanFile(file)
                      setDownloaded(file.name)
                    }}
                  >
                    <Download size={16} aria-hidden="true" />
                    Download {file.name}
                  </button>
                </li>
              ))}
            </ul>
            <p className="field-hint" aria-live="polite">
              {downloaded ? `${downloaded} download started.` : ''}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default CleanExportPanel
