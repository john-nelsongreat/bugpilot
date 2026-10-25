import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  BUGS_STORAGE_KEY,
  loadBugState,
  saveBugs,
} from '../features/bugs/storage'
import type { Bug } from '../features/bugs/types'
import { formatDateTime } from '../features/bugs/format'
import { makeBug, makeSavedDiagnosis } from '../test/factories'

const TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "report.py", line 3, in <module>',
  '    import pandas',
  "ModuleNotFoundError: No module named 'pandas'",
].join('\n')
const FINAL_LINE = "ModuleNotFoundError: No module named 'pandas'"
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
const EXPECTED_FIX = `${FIX_EXPLANATION}\n\nExample code:\n${FIX_CODE}`
const SIGNATURE = "ModuleNotFoundError: No module named '<module>'"

function seedBug(overrides: Partial<Bug> = {}) {
  const bug = makeBug({
    id: 'save-flow',
    title: 'Nightly report cannot import pandas',
    language: 'Python',
    errorMessage: TRACEBACK,
    stepsToReproduce: 'Run the nightly pipeline.',
    actualBehavior: 'The job exits before writing the CSV.',
    proposedFix: '',
    fixStatus: null,
    ...overrides,
  })
  const saved = saveBugs([bug])
  expect(saved.ok).toBe(true)
  return bug
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

async function openSaveDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Analyze' }))
  await screen.findByRole('heading', { level: 2, name: 'Missing module' })
  await user.click(
    screen.getByRole('button', { name: 'Save diagnosis to this bug' }),
  )
  return screen.findByRole('dialog', {
    name: 'Save diagnosis to this bug?',
  })
}

function storedBug(id: string) {
  const bug = loadBugState(localStorage).bugs.find((item) => item.id === id)
  if (!bug) throw new Error('Expected the saved report to exist')
  return bug
}

describe('Assistant save diagnosis', () => {
  it('saves the previewed diagnosis and exposes it from the report', async () => {
    const user = userEvent.setup()
    const bug = seedBug()
    const view = renderAt(`/assistant?bugId=${bug.id}`)

    expect(
      screen.queryByRole('button', { name: 'Save diagnosis to this bug' }),
    ).not.toBeInTheDocument()

    const dialog = await openSaveDialog(user)
    expect(dialog.querySelector('pre.code-block code')?.textContent).toBe(
      EXPECTED_FIX,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save diagnosis' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Diagnosis saved to this bug.')).toBeVisible()
    const savedTrigger = screen.getByRole('button', {
      name: 'Save diagnosis to this bug',
    })
    expect(savedTrigger).toHaveFocus()

    const link = screen.getByRole('link', { name: 'View bug' })
    expect(link).toHaveAttribute('href', `/bugs/${bug.id}`)

    const stored = storedBug(bug.id)
    expect(stored.proposedFix).toBe(EXPECTED_FIX)
    expect(stored.fixStatus).toBe('Proposed')
    expect(stored.diagnosis).toMatchObject({
      category: 'missing-module',
      matchedSignature: SIGNATURE,
      confidence: 'high',
      evidence: [{ label: 'Final exception line', quote: FINAL_LINE }],
    })
    expect(Number.isNaN(Date.parse(stored.diagnosis?.savedAt ?? ''))).toBe(false)
    expect(stored.updatedAt).not.toBe(bug.updatedAt)

    await user.click(link)
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Nightly report cannot import pandas',
      }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Saved diagnosis' })).toBeVisible()
    expect(
      screen.getByText(EXPECTED_FIX.replace(/\s+/g, ' ')),
    ).toBeVisible()
    expect(screen.getByText(FINAL_LINE, { selector: 'code' })).toBeVisible()

    view.unmount()
    renderAt(`/bugs/${bug.id}`)
    expect(screen.getByRole('heading', { name: 'Saved diagnosis' })).toBeVisible()
    expect(
      screen.getByText(EXPECTED_FIX.replace(/\s+/g, ' ')),
    ).toBeVisible()
  })

  it('stores only structured fields and the selected evidence', async () => {
    const user = userEvent.setup()
    const bug = seedBug()
    renderAt(`/assistant?bugId=${bug.id}`)

    await user.type(
      screen.getByLabelText('Code snippet'),
      'from pandas import DataFrame as Frame',
    )
    const dialog = await openSaveDialog(user)
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: /Related line from the supplied code/,
      }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save diagnosis' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )

    const stored = storedBug(bug.id)
    const diagnosis = stored.diagnosis
    if (!diagnosis) throw new Error('Expected a saved diagnosis')
    expect(Object.keys(diagnosis).sort()).toEqual([
      'category',
      'confidence',
      'evidence',
      'matchedSignature',
      'savedAt',
    ])
    expect(diagnosis.evidence).toEqual([
      { label: 'Final exception line', quote: FINAL_LINE },
    ])

    const serialized = JSON.stringify(diagnosis)
    expect(serialized).not.toContain('from pandas import DataFrame as Frame')
    expect(serialized).not.toContain('Traceback (most recent call last)')
    expect(serialized).not.toContain('Run the nightly pipeline.')
    expect(serialized).not.toContain('The job exits before writing the CSV.')
    expect(stored.proposedFix).toBe(EXPECTED_FIX)
    expect(stored.proposedFix).not.toContain(
      'from pandas import DataFrame as Frame',
    )
    expect(stored.proposedFix).not.toContain('Run the nightly pipeline.')
    expect(stored.proposedFix).not.toContain(
      'The job exits before writing the CSV.',
    )
    expect(stored.proposedFix).not.toContain('Traceback (most recent call last)')
  })

  it('keeps an existing fix by default and replaces it only when asked', async () => {
    const user = userEvent.setup()
    const bug = seedBug({
      proposedFix: 'Existing fix from a teammate.',
      fixStatus: 'Accepted',
    })
    renderAt(`/assistant?bugId=${bug.id}`)

    const firstDialog = await openSaveDialog(user)
    expect(
      within(firstDialog).getByText(
        'This bug already has a proposed fix: it will be KEPT and only the diagnosis is saved.',
      ),
    ).toBeVisible()
    expect(within(firstDialog).getByText('Fix state stays Accepted.')).toBeVisible()
    await user.click(
      within(firstDialog).getByRole('button', { name: 'Save diagnosis' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )

    let stored = storedBug(bug.id)
    expect(stored.proposedFix).toBe('Existing fix from a teammate.')
    expect(stored.fixStatus).toBe('Accepted')
    expect(stored.diagnosis?.category).toBe('missing-module')

    await user.click(
      screen.getByRole('button', { name: 'Save diagnosis to this bug' }),
    )
    const secondDialog = await screen.findByRole('dialog', {
      name: 'Save diagnosis to this bug?',
    })
    expect(
      within(secondDialog).getByText(/already has a saved diagnosis from/i),
    ).toBeVisible()
    await user.click(
      within(secondDialog).getByRole('checkbox', {
        name: 'Replace the existing proposed fix with this one',
      }),
    )
    await user.click(
      within(secondDialog).getByRole('button', { name: 'Save diagnosis' }),
    )

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    stored = storedBug(bug.id)
    expect(stored.proposedFix).toBe(EXPECTED_FIX)
    expect(stored.fixStatus).toBe('Accepted')
  })

  it('leaves a Verified fix state and its notes untouched', async () => {
    const user = userEvent.setup()
    const bug = seedBug({
      proposedFix: 'Verified fix from a teammate.',
      fixStatus: 'Verified',
      verificationNotes: 'Checked on staging.',
      status: 'Resolved',
    })
    renderAt(`/assistant?bugId=${bug.id}`)

    const dialog = await openSaveDialog(user)
    expect(within(dialog).getByText('Fix state stays Verified.')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Save diagnosis' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    const stored = storedBug(bug.id)
    expect(stored.fixStatus).toBe('Verified')
    expect(stored.verificationNotes).toBe('Checked on staging.')
    expect(stored.proposedFix).toBe('Verified fix from a teammate.')
    expect(stored.status).toBe('Resolved')
    expect(stored.diagnosis).toBeDefined()
  })

  it('warns about and replaces an existing saved diagnosis', async () => {
    const user = userEvent.setup()
    const oldSavedAt = '2026-10-20T08:00:00.000Z'
    const bug = seedBug({
      diagnosis: makeSavedDiagnosis({
        category: 'type-mismatch',
        savedAt: oldSavedAt,
        evidence: [{ label: 'Old evidence', quote: 'Old quote' }],
      }),
    })
    renderAt(`/assistant?bugId=${bug.id}`)

    const dialog = await openSaveDialog(user)
    const notice = within(dialog).getByText(
      /already has a saved diagnosis from/i,
    )
    expect(notice).toHaveTextContent(formatDateTime(oldSavedAt))
    await user.click(within(dialog).getByRole('button', { name: 'Save diagnosis' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    const stored = storedBug(bug.id)
    expect(stored.diagnosis?.category).toBe('missing-module')
    expect(stored.diagnosis?.savedAt).not.toBe(oldSavedAt)
    expect(
      Date.parse(stored.diagnosis?.savedAt ?? '') > Date.parse(oldSavedAt),
    ).toBe(true)
    expect(stored.diagnosis?.evidence).toEqual([
      { label: 'Final exception line', quote: FINAL_LINE },
    ])
  })

  it('leaves the stored report unchanged when the write fails', async () => {
    const user = userEvent.setup()
    const bug = seedBug()
    renderAt(`/assistant?bugId=${bug.id}`)

    const dialog = await openSaveDialog(user)
    const raw = localStorage.getItem(BUGS_STORAGE_KEY)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })

    await user.click(within(dialog).getByRole('button', { name: 'Save diagnosis' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      /could not save|storage|quota/i,
    )
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    expect(storedBug(bug.id).diagnosis).toBeUndefined()
    const alerts = screen.getAllByRole('alert')
    expect(
      alerts.some((alert) => /could not save|storage|quota/i.test(alert.textContent ?? '')),
    ).toBe(true)
  })

  it('hides saving without a loaded bug, without a recognised fix, or after removing the context', async () => {
    const user = userEvent.setup()
    const bug = seedBug()
    const unknownBug = seedBug({
      id: 'unknown-failure',
      errorMessage: 'The operation did not complete.',
    })
    const both = saveBugs([bug, unknownBug])
    expect(both.ok).toBe(true)

    const first = renderAt('/assistant')
    await user.type(screen.getByLabelText('Error message or traceback'), TRACEBACK)
    await user.click(screen.getByRole('button', { name: 'Analyze' }))
    await screen.findByRole('heading', { level: 2, name: 'Missing module' })
    expect(
      screen.queryByRole('button', { name: 'Save diagnosis to this bug' }),
    ).not.toBeInTheDocument()
    first.unmount()

    const second = renderAt(`/assistant?bugId=${unknownBug.id}`)
    await user.click(screen.getByRole('button', { name: 'Analyze' }))
    await screen.findByRole('heading', { level: 2, name: 'Unrecognised' })
    expect(
      screen.queryByRole('button', { name: 'Save diagnosis to this bug' }),
    ).not.toBeInTheDocument()
    second.unmount()

    renderAt(`/assistant?bugId=${bug.id}`)
    await user.click(screen.getByRole('button', { name: 'Analyze' }))
    await screen.findByRole('heading', { level: 2, name: 'Missing module' })
    expect(
      screen.getByRole('button', { name: 'Save diagnosis to this bug' }),
    ).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'Remove loaded bug context' }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Save diagnosis to this bug' }),
      ).not.toBeInTheDocument(),
    )
  })
})
