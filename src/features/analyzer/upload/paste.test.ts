// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_ARCHIVE_LIMITS } from '../archive/limits'
import type { IntakeSource } from '../archive/readLooseFiles'
import { createArchiveClient, type WorkerHandle } from '../archive/workerClient'
import type { WorkerIntakeSource } from '../archive/workerProtocol'
import { pastedSource } from './paste'

/**
 * A paste is the one intake whose bytes have no file behind them, so every pass hands the same
 * encoded buffer to the worker. A transfer list *moves* a buffer instead of copying it, so the
 * quick pass detaches what the deep pass is about to post: the second read would be refused
 * before it started. These tests drive the seam that broke — pasted source, then the page's
 * payload wrapping, then the real client — against a fake that honours transfers. A fake that
 * ignored the transfer list passes on the broken code, which is why G2 exists. The file runs in
 * the node environment because that is where a faithful transfer and a real DOMException live:
 * under jsdom the thrown error belongs to Node's realm, so G2 would test the realm instead of the
 * mechanism.
 */

/** The exact snippet docs/MANUAL_TEST_CHECKLIST.md step 18.3 tells a human to paste. */
const PASTED_TEXT = '@theme {\n--color-a: red;\n'

class FaithfulWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  posts: unknown[] = []
  postMessage(message: unknown, transfer?: Transferable[]) {
    // structuredClone with a transfer list detaches the originals, exactly like Chrome.
    const cloned = structuredClone(message, { transfer }) as { type?: string; id?: number }
    this.posts.push(cloned)
    const id = cloned.id
    if ((cloned.type === 'read-files' || cloned.type === 'read-archive') && typeof id === 'number') {
      // The client answers through the message envelope in workerClient.ts:132-157, so a post
      // that is a real request gets the done message the page is waiting for, with its own id.
      this.onmessage?.({ data: { type: 'done', id, result: emptyReadResult() } })
    }
  }
  terminate() {}
  addEventListener(type: 'message' | 'error', listener: (e: unknown) => void) {
    if (type === 'message') this.onmessage = listener
    else this.onerror = listener
  }
}

function emptyReadResult() {
  return {
    refusal: null,
    entries: [],
    skipped: [],
    stats: {
      walkedRecords: 0,
      producedBytes: 0,
      entries: 0,
      skipped: 0,
      durationMs: 0,
      peakEntryBytes: 0,
    },
  }
}

/** session.ts:184-188: a source with a handle travels as the file, anything else is read here. */
async function toPayload(source: IntakeSource): Promise<WorkerIntakeSource> {
  if (source.file) return { path: source.path, size: source.size, file: source.file }
  return { path: source.path, size: source.size, bytes: await source.read() }
}

function requirePaste(text: string, extension: string): IntakeSource {
  const paste = pastedSource(text, extension)
  if (!paste.ok) throw new Error(`the paste was refused: ${paste.refusal}`)
  return paste.source
}

function postedBytes(worker: FaithfulWorker, index: number): Uint8Array {
  const post = worker.posts[index] as { sources?: readonly WorkerIntakeSource[] } | undefined
  const bytes = post?.sources?.[0]?.bytes
  if (!bytes) throw new Error(`post ${index} carried no readable bytes`)
  return bytes
}

describe('a pasted snippet across the worker transfer', () => {
  it('G1: the quick pass and the deep pass both post the whole snippet', async () => {
    const source = requirePaste(PASTED_TEXT, 'css')
    const worker = new FaithfulWorker()
    const client = createArchiveClient((): WorkerHandle => worker)

    const first = await client.readFiles([await toPayload(source)], { limits: DEFAULT_ARCHIVE_LIMITS })
    expect(first.refusal).toBeNull()
    const quickBytes = postedBytes(worker, 0)
    expect(quickBytes.byteLength).toBe(source.size)
    const quickText = new TextDecoder().decode(quickBytes)
    expect(quickText).toBe(PASTED_TEXT)

    const second = await client.readFiles([await toPayload(source)], { limits: DEFAULT_ARCHIVE_LIMITS })
    expect(second.refusal).toBeNull()
    const deepBytes = postedBytes(worker, 1)
    expect(deepBytes.byteLength).toBe(quickBytes.byteLength)
    expect(new TextDecoder().decode(deepBytes)).toBe(quickText)
  })

  it('G2: the fake detaches a transferred buffer, so G1 can go red at all', () => {
    const worker = new FaithfulWorker()
    const bytes = new Uint8Array([1, 2, 3, 4])

    worker.postMessage({ bytes }, [bytes.buffer])
    expect(bytes.byteLength).toBe(0)

    let error: unknown = null
    try {
      worker.postMessage({ bytes }, [bytes.buffer])
    } catch (caught) {
      error = caught
    }
    // Chrome and Node word this differently, so the portable assertion is the class, never the message.
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('DataCloneError')
  })

  it('G3: every read returns identical bytes in a buffer no one else holds', async () => {
    const source = requirePaste(PASTED_TEXT, 'css')

    const first = await source.read()
    const second = await source.read()

    expect(first.length).toBe(second.length)
    expect(new TextDecoder().decode(second)).toBe(new TextDecoder().decode(first))
    expect(first.buffer).not.toBe(second.buffer)
  })
})
