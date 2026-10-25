import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Copy,
  Info,
  RotateCcw,
  Search,
  ShieldCheck,
  Stethoscope,
  X,
} from 'lucide-react'
import { useWorkspace } from '../app/useWorkspace'
import { assistantPrefillFor } from '../features/assistant/prefill'
import {
  MAX_ERROR_TEXT_LENGTH,
  diagnose,
} from '../diagnostics/engine'
import { CONFIDENCE_LABELS, diagnosticCategoryLabel } from '../diagnostics/labels'
import { copyTextToClipboard } from '../lib/clipboard'
import type {
  DiagnosticLanguage,
  DiagnosticResult,
} from '../diagnostics/types'

const EMPTY_VALUE_NOTE =
  'No specific line was matched. The general steps below still apply.'

type CopyStatus =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

export function AssistantPage() {
  const { bugs } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedBugId = searchParams.get('bugId')
  const requestedBug = requestedBugId
    ? (bugs.find((bug) => bug.id === requestedBugId) ?? null)
    : null
  const initialPrefill = requestedBug ? assistantPrefillFor(requestedBug) : null
  const loadedBug = requestedBug
  const bugContextNotice =
    requestedBugId && !loadedBug
      ? 'No saved report matches this link. Paste an error to continue.'
      : null
  const [appliedBugId, setAppliedBugId] = useState<string | null>(
    requestedBugId,
  )
  const [language, setLanguage] = useState<DiagnosticLanguage>(
    initialPrefill?.language ?? 'auto',
  )
  const [errorText, setErrorText] = useState(initialPrefill?.errorText ?? '')
  const [codeSnippet, setCodeSnippet] = useState('')
  const [reproductionDetails, setReproductionDetails] = useState(
    initialPrefill?.reproductionDetails ?? '',
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(() => new Set())
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null)
  const errorFieldRef = useRef<HTMLTextAreaElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)

  const overLimit = errorText.length > MAX_ERROR_TEXT_LENGTH
  const overLimitMessage = `This input is ${errorText.length.toLocaleString(
    'en-US',
  )} characters. Shorten it to ${MAX_ERROR_TEXT_LENGTH.toLocaleString(
    'en-US',
  )} characters or fewer.`
  const displayedError = formError ?? (overLimit ? overLimitMessage : null)

  useEffect(() => {
    if (result) {
      resultHeadingRef.current?.focus()
    }
  }, [result])

  // Adjusting state during render is the documented way to follow a changed
  // URL parameter without an effect. Clearing the parameter (removing the
  // context) deliberately leaves the typed text alone.
  if (requestedBugId && requestedBugId !== appliedBugId) {
    const nextPrefill = requestedBug ? assistantPrefillFor(requestedBug) : null
    setAppliedBugId(requestedBugId)
    setLanguage(nextPrefill?.language ?? 'auto')
    setErrorText(nextPrefill?.errorText ?? '')
    setCodeSnippet('')
    setReproductionDetails(nextPrefill?.reproductionDetails ?? '')
    setFormError(null)
    setResult(null)
    setCheckedSteps(new Set())
    setCopyStatus(null)
  }

  function handleRemoveBugContext() {
    setSearchParams({}, { replace: true })
  }

  function resetOutcome() {
    setResult(null)
    setCheckedSteps(new Set())
    setCopyStatus(null)
    setFormError(null)
  }

  function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (errorText.trim() === '') {
      setFormError('Enter an error message or traceback to analyze.')
      errorFieldRef.current?.focus()
      return
    }

    if (overLimit) {
      setFormError(overLimitMessage)
      errorFieldRef.current?.focus()
      return
    }

    setFormError(null)
    setCheckedSteps(new Set())
    setCopyStatus(null)
    setResult(
      diagnose({
        language,
        errorText,
        codeSnippet: codeSnippet.trim() === '' ? undefined : codeSnippet,
        reproductionDetails:
          reproductionDetails.trim() === '' ? undefined : reproductionDetails,
      }),
    )
  }

  function handleClear() {
    setLanguage('auto')
    setErrorText('')
    setCodeSnippet('')
    setReproductionDetails('')
    setFormError(null)
    setResult(null)
    setCheckedSteps(new Set())
    setCopyStatus(null)
    errorFieldRef.current?.focus()
  }

  function toggleStep(index: number) {
    setCheckedSteps((current) => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  async function handleCopy() {
    if (!result?.possibleFix) return
    const copied = await copyTextToClipboard(result.possibleFix.exampleCode)

    if (copied) {
      setCopyStatus({
        kind: 'success',
        message: 'Code copied to the clipboard.',
      })
    } else {
      setCopyStatus({
        kind: 'error',
        message:
          'Could not copy automatically. Select the example code and copy it manually.',
      })
    }
  }

  const announcement = result
    ? `Analysis complete. ${diagnosticCategoryLabel(result.category)}. ${
        CONFIDENCE_LABELS[result.confidence.level]
      } confidence.`
    : ''

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Local diagnosis</p>
          <h1>Debug assistant</h1>
          <p className="page-lede">
            Paste an error line or a full traceback. The assistant matches local
            rules and explains what it can support — without running code or
            sending text anywhere.
          </p>
        </div>
      </header>

      <p className="assistant-privacy-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>Local analysis only.</strong> Pasted text and results stay in
          this tab session. They are never written to your workspace or sent
          anywhere.
        </span>
      </p>

      {loadedBug ? (
        <div className="assistant-bug-context">
          <span className="assistant-bug-context-label">
            Loaded from bug: <strong>{loadedBug.title}</strong>
          </span>
          <button
            type="button"
            className="button button--secondary"
            onClick={handleRemoveBugContext}
            aria-label="Remove loaded bug context"
          >
            <X size={14} aria-hidden="true" />
            Remove
          </button>
        </div>
      ) : null}

      {bugContextNotice ? (
        <div className="notice" role="status" aria-label="Bug context">
          <Info size={16} aria-hidden="true" />
          <div>
            <p>{bugContextNotice}</p>
          </div>
        </div>
      ) : null}

      <div className="assistant-layout">
        <form
          className="panel assistant-form"
          onSubmit={handleAnalyze}
          noValidate
          aria-labelledby="assistant-form-heading"
        >
          <div className="assistant-form-head">
            <p className="eyebrow">Input</p>
            <h2 id="assistant-form-heading">What failed?</h2>
          </div>

          <div className="field">
            <label htmlFor="assistant-language">Language</label>
            <select
              id="assistant-language"
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value as DiagnosticLanguage)
                resetOutcome()
              }}
              aria-describedby="assistant-language-hint"
            >
              <option value="auto">Auto — infer from the text</option>
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
            <p className="field-hint" id="assistant-language-hint">
              Auto uses traceback headers and stack frames when they are
              present.
            </p>
          </div>

          <div className="field">
            <div className="label-row">
              <label htmlFor="assistant-error">
                Error message or traceback
              </label>
              <span className="optional-tag">Required</span>
            </div>
            <textarea
              id="assistant-error"
              ref={errorFieldRef}
              className="code-input"
              rows={9}
              value={errorText}
              onChange={(event) => {
                setErrorText(event.target.value)
                resetOutcome()
              }}
              placeholder={
                'Paste the final exception line or the full traceback.\nExample: ModuleNotFoundError: No module named requests'
              }
              aria-invalid={displayedError ? true : undefined}
              aria-describedby={`assistant-error-count${
                displayedError ? ' assistant-error-message' : ''
              }`}
            />
            <p
              className={
                overLimit ? 'field-hint field-hint--danger' : 'field-hint'
              }
              id="assistant-error-count"
            >
              {errorText.length.toLocaleString('en-US')} /{' '}
              {MAX_ERROR_TEXT_LENGTH.toLocaleString('en-US')} characters
            </p>
            {displayedError ? (
              <p
                className="field-error"
                id="assistant-error-message"
                role="alert"
              >
                {displayedError}
              </p>
            ) : null}
          </div>

          <div className="field">
            <div className="label-row">
              <label htmlFor="assistant-code">Code snippet</label>
              <span className="optional-tag">Optional</span>
            </div>
            <textarea
              id="assistant-code"
              className="code-input"
              rows={5}
              value={codeSnippet}
              onChange={(event) => {
                setCodeSnippet(event.target.value)
                resetOutcome()
              }}
              placeholder="Paste the few lines around the failure."
              aria-describedby="assistant-code-hint"
            />
            <p className="field-hint" id="assistant-code-hint">
              Used only to quote a matching line as evidence.
            </p>
          </div>

          <div className="field">
            <div className="label-row">
              <label htmlFor="assistant-details">Reproduction details</label>
              <span className="optional-tag">Optional</span>
            </div>
            <textarea
              id="assistant-details"
              rows={3}
              value={reproductionDetails}
              onChange={(event) => {
                setReproductionDetails(event.target.value)
                resetOutcome()
              }}
              placeholder="Command, environment, or steps that trigger it."
              aria-describedby="assistant-details-hint"
            />
            <p className="field-hint" id="assistant-details-hint">
              Language clues here can help Auto pick a runtime.
            </p>
          </div>

          <div className="assistant-form-actions">
            <button type="submit" className="button button--primary">
              <Search size={16} aria-hidden="true" />
              Analyze
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={handleClear}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Clear
            </button>
          </div>
        </form>

        <div className="assistant-output">
          <p className="sr-only" role="status" aria-label="Analysis status">
            {announcement}
          </p>

          {result ? (
            <section
              className="panel assistant-result"
              aria-labelledby="assistant-result-heading"
            >
              <header className="assistant-result-head">
                <p className="eyebrow">Analysis result</p>
                <h2
                  id="assistant-result-heading"
                  ref={resultHeadingRef}
                  tabIndex={-1}
                >
                  {diagnosticCategoryLabel(result.category)}
                </h2>
                <div className="assistant-result-meta">
                  <span
                    className={`badge badge--${result.confidence.level}`}
                  >
                    {CONFIDENCE_LABELS[result.confidence.level]} confidence
                  </span>
                  <span className="assistant-signature-label">
                    Matched signature
                  </span>
                  <code className="assistant-signature">
                    {result.matchedSignature ?? 'No rule matched'}
                  </code>
                </div>
                <p className="assistant-confidence-reason">
                  {result.confidence.reason}
                </p>
              </header>

              <div className="assistant-result-body">
                <section className="assistant-section">
                  <h3>
                    {result.category === 'unrecognized'
                      ? 'What this means'
                      : 'Likely cause'}
                  </h3>
                  <p className="prose">{result.likelyCause}</p>
                </section>

                <section className="assistant-section">
                  <h3>Evidence</h3>
                  {result.evidence.length > 0 ? (
                    <ul className="assistant-evidence-list">
                      {result.evidence.map((item, index) => (
                        <li
                          key={`${item.source}-${item.lineNumber ?? 'none'}-${index}`}
                          className="assistant-evidence"
                        >
                          <div className="assistant-evidence-meta">
                            <span>{item.label}</span>
                            {item.lineNumber ? (
                              <span>Line {item.lineNumber}</span>
                            ) : null}
                            <span className="assistant-source">
                              {item.source}
                            </span>
                          </div>
                          <code className="assistant-quote">
                            {item.quote}
                          </code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="field-hint">{EMPTY_VALUE_NOTE}</p>
                  )}
                </section>

                <section className="assistant-section">
                  <h3>Debugging steps</h3>
                  <ol className="assistant-steps">
                    {result.debuggingSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </section>

                <section className="assistant-section">
                  <h3>Possible fix</h3>
                  {result.possibleFix ? (
                    <>
                      <p className="prose">
                        {result.possibleFix.explanation}
                      </p>
                      <p className="assistant-where">
                        <strong>Where it may apply:</strong>{' '}
                        {result.possibleFix.whereItMayApply}
                      </p>
                      <div className="assistant-copy-row">
                        <span className="eyebrow">Example code</span>
                        <button
                          type="button"
                          className="button button--secondary assistant-copy"
                          onClick={() => void handleCopy()}
                        >
                          <Copy size={15} aria-hidden="true" />
                          Copy code
                        </button>
                      </div>
                      <pre className="code-block">
                        <code>{result.possibleFix.exampleCode}</code>
                      </pre>
                      {copyStatus ? (
                        <p
                          className={
                            copyStatus.kind === 'error'
                              ? 'assistant-copy-status is-error'
                              : 'assistant-copy-status'
                          }
                          role={
                            copyStatus.kind === 'error' ? 'alert' : 'status'
                          }
                        >
                          {copyStatus.message}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="prose">
                      No fix is suggested because no supported rule matched this
                      text. Use the general steps above to narrow it down.
                    </p>
                  )}
                </section>

                <section className="assistant-section">
                  <h3>Verification checklist</h3>
                  <ul className="assistant-checklist">
                    {result.verificationSteps.map((step, index) => (
                      <li key={`${index}-${step}`}>
                        <label>
                          <input
                            type="checkbox"
                            checked={checkedSteps.has(index)}
                            onChange={() => toggleStep(index)}
                          />
                          <span>{step}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="field-hint">
                    Session-only checks. Checking a box does not verify the fix.
                  </p>
                </section>

                <section className="assistant-section">
                  <h3>Limitations</h3>
                  <ul className="assistant-list">
                    {result.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </section>

                <section className="assistant-section">
                  <h3>Alternative explanations</h3>
                  {result.alternativeExplanations.length > 0 ? (
                    <ul className="assistant-list">
                      {result.alternativeExplanations.map((alternative) => (
                        <li key={alternative}>{alternative}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="field-hint">
                      None suggested for this match.
                    </p>
                  )}
                </section>

                <p className="assistant-result-footer">
                  Suggestions are displayed text only. No code was run, and
                  nothing here has been verified.
                </p>
              </div>
            </section>
          ) : (
            <section
              className="panel empty-state assistant-empty"
              aria-labelledby="assistant-empty-heading"
            >
              <span className="empty-icon" aria-hidden="true">
                <Stethoscope size={24} />
              </span>
              <h2 id="assistant-empty-heading">No analysis yet</h2>
              <p>
                Paste an error line or a traceback, then choose Analyze. Matched
                evidence, steps, and a possible fix will appear here.
              </p>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
