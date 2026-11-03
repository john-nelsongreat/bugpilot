import { useEffect, useState } from 'react'
import { Cpu, X } from 'lucide-react'
import type { SourceLanguage } from '../archive/classify'
import { formatEngineBytes, loadEngineManifest, planEngineDownload, type EngineDownloadPlan } from '../engines/downloadPlan'
import { languageLabel } from '../languages'

/**
 * The engines are WebAssembly: several megabytes that no user should download by accident. This
 * panel is the gate — it names every file that would load, with the size measured at build time
 * from `assets/engines/manifest.json`, and nothing is fetched until the user presses Run.
 */
const KIND_LABELS: Record<string, string> = {
  'engine-worker': 'Analysis worker script',
  'engine-client': 'Worker loader script',
  'tree-sitter-core': 'tree-sitter runtime',
  ruff: 'Ruff (Python linter)',
  other: 'Engine support file',
}

function entryLabel(entry: EngineDownloadPlan['files'][number]): string {
  if (entry.kind === 'grammar') return `${capitalise(entry.language ?? 'grammar')} grammar`
  return KIND_LABELS[entry.kind] ?? `Engine file ${entry.path.split('/').pop() ?? entry.path}`
}

function capitalise(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface EngineGateProps {
  /** Languages present in the analysed upload; the plan is built from exactly these. */
  languages: readonly SourceLanguage[]
  onRun: () => void
  onDismiss: () => void
}

export function EngineGate({ languages, onRun, onDismiss }: EngineGateProps) {
  const [plan, setPlan] = useState<EngineDownloadPlan | null>(null)

  useEffect(() => {
    let alive = true
    void loadEngineManifest().then((manifest) => {
      if (alive) setPlan(planEngineDownload(manifest, languages))
    })
    return () => {
      alive = false
    }
  }, [languages])

  return (
    <section className="panel analyze-engine-gate" aria-labelledby="analyze-engine-gate-heading">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Optional second pass</p>
          <h2 id="analyze-engine-gate-heading">
            <Cpu size={18} aria-hidden="true" /> Deep analysis engines
          </h2>
        </div>
      </div>
      <div className="analyze-engine-gate-body">
        <p className="prose">
          The built-in pattern rules have already run. The deep engines read the real grammar of
          each file instead of a pattern, and Ruff checks Python the way a linter does. They run as
          WebAssembly inside this tab: your code is still not uploaded, not stored, and not
          executed.
        </p>
        <p className="prose">
          This upload has {languages.map((language) => languageLabel(language)).join(', ')} files,
          which the engines can read. These files download from this site before anything runs:
        </p>

        {plan === null ? (
          <p className="field-hint" role="status">
            Measuring the engine files…
          </p>
        ) : plan.files.length === 0 ? (
          <p className="field-hint">
            {plan.needsTreeSitter || plan.needsRuff
              ? 'The build did not publish an engine manifest, so the sizes cannot be quoted here. Expect several megabytes from this site only.'
              : 'None of the languages in this upload has a deep engine, so there is nothing to download and nothing extra to check.'}
          </p>
        ) : (
          <ul className="analyze-engine-file-list">
            {plan.files.map((entry) => (
              <li key={entry.path}>
                <span>{entryLabel(entry)}</span>
                <span className="field-hint">{formatEngineBytes(entry.gzipBytes)} compressed</span>
              </li>
            ))}
          </ul>
        )}

        {plan !== null && plan.files.length > 0 ? (
          <p className="prose">
            About <strong>{formatEngineBytes(plan.gzipBytes)}</strong> in total, compressed, served
            by this site. Sizes are measured at build time and are the same files every visitor
            gets.
          </p>
        ) : null}

        {plan && plan.uncovered.length > 0 ? (
          <p className="field-hint">
            No grammar is shipped for{' '}
            {plan.uncovered.map((language) => languageLabel(language)).join(', ')}, so those files
            keep pattern-rule coverage only.
          </p>
        ) : null}

        <p className="field-hint">
          The engines are read-only detectors. They add findings and coverage notes; they never
          change your files, and automatic fixes stay limited to the ones BugPilot can edit safely.
        </p>

        <div className="analyze-engine-gate-actions">
          <button type="button" className="button button--primary" onClick={onRun}>
            <Cpu size={16} aria-hidden="true" />
            Run deep analysis
          </button>
          <button type="button" className="button button--secondary" onClick={onDismiss}>
            <X size={16} aria-hidden="true" />
            Cancel, keep the pattern-rule report
          </button>
        </div>
      </div>
    </section>
  )
}
