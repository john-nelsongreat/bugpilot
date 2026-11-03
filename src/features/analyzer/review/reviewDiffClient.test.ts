import { describe, expect, it } from 'vitest'
import { startDiffWorker, type DiffWorkerScope } from './diffWorker'
import { buildReviewDiff, type ReviewDiffInput } from './reviewDiff'
import {
  createReviewDiffClient,
  createSyncReviewDiffBuilder,
  type DiffWorkerHandle,
} from './reviewDiffClient'

const FAKE_SECRET = ['Zq9', 'vT4k', 'Wm8p', 'Rc2s', 'Ld7N'].join('')
const MASK = `${FAKE_SECRET[0]}…${FAKE_SECRET[FAKE_SECRET.length - 1]}`

function input(file = 'src/app.ts'): ReviewDiffInput {
  const before = `const key = "${FAKE_SECRET}"\nconst retry = 1\n`
  const after = `const key = process.env.KEY\nconst retry = 1\n`
  const start = before.indexOf(FAKE_SECRET)
  return {
    file,
    before,
    after,
    maskedSpans: [{ startOffset: start, endOffset: start + FAKE_SECRET.length, maskedText: MASK }],
  }
}

interface FakeWorker {
  handle: DiffWorkerHandle
  posted: unknown[]
  listeners: Record<string, Array<(event: unknown) => void>>
  emit: (type: string, event: unknown) => void
  terminated: boolean
}

function makeWorker(): FakeWorker {
  const fake: FakeWorker = {
    posted: [],
    listeners: {},
    terminated: false,
    emit: (type, event) => {
      for (const listener of fake.listeners[type] ?? []) listener(event)
    },
    handle: {
      postMessage: () => {},
      addEventListener: () => {},
      terminate: () => {},
    },
  }
  fake.handle.postMessage = (message: unknown) => {
    fake.posted.push(message)
  }
  fake.handle.addEventListener = (type: string, listener: (event: unknown) => void) => {
    fake.listeners[type] = [...(fake.listeners[type] ?? []), listener]
  }
  fake.handle.terminate = () => {
    fake.terminated = true
  }
  return fake
}

describe('buildReviewDiff', () => {
  it('builds unified and side-by-side rows and masks removed secrets', () => {
    const result = buildReviewDiff(input())

    expect(result.error).toBeNull()
    expect(result.unified?.rows.some((row) => row.kind === 'remove')).toBe(true)
    expect(result.split?.rows.some((row) => row.kind === 'pair')).toBe(true)
    const removed = result.unified?.rows.filter((row) => row.kind === 'remove') ?? []
    expect(removed[0]?.text).toContain(MASK)
    expect(result.unified?.rows.some((row) => row.text.includes(FAKE_SECRET))).toBe(false)
  })
})

describe('review diff client', () => {
  it('posts the inputs, resolves the worker result and terminates the worker', async () => {
    const fake = makeWorker()
    const pending = createReviewDiffClient(() => fake.handle)([input()])

    const posted = fake.posted[0] as { type: string; id: number; inputs: ReviewDiffInput[] }
    expect(posted.type).toBe('build')
    expect(posted.inputs).toHaveLength(1)

    fake.emit('message', {
      data: {
        type: 'done',
        id: posted.id,
        results: [{ file: 'src/app.ts', unified: null, split: null, error: null }],
      },
    })
    await expect(pending).resolves.toEqual([
      { file: 'src/app.ts', unified: null, split: null, error: null },
    ])
    expect(fake.terminated).toBe(true)
  })

  it('terminates and resolves empty when the caller aborts', async () => {
    const fake = makeWorker()
    const controller = new AbortController()
    const pending = createReviewDiffClient(() => fake.handle)([input()], controller.signal)
    controller.abort()

    await expect(pending).resolves.toEqual([])
    expect(fake.terminated).toBe(true)
  })

  it('rejects when the worker reports an error', async () => {
    const fake = makeWorker()
    const pending = createReviewDiffClient(() => fake.handle)([input()])
    fake.emit('error', {})

    await expect(pending).rejects.toThrow('stopped unexpectedly')
    expect(fake.terminated).toBe(true)
  })

  it('falls back to building in place without a worker', async () => {
    const results = await createSyncReviewDiffBuilder()([input()])
    expect(results).toHaveLength(1)
    expect(results[0].unified?.changeCount).toBeGreaterThan(0)
  })
})

describe('diff worker protocol', () => {
  function makeScope() {
    const posted: unknown[] = []
    const scope: DiffWorkerScope = {
      onmessage: null,
      postMessage: (message) => posted.push(message),
    }
    startDiffWorker(scope)
    return { scope, posted }
  }

  it('answers a build request with one result per input', () => {
    const { scope, posted } = makeScope()
    scope.onmessage?.({ data: { type: 'build', id: 7, inputs: [input(), input('src/b.ts')] } })

    const message = posted[0] as {
      type: string
      id: number
      results: Array<{ file: string; error: string | null }>
    }
    expect(message.type).toBe('done')
    expect(message.id).toBe(7)
    expect(message.results.map((result) => result.file)).toEqual(['src/app.ts', 'src/b.ts'])
    expect(message.results.every((result) => result.error === null)).toBe(true)
  })

  it('ignores malformed requests', () => {
    const { scope, posted } = makeScope()
    scope.onmessage?.({ data: { type: 'build' } })
    scope.onmessage?.({ data: null })
    expect(posted).toEqual([])
  })
})
