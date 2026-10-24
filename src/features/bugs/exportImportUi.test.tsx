import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { makeBug } from '../../test/factories'
import { THEME_STORAGE_KEY } from '../theme/theme'
import {
  PREIMPORT_STORAGE_KEY,
  serializeBugExport,
} from './exportImport'
import { BUGS_STORAGE_KEY, saveBugs } from './storage'
import type { Bug } from './types'

const EXPORTED_AT = new Date('2026-10-24T12:34:56.000Z')

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let downloaded: { name: string; href: string } | null
let lastBlob: Blob | null

beforeEach(() => {
  downloaded = null
  lastBlob = null
  createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob
    return 'blob:bugpilot-export'
  })
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function (this: HTMLAnchorElement) {
      downloaded = {
        name: this.download,
        href: this.getAttribute('href') ?? '',
      }
    },
  )
})

afterEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  })
})

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

function storedBugs(): Bug[] {
  const raw = localStorage.getItem(BUGS_STORAGE_KEY)
  expect(raw).not.toBeNull()
  return (JSON.parse(raw as string) as { bugs: Bug[] }).bugs
}

function localKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  ).filter((key): key is string => key !== null)
}

function exportFile(bugs: Bug[], name = 'bugpilot-export.json') {
  return new File([serializeBugExport(bugs, EXPORTED_AT)], name, {
    type: 'application/json',
  })
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Blob could not be read'))
    reader.readAsText(blob)
  })
}

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import reports' }))
  const dialog = screen.getByRole('dialog', { name: 'Import bug reports' })
  return {
    dialog,
    fileInput: within(dialog).getByLabelText('BugPilot export file'),
  }
}

describe('export reports', () => {
  it('downloads a JSON export of every report without touching storage', async () => {
    const user = userEvent.setup()
    const first = makeBug({
      id: 'export-first',
      title: 'First exported report',
      fixStatus: 'Verified',
      proposedFix: 'Guard the null value.',
      verificationNotes: 'Checked in a fresh profile.',
    })
    const second = makeBug({
      id: 'export-second',
      title: 'Second exported report',
    })
    storeBugs(first, second)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const keysBefore = localKeys()
    renderAt('/bugs')

    await user.click(screen.getByRole('button', { name: 'Export reports' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(downloaded).not.toBeNull()
    expect(downloaded?.name).toMatch(
      /^bugpilot-export-\d{4}-\d{2}-\d{2}\.json$/,
    )
    expect(downloaded?.href).toBe('blob:bugpilot-export')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:bugpilot-export')

    const text = await readBlob(lastBlob as Blob)
    const payload = JSON.parse(text) as {
      app: string
      schemaVersion: number
      exportedAt: string
      bugs: Bug[]
    }

    expect(payload.app).toBe('bugpilot')
    expect(payload.schemaVersion).toBe(1)
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false)
    expect(payload.bugs).toEqual([first, second])
    expect(payload).not.toHaveProperty('theme')
    expect(payload).not.toHaveProperty('assistantText')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(localKeys().sort()).toEqual(keysBefore.sort())
  })

  it('explains why nothing downloads when there are no reports', async () => {
    const user = userEvent.setup()
    storeBugs()
    renderAt('/bugs')

    await user.click(screen.getByRole('button', { name: 'Export reports' }))

    expect(
      await screen.findByText(/there are no reports to export yet/i),
    ).toBeVisible()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(downloaded).toBeNull()
  })

  it('offers a backup export inside the import dialog', async () => {
    const user = userEvent.setup()
    const bug = makeBug({ id: 'dialog-backup', title: 'Back me up' })
    storeBugs(bug)
    renderAt('/bugs')

    const { dialog } = await openImport(user)
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Export current reports first',
      }),
    )

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(downloaded?.name).toMatch(/^bugpilot-export-/)
  })
})

describe('import preview and merge', () => {
  it('previews a file, keeps existing reports, and adds new ones', async () => {
    const user = userEvent.setup()
    const existing = makeBug({
      id: 'merge-existing',
      title: 'Already here',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    })
    const duplicate = makeBug({
      id: 'merge-existing',
      title: 'Imported duplicate',
    })
    const imported = makeBug({
      id: 'merge-new',
      title: 'Imported report',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    })
    storeBugs(existing)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const rawBefore = localStorage.getItem(BUGS_STORAGE_KEY) as string
    renderAt('/bugs')

    const { dialog, fileInput } = await openImport(user)
    await user.upload(
      fileInput,
      exportFile([imported, duplicate], 'my-reports.json'),
    )

    expect(await within(dialog).findByText('my-reports.json')).toBeVisible()
    expect(within(dialog).getByText('Valid reports: 2')).toBeVisible()
    expect(within(dialog).getByText('Invalid reports: 0')).toBeVisible()
    expect(within(dialog).getByText('Already in your log: 1')).toBeVisible()
    expect(
      within(dialog).getByText(
        '1 new report will be added. 1 matching existing report and 0 invalid reports will be skipped.',
      ),
    ).toBeVisible()
    expect(
      within(dialog).getByRole('radio', { name: /Add new reports only/ }),
    ).toBeChecked()

    await user.click(within(dialog).getByRole('button', { name: 'Add reports' }))

    expect(
      await screen.findByText('Import complete. Added 1, skipped 1, replaced 0.'),
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import reports' })).toHaveFocus()
    expect(storedBugs()).toEqual([existing, imported])
    expect(storedBugs()[1].createdAt).toBe(imported.createdAt)
    expect(storedBugs()[1].updatedAt).toBe(imported.updatedAt)
    expect(screen.getByRole('link', { name: 'Imported report' })).toBeVisible()
    expect(localStorage.getItem(PREIMPORT_STORAGE_KEY)).toBe(rawBefore)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('lists invalid records with positions and never imports them silently', async () => {
    const user = userEvent.setup()
    const valid = makeBug({ id: 'mixed-valid', title: 'Valid import' })
    const blankTitle = {
      ...JSON.parse(JSON.stringify(makeBug({ id: 'mixed-blank' }))),
      title: '',
    }
    const badSeverity = {
      ...JSON.parse(JSON.stringify(makeBug({ id: 'mixed-severity' }))),
      severity: 'Urgent',
    }
    const text = JSON.stringify({
      app: 'bugpilot',
      schemaVersion: 1,
      exportedAt: EXPORTED_AT.toISOString(),
      bugs: [valid, blankTitle, badSeverity],
    })
    storeBugs()
    renderAt('/bugs')

    const { dialog, fileInput } = await openImport(user)
    await user.upload(
      fileInput,
      new File([text], 'mixed.json', { type: 'application/json' }),
    )

    expect(await within(dialog).findByText('Valid reports: 1')).toBeVisible()
    expect(within(dialog).getByText('Invalid reports: 2')).toBeVisible()
    const issues = within(dialog).getByRole('list', { name: 'Invalid reports' })
    expect(within(issues).getByText('Report 2: Enter a title.')).toBeVisible()
    expect(
      within(issues).getByText('Report 3: Choose a valid severity.'),
    ).toBeVisible()
    expect(
      within(dialog).getByText(
        '1 new report will be added. 0 matching existing reports and 2 invalid reports will be skipped.',
      ),
    ).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'Add reports' }))

    expect(
      await screen.findByText('Import complete. Added 1, skipped 2, replaced 0.'),
    ).toBeVisible()
    expect(storedBugs().map((bug) => bug.id)).toEqual(['mixed-valid'])
  })

  it('shows only the first ten invalid reasons', async () => {
    const user = userEvent.setup()
    const records = Array.from({ length: 12 }, (_, index) => ({
      ...JSON.parse(
        JSON.stringify(makeBug({ id: `invalid-${index + 1}` })),
      ),
      title: '',
    }))
    const text = JSON.stringify({
      app: 'bugpilot',
      schemaVersion: 1,
      bugs: records,
    })
    storeBugs()
    renderAt('/bugs')

    const { dialog, fileInput } = await openImport(user)
    await user.upload(
      fileInput,
      new File([text], 'invalid.json', { type: 'application/json' }),
    )

    expect(await within(dialog).findByText('Invalid reports: 12')).toBeVisible()
    const issues = within(dialog).getByRole('list', { name: 'Invalid reports' })
    expect(within(issues).getAllByRole('listitem')).toHaveLength(10)
    expect(
      within(dialog).getByText('2 more invalid reports are not listed.'),
    ).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Add reports' })).toBeDisabled()
  })

  it('shows a parse error for malformed files and disables import', async () => {
    const user = userEvent.setup()
    storeBugs(makeBug({ id: 'parse-existing' }))
    const rawBefore = localStorage.getItem(BUGS_STORAGE_KEY)
    renderAt('/bugs')

    const { dialog, fileInput } = await openImport(user)
    await user.upload(
      fileInput,
      new File(['{not json'], 'broken.json', { type: 'application/json' }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /not valid JSON/i,
    )
    expect(
      within(dialog).getByRole('button', { name: 'Add reports' }),
    ).toBeDisabled()
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)
    expect(localStorage.getItem(PREIMPORT_STORAGE_KEY)).toBeNull()
  })
})

describe('replace mode', () => {
  it('requires the warning acknowledgement before replacing the log', async () => {
    const user = userEvent.setup()
    const oldA = makeBug({ id: 'replace-old-a', title: 'Old A' })
    const oldB = makeBug({ id: 'replace-old-b', title: 'Old B' })
    const imported = makeBug({ id: 'replace-new', title: 'Replacement' })
    storeBugs(oldA, oldB)
    const rawBefore = localStorage.getItem(BUGS_STORAGE_KEY) as string
    renderAt('/bugs')

    const { dialog, fileInput } = await openImport(user)
    await user.upload(fileInput, exportFile([imported], 'replace.json'))
    await within(dialog).findByText('Valid reports: 1')

    await user.click(
      within(dialog).getByRole('radio', { name: /Replace all reports/ }),
    )

    expect(
      within(dialog).getByText(/This replaces your entire bug log/i),
    ).toBeVisible()
    expect(
      within(dialog).getByText(
        /All 2 current reports will be deleted and replaced by 1 imported report/i,
      ),
    ).toBeVisible()
    const confirm = within(dialog).getByRole('button', {
      name: 'Replace all reports',
    })
    expect(confirm).toBeDisabled()
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'I understand this replaces all 2 current reports.',
      }),
    )
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(
      await screen.findByText('Import complete. Added 1, skipped 0, replaced 2.'),
    ).toBeVisible()
    expect(storedBugs()).toEqual([imported])
    expect(localStorage.getItem(PREIMPORT_STORAGE_KEY)).toBe(rawBefore)
    expect(screen.getByRole('link', { name: 'Replacement' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Old A' })).not.toBeInTheDocument()
  })
})

describe('dialog behaviour', () => {
  it('traps focus, cancels with Escape, and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const existing = makeBug({ id: 'focus-existing' })
    storeBugs(existing)
    const rawBefore = localStorage.getItem(BUGS_STORAGE_KEY)
    renderAt('/bugs')

    const trigger = screen.getByRole('button', { name: 'Import reports' })
    const { dialog, fileInput } = await openImport(user)
    expect(fileInput).toHaveFocus()

    await user.tab({ shift: true })
    expect(
      within(dialog).getByRole('button', { name: 'Close dialog' }),
    ).toHaveFocus()

    await user.tab({ shift: true })
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus()

    await user.tab()
    expect(
      within(dialog).getByRole('button', { name: 'Close dialog' }),
    ).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)
    expect(localStorage.getItem(PREIMPORT_STORAGE_KEY)).toBeNull()

    await user.click(trigger)
    const reopened = screen.getByRole('dialog', { name: 'Import bug reports' })
    await user.click(within(reopened).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)
  })

  it('keeps the existing data and shows a persistent error when the backup fails', async () => {
    const user = userEvent.setup()
    const existing = makeBug({ id: 'failure-existing' })
    const imported = makeBug({ id: 'failure-imported' })
    storeBugs(existing)
    const rawBefore = localStorage.getItem(BUGS_STORAGE_KEY) as string
    renderAt('/bugs')

    const storageSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === PREIMPORT_STORAGE_KEY) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      storageSetItem.call(this, key, value)
    })

    const { dialog, fileInput } = await openImport(user)
    await user.upload(fileInput, exportFile([imported]))
    await within(dialog).findByText('Valid reports: 1')
    await user.click(within(dialog).getByRole('button', { name: 'Add reports' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /unchanged/i,
    )
    expect(screen.getByRole('dialog', { name: 'Import bug reports' })).toBeVisible()
    expect(
      screen
        .getAllByRole('alert')
        .some((element) => /unchanged/i.test(element.textContent ?? '')),
    ).toBe(true)
    expect(localStorage.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)
    expect(localStorage.getItem(PREIMPORT_STORAGE_KEY)).toBeNull()
    expect(storedBugs()).toEqual([existing])
  })

  it('does not show the sample notice after a successful import', async () => {
    const user = userEvent.setup()
    const imported = makeBug({ id: 'sample-imported', title: 'Imported after samples' })
    const view = renderAt('/bugs')

    expect(await screen.findByText(/sample workspace loaded/i)).toBeVisible()
    const seededCount = storedBugs().length

    const { dialog, fileInput } = await openImport(user)
    await user.upload(fileInput, exportFile([imported]))
    await within(dialog).findByText('Valid reports: 1')
    await user.click(within(dialog).getByRole('button', { name: 'Add reports' }))

    expect(
      await screen.findByText('Import complete. Added 1, skipped 0, replaced 0.'),
    ).toBeVisible()
    expect(screen.queryByText(/sample workspace loaded/i)).not.toBeInTheDocument()
    expect(storedBugs()).toHaveLength(seededCount + 1)

    view.unmount()
    renderAt('/bugs')

    expect(screen.queryByText(/sample workspace loaded/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Imported after samples' }),
    ).toBeVisible()
  })
})
