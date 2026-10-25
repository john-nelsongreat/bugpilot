import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'
import App from './App'
import { serializeBugExport } from './features/bugs/exportImport'
import { saveBugs } from './features/bugs/storage'
import { createSampleBugs } from './features/bugs/samples'
import type { Bug } from './features/bugs/types'
import { getAxeViolations } from './test/axe'
import { makeBug, makeSavedDiagnosis } from './test/factories'

const SAMPLE_NOW = new Date('2026-10-24T12:00:00.000Z')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function storeBugs(...bugs: Bug[]) {
  const result = saveBugs(bugs)
  expect(result.ok).toBe(true)
}

function sampleBugs(): Bug[] {
  return createSampleBugs(SAMPLE_NOW)
}

function exportFile(bugs: Bug[], name: string) {
  return new File([serializeBugExport(bugs, SAMPLE_NOW)], name, {
    type: 'application/json',
  })
}

async function expectNoViolations(scope: HTMLElement) {
  await expect(getAxeViolations(scope)).resolves.toEqual([])
}

// Vitest renders into a jsdom document of its own making; the shipped
// <html lang> and <title> live in index.html, which tests never load. They are
// copied from the real file so axe's document-level rules check the shell the
// site actually serves instead of an empty placeholder.
const shippedLang = /<html\b[^>]*\blang="([^"]*)"/i.exec(indexHtml)?.[1]
const shippedTitle = /<title>([^<]*)<\/title>/i.exec(indexHtml)?.[1]

beforeAll(() => {
  if (shippedLang) document.documentElement.lang = shippedLang
  if (shippedTitle) document.title = shippedTitle
})

afterAll(() => {
  document.documentElement.removeAttribute('lang')
  document.title = ''
})

describe('axe-core accessibility checks', () => {
  it('passes on the overview page of a first run', async () => {
    const { container } = renderAt('/')
    expect(
      await screen.findByText('Sample workspace loaded.'),
    ).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes on the bug log with saved reports', async () => {
    storeBugs(...sampleBugs())
    const { container } = renderAt('/bugs')

    await expectNoViolations(container)
  })

  it('passes on an empty bug log', async () => {
    storeBugs()
    const { container } = renderAt('/bugs')
    expect(screen.getByText('No bugs recorded yet.')).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes on a bug detail page', async () => {
    storeBugs(...sampleBugs())
    const { container } = renderAt('/bugs/sample-checkout-nan')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Checkout total shows NaN after a promo code',
      }),
    ).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes on a bug detail page with both copy buttons', async () => {
    storeBugs(
      makeBug({
        id: 'copy-detail',
        title: 'Copy controls on a saved report',
        errorMessage:
          "TypeError: Cannot read properties of undefined (reading 'total')\n    at calculateTotal (src/cart/total.ts:18:9)",
        proposedFix:
          'Default the missing total before formatting:\n\nconst total = cart.total ?? 0',
      }),
    )
    const { container } = renderAt('/bugs/copy-detail')

    expect(
      await screen.findByRole('button', { name: 'Copy error message' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Copy proposed fix' }),
    ).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes on the new bug form', async () => {
    storeBugs(...sampleBugs())
    const { container } = renderAt('/bugs/new')

    await expectNoViolations(container)
  })

  it('passes on the new bug form after an empty submit shows the error summary', async () => {
    const user = userEvent.setup()
    storeBugs(...sampleBugs())
    const { container } = renderAt('/bugs/new')

    await user.click(screen.getByRole('button', { name: 'Create bug' }))

    // The summary carries role="alert" but computes no accessible name, so it
    // is reached by its heading text rather than by a name filter.
    await screen.findByText('Fix the highlighted fields and try again.')
    const summary = screen.getAllByRole('alert')[0]
    expect(within(summary).getAllByRole('link').length).toBeGreaterThan(0)

    await expectNoViolations(container)
  })

  it('passes on the edit bug form', async () => {
    storeBugs(...sampleBugs())
    const { container } = renderAt('/bugs/sample-checkout-nan/edit')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit bug report' }),
    ).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes on the assistant before anything is analyzed', async () => {
    storeBugs(...sampleBugs())
    const { container } = renderAt('/assistant')

    await expectNoViolations(container)
  })

  it('passes on the assistant with a loaded bug', async () => {
    storeBugs(...sampleBugs())
    const { container } = renderAt('/assistant?bugId=sample-checkout-nan')

    expect(await screen.findByText(/Loaded from bug:/)).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes on the assistant showing a Python result', async () => {
    const user = userEvent.setup()
    storeBugs(...sampleBugs())
    const { container } = renderAt('/assistant')

    await user.selectOptions(screen.getByLabelText('Language'), 'python')
    await user.type(
      screen.getByLabelText('Error message or traceback'),
      "ModuleNotFoundError: No module named 'requests'",
    )
    await user.click(screen.getByRole('button', { name: 'Analyze' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Missing module' }),
    ).toHaveFocus()

    await expectNoViolations(container)
  })

  it('passes on the assistant showing a validation error', async () => {
    const user = userEvent.setup()
    storeBugs(...sampleBugs())
    const { container } = renderAt('/assistant')

    await user.click(screen.getByRole('button', { name: 'Analyze' }))

    expect(
      screen.getByLabelText('Error message or traceback'),
    ).toHaveAttribute('aria-invalid', 'true')
    expect(
      await screen.findByText(
        'Enter an error message or traceback to analyze.',
      ),
    ).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes on the not-found page', async () => {
    const { container } = renderAt('/this-route-does-not-exist')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes with the delete confirmation dialog open', async () => {
    const user = userEvent.setup()
    storeBugs(...sampleBugs())
    const { container } = renderAt('/bugs/sample-checkout-nan')

    await user.click(screen.getByRole('button', { name: 'Delete bug report' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Delete bug report?',
    })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    await expectNoViolations(container)
  })

  it('passes on a bug detail page with a saved diagnosis', async () => {
    storeBugs(
      makeBug({
        id: 'diagnosis-detail',
        title: 'A report with a saved diagnosis',
        diagnosis: makeSavedDiagnosis(),
      }),
    )
    const { container } = renderAt('/bugs/diagnosis-detail')

    expect(
      await screen.findByRole('heading', { name: 'Saved diagnosis' }),
    ).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes with the remove-diagnosis dialog open', async () => {
    const user = userEvent.setup()
    storeBugs(
      makeBug({
        id: 'diagnosis-remove',
        title: 'A report with a saved diagnosis',
        diagnosis: makeSavedDiagnosis(),
      }),
    )
    const { container } = renderAt('/bugs/diagnosis-remove')

    await user.click(
      screen.getByRole('button', { name: 'Remove saved diagnosis' }),
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'Remove saved diagnosis?',
    })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    await expectNoViolations(container)
  })

  it('passes with the import dialog open and a preview showing', async () => {
    const user = userEvent.setup()
    storeBugs(...sampleBugs())
    const { container } = renderAt('/bugs')

    await user.click(screen.getByRole('button', { name: 'Import reports' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Import bug reports',
    })
    await user.upload(
      within(dialog).getByLabelText('BugPilot export file'),
      exportFile([makeBug({ id: 'imported-bug' })], 'my-reports.json'),
    )

    expect(await within(dialog).findByText('my-reports.json')).toBeVisible()
    expect(within(dialog).getByText('Valid reports: 1')).toBeVisible()

    await expectNoViolations(container)
  })

  it('passes while an info toast is on screen', async () => {
    const user = userEvent.setup()
    storeBugs()
    const { container } = renderAt('/bugs')

    await user.click(screen.getByRole('button', { name: 'Export reports' }))

    const message = await screen.findByText(
      'There are no reports to export yet.',
    )
    expect(message.closest('[role="status"]')).not.toBeNull()
    // Holding focus pauses the auto-dismiss timer so axe definitely sees the
    // toast rather than a page it has already left.
    fireEvent.focus(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    )

    await expectNoViolations(container)
  })
})
