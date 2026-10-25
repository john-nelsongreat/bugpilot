import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { saveBugs } from '../features/bugs/storage'
import type { Bug } from '../features/bugs/types'
import { makeBug } from '../test/factories'

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function seedBug(overrides: Partial<Bug> = {}) {
  const bug = makeBug({
    id: 'linked-bug',
    title: 'Linked checkout report',
    language: 'TypeScript',
    errorMessage:
      "TypeError: Cannot read properties of undefined (reading 'amount')",
    stepsToReproduce: 'Add two items and apply SAVE10.',
    actualBehavior: 'The checkout total shows NaN.',
    ...overrides,
  })
  const saved = saveBugs([bug])
  expect(saved.ok).toBe(true)
  return bug
}

function errorField() {
  return screen.getByLabelText(
    'Error message or traceback',
  ) as HTMLTextAreaElement
}

function detailsField() {
  return screen.getByLabelText('Reproduction details') as HTMLTextAreaElement
}

function languageField() {
  return screen.getByLabelText('Language') as HTMLSelectElement
}

function snapshotStorage() {
  return Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index)
    return [key, key ? localStorage.getItem(key) : null] as const
  }).sort(([left], [right]) => String(left).localeCompare(String(right)))
}

describe('Assistant bug prefill', () => {
  it('prefills the linked bug without running an analysis', () => {
    const bug = seedBug({ language: 'PYTHON' })

    renderAt(`/assistant?bugId=${bug.id}`)

    expect(errorField().value).toBe(bug.errorMessage)
    expect(languageField().value).toBe('python')
    expect(detailsField().value).toBe(
      'Steps to reproduce:\nAdd two items and apply SAVE10.\n\nActual behavior:\nThe checkout total shows NaN.',
    )
    expect(screen.getByText(/Loaded from bug:/)).toBeVisible()
    expect(screen.getByText(bug.title)).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'No analysis yet' }),
    ).toBeVisible()
    expect(screen.queryByText('Analysis result')).not.toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Analysis status' }),
    ).toHaveTextContent('')
  })

  it.each([
    ['python', 'python'],
    ['Python', 'python'],
    ['javascript', 'javascript'],
    ['TypeScript', 'javascript'],
    ['js', 'javascript'],
    ['ts', 'javascript'],
    ['node', 'javascript'],
    ['rust', 'auto'],
  ])('maps the stored language "%s" to %s', (stored, expected) => {
    const bug = seedBug({ language: stored })

    renderAt(`/assistant?bugId=${bug.id}`)

    expect(languageField().value).toBe(expected)
  })

  it('shows the context but leaves fields empty when the bug has no error message', () => {
    const bug = seedBug({ errorMessage: '' })

    renderAt(`/assistant?bugId=${bug.id}`)

    expect(screen.getByText(/Loaded from bug:/)).toBeVisible()
    expect(screen.getByText(bug.title)).toBeVisible()
    expect(errorField().value).toBe('')
    expect(detailsField().value).toBe('')
    expect(languageField().value).toBe('auto')
  })

  it('shows a non-blocking notice for an unknown bug and leaves the form empty', () => {
    seedBug()

    renderAt('/assistant?bugId=missing-report')

    expect(screen.getByText(/no saved report matches/i)).toBeVisible()
    expect(screen.getByRole('status', { name: 'Bug context' })).toHaveTextContent(
      /no saved report matches/i,
    )
    expect(screen.queryByText(/Loaded from bug:/)).not.toBeInTheDocument()
    expect(errorField().value).toBe('')
    expect(detailsField().value).toBe('')
    expect(languageField().value).toBe('auto')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('removes the bug context and query string but keeps typed text', async () => {
    const user = userEvent.setup()
    const bug = seedBug()
    renderAt(`/assistant?bugId=${bug.id}`)

    await user.clear(errorField())
    await user.type(errorField(), 'Hand-written failure text')
    await user.click(
      screen.getByRole('button', { name: 'Remove loaded bug context' }),
    )

    expect(screen.queryByText(/Loaded from bug:/)).not.toBeInTheDocument()
    expect(errorField().value).toBe('Hand-written failure text')
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/assistant'),
    )
    expect(screen.queryByText(/no saved report matches/i)).not.toBeInTheDocument()
  })

  it('leaves the assistant unchanged when no bug id is present', () => {
    seedBug()

    renderAt('/assistant')

    expect(screen.queryByText(/Loaded from bug:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no saved report matches/i)).not.toBeInTheDocument()
    expect(errorField().value).toBe('')
    expect(detailsField().value).toBe('')
    expect(languageField().value).toBe('auto')
  })

  it('does not write prefilled text or analysis results to storage', async () => {
    const user = userEvent.setup()
    const bug = seedBug()
    const before = snapshotStorage()
    renderAt(`/assistant?bugId=${bug.id}`)

    await user.click(screen.getByRole('button', { name: 'Analyze' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Type mismatch' }),
    ).toBeVisible()
    expect(snapshotStorage()).toEqual(before)
  })
})
