import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { BUGS_STORAGE_KEY, saveBugs } from '../features/bugs/storage'
import type { Bug } from '../features/bugs/types'
import { makeBug } from '../test/factories'

function renderDetail(bug: Bug) {
  const saved = saveBugs([bug])
  expect(saved.ok).toBe(true)

  return render(
    <MemoryRouter initialEntries={[`/bugs/${bug.id}`]}>
      <App />
    </MemoryRouter>,
  )
}

describe('Analyse with Assistant link', () => {
  it('links with only the bug id and opens a prefilled assistant', async () => {
    const user = userEvent.setup()
    const bug = makeBug({
      id: 'linked-detail',
      title: 'Imports fail after the pandas upgrade',
      language: 'Python',
      errorMessage: "ModuleNotFoundError: No module named 'requests'",
      stepsToReproduce: 'Run scripts/report.py in a clean environment.',
      actualBehavior: 'The script exits before writing a report.',
    })
    const raw = JSON.stringify({ schemaVersion: 1, bugs: [bug] })
    renderDetail(bug)

    const link = screen.getByRole('link', { name: 'Analyse with Assistant' })
    expect(link).toHaveAttribute('href', `/assistant?bugId=${bug.id}`)
    expect(link.getAttribute('href')).not.toContain('ModuleNotFoundError')
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)

    await user.click(link)

    expect(screen.getByText(/Loaded from bug:/)).toBeVisible()
    expect(screen.getByText(bug.title)).toBeVisible()
    expect(
      (screen.getByLabelText(
        'Error message or traceback',
      ) as HTMLTextAreaElement).value,
    ).toBe(bug.errorMessage)
    expect(
      (screen.getByLabelText('Language') as HTMLSelectElement).value,
    ).toBe('python')
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
  })

  it('is absent when the report has no error message', () => {
    const bug = makeBug({ id: 'no-error-bug', errorMessage: '' })
    renderDetail(bug)

    expect(
      screen.queryByRole('link', { name: 'Analyse with Assistant' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('No error output was recorded.')).toBeVisible()
  })
})
