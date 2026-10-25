import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantPage } from './AssistantPage'
import type { AttachDiagnosisErrorCode } from '../features/bugs/diagnosis'
import { makeBug } from '../test/factories'

const { workspaceState } = vi.hoisted(() => ({
  workspaceState: {
    bugs: [] as import('../features/bugs/types').Bug[],
    attachDiagnosis: vi.fn(),
    notify: vi.fn(),
  },
}))

vi.mock('../app/useWorkspace', () => ({
  useWorkspace: () => ({
    bugs: workspaceState.bugs,
    attachDiagnosis: workspaceState.attachDiagnosis,
    notify: workspaceState.notify,
    toast: null,
    dismissToast: vi.fn(),
  }),
}))

const TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "report.py", line 3, in <module>',
  '    import pandas',
  "ModuleNotFoundError: No module named 'pandas'",
].join('\n')

beforeEach(() => {
  workspaceState.bugs = [
    makeBug({
      id: 'save-errors-bug',
      language: 'Python',
      errorMessage: TRACEBACK,
      proposedFix: '',
      fixStatus: null,
    }),
  ]
  workspaceState.attachDiagnosis.mockReset()
  workspaceState.notify.mockReset()
})

async function attemptSave(user: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter initialEntries={['/assistant?bugId=save-errors-bug']}>
      <AssistantPage />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: 'Analyze' }))
  await screen.findByRole('heading', { level: 2, name: 'Missing module' })
  await user.click(
    screen.getByRole('button', { name: 'Save diagnosis to this bug' }),
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Save diagnosis to this bug?',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Save diagnosis' }))
  return dialog
}

const failureCases: Array<[AttachDiagnosisErrorCode, string]> = [
  ['bug-not-found', 'This bug report no longer exists.'],
  [
    'missing-proposed-fix',
    'A proposed fix is required before a diagnosis can be saved.',
  ],
  [
    'unrecognized-diagnosis',
    'This diagnosis is not recognised, so there is no fix to save.',
  ],
  [
    'invalid-diagnosis',
    'The diagnosis could not be saved: Keep each evidence label to 80 characters or fewer.',
  ],
  [
    'storage-write-failed',
    'BugPilot could not save your changes. Free some browser storage and try again.',
  ],
]

describe('Assistant save diagnosis errors', () => {
  it.each(failureCases)(
    'shows the typed %s message without closing the dialog',
    async (code, message) => {
      const user = userEvent.setup()
      workspaceState.attachDiagnosis.mockReturnValue({
        ok: false,
        code,
        message,
      })

      const dialog = await attemptSave(user)

      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(within(dialog).getByRole('alert')).toHaveTextContent(message)
      expect(
        within(dialog).getByRole('button', { name: 'Save diagnosis' }),
      ).toBeEnabled()

      if (code === 'storage-write-failed') {
        expect(workspaceState.notify).toHaveBeenCalledWith(message, {
          tone: 'error',
        })
      } else {
        expect(workspaceState.notify).not.toHaveBeenCalled()
      }
    },
  )
})
