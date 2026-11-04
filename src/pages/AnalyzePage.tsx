import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { AlertTriangle, Clipboard, FileSearch, FolderOpen, Plus, ShieldCheck, Upload, X } from 'lucide-react'
import {
  analyzeUpload,
  isStaleHandleError,
  STALE_HANDLE_MESSAGE,
  type AnalysisSessionResult,
  type AnalyzeUploadOptions,
  type SessionPhase,
  type SessionProgress,
  type UploadInput,
  type UploadPreReadInput,
} from '../features/analyzer/analysis/session'
import type { SourceLanguage } from '../features/analyzer/archive/classify'
import { limitsForDevice, MAX_RETAINED_TEXT_BYTES } from '../features/analyzer/archive/limits'
import { wallClockSeconds } from '../features/analyzer/archive/bounds'
import { isContainerName } from '../features/analyzer/archive/format'
import type { ArchiveReadStats } from '../features/analyzer/archive/guard'
import { ENGINES_UNAVAILABLE_MESSAGE } from '../features/analyzer/engines/featureProbe'
import { hasDeepEngine } from '../features/analyzer/languages'
import type { IntakeSource } from '../features/analyzer/archive/readLooseFiles'
import {
  downloadReportJson,
  downloadReportMarkdown,
  type DownloadReportFile,
} from '../features/analyzer/export/reportFiles'
import { AnalyzeResults, type PrepareFixPlan } from '../features/analyzer/ui/AnalyzeResults'
import { EngineGate } from '../features/analyzer/ui/EngineGate'
import { sourcesFromDrop, sourcesFromFiles } from '../features/analyzer/upload/sources'
import { combineUploads } from '../features/analyzer/upload/multiSource'
import {
  DEFAULT_PASTE_EXTENSION,
  MAX_PASTED_BYTES,
  PASTE_LANGUAGES,
  pastedSource,
} from '../features/analyzer/upload/paste'

const PHASE_LABELS: Record<SessionPhase, string> = {
  reading: 'Reading the upload',
  rules: 'Running BugPilot rules',
  engines: 'Running deep analysis engines',
  typescript: 'Checking TypeScript syntax',
}

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

/** `'basic'` is the slice A behaviour; `'deep'` additionally runs the WebAssembly engines. */
type PassMode = 'basic' | 'deep'

interface PreparedUpload {
  input: UploadInput
  archiveBytes: number
  /** The uploads this pass is built from, in the order the user added them. */
  uploads: readonly (readonly IntakeSource[])[]
  /**
   * The same upload again. A zip's bytes are transferred to the reader worker, so the local
   * copy is detached after the first pass and the file has to be re-read from the picker.
   */
  retry: () => Promise<PreparedUpload>
}

export interface AnalyzePageProps {
  analyze?: AnalyzeFunction
  readFile?: (file: File) => Promise<Uint8Array>
  downloadReportFile?: DownloadReportFile
  prepareFixPlan?: PrepareFixPlan
  now?: () => Date
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

function defaultDownloadReportFile(
  format: 'markdown' | 'json',
  report: Parameters<DownloadReportFile>[1],
  includeSnippets: boolean,
): void {
  if (format === 'markdown') downloadReportMarkdown(report, includeSnippets)
  else downloadReportJson(report, includeSnippets)
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KiB`
  const mebibytes = bytes / 1_048_576
  return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`
}

/** Device Memory is a Chromium-only hint; an absent value means "use the normal ceilings". */
function deviceMemoryGiB(): number | undefined {
  const reported = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return typeof reported === 'number' ? reported : undefined
}

function cancelledResult(stats: ArchiveReadStats | null): AnalysisSessionResult {
  return { status: 'cancelled', message: null, report: null, stats }
}

async function prepareFiles(
  files: readonly File[],
  readFile: (file: File) => Promise<Uint8Array>,
): Promise<PreparedUpload> {
  if (files.length === 0) throw new Error('No files were selected.')
  // `File` objects stay readable, so a second pass re-reads the same selection.
  const retry = () => prepareFiles(files, readFile)
  // The name only decides which pipeline an upload enters; the reader works the format out from
  // the bytes and reports a disagreement as a note.
  if (files.length === 1 && isContainerName(files[0].name)) {
    const bytes = await readFile(files[0])
    return {
      input: { kind: 'archive', bytes, name: files[0].name },
      archiveBytes: bytes.length,
      uploads: [],
      retry,
    }
  }
  return {
    input: { kind: 'files', sources: sourcesFromFiles(files) },
    archiveBytes: files.reduce((total, file) => total + file.size, 0),
    uploads: [sourcesFromFiles(files)],
    retry,
  }
}

function fromSources(sources: readonly IntakeSource[]): () => Promise<PreparedUpload> {
  const prepare = async (): Promise<PreparedUpload> => {
    if (sources.length === 1 && isContainerName(sources[0].path)) {
      const bytes = await sources[0].read()
      return {
        input: { kind: 'archive', bytes, name: sources[0].path },
        archiveBytes: bytes.length,
        uploads: [],
        retry: prepare,
      }
    }
    return {
      input: { kind: 'files', sources },
      archiveBytes: sources.reduce((total, source) => total + source.size, 0),
      uploads: [sources],
      retry: prepare,
    }
  }
  return prepare
}

/**
 * One pass over several uploads. Each upload keeps its own handle list, so a re-run reads the same
 * files again; naming and screening happen every time, which is what makes a repeated pick of the
 * same folder behave the same as the first one.
 */
function prepareUploads(uploads: readonly (readonly IntakeSource[])[]): PreparedUpload {
  const combined = combineUploads(uploads)
  const prepare = async (): Promise<PreparedUpload> => prepared
  const prepared: PreparedUpload = {
    input: { kind: 'files', sources: combined.sources, notes: combined.notes },
    archiveBytes: combined.sources.reduce((total, source) => total + source.size, 0),
    uploads,
    retry: prepare,
  }
  return prepared
}

async function prepareDrop(
  transfer: DataTransfer,
  readFile: (file: File) => Promise<Uint8Array>,
): Promise<PreparedUpload> {
  const files = Array.from(transfer.files)
  const sources = await sourcesFromDrop(transfer)
  if (sources === null) return prepareFiles(files, readFile)
  if (sources.length === 0) throw new Error('No readable files were found in the drop.')
  return fromSources(sources)()
}

export function AnalyzePage({
  analyze = analyzeUpload,
  readFile = readFileBytes,
  downloadReportFile = defaultDownloadReportFile,
  prepareFixPlan,
  now = () => new Date(),
}: AnalyzePageProps = {}) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<SessionProgress | null>(null)
  const [result, setResult] = useState<AnalysisSessionResult | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [deepPass, setDeepPass] = useState(false)
  const [gateDismissed, setGateDismissed] = useState(false)
  /** The uploads the current run is built from, in the order the user added them. */
  const [uploads, setUploads] = useState<readonly (readonly IntakeSource[])[]>([])
  const [intakeMode, setIntakeMode] = useState<'upload' | 'paste'>('upload')
  const [pasteText, setPasteText] = useState('')
  const [pasteExtension, setPasteExtension] = useState(DEFAULT_PASTE_EXTENSION)

  const busyRef = useRef(false)
  const runTokenRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const retryRef = useRef<(() => Promise<PreparedUpload>) | null>(null)
  /** The next picker or drop adds to the run instead of replacing it. */
  const addingRef = useRef(false)
  /**
   * The text the last completed pass kept in memory, ready to be analysed again. A second pass
   * normally re-reads the original handles; this is what it falls back to when the browser reports
   * that the file is gone. It is dropped with the result, so it never outlives Clear.
   */
  const heldReadRef = useRef<{ input: UploadPreReadInput; archiveBytes: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const uploadHeadingRef = useRef<HTMLHeadingElement>(null)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const focusProgressRef = useRef(false)

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
    folderInputRef.current?.setAttribute('directory', '')
  }, [])

  useEffect(() => {
    return () => {
      runTokenRef.current += 1
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (result?.status === 'completed') resultsHeadingRef.current?.focus()
  }, [result])

  useEffect(() => {
    if (running && focusProgressRef.current) {
      focusProgressRef.current = false
      progressRef.current?.focus()
    }
  }, [running])

  const limits = useMemo(() => limitsForDevice(deviceMemoryGiB()), [])

  const analysedLanguages = useMemo(() => {
    const found = new Set<SourceLanguage>()
    for (const entry of result?.report?.coverage ?? []) {
      if (entry.status === 'analysed') found.add(entry.language)
    }
    return [...found].sort((left, right) => left.localeCompare(right))
  }, [result])

  const deepLanguages = useMemo(
    () => analysedLanguages.filter((language) => hasDeepEngine(language)),
    [analysedLanguages],
  )

  const enginesBlocked = result?.report?.limitations.includes(ENGINES_UNAVAILABLE_MESSAGE) ?? false

  /**
   * The pass re-run when a browser handle goes stale. Only a run that kept every file's text can
   * stand in for the upload, so `heldReadRef` is empty whenever the retention rule trimmed it.
   */
  function heldPass(): PreparedUpload | null {
    const held = heldReadRef.current
    if (held === null) return null
    const prepared: PreparedUpload = {
      input: held.input,
      archiveBytes: held.archiveBytes,
      // The upload list is unchanged: this pass replays text already in this tab, so the picker
      // still offers to add to the same run.
      uploads,
      retry: () => Promise.resolve(prepared),
    }
    return prepared
  }

  function staleResult(): AnalysisSessionResult {
    return { status: 'error', message: STALE_HANDLE_MESSAGE, report: null, stats: null, handleStale: true }
  }

  function rememberRead(outcome: AnalysisSessionResult, archiveBytes: number): void {
    if (outcome.retention !== 'all' || outcome.stats === null || !outcome.sources) {
      heldReadRef.current = null
      return
    }
    heldReadRef.current = {
      input: {
        kind: 'pre-read',
        entries: outcome.sources,
        skipped: outcome.skipped ?? [],
        stats: outcome.stats,
      },
      archiveBytes,
    }
  }

  async function runPass(prepare: () => Promise<PreparedUpload>, mode: PassMode): Promise<void> {
    if (busyRef.current) return

    const token = runTokenRef.current + 1
    runTokenRef.current = token
    busyRef.current = true
    const controller = new AbortController()
    abortRef.current = controller

    setRunning(true)
    setProgress(null)
    setResult(null)

    try {
      let prepared: PreparedUpload | null
      try {
        prepared = await prepare()
      } catch (error) {
        prepared = isStaleHandleError(error) ? heldPass() : null
        if (prepared === null) {
          setResult({
            status: 'error',
            message: isStaleHandleError(error)
              ? STALE_HANDLE_MESSAGE
              : error instanceof Error
                ? error.message
                : 'The upload could not be read.',
            report: null,
            stats: null,
          })
          return
        }
      }
      if (runTokenRef.current !== token) return
      if (controller.signal.aborted) {
        setResult(cancelledResult(null))
        return
      }
      retryRef.current = prepared.retry
      setUploads(prepared.uploads)

      const options: AnalyzeUploadOptions = {
        archiveBytes: prepared.archiveBytes,
        signal: controller.signal,
        generatedAt: now(),
        limits,
        onProgress: (next) => {
          if (runTokenRef.current === token) setProgress(next)
        },
      }
      if (mode === 'deep') options.engines = 'approved'

      let outcome = await analyze(prepared.input, options)
      if (outcome.handleStale === true) {
        const held = heldPass()
        if (held === null) outcome = staleResult()
        else outcome = await analyze(held.input, { ...options, archiveBytes: held.archiveBytes })
      }
      if (runTokenRef.current !== token) return
      const final =
        controller.signal.aborted && outcome.status !== 'cancelled'
          ? cancelledResult(outcome.stats)
          : outcome
      setResult(final)
      if (final.status === 'completed') rememberRead(final, prepared.archiveBytes)
      else heldReadRef.current = null
      if (mode === 'deep' && final.status !== 'completed') setDeepPass(false)
    } catch (error) {
      if (runTokenRef.current !== token) return
      setResult({
        status: 'error',
        message: error instanceof Error ? error.message : 'The upload could not be read.',
        report: null,
        stats: null,
      })
    } finally {
      if (runTokenRef.current === token) {
        busyRef.current = false
        abortRef.current = null
        setRunning(false)
        setProgress(null)
      }
    }
  }

  async function startUpload(prepare: () => Promise<PreparedUpload>): Promise<void> {
    setDeepPass(false)
    setGateDismissed(false)
    retryRef.current = null
    heldReadRef.current = null
    await runPass(prepare, 'basic')
  }

  function handleRunDeep(): void {
    const retry = retryRef.current
    if (retry === null || busyRef.current) return
    focusProgressRef.current = true
    setDeepPass(true)
    void runPass(retry, 'deep')
  }

  function handleDismissGate(): void {
    setGateDismissed(true)
    uploadHeadingRef.current?.focus()
  }

  function handleClear(): void {
    runTokenRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    retryRef.current = null
    heldReadRef.current = null
    addingRef.current = false
    busyRef.current = false
    setRunning(false)
    setProgress(null)
    setResult(null)
    setUploads([])
    setPasteText('')
    setDeepPass(false)
    setGateDismissed(false)
    uploadHeadingRef.current?.focus()
  }

  /**
   * A paste is one file the browser never saw. It enters the same reader as a picked file, so it
   * gets the same ceilings, the same coverage table and the same re-read for a deep pass — the only
   * difference is that the bytes come out of this tab's memory instead of a disk handle.
   */
  function handleRunPaste(): void {
    const pasted = pastedSource(pasteText, pasteExtension)
    if (pasted.ok === false) {
      runTokenRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      heldReadRef.current = null
      retryRef.current = null
      setResult({ status: 'refused', message: pasted.refusal, report: null, stats: null })
      uploadHeadingRef.current?.focus()
      return
    }
    const prepared: PreparedUpload = {
      input: { kind: 'files', sources: [pasted.source] },
      archiveBytes: pasted.source.size,
      uploads: [[pasted.source]],
      retry: () => Promise.resolve(prepared),
    }
    void startUpload(async () => prepared)
  }

  /**
   * Adds a further upload and re-runs the whole selection. The uploads already picked stay in the
   * run: naming and screening happen again over the combined list, so the earlier files are read
   * from their own handles in the same order and an upload that cannot be trusted is left out.
   */
  async function addUpload(sources: readonly IntakeSource[]): Promise<void> {
    const next = [...uploads, sources]
    setDeepPass(false)
    setGateDismissed(false)
    heldReadRef.current = null
    await runPass(async () => prepareUploads(next), 'basic')
  }

  function handleCancel(): void {
    abortRef.current?.abort()
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    if (addingRef.current) {
      addingRef.current = false
      void addUpload(sourcesFromFiles(files))
      return
    }
    void startUpload(() => prepareFiles(files, readFile))
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    setDragActive(false)
    if (busyRef.current) return
    const transfer = event.dataTransfer
    if (!addingRef.current) {
      await startUpload(() => prepareDrop(transfer, readFile))
      return
    }
    addingRef.current = false
    const sources =
      (await sourcesFromDrop(transfer)) ?? sourcesFromFiles(Array.from(transfer.files))
    await addUpload(sources)
  }

  const announcement =
    result?.status === 'completed' && result.report
      ? `Analysis complete. ${result.report.summary.findings} finding${
          result.report.summary.findings === 1 ? '' : 's'
        } in ${result.report.session.analysedCount} analysed file${
          result.report.session.analysedCount === 1 ? '' : 's'
        }.`
      : result?.status === 'refused'
        ? `Upload refused. ${result.message ?? ''}`
        : result?.status === 'error'
          ? `Analysis failed. ${result.message ?? ''}`
          : result?.status === 'cancelled'
            ? 'Analysis cancelled. Nothing was kept.'
            : ''

  const refusedOrFailed = result?.status === 'refused' || result?.status === 'error'

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Local static review</p>
          <h1>Analyze code</h1>
          <p className="page-lede">
            Upload a folder, a zip, or a few loose files. BugPilot runs its own rules and a
            syntax-only TypeScript parser in this tab. It never executes your code and never
            uploads it.
          </p>
        </div>
      </header>

      <p className="analyze-privacy">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>Local analysis only.</strong> Files are read in this tab, never uploaded, never
          written to your workspace, and dropped when you clear or leave. No code is executed.
        </span>
      </p>

      <p className="sr-only" role="status" aria-label="Analysis status">
        {announcement}
      </p>

      <section className="panel analyze-upload" aria-labelledby="analyze-upload-heading">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2 id="analyze-upload-heading" ref={uploadHeadingRef} tabIndex={-1}>
              Upload code to check
            </h2>
          </div>
        </div>

        <div className="analyze-upload-body">
          <div className="analyze-tabs" role="tablist" aria-label="How to give BugPilot code">
            <button
              type="button"
              role="tab"
              id="analyze-tab-upload"
              aria-controls="analyze-panel-upload"
              aria-selected={intakeMode === 'upload'}
              className={intakeMode === 'upload' ? 'analyze-tab is-selected' : 'analyze-tab'}
              onClick={() => setIntakeMode('upload')}
            >
              <Upload size={16} aria-hidden="true" />
              Upload files
            </button>
            <button
              type="button"
              role="tab"
              id="analyze-tab-paste"
              aria-controls="analyze-panel-paste"
              aria-selected={intakeMode === 'paste'}
              className={intakeMode === 'paste' ? 'analyze-tab is-selected' : 'analyze-tab'}
              onClick={() => setIntakeMode('paste')}
            >
              <Clipboard size={16} aria-hidden="true" />
              Paste code
            </button>
          </div>

          {intakeMode === 'upload' ? (
          <div
            role="tabpanel"
            id="analyze-panel-upload"
            aria-labelledby="analyze-tab-upload"
            tabIndex={0}
            className={dragActive ? 'analyze-drop is-dragging' : 'analyze-drop'}
            onDragEnter={(event) => {
              event.preventDefault()
              if (!busyRef.current) setDragActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Node | null
              if (!next || !event.currentTarget.contains(next)) setDragActive(false)
            }}
            onDrop={handleDrop}
          >
            <span className="empty-icon analyze-drop-icon" aria-hidden="true">
              <Upload size={22} />
            </span>
            <p className="analyze-drop-title">Drop a folder, an archive, or loose files here</p>
            <p className="field-hint analyze-drop-hint">
              Archives open as .zip, .tar, .gz, .tgz and package files (.whl, .jar, .apk and
              friends); the format is read from the bytes, not from the name. Dragging is optional.
              Both buttons below open a picker and work from the keyboard.
            </p>
            <div className="analyze-pick-actions">
              <button
                type="button"
                className="button button--primary"
                disabled={running}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} aria-hidden="true" />
                Choose files
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={running}
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen size={16} aria-hidden="true" />
                Choose a folder
              </button>
            </div>
            {!running && uploads.length > 0 ? (
              <>
                <div className="analyze-pick-actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => {
                      addingRef.current = true
                      fileInputRef.current?.click()
                    }}
                  >
                    <Plus size={16} aria-hidden="true" />
                    Add another upload to this run
                  </button>
                </div>
                <p className="field-hint">
                  The files already picked stay in the run and are read again from the same handles,
                  in the same order. Each upload gets its own <code>upload-N/</code> prefix, so two
                  folders with a <code>src/app.js</code> inside both keep their own copy. BugPilot
                  screens the uploads one by one: one it cannot trust is left out with a reason, and
                  the others are still checked. An archive has to be picked on its own.
                </p>
              </>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              aria-label="Choose files to analyse"
              onChange={handleFileSelection}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              hidden
              aria-label="Choose a folder to analyse"
              onChange={handleFileSelection}
            />
          </div>
          ) : null}

          {intakeMode === 'paste' ? (
            <div
              role="tabpanel"
              id="analyze-panel-paste"
              aria-labelledby="analyze-tab-paste"
              tabIndex={0}
              className="analyze-paste"
            >
              <div className="field">
                <label htmlFor="analyze-paste-language">Language of the pasted code</label>
                <select
                  id="analyze-paste-language"
                  className="analyze-paste-language"
                  value={pasteExtension}
                  onChange={(event) => setPasteExtension(event.target.value)}
                >
                  {PASTE_LANGUAGES.map((option) => (
                    <option key={option.extension} value={option.extension}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="analyze-paste-text">Code to check</label>
                <textarea
                  id="analyze-paste-text"
                  className="analyze-paste-text"
                  rows={12}
                  spellCheck={false}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                />
              </div>
              <p className="field-hint">
                The language name decides which rules get to read the text; a paste with no name
                would be checked as plain text. Up to 1 MiB of UTF-8, measured before a byte is
                analysed. The text is held in this tab only: it is never uploaded, never written to
                disk, and Clear results wipes it.
              </p>
              <div className="analyze-pick-actions analyze-paste-actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={running}
                  onClick={handleRunPaste}
                >
                  <FileSearch size={16} aria-hidden="true" />
                  Check the pasted text
                </button>
              </div>
            </div>
          ) : null}

          {running ? (
            <div
              className="analyze-progress"
              role="status"
              aria-live="polite"
              aria-label="Analysis progress"
              ref={progressRef}
              tabIndex={-1}
            >
              <div className="analyze-progress-text">
                <p>
                  <strong>{progress ? PHASE_LABELS[progress.phase] : 'Preparing the upload'}</strong>
                </p>
                <p className="field-hint">
                  {progress?.detail ?? 'Reading the selection inside this tab.'}
                </p>
                {progress && progress.filesTotal > 0 ? (
                  <progress
                    className="analyze-progress-bar"
                    value={progress.filesDone}
                    max={progress.filesTotal}
                    aria-label={`${progress.filesDone} of ${progress.filesTotal} files`}
                  />
                ) : (
                  <progress className="analyze-progress-bar" aria-label="Analysis in progress" />
                )}
              </div>
              <button type="button" className="button button--secondary" onClick={handleCancel}>
                <X size={16} aria-hidden="true" />
                Cancel
              </button>
            </div>
          ) : null}

          {refusedOrFailed ? (
            <div className="notice notice--alert" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>{result?.status === 'refused' ? 'Upload refused' : 'Analysis failed'}</strong>
                <p>{result?.message}</p>
                <p className="field-hint">Nothing was analysed and nothing was kept.</p>
              </div>
            </div>
          ) : null}

          {result?.status === 'cancelled' ? (
            <div className="notice" role="status">
              <X size={20} aria-hidden="true" />
              <div>
                <strong>Analysis cancelled</strong>
                <p>Nothing was kept. The workers were stopped and the upload was dropped.</p>
              </div>
            </div>
          ) : null}

          <div className="analyze-limits">
            <h3>Limits, applied before anything is analysed</h3>
            <ul className="analyze-limit-list">
              <li>
                Archive up to {formatBytes(limits.maxArchiveBytes)}; up to{' '}
                {formatBytes(limits.maxTotalUncompressedBytes)} of decoded text in total.
              </li>
              <li>
                One file up to {formatBytes(limits.maxSingleFileUncompressedBytes)}; bigger files
                are skipped with a reason instead of stopping the run.
              </li>
              <li>
                Up to {limits.maxEntryCount.toLocaleString('en-US')} entries. Encrypted entries,
                nested archives, symbolic links, unsafe paths and duplicate names are refused.
              </li>
              <li>
                Binary files, empty files and dependency folders such as node_modules, .git or dist
                are skipped with a reason.
              </li>
              <li>
                Folder drops and the folder picker are checked against the same limits as an
                archive.
              </li>
              <li>
                Several uploads share one budget: every ceiling above applies to the files from all
                of them together, not once per upload.
              </li>
              <li>
                Pasted code is capped at {formatBytes(MAX_PASTED_BYTES)} of UTF-8 and is treated as
                one file named <code>pasted/snippet.txt</code>.
              </li>
              <li>
                Reading one upload gets {wallClockSeconds(limits)} seconds. Past that BugPilot stops
                and keeps nothing, so a huge or deeply nested folder cannot hang the tab.
              </li>
              <li>
                The analysed text stays in this tab for the fix review while it fits{' '}
                {formatBytes(MAX_RETAINED_TEXT_BYTES)}; above that only the files a finding points at
                are kept, and Clear drops even those.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {!running && result?.status === 'completed' && !deepPass && !gateDismissed && deepLanguages.length > 0 ? (
        <EngineGate
          languages={deepLanguages}
          onRun={handleRunDeep}
          onDismiss={handleDismissGate}
        />
      ) : null}

      {enginesBlocked ? (
        <div className="notice notice--alert analyze-engines-blocked" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Deep engines did not run</strong>
            <p>{ENGINES_UNAVAILABLE_MESSAGE}</p>
            <p className="field-hint">
              {`The findings above come from the pattern rules${
                result?.report?.session.analysedCount
                  ? ` and cover all ${result.report.session.analysedCount} analysed file(s)`
                  : ''
              }. Syntax-tree and linter checks were not possible here.`}
            </p>
          </div>
        </div>
      ) : null}

      {!running && !result ? (
        <section className="panel empty-state analyze-empty" aria-labelledby="analyze-empty-heading">
          <span className="empty-icon" aria-hidden="true">
            <FileSearch size={24} />
          </span>
          <h2 id="analyze-empty-heading">No files checked yet</h2>
          <p>
            Choose a folder or a small zip to see findings, per-file coverage, and the checks that
            were not performed.
          </p>
        </section>
      ) : null}

      {result?.status === 'completed' && result.report ? (
        <AnalyzeResults
          key={result.report.generatedAt}
          report={result.report}
          sources={result.sources ?? []}
          prepareFixPlan={prepareFixPlan}
          headingRef={resultsHeadingRef}
          downloadReportFile={downloadReportFile}
          onClear={handleClear}
        />
      ) : null}
    </>
  )
}
