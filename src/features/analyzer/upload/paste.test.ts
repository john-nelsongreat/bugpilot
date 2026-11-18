// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { DEFAULT_ARCHIVE_LIMITS } from '../archive/limits'
import type { IntakeSource } from '../archive/readLooseFiles'
import { createArchiveClient, type WorkerHandle } from '../archive/workerClient'
import type { WorkerIntakeSource } from '../archive/workerProtocol'
import { enginesFor } from '../engines/registry'
import { jsonSyntaxRule } from '../rules/json'
import { PASTE_LANGUAGES, pastedSource } from './paste'

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

/** The exact snippet docs/MANUAL_TEST_CHECKLIST.md step 18.1 tells a human to paste. */
const JSON_PASTED_TEXT = '{"a": 1,,}'

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

/**
 * The other half of a paste: not whether the bytes survive, but what the intake decides the paste
 * *is*. A name is the only thing the classifier reads, so a choice that does not reach the name
 * never reaches the rules that key on it. G1 and G3 above both pasted this CSS as `'css'` while the
 * intake was quietly renaming it to `snippet.txt` (`pastedSource` falls back to Auto for anything
 * the offered list does not contain), because nothing in this file read the path it produced. The
 * tests below read it.
 */
describe('what a paste is named, and which rules that name selects', () => {
  it('names the CSS the checklist pastes `.css`, so the CSS grammar can run on it', () => {
    const source = requirePaste(PASTED_TEXT, 'css')

    expect(source.path).toBe('pasted/snippet.css')
    const detection = detectLanguage(source.path, PASTED_TEXT)
    expect(detection.language).toBe('css')
    expect(detection.source).toBe('extension')
    expect(enginesFor(detection.language)?.syntaxClaims, 'css must be able to claim a syntax finding').toBe(true)
  })

  it('names the same text `.txt` on Auto, which is why the item has to name a choice', () => {
    // Nothing sniffs CSS out of content (`sniffContent` knows XML, HTML and parseable JSON only), so
    // Auto on an extension-less name lands on the text fallback and no syntax engine runs at all.
    const source = requirePaste(PASTED_TEXT, 'auto')

    expect(source.path).toBe('pasted/snippet.txt')
    const detection = detectLanguage(source.path, PASTED_TEXT)
    expect(detection.language).toBe('text')
    expect(enginesFor(detection.language), 'plain text must carry no syntax engine').toBeNull()
  })

  it('takes an extension the list does not offer as Auto, and still accepts the paste', () => {
    // The fallback is deliberate: a stale choice must not refuse someone's text. It is also how a
    // `'css'` argument went unnoticed for this long, so its shape is pinned rather than assumed.
    expect(PASTE_LANGUAGES.some((option) => option.extension === 'tsx'), 'tsx must stay unoffered here').toBe(false)

    const paste = pastedSource(PASTED_TEXT, 'tsx')
    expect(paste.ok).toBe(true)
    if (paste.ok) expect(paste.source.path).toBe('pasted/snippet.txt')
  })

  it('needs the JSON choice for the 18.1 paste too, because the rule is keyed to the language the name supplies', () => {
    const chosen = requirePaste(JSON_PASTED_TEXT, 'json')
    expect(chosen.path).toBe('pasted/snippet.json')
    // `dialectCandidate` asks for languageSource 'extension', so the dropdown choice is what offers
    // the JSONC candidate here — the snippet's own text never could.
    expect(detectLanguage(chosen.path, JSON_PASTED_TEXT).source).toBe('extension')

    // Two commas are not JSONC either, so the strict parse still reports; but that is only reached
    // because the name said `json`. On Auto the same text is plain text and the rule never sees it.
    expect(detectLanguage(requirePaste(JSON_PASTED_TEXT, 'auto').path, JSON_PASTED_TEXT).language).toBe('text')
    expect(jsonSyntaxRule.languages).toContain('json')
    expect(jsonSyntaxRule.languages).not.toContain('text')
  })
})
