import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisSessionResult, AnalyzeUploadOptions, UploadInput } from '../features/analyzer/analysis/session'
import type { ArchiveReadStats } from '../features/analyzer/archive/guard'
import {
  HIGH_CAPACITY_ARCHIVE_LIMITS,
  limitsForDevice,
} from '../features/analyzer/archive/limits'
import { getAxeViolations } from '../test/axe'
import { AnalyzePage } from './AnalyzePage'

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

const STATS: ArchiveReadStats = {
  walkedRecords: 1,
  producedBytes: 12,
  entries: 1,
  skipped: 0,
  durationMs: 2,
  peakEntryBytes: 12,
}

const CANCELLED: AnalysisSessionResult = { status: 'cancelled', message: null, report: null, stats: STATS }

function selectFiles(files: File[]): void {
  const input = screen.getByLabelText('Choose files to analyse') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

const originalDeviceMemory = Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory')

function reportDeviceMemory(gib: number): void {
  Object.defineProperty(window.navigator, 'deviceMemory', { value: gib, configurable: true, writable: true })
}

afterEach(() => {
  delete (window.navigator as unknown as { deviceMemory?: number }).deviceMemory
  if (originalDeviceMemory) {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', originalDeviceMemory)
  }
})

describe('Large project mode', () => {
  it('is offered only when the browser reports enough memory', () => {
    reportDeviceMemory(4)
    const { unmount } = render(<AnalyzePage analyze={vi.fn<AnalyzeFunction>()} />)
    expect(screen.queryByLabelText(/Large project mode/)).toBeNull()
    unmount()

    reportDeviceMemory(8)
    render(<AnalyzePage analyze={vi.fn<AnalyzeFunction>()} />)
    expect(screen.getByLabelText(/Large project mode/)).toBeVisible()
  })

  it('shows the normal ceilings, then raises them with a plain warning after the opt-in', async () => {
    reportDeviceMemory(8)
    const user = userEvent.setup()
    render(<AnalyzePage analyze={vi.fn<AnalyzeFunction>()} />)

    expect(screen.getByText(/Zip up to 2 GiB/)).toBeVisible()
    expect(screen.getByText(/parses up to 250,000 archive records/)).toBeVisible()
    expect(screen.getByText(/analyses up to 20,000 files/)).toBeVisible()
    expect(screen.getByText(/unpacks at most 600 MiB/)).toBeVisible()
    expect(screen.getByText(/within 300 seconds/)).toBeVisible()
    expect(screen.getByText(/200,000 findings/)).toBeVisible()
    expect(screen.getByText('Effective for this machine.')).toBeVisible()

    const toggle = screen.getByLabelText(/Large project mode/) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(
      screen.getByText(/raises the zip and tar ceilings/),
    ).toBeVisible()
    expect(
      screen.getByText(/lets one pass use more memory and more time/),
    ).toBeVisible()

    await user.click(toggle)

    expect(toggle.checked).toBe(true)
    expect(screen.getByText(/Zip up to 8 GiB/)).toBeVisible()
    expect(screen.getByText(/tar and tar.gz up to 1 GiB/)).toBeVisible()
    expect(screen.getByText(/unpacks at most 1 GiB/)).toBeVisible()
    expect(screen.getByText(/within 600 seconds/)).toBeVisible()
    expect(screen.getByText(/parses up to 250,000 archive records/)).toBeVisible()
    expect(screen.getByText(/analyses up to 40,000 files/)).toBeVisible()
    expect(screen.getByText('Effective for this machine in large project mode.')).toBeVisible()
  })

  it('hands the raised ceilings to the run only after the opt-in', async () => {
    reportDeviceMemory(8)
    const user = userEvent.setup()
    const analyze = vi.fn<AnalyzeFunction>(async () => CANCELLED)
    render(<AnalyzePage analyze={analyze} />)

    await user.click(screen.getByLabelText(/Large project mode/))
    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    expect(analyze.mock.calls[0][1].limits).toEqual(HIGH_CAPACITY_ARCHIVE_LIMITS)
  })

  it('passes the normal ceilings when the opt-in is never used', async () => {
    reportDeviceMemory(8)
    const analyze = vi.fn<AnalyzeFunction>(async () => CANCELLED)
    render(<AnalyzePage analyze={analyze} />)

    selectFiles([new File(['const x = 1\n'], 'app.ts', { type: 'text/plain' })])
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))

    expect(analyze.mock.calls[0][1].limits).toEqual(limitsForDevice(8, false))
  })

  it('never offers the opt-in on a small device, and keeps the halved ceilings', () => {
    reportDeviceMemory(2)
    render(<AnalyzePage analyze={vi.fn<AnalyzeFunction>()} />)

    expect(screen.queryByLabelText(/Large project mode/)).toBeNull()
    expect(screen.getByText(/Zip up to 1 GiB/)).toBeVisible()
    expect(screen.getByText(/analyses up to 10,000 files/)).toBeVisible()
  })

  it('passes an axe audit with the opt-in offered and ticked', async () => {
    reportDeviceMemory(8)
    const user = userEvent.setup()
    const { container } = render(<AnalyzePage analyze={vi.fn<AnalyzeFunction>()} />)

    expect(await getAxeViolations(container)).toEqual([])
    await user.click(screen.getByLabelText(/Large project mode/))
    await waitFor(async () => {
      expect(await getAxeViolations(container)).toEqual([])
    })
  })
})
