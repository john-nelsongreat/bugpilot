import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { diagnose } from '../diagnostics/engine'
import type { DiagnosticResult, PossibleFix } from '../diagnostics/types'
import { SaveDiagnosisDialog } from './SaveDiagnosisDialog'
import { formatDateTime } from '../features/bugs/format'
import type { Bug, FixStatus } from '../features/bugs/types'
import { makeBug, makeSavedDiagnosis } from '../test/factories'

const errorText = "ModuleNotFoundError: No module named 'pandas'"
const codeSnippet = 'from pandas import DataFrame as Frame'

const FIX_EXPLANATION =
  'Install the distribution that provides "pandas" in the failing environment, or correct the import if the module name is wrong.'
const FIX_CODE = [
  '# Confirm which Python environment runs the failing code.',
  'python -c "import sys; print(sys.executable)"',
  '# Install the package that provides "pandas" (the distribution name may differ).',
  'python -m pip install pandas',
  '# Check the exact import used by your code.',
  'python -c "import pandas"',
].join('\n')
const COMPOSED_FIX = `${FIX_EXPLANATION}\n\nExample code:\n${FIX_CODE}`

function pythonResult(overrides: Partial<DiagnosticResult> = {}) {
  const result = diagnose({
    language: 'python',
    errorText,
    codeSnippet,
  })
  return { ...result, ...overrides }
}

function renderDialog(
  options: {
    bug?: Bug
    result?: DiagnosticResult
    possibleFix?: PossibleFix
    error?: string | null
  } = {},
) {
  const bug = options.bug ?? makeBug({ proposedFix: '', fixStatus: null })
  const result = options.result ?? pythonResult()
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  const view = render(
    <SaveDiagnosisDialog
      bug={bug}
      result={result}
      possibleFix={options.possibleFix ?? (result.possibleFix as PossibleFix)}
      error={options.error ?? null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )
  return { ...view, bug, result, onCancel, onConfirm }
}

function confirmButton() {
  return screen.getByRole('button', { name: 'Save diagnosis' })
}

describe('SaveDiagnosisDialog', () => {
  it('previews the category, signature, confidence, evidence and composed fix', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', {
      name: 'Save diagnosis to this bug?',
    })
    expect(within(dialog).getByText('Missing module')).toBeVisible()
    expect(
      within(dialog).getByText("ModuleNotFoundError: No module named '<module>'"),
    ).toBeVisible()
    expect(within(dialog).getByText('High confidence')).toBeVisible()
    expect(within(dialog).getByText('Final exception line')).toBeVisible()
    expect(within(dialog).getByText(errorText)).toBeVisible()
    expect(
      within(dialog).getByText('Related line from the supplied code'),
    ).toBeVisible()
    expect(within(dialog).getByText(codeSnippet)).toBeVisible()
    expect(dialog.querySelector('pre.code-block code')?.textContent).toBe(
      COMPOSED_FIX,
    )
    expect(
      within(dialog).getByText(COMPOSED_FIX.replace(/\s+/g, ' ')),
    ).toBeVisible()
    expect(
      within(dialog).getByText(
        'Nothing is marked as verified. Saving records an assistant suggestion, not a verified fix.',
      ),
    ).toBeVisible()
  })

  it('checks every evidence item by default and passes only the selected ones', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderDialog()

    const finalLine = screen.getByRole('checkbox', {
      name: /Final exception line/,
    })
    const codeLine = screen.getByRole('checkbox', {
      name: /Related line from the supplied code/,
    })
    expect(finalLine).toBeChecked()
    expect(codeLine).toBeChecked()

    await user.click(codeLine)
    await user.click(confirmButton())

    expect(onConfirm).toHaveBeenCalledWith({
      evidence: [{ label: 'Final exception line', quote: errorText }],
      replaceFix: false,
    })
  })

  it('explains that a missing fix will be stored and set to Proposed', () => {
    renderDialog({ bug: makeBug({ proposedFix: '', fixStatus: null }) })

    expect(
      screen.getByText(
        'This bug has no proposed fix yet: saving will store this one and set the fix state to Proposed.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('checkbox', {
        name: 'Replace the existing proposed fix with this one',
      }),
    ).not.toBeInTheDocument()
  })

  it('keeps an existing fix by default unless replacement is ticked', async () => {
    const user = userEvent.setup()
    const bug = makeBug({
      proposedFix: 'Existing fix from a teammate.',
      fixStatus: 'Proposed',
    })
    const { onConfirm } = renderDialog({ bug })

    expect(
      screen.getByText(
        'This bug already has a proposed fix: it will be KEPT and only the diagnosis is saved.',
      ),
    ).toBeVisible()
    const replace = screen.getByRole('checkbox', {
      name: 'Replace the existing proposed fix with this one',
    })
    expect(replace).not.toBeChecked()

    await user.click(confirmButton())
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ replaceFix: false }),
    )

    await user.click(replace)
    await user.click(confirmButton())
    expect(onConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ replaceFix: true }),
    )
  })

  it.each(['Accepted', 'Rejected', 'Verified'] as const)(
    'states that the %s fix state stays unchanged',
    (fixStatus: FixStatus) => {
      renderDialog({
        bug: makeBug({
          proposedFix: 'Existing fix from a teammate.',
          fixStatus,
        }),
      })

      expect(
        screen.getByText(`Fix state stays ${fixStatus}.`),
      ).toBeVisible()
    },
  )

  it('warns that an existing saved diagnosis will be replaced', () => {
    const savedAt = '2026-10-20T08:00:00.000Z'
    renderDialog({
      bug: makeBug({
        proposedFix: '',
        fixStatus: null,
        diagnosis: makeSavedDiagnosis({ savedAt }),
      }),
    })

    expect(
      screen.getByText(/already has a saved diagnosis from/i),
    ).toHaveTextContent(formatDateTime(savedAt))
    expect(
      screen.getByText(/already has a saved diagnosis from/i),
    ).toHaveTextContent('Saving will replace it.')
  })

  it('drops the example code when the composed fix is too long and says so', () => {
    const explanation = 'A'.repeat(19_990)
    renderDialog({
      possibleFix: {
        explanation,
        whereItMayApply: 'Somewhere.',
        exampleCode: 'B'.repeat(100),
      },
    })

    expect(screen.getByText(explanation)).toBeVisible()
    expect(
      screen.getByText(/example code was left out because/i),
    ).toBeVisible()
    expect(confirmButton()).toBeEnabled()
  })

  it('disables saving when the explanation alone exceeds the limit', () => {
    const explanation = 'A'.repeat(20_001)
    renderDialog({
      possibleFix: {
        explanation,
        whereItMayApply: 'Somewhere.',
        exampleCode: 'B'.repeat(100),
      },
    })

    expect(
      screen.getByText(/explanation alone is longer than 20,000 characters/i),
    ).toBeVisible()
    expect(confirmButton()).toBeDisabled()
  })

  it('shows a message when no evidence will be saved', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderDialog({
      result: pythonResult({ evidence: [] }),
    })

    expect(
      screen.getByText('No evidence will be saved with this diagnosis.'),
    ).toBeVisible()

    await user.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith({ evidence: [], replaceFix: false })
  })

  it('shows a save error inside the dialog', () => {
    renderDialog({ error: 'The diagnosis could not be saved: too long.' })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The diagnosis could not be saved: too long.',
    )
  })

  it('cancels with Escape and with the Cancel button without confirming', async () => {
    const user = userEvent.setup()
    const { onCancel, onConfirm } = renderDialog()

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('traps Tab focus inside the dialog', () => {
    renderDialog()

    const close = screen.getByRole('button', { name: 'Close dialog' })
    const save = confirmButton()

    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(save).toHaveFocus()

    save.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
  })
})
