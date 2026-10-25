import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import { makeBug, makeSavedDiagnosis } from '../../test/factories'
import { loadBugState, saveBugs } from './storage'
import type { Bug } from './types'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function store(...bugs: Bug[]) {
  const result = saveBugs(bugs)
  expect(result.ok).toBe(true)
}

function storedBug(id: string): Bug {
  const bug = loadBugState(localStorage).bugs.find((item) => item.id === id)
  if (!bug) throw new Error(`Expected ${id} to remain in storage`)
  return bug
}

describe('saved diagnosis through the edit form', () => {
  it('survives editing the report fields and status', async () => {
    const diagnosis = makeSavedDiagnosis()
    const bug = makeBug({
      id: 'form-edit-diagnosis',
      title: 'Original title',
      status: 'Open',
      diagnosis,
    })
    store(bug)
    renderAt(`/bugs/${bug.id}/edit`)

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Edited title keeps diagnosis' },
    })
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'Resolved' },
    })
    fireEvent.change(screen.getByLabelText('Fix status'), {
      target: { value: 'Accepted' },
    })
    fireEvent.change(screen.getByLabelText('Proposed fix'), {
      target: { value: 'Guard the missing amount before reading it.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Edited title keeps diagnosis',
      }),
    ).toBeVisible()

    const saved = storedBug(bug.id)
    expect(saved.diagnosis).toEqual(diagnosis)
    expect(saved.title).toBe('Edited title keeps diagnosis')
    expect(saved.status).toBe('Resolved')
    expect(saved.fixStatus).toBe('Accepted')
    expect(saved.createdAt).toBe(bug.createdAt)
  })

  it('survives a Verified fix state with verification notes', async () => {
    const diagnosis = makeSavedDiagnosis()
    const bug = makeBug({
      id: 'form-verified-diagnosis',
      fixStatus: 'Proposed',
      proposedFix: 'Validate the amount before formatting the total.',
      verificationNotes: '',
      diagnosis,
    })
    store(bug)
    renderAt(`/bugs/${bug.id}/edit`)

    fireEvent.change(screen.getByLabelText('Fix status'), {
      target: { value: 'Verified' },
    })
    fireEvent.change(screen.getByLabelText('Verification notes'), {
      target: { value: 'Checked the failing cart in a fresh profile.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: bug.title }),
    ).toBeVisible()

    const saved = storedBug(bug.id)
    expect(saved.diagnosis).toEqual(diagnosis)
    expect(saved.fixStatus).toBe('Verified')
    expect(saved.verificationNotes).toBe(
      'Checked the failing cart in a fresh profile.',
    )
    expect(saved.proposedFix).toBe('Validate the amount before formatting the total.')
  })
})

describe('saved diagnosis through the detail page', () => {
  it('survives the quick status change and a reload', async () => {
    const diagnosis = makeSavedDiagnosis()
    const bug = makeBug({
      id: 'status-diagnosis',
      title: 'Status change keeps diagnosis',
      diagnosis,
    })
    store(bug)
    const view = renderAt(`/bugs/${bug.id}`)

    fireEvent.change(screen.getByLabelText('Update status'), {
      target: { value: 'In Progress' },
    })

    await waitFor(() => {
      expect(storedBug(bug.id).status).toBe('In Progress')
    })
    expect(storedBug(bug.id).diagnosis).toEqual(diagnosis)

    view.unmount()
    renderAt(`/bugs/${bug.id}`)

    expect(storedBug(bug.id).diagnosis).toEqual(diagnosis)
    expect(
      screen.getByRole('heading', { level: 1, name: bug.title }),
    ).toBeVisible()
  })
})
