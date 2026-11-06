import { describe, expect, it } from 'vitest'
import type { ArchiveEntry } from '../archive/guard'
import { createAnalyzerPool, poolSizeFor } from './analyzerPool'
import type { AnalyzerClient, AnalyzerRunOptions, AnalyzerRunResult } from './analyzerClient'
import type { FileAnalysis } from './engine'

function entry(name: string): ArchiveEntry {
  return {
    name,
    text: 'const x = 1\n',
    language: 'javascript',
    languageSource: 'extension',
    encoding: 'utf-8',
    bytes: 12,
  }
}

function analysis(name: string): FileAnalysis {
  return { file: name, findings: [], notes: [], rulesRan: ['bugpilot/generic/long-line'], stoppedEarly: false }
}

interface Call {
  entries: ArchiveEntry[]
  options: AnalyzerRunOptions | undefined
}

interface FakeClient {
  client: AnalyzerClient & { dispose?: () => void }
  calls: Call[]
  disposed: number
}

function makeFake(resolve: (call: Call, at: number) => Promise<AnalyzerRunResult>): FakeClient {
  const fake: FakeClient = {
    calls: [],
    disposed: 0,
    client: {
      analyze(entries, options) {
        const call: Call = { entries: [...entries], options }
        fake.calls.push(call)
        return resolve(call, fake.calls.length - 1)
      },
      dispose: () => {
        fake.disposed += 1
      },
    },
  }
  return fake
}

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('pool sizing', () => {
  it('keeps one spare core per worker up to four', () => {
    expect(poolSizeFor(16)).toBe(4)
    expect(poolSizeFor(8)).toBe(4)
    expect(poolSizeFor(5)).toBe(4)
    expect(poolSizeFor(3)).toBe(2)
    expect(poolSizeFor(2)).toBe(1)
    expect(poolSizeFor(1)).toBe(1)
    expect(poolSizeFor(0)).toBe(1)
    expect(poolSizeFor(undefined)).toBe(1)
  })
})

describe('analyzer worker pool', () => {
  it('answers an empty or already-aborted run without starting a worker', async () => {
    const fake = makeFake(() => Promise.resolve({ files: [], cancelled: false, error: null }))
    const pool = createAnalyzerPool(() => fake.client, 2)

    const empty = await pool.analyze([])
    expect(empty).toMatchObject({ files: [], cancelled: false, error: null })

    const controller = new AbortController()
    controller.abort()
    const aborted = await pool.analyze([entry('f0')], { signal: controller.signal })
    expect(aborted).toMatchObject({ files: [], cancelled: true, error: null })
    expect(fake.calls).toHaveLength(0)
  })

  it('reassembles chunk results in input order however the workers interleaved', async () => {
    const made: FakeClient[] = []
    const pool = createAnalyzerPool(() => {
      const fake = makeFake((call, at) => new Promise((resolve) => {
        setTimeout(() => resolve({ files: call.entries.map((item) => analysis(item.name)), cancelled: false, error: null }), at === 0 ? 30 : 5)
      }))
      made.push(fake)
      return fake.client
    }, 2, 2)

    const entries = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'].map(entry)
    const result = await pool.analyze(entries)
    expect(result.cancelled).toBe(false)
    expect(result.error).toBeNull()
    expect(result.files.map((item) => item.file)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5'])
  })

  it('never runs more chunks than workers', async () => {
    const releases: Array<() => void> = []
    let concurrent = 0
    let maxConcurrent = 0
    const fake = makeFake(
      (call) =>
        new Promise((resolve) => {
          concurrent += 1
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          releases.push(() => {
            concurrent -= 1
            resolve({ files: call.entries.map((item) => analysis(item.name)), cancelled: false, error: null })
          })
        }),
    )
    const pool = createAnalyzerPool(() => fake.client, 2, 2)

    const pending = pool.analyze(['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'].map(entry))
    await tick()
    expect(fake.calls).toHaveLength(2)

    const releaseAll = async (): Promise<void> => {
      for (let guard = 0; guard < 8; guard += 1) {
        if (releases.length === 0) break
        const batch = releases.splice(0, releases.length)
        for (const release of batch) release()
        await tick(5)
      }
    }
    releases[0]()
    await tick()
    expect(fake.calls).toHaveLength(3)

    await releaseAll()
    const result = await pending
    expect(result.files.map((item) => item.file)).toHaveLength(10)
    expect(maxConcurrent).toBe(2)
    // Two pool workers share this fake, so dispose runs once per pooled worker.
    expect(fake.disposed).toBe(2)
  })

  it('returns nothing when the caller cancels mid-run', async () => {
    const releases: Array<() => void> = []
    const fake = makeFake(
      (call) =>
        new Promise((resolve) => {
          releases.push(() => {
            if (call.options?.signal?.aborted) resolve({ files: [], cancelled: true, error: null })
            else resolve({ files: call.entries.map((item) => analysis(item.name)), cancelled: false, error: null })
          })
        }),
    )
    const controller = new AbortController()
    const pool = createAnalyzerPool(() => fake.client, 1, 2)
    const pending = pool.analyze(['f0', 'f1', 'f2', 'f3', 'f4', 'f5'].map(entry), { signal: controller.signal })

    await tick()
    expect(fake.calls).toHaveLength(1)
    releases.shift()?.()
    await tick()
    expect(fake.calls).toHaveLength(2)

    controller.abort()
    releases.shift()?.()
    await expect(pending).resolves.toMatchObject({ files: [], cancelled: true, error: null })
    expect(fake.calls).toHaveLength(2)
  })

  it('stops dispatching and reports the failure when a chunk errors', async () => {
    const fake = makeFake((call, at) =>
      at === 1
        ? Promise.resolve({ files: [], cancelled: false, error: 'The analyzer stopped unexpectedly.' })
        : Promise.resolve({ files: call.entries.map((item) => analysis(item.name)), cancelled: false, error: null }),
    )
    const pool = createAnalyzerPool(() => fake.client, 1, 1)

    const result = await pool.analyze(['f0', 'f1', 'f2'].map(entry))
    expect(result.files).toEqual([])
    expect(result.cancelled).toBe(false)
    expect(result.error).toBe('The analyzer stopped unexpectedly.')
    expect(fake.calls).toHaveLength(2)
  })

  it('aggregates progress across workers to the full total', async () => {
    const fake = makeFake((call) => {
      call.options?.onProgress?.({ phase: 'rules', filesDone: 1, filesTotal: 2, findings: 1 })
      call.options?.onProgress?.({ phase: 'rules', filesDone: 2, filesTotal: 2, findings: 2 })
      return Promise.resolve({ files: call.entries.map((item) => analysis(item.name)), cancelled: false, error: null })
    })
    const pool = createAnalyzerPool(() => fake.client, 2, 2)

    const seen: Array<{ filesDone: number; filesTotal: number; findings: number }> = []
    await pool.analyze(['f0', 'f1', 'f2', 'f3'].map(entry), {
      onProgress: (progress) =>
        seen.push({ filesDone: progress.filesDone, filesTotal: progress.filesTotal, findings: progress.findings }),
    })

    expect(seen[0]).toEqual({ filesDone: 0, filesTotal: 4, findings: 0 })
    expect(seen.at(-1)).toEqual({ filesDone: 4, filesTotal: 4, findings: 4 })
  })
})
