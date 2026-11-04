import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  AnalysisSessionResult,
  AnalyzeUploadOptions,
  UploadArchiveInput,
  UploadInput,
} from '../features/analyzer/analysis/session'
import type { ArchiveReadStats } from '../features/analyzer/archive/guard'
import { AnalyzePage } from './AnalyzePage'

type AnalyzeFunction = (input: UploadInput, options: AnalyzeUploadOptions) => Promise<AnalysisSessionResult>

const STATS: ArchiveReadStats = {
  walkedRecords: 0,
  producedBytes: 0,
  entries: 0,
  skipped: 0,
  durationMs: 1,
  peakEntryBytes: 0,
}

/**
 * Intake routing happens before the session reads a byte, so the stub stops there. Which pipeline
 * an upload enters is the whole subject of this file — the reader's own decisions are covered by
 * the archive suites, and the results panel by AnalyzePage.test.tsx.
 */
function stopBeforeReading(): AnalyzeFunction {
  return async () => ({ status: 'cancelled', message: null, report: null, stats: STATS })
}

function selectFiles(files: File[]): void {
  const input = screen.getByLabelText('Choose files to analyse') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

async function firstCall(
  analyze: ReturnType<typeof vi.fn<AnalyzeFunction>>,
): Promise<UploadInput> {
  await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
  return analyze.mock.calls[0][0]
}

function asArchive(input: UploadInput): UploadArchiveInput {
  if (input.kind !== 'archive') throw new Error(`expected the container pipeline, got "${input.kind}"`)
  return input
}

function droppedFile(path: string): File {
  return new File(['not really a container'], path, { type: 'application/octet-stream' })
}

function dropOn(container: HTMLElement, transfer: { files: File[]; items: unknown[] }): void {
  const zone = container.querySelector('.analyze-drop')
  if (!zone) throw new Error('expected a drop zone')
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  act(() => {
    zone.dispatchEvent(event)
  })
}

describe('Analyze page container routing', () => {
  it('sends a single .tar.gz pick to the container reader with its name', async () => {
    const analyze = vi.fn<AnalyzeFunction>(stopBeforeReading())
    const readFile = vi.fn(async () => new Uint8Array([0x1f, 0x8b]))
    render(<AnalyzePage analyze={analyze} readFile={readFile} />)

    selectFiles([droppedFile('project.tar.gz')])

    const input = asArchive(await firstCall(analyze))
    expect(input.name).toBe('project.tar.gz')
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('sends a package archive named .jar to the container reader', async () => {
    const analyze = vi.fn<AnalyzeFunction>(stopBeforeReading())
    const readFile = vi.fn(async () => new Uint8Array([80, 75, 3, 4]))
    render(<AnalyzePage analyze={analyze} readFile={readFile} />)

    selectFiles([droppedFile('app.jar')])

    expect(asArchive(await firstCall(analyze)).name).toBe('app.jar')
  })

  it('keeps a single text file on the loose-file pipeline', async () => {
    const analyze = vi.fn<AnalyzeFunction>(stopBeforeReading())
    const readFile = vi.fn(async () => new Uint8Array([1]))
    render(<AnalyzePage analyze={analyze} readFile={readFile} />)

    selectFiles([new File(['hello\n'], 'notes.txt', { type: 'text/plain' })])

    const input = await firstCall(analyze)
    expect(input.kind).toBe('files')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('sends a dropped .tgz to the container reader with its path', async () => {
    const analyze = vi.fn<AnalyzeFunction>(stopBeforeReading())
    const { container } = render(<AnalyzePage analyze={analyze} />)

    const file = droppedFile('release/build.tgz')
    const entry = {
      isFile: true,
      isDirectory: false,
      fullPath: '/release/build.tgz',
      file: (onSuccess: (value: File) => void) => onSuccess(file),
    }
    dropOn(container, { files: [file], items: [{ webkitGetAsEntry: () => entry }] })

    expect(asArchive(await firstCall(analyze)).name).toBe('release/build.tgz')
  })
})
