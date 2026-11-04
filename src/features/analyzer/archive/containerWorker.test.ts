import { describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import { buildTar } from '../../../test/tarFixtures'
import { buildZip } from '../../../test/zipFixtures'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'
import type { ArchiveLimits } from './limits'
import { startArchiveWorker, type WorkerScope } from './workerProtocol'
import { createArchiveClient, type WorkerHandle } from './workerClient'

/**
 * The container reader behind the same one-job-at-a-time worker the zip reader already uses: the
 * page sends bytes and the name it was given, and the format is decided inside the worker from the
 * bytes. These tests cover the wiring, not the parsers (each reader has its own suite).
 */

function limitsFor(): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, maxArchiveBytes: 65_536 }
}

interface FakeScope {
  scope: WorkerScope
  posted: unknown[]
}

function makeScope(): FakeScope {
  const posted: unknown[] = []
  let handler: ((event: { data: unknown }) => void) | null = null
  return {
    posted,
    scope: {
      postMessage: (message: unknown) => posted.push(message),
      set onmessage(next: ((event: { data: unknown }) => void) | null) {
        handler = next
      },
      get onmessage() {
        return handler ?? null
      },
    } as WorkerScope,
  }
}

async function readInWorker(bytes: Uint8Array, name: string | undefined) {
  const fake = makeScope()
  startArchiveWorker(fake.scope)
  fake.scope.onmessage?.({
    data: { type: 'read-archive', id: 1, bytes: bytes.buffer, name, limits: limitsFor() },
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  const done = fake.posted.filter((message) => (message as { type: string }).type === 'done') as Array<
    {
      result: {
        refusal: { code: string } | null
        entries: Array<{ name: string }>
        format?: string | null
        note?: string | null
      }
    }
  >
  expect(done).toHaveLength(1)
  return done[0].result
}

interface FakeWorker {
  handle: WorkerHandle
  posted: Array<{ message: unknown; transfer?: unknown }>
  emit: (type: string, event: unknown) => void
  terminated: boolean
}

function makeWorker(): FakeWorker {
  const listeners: Record<string, Array<(event: unknown) => void>> = {}
  const fake = {
    handle: {} as WorkerHandle,
    posted: [] as Array<{ message: unknown; transfer?: unknown }>,
    terminated: false,
    emit(type: string, event: unknown) {
      for (const listener of listeners[type] ?? []) listener(event)
    },
  }
  fake.handle.postMessage = (message: unknown, transfer?: Transferable[]) => {
    fake.posted.push({ message, transfer })
  }
  fake.handle.addEventListener = (type: string, listener: (event: unknown) => void) => {
    listeners[type] = [...(listeners[type] ?? []), listener]
  }
  fake.handle.terminate = () => {
    fake.terminated = true
  }
  return fake
}

describe('container reads through the archive worker', () => {
  it('reads a tar and reports the container it found', async () => {
    const bytes = buildTar([{ name: 'calc.py', content: 'print(1)\n' }])

    const result = await readInWorker(bytes, 'project.tar')

    expect(result.refusal).toBeNull()
    expect(result.format).toBe('tar')
    expect(result.entries.map((entry) => entry.name)).toEqual(['calc.py'])
    expect(result.note).toBeNull()
  })

  it('opens a tar.gz inside the worker', async () => {
    const bytes = gzipSync(buildTar([{ name: 'src/a.js', content: 'export const a = 1\n' }]))

    const result = await readInWorker(bytes, 'project.tar.gz')

    expect(result.refusal).toBeNull()
    expect(result.format).toBe('gzip')
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js'])
  })

  it('refuses a 7z that claims to be a zip and notes the disagreement', async () => {
    const bytes = new Uint8Array([0x37, 0x7b, 0xa3, 0xab, 0x27, 0x1c, 0, 0, 1, 2, 3, 4])

    const result = await readInWorker(bytes, 'app.zip')

    expect(result.refusal?.code).toBe('unsupported_format')
    expect(result.format).toBeNull()
    expect(result.note).toContain('.7z')
    expect(result.entries).toEqual([])
  })

  it('still reads a zip from a request that carries no name', async () => {
    const bytes = buildZip([{ name: 'README.md', content: '# Project\n' }])

    const result = await readInWorker(bytes, undefined)

    expect(result.refusal).toBeNull()
    expect(result.format).toBe('zip')
    expect(result.entries.map((entry) => entry.name)).toEqual(['README.md'])
  })
})

describe('the page side of a container read', () => {
  it('sends the uploaded name along with the bytes', async () => {
    const fake = makeWorker()
    const pending = createArchiveClient(() => fake.handle).read(new Uint8Array([1]), {
      limits: limitsFor(),
      name: 'project.tar.gz',
    })

    expect((fake.posted[0].message as { name?: string }).name).toBe('project.tar.gz')

    const id = (fake.posted[0].message as { id: number }).id
    fake.emit('message', {
      data: { type: 'done', id, result: { refusal: null, entries: [], skipped: [], stats: {} } },
    })
    await expect(pending).resolves.toMatchObject({ refusal: null })
    expect(fake.terminated).toBe(true)
  })

  it('carries the format and the mismatch note back to the page', async () => {
    const fake = makeWorker()
    const pending = createArchiveClient(() => fake.handle).read(new Uint8Array([1]), {
      limits: limitsFor(),
      name: 'backup.tar',
    })
    const id = (fake.posted[0].message as { id: number }).id

    fake.emit('message', {
      data: {
        type: 'done',
        id,
        result: {
          refusal: null,
          entries: [],
          skipped: [],
          stats: {},
          format: 'zip',
          note: 'This file is named "backup.tar" but its contents are a zip archive.',
        },
      },
    })

    await expect(pending).resolves.toMatchObject({
      format: 'zip',
      note: 'This file is named "backup.tar" but its contents are a zip archive.',
    })
  })
})
