import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { saveBugs } from '../features/bugs/storage'
import { makeBug } from '../test/factories'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function seedWorkspace() {
  const result = saveBugs([makeBug({ id: 'seeded-bug', title: 'Existing report' })])
  expect(result.ok).toBe(true)
}

function openAssistant() {
  seedWorkspace()
  return renderAt('/assistant')
}

function fillAndAnalyze({
  errorText,
  language,
  codeSnippet,
  reproductionDetails,
}: {
  errorText: string
  language?: 'auto' | 'python' | 'javascript'
  codeSnippet?: string
  reproductionDetails?: string
}) {
  if (language) {
    fireEvent.change(screen.getByLabelText('Language'), {
      target: { value: language },
    })
  }
  fireEvent.change(screen.getByLabelText('Error message or traceback'), {
    target: { value: errorText },
  })
  if (codeSnippet !== undefined) {
    fireEvent.change(screen.getByLabelText('Code snippet'), {
      target: { value: codeSnippet },
    })
  }
  if (reproductionDetails !== undefined) {
    fireEvent.change(screen.getByLabelText('Reproduction details'), {
      target: { value: reproductionDetails },
    })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
}

function snapshotStorage() {
  return Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index)
    return [key, key ? localStorage.getItem(key) : null] as const
  }).sort(([left], [right]) => String(left).localeCompare(String(right)))
}

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

describe('Debug assistant', () => {
  it('diagnoses a Python error with evidence, fix, checklist, and confidence', () => {
    openAssistant()

    fillAndAnalyze({
      language: 'python',
      errorText: "ModuleNotFoundError: No module named 'requests'",
      codeSnippet: 'import requests\n\nrequests.get(url)',
    })

    expect(
      screen.getByRole('heading', { level: 2, name: 'Missing module' }),
    ).toHaveFocus()
    expect(screen.getByText('Matched signature')).toBeVisible()
    expect(
      screen.getByText("ModuleNotFoundError: No module named '<module>'"),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Likely cause' }),
    ).toBeVisible()
    expect(
      screen.getByText(/could not locate the module "requests"/i),
    ).toBeVisible()
    expect(screen.getByText('High confidence')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Evidence' })).toBeVisible()
    expect(screen.getByText('Final exception line')).toBeVisible()
    expect(screen.getByText('import requests')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Debugging steps' }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Possible fix' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Verification checklist' }),
    ).toBeVisible()
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Limitations' })).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Alternative explanations' }),
    ).toBeVisible()
    expect(
      screen.getByRole('status', { name: 'Analysis status' }),
    ).toHaveTextContent(/missing module/i)
  })

  it('diagnoses a JavaScript error with the explicit runtime', () => {
    openAssistant()

    fillAndAnalyze({
      language: 'javascript',
      errorText:
        "TypeError: Cannot read properties of undefined (reading 'map')",
    })

    expect(
      screen.getByRole('heading', { level: 2, name: 'Type mismatch' }),
    ).toHaveFocus()
    expect(
      screen.getByText(
        "TypeError: Cannot read properties of undefined (reading 'map')",
        { selector: 'code.assistant-signature' },
      ),
    ).toBeVisible()
    expect(screen.getByText('High confidence')).toBeVisible()
    expect(
      screen.getByText(/JavaScript tried to read a property/i),
    ).toBeVisible()
  })

  it('shows general guidance for unrecognised text without inventing a cause', () => {
    openAssistant()

    fillAndAnalyze({ errorText: 'The widget exploded while loading.' })

    expect(
      screen.getByRole('heading', { level: 2, name: 'Unrecognised' }),
    ).toHaveFocus()
    expect(screen.getByText('No rule matched')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'What this means' }),
    ).toBeVisible()
    expect(
      screen.getByText(/no supported exception signature was found/i),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Likely cause' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Debugging steps' }),
    ).toBeVisible()
    expect(screen.getByText(/copy the final exception line/i)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Copy code' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Low confidence')).toBeVisible()
  })

  it('requires error text and moves focus to the field', () => {
    openAssistant()

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an error message or traceback to analyze.',
    )
    expect(screen.getByLabelText('Error message or traceback')).toHaveFocus()
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Unrecognised' }),
    ).not.toBeInTheDocument()
  })

  it('rejects input over the 20,000-character limit', () => {
    openAssistant()
    const overLimit = 'x'.repeat(20_001)

    fireEvent.change(screen.getByLabelText('Error message or traceback'), {
      target: { value: overLimit },
    })

    expect(
      screen.getByText(/shorten it to 20,000 characters or fewer/i),
    ).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/20,001 characters/)
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Unrecognised' }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Error message or traceback')).toHaveFocus()
  })

  it('clears inputs, results, and checklist state', () => {
    openAssistant()

    fillAndAnalyze({
      language: 'python',
      errorText: "ModuleNotFoundError: No module named 'requests'",
      codeSnippet: 'import requests',
      reproductionDetails: 'Starts the worker',
    })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByLabelText('Error message or traceback')).toHaveValue('')
    expect(screen.getByLabelText('Language')).toHaveValue('auto')
    expect(screen.getByLabelText('Code snippet')).toHaveValue('')
    expect(screen.getByLabelText('Reproduction details')).toHaveValue('')
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Missing module' }),
    ).not.toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByLabelText('Error message or traceback')).toHaveFocus()
  })

  it('copies the example fix and confirms success', async () => {
    openAssistant()
    fillAndAnalyze({
      language: 'python',
      errorText: "ModuleNotFoundError: No module named 'requests'",
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    mockClipboard(writeText)

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('python -m pip install requests'),
    )
    expect(
      await screen.findByText('Code copied to the clipboard.'),
    ).toBeVisible()
  })

  it('shows a visible fallback when clipboard access fails', async () => {
    openAssistant()
    fillAndAnalyze({
      language: 'python',
      errorText: "ModuleNotFoundError: No module named 'requests'",
    })
    mockClipboard(vi.fn().mockRejectedValue(new Error('Clipboard blocked')))

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))

    expect(
      await screen.findByText(/could not copy automatically/i),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeEnabled()
  })

  it('never writes pasted text or results to localStorage', async () => {
    openAssistant()
    const before = snapshotStorage()

    fillAndAnalyze({
      language: 'python',
      errorText: "ModuleNotFoundError: No module named 'requests'",
      codeSnippet: 'import requests',
    })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    mockClipboard(vi.fn().mockResolvedValue(undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    await screen.findByText('Code copied to the clipboard.')

    expect(snapshotStorage()).toEqual(before)
    expect(JSON.stringify(before)).not.toContain('requests')
  })

  it('opens from the primary navigation with an active state', async () => {
    const user = userEvent.setup()
    seedWorkspace()
    renderAt('/')

    await user.click(screen.getByRole('link', { name: 'Assistant' }))

    expect(
      screen.getByRole('heading', { level: 1, name: 'Debug assistant' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
