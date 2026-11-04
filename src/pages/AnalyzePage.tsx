import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { AlertTriangle, FileSearch, FolderOpen, ShieldCheck, Upload, X } from 'lucide-react'
import {
  analyzeUpload,
  type AnalysisSessionResult,
  type AnalyzeUploadOptions,
  type SessionPhase,
  type SessionProgress,
  type UploadInput,
} from '../features/analyzer/analysis/session'
import type { SourceLanguage } from '../features/analyzer/archive/classify'
import { DEFAULT_ARCHIVE_LIMITS } from '../features/analyzer/archive/limits'
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
  return `${Math.round(bytes / 1_048_576)} MiB`
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
    return { input: { kind: 'archive', bytes, name: files[0].name }, archiveBytes: bytes.length, retry }
  }
  return {
    input: { kind: 'files', sources: sourcesFromFiles(files) },
    archiveBytes: files.reduce((total, file) => total + file.size, 0),
    retry,
  }
}

function fromSources(sources: readonly IntakeSource[]): () => Promise<PreparedUpload> {
  const prepare = async (): Promise<PreparedUpload> => {
    if (sources.length === 1 && isContainerName(sources[0].path)) {
      const bytes = await sources[0].read()
      return { input: { kind: 'archive', bytes, name: sources[0].path }, archiveBytes: bytes.length, retry: prepare }
    }
    return {
      input: { kind: 'files', sources },
      archiveBytes: sources.reduce((total, source) => total + source.size, 0),
      retry: prepare,
    }
  }
  return prepare
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

  const busyRef = useRef(false)
  const runTokenRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const retryRef = useRef<(() => Promise<PreparedUpload>) | null>(null)
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

  const limits = DEFAULT_ARCHIVE_LIMITS

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
      const prepared = await prepare()
      if (runTokenRef.current !== token) return
      if (controller.signal.aborted) {
        setResult(cancelledResult(null))
        return
      }
      retryRef.current = prepared.retry

      const options: AnalyzeUploadOptions = {
        archiveBytes: prepared.archiveBytes,
        signal: controller.signal,
        generatedAt: now(),
        onProgress: (next) => {
          if (runTokenRef.current === token) setProgress(next)
        },
      }
      if (mode === 'deep') options.engines = 'approved'

      const outcome = await analyze(prepared.input, options)
      if (runTokenRef.current !== token) return
      const final =
        controller.signal.aborted && outcome.status !== 'cancelled'
          ? cancelledResult(outcome.stats)
          : outcome
      setResult(final)
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
    busyRef.current = false
    setRunning(false)
    setProgress(null)
    setResult(null)
    setDeepPass(false)
    setGateDismissed(false)
    uploadHeadingRef.current?.focus()
  }

  function handleCancel(): void {
    abortRef.current?.abort()
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    void startUpload(() => prepareFiles(files, readFile))
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragActive(false)
    if (busyRef.current) return
    const transfer = event.dataTransfer
    void startUpload(() => prepareDrop(transfer, readFile))
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
          <div
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
