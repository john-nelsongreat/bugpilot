import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ArchiveEntry } from '../archive/guard'
import type { AnalyzerFinding, AnalyzerReport } from '../types'
import { applyEdits } from '../fixes/text'
import type { FixCandidate } from '../fixes/types'
import type { DiffRow, FileDiff } from '../review/diffModel'
import type { ReviewDiffBuilder, ReviewDiffInput, ReviewDiffResult } from '../review/reviewDiff'
import { createDefaultReviewDiffBuilder } from '../review/reviewDiffClient'

export const REVIEW_PAGE_SIZE = 250

const defaultBuildDiffs = createDefaultReviewDiffBuilder()
const EMPTY_RESULTS: ReadonlyMap<string, ReviewDiffResult> = new Map()

export interface FixReviewProps {
  report: AnalyzerReport
  sources: readonly ArchiveEntry[]
  candidates: readonly FixCandidate[]
  onClose: () => void
  pageSize?: number
  buildDiffs?: ReviewDiffBuilder
}

interface FileView {
  file: string
  causes: AnalyzerFinding[]
  unified: FileDiff | null
  split: FileDiff | null
  error: string | null
  masked: boolean
  loading: boolean
}

interface FileInput {
  file: string
  causes: AnalyzerFinding[]
  masked: boolean
  input: ReviewDiffInput | null
  error: string | null
}

interface BuiltDiffs {
  inputs: readonly ReviewDiffInput[]
  results: ReadonlyMap<string, ReviewDiffResult>
  error: string | null
}

type ViewMode = 'unified' | 'split'

function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)')
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return narrow
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`
}

function changeRows(rows: readonly DiffRow[]): DiffRow[] {
  return rows.filter((row) => row.changeIndex !== null)
}

export function FixReview({
  report,
  sources,
  candidates,
  onClose,
  pageSize = REVIEW_PAGE_SIZE,
  buildDiffs = defaultBuildDiffs,
}: FixReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const narrow = useNarrowViewport()
  const [view, setView] = useState<ViewMode>('unified')
  const [openFile, setOpenFile] = useState(0)
  const [pages, setPages] = useState<Record<number, number>>({})
  const [activeChange, setActiveChange] = useState(0)
  const [focusNonce, setFocusNonce] = useState(0)
  const [built, setBuilt] = useState<BuiltDiffs | null>(null)
  const pendingFocus = useRef<string | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const inputs = useMemo<FileInput[]>(() => {
    const byFile = new Map<string, FixCandidate[]>()
    for (const candidate of candidates) {
      const list = byFile.get(candidate.file)
      if (list) list.push(candidate)
      else byFile.set(candidate.file, [candidate])
    }
    const findingById = new Map(report.findings.map((finding) => [finding.id, finding]))
    const sourceByName = new Map(sources.map((source) => [source.name, source]))

    return [...byFile.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, fileCandidates]) => {
        const source = sourceByName.get(file)
        const causes = fileCandidates
          .map((candidate) => findingById.get(candidate.findingId))
          .filter((finding): finding is AnalyzerFinding => Boolean(finding))
        const maskedSpans = fileCandidates.flatMap((candidate) => candidate.maskedSpans)
        const masked = maskedSpans.length > 0
        if (!source) {
          return {
            file,
            causes,
            masked,
            input: null,
            error: 'The analysed text for this file is no longer available.',
          }
        }
        try {
          const after = applyEdits(source.text, fileCandidates.flatMap((candidate) => candidate.edits))
          return {
            file,
            causes,
            masked,
            input: { file, before: source.text, after, maskedSpans },
            error: null,
          }
        } catch (error) {
          return {
            file,
            causes,
            masked,
            input: null,
            error: error instanceof Error ? error.message : 'The diff could not be built.',
          }
        }
      })
  }, [candidates, report.findings, sources])

  const diffInputs = useMemo(
    () => inputs.flatMap((entry) => (entry.input ? [entry.input] : [])),
    [inputs],
  )

  const builtMatches = built !== null && built.inputs === diffInputs
  const results = builtMatches ? built.results : EMPTY_RESULTS
  const buildError = builtMatches ? built.error : null
  const loading = diffInputs.length > 0 && !builtMatches

  useEffect(() => {
    if (diffInputs.length === 0) return
    const controller = new AbortController()
    buildDiffs(diffInputs, controller.signal).then(
      (list) => {
        if (controller.signal.aborted) return
        setBuilt({
          inputs: diffInputs,
          results: new Map(list.map((result) => [result.file, result])),
          error: null,
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setBuilt({
          inputs: diffInputs,
          results: EMPTY_RESULTS,
          error: error instanceof Error ? error.message : 'The diffs could not be built.',
        })
      },
    )
    return () => controller.abort()
  }, [buildDiffs, diffInputs])

  const files = useMemo<FileView[]>(
    () =>
      inputs.map((entry) => {
        const base = { file: entry.file, causes: entry.causes, masked: entry.masked }
        if (!entry.input) {
          return { ...base, unified: null, split: null, error: entry.error, loading: false }
        }
        if (loading) {
          return { ...base, unified: null, split: null, error: null, loading: true }
        }
        const result = results.get(entry.file)
        if (!result) {
          return {
            ...base,
            unified: null,
            split: null,
            error: buildError ?? 'The diff could not be built.',
            loading: false,
          }
        }
        return {
          ...base,
          unified: result.unified,
          split: result.split,
          error: result.error,
          loading: false,
        }
      }),
    [inputs, results, buildError, loading],
  )

  const useSplit = view === 'split' && !narrow
  const rowsFor = (file: FileView): DiffRow[] => {
    if (!file.unified || !file.split) return []
    return useSplit ? file.split.rows : file.unified.rows
  }

  const changes = useMemo(() => {
    const list: { fileIndex: number; rowIndex: number; row: DiffRow }[] = []
    files.forEach((file, fileIndex) => {
      const diff = useSplit ? file.split : file.unified
      if (!diff) return
      diff.rows.forEach((row, rowIndex) => {
        if (row.changeIndex !== null) list.push({ fileIndex, rowIndex, row })
      })
    })
    return list
  }, [files, useSplit])

  useEffect(() => {
    if (focusNonce === 0) return
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    const timer = setTimeout(() => {
      document.getElementById(id)?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [focusNonce, openFile, pages, view])

  function jumpTo(index: number): void {
    if (changes.length === 0) return
    const next = Math.max(0, Math.min(index, changes.length - 1))
    const target = changes[next]
    setActiveChange(next)
    setOpenFile(target.fileIndex)
    setPages((current) => ({
      ...current,
      [target.fileIndex]: Math.floor(target.rowIndex / pageSize),
    }))
    pendingFocus.current = `fix-diff-${target.fileIndex}-${target.rowIndex}`
    setFocusNonce((value) => value + 1)
  }

  const currentFile = files[openFile] ?? null
  const currentRows = currentFile ? rowsFor(currentFile) : []
  const pageCount = Math.max(1, Math.ceil(currentRows.length / pageSize))
  const page = Math.min(pages[openFile] ?? 0, pageCount - 1)
  const pageStart = page * pageSize
  const visibleRows = currentRows.slice(pageStart, pageStart + pageSize)
  const shownChanges = changeRows(visibleRows).length
  const titleId = 'fix-review-heading'

  return (
    <section className="fix-review" aria-labelledby={titleId}>
      <header className="fix-review-head">
        <div>
          <p className="eyebrow">Review changes</p>
          <h3 id={titleId} ref={headingRef} tabIndex={-1}>
            Diff of {plural(candidates.length, 'proposed change')} in {plural(files.length, 'file')}
          </h3>
          <p className="field-hint">
            Built in this tab from your in-memory source. Nothing is saved and nothing is sent anywhere.
          </p>
        </div>
        <button type="button" className="button button--secondary" onClick={onClose}>
          <X size={16} aria-hidden="true" />
          Close review
        </button>
      </header>

      {files.length === 0 ? (
        <div className="fix-review-empty">
          <p className="prose">No changes are selected, so there is nothing to review.</p>
          <button type="button" className="button button--secondary" onClick={onClose}>
            Back to findings
          </button>
        </div>
      ) : (
        <>
          <div className="fix-review-toolbar">
            <div className="fix-view-toggle" role="group" aria-label="Diff view">
              <button
                type="button"
                className="button button--quiet"
                aria-pressed={!useSplit}
                onClick={() => setView('unified')}
              >
                Unified
              </button>
              <button
                type="button"
                className="button button--quiet"
                aria-pressed={useSplit}
                disabled={narrow}
                onClick={() => setView('split')}
                aria-describedby={narrow ? 'fix-split-note' : undefined}
              >
                Side by side
              </button>
            </div>
            {narrow ? (
              <p className="field-hint" id="fix-split-note">
                Side-by-side is unavailable at this width; the unified diff is shown.
              </p>
            ) : null}
            <div className="fix-jump" role="group" aria-label="Jump between changes">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => jumpTo(activeChange - 1)}
                disabled={activeChange <= 0}
              >
                Previous change
              </button>
              <span className="field-hint">
                Change {changes.length === 0 ? 0 : activeChange + 1} of {changes.length}
              </span>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => jumpTo(activeChange + 1)}
                disabled={activeChange >= changes.length - 1}
              >
                Next change
              </button>
            </div>
          </div>

          <p className="sr-only" role="status" aria-label="Changes shown">
            {shownChanges} changed row{shownChanges === 1 ? '' : 's'} shown
            {currentFile ? ` in ${currentFile.file}` : ''}.
          </p>

          <div className="fix-review-files">
            {files.map((file, fileIndex) => {
              const rows = rowsFor(file)
              const isOpen = openFile === fileIndex
              const filePageCount = Math.max(1, Math.ceil(rows.length / pageSize))
              const filePage = Math.min(pages[fileIndex] ?? 0, filePageCount - 1)
              const start = filePage * pageSize
              const slice = rows.slice(start, start + pageSize)
              const fileChanges = changeRows(rows).length
              const panelId = `fix-file-panel-${fileIndex}`

              return (
                <section className="fix-file" key={file.file} aria-labelledby={`fix-file-heading-${fileIndex}`}>
                  <h4 id={`fix-file-heading-${fileIndex}`}>
                    <button
                      type="button"
                      className="fix-file-toggle"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenFile(isOpen ? -1 : fileIndex)}
                    >
                      <code>{file.file}</code>
                      <span className="field-hint">
                        {file.loading
                          ? 'Building diff…'
                          : `${plural(fileChanges, 'changed row')} · ${plural(file.causes.length, 'causing finding')}`}
                      </span>
                    </button>
                  </h4>

                  {isOpen ? (
                    <div id={panelId} className="fix-file-panel">
                      {file.error ? (
                        <p className="notice notice--alert">{file.error}</p>
                      ) : file.loading ? (
                        <p className="field-hint">Building the diff…</p>
                      ) : (
                        <>
                          <ul className="fix-review-causes">
                            {file.causes.map((finding) => (
                              <li key={finding.id}>
                                <code>{finding.ruleId}</code>
                                <span>Line {finding.range.startLine}</span>
                                <span>{finding.message}</span>
                              </li>
                            ))}
                          </ul>

                          {file.masked ? (
                            <p className="notice notice--alert">
                              Lines that held a suspected secret are masked here. The full value is not shown anywhere
                              in this review.
                            </p>
                          ) : null}

                          {filePageCount > 1 ? (
                            <div className="fix-page-controls">
                              <button
                                type="button"
                                className="button button--quiet"
                                onClick={() => setPages((current) => ({ ...current, [fileIndex]: filePage - 1 }))}
                                disabled={filePage === 0}
                              >
                                Previous rows
                              </button>
                              <span className="field-hint">
                                Rows {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
                              </span>
                              <button
                                type="button"
                                className="button button--quiet"
                                onClick={() => setPages((current) => ({ ...current, [fileIndex]: filePage + 1 }))}
                                disabled={filePage >= filePageCount - 1}
                              >
                                Next rows
                              </button>
                            </div>
                          ) : null}

                          <div className="fix-diff-scroll">
                            {useSplit ? (
                              <table className="fix-diff-table fix-diff-table--split">
                                <caption className="sr-only">Side-by-side diff for {file.file}</caption>
                                <thead>
                                  <tr>
                                    <th scope="col">Old line</th>
                                    <th scope="col">Old code</th>
                                    <th scope="col">New line</th>
                                    <th scope="col">New code</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {slice.map((row, offset) => {
                                    const rowIndex = start + offset
                                    if (row.kind === 'hunk') {
                                      return (
                                        <tr key={`${file.file}-${rowIndex}`} className="fix-diff-row fix-diff-row--hunk">
                                          <td colSpan={4}>
                                            <code>{row.text}</code>
                                          </td>
                                        </tr>
                                      )
                                    }
                                    const removed = row.kind === 'remove' || row.kind === 'pair'
                                    const added = row.kind === 'add' || row.kind === 'pair'
                                    return (
                                      <tr
                                        key={`${file.file}-${rowIndex}`}
                                        id={`fix-diff-${fileIndex}-${rowIndex}`}
                                        tabIndex={-1}
                                        className={`fix-diff-row fix-diff-row--${row.kind}`}
                                      >
                                        <td className="fix-diff-num">{row.oldLine ?? ''}</td>
                                        <td className={removed ? 'fix-diff-code fix-diff-code--removed' : 'fix-diff-code'}>
                                          <span className="fix-diff-mark" aria-hidden="true">
                                            {removed ? '−' : ' '}
                                          </span>
                                          {removed ? <span className="sr-only">removed </span> : null}
                                          <code>{row.oldText ?? ''}</code>
                                        </td>
                                        <td className="fix-diff-num">{row.newLine ?? ''}</td>
                                        <td className={added ? 'fix-diff-code fix-diff-code--added' : 'fix-diff-code'}>
                                          <span className="fix-diff-mark" aria-hidden="true">
                                            {added ? '+' : ' '}
                                          </span>
                                          {added ? <span className="sr-only">added </span> : null}
                                          <code>{row.newText ?? ''}</code>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            ) : (
                              <table className="fix-diff-table fix-diff-table--unified">
                                <caption className="sr-only">Unified diff for {file.file}</caption>
                                <thead>
                                  <tr>
                                    <th scope="col">Old line</th>
                                    <th scope="col">New line</th>
                                    <th scope="col">Change</th>
                                    <th scope="col">Code</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {slice.map((row, offset) => {
                                    const rowIndex = start + offset
                                    if (row.kind === 'hunk') {
                                      return (
                                        <tr key={`${file.file}-${rowIndex}`} className="fix-diff-row fix-diff-row--hunk">
                                          <td colSpan={4}>
                                            <code>{row.text}</code>
                                          </td>
                                        </tr>
                                      )
                                    }
                                    return (
                                      <tr
                                        key={`${file.file}-${rowIndex}`}
                                        id={`fix-diff-${fileIndex}-${rowIndex}`}
                                        tabIndex={-1}
                                        className={`fix-diff-row fix-diff-row--${row.kind}`}
                                      >
                                        <td className="fix-diff-num">{row.oldLine ?? ''}</td>
                                        <td className="fix-diff-num">{row.newLine ?? ''}</td>
                                        <td className="fix-diff-mark">
                                          <span aria-hidden="true">
                                            {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}
                                          </span>
                                          {row.kind === 'add' ? <span className="sr-only">added</span> : null}
                                          {row.kind === 'remove' ? <span className="sr-only">removed</span> : null}
                                        </td>
                                        <td
                                          className={
                                            row.kind === 'add'
                                              ? 'fix-diff-code fix-diff-code--added'
                                              : row.kind === 'remove'
                                                ? 'fix-diff-code fix-diff-code--removed'
                                                : 'fix-diff-code'
                                          }
                                        >
                                          <code>{row.text}</code>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

export default FixReview
