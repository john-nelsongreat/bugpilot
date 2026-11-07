import { describe, expect, it } from 'vitest'
import { createBlobSource, createMemorySource } from './source'

/**
 * The Blob source answers neighbouring small reads from a cached window, because a zip walk
 * issues several reads per entry and one slice call per read turns a many-entry archive into
 * minutes of per-call latency. These tests pin the only observable contract: the bytes a read
 * returns are the file's bytes, and a cached window never leaks past its own bounds.
 */

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = 0x12345678
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    bytes[index] = state >>> 24
  }
  return bytes
}

describe('blob source window cache', () => {
  it('returns the same bytes as the memory source across overlapping reads', async () => {
    const bytes = randomBytes(300_000)
    const blob = new Blob([bytes.buffer as ArrayBuffer])
    const cached = createBlobSource(blob)
    const plain = createMemorySource(bytes)

    // Ascending small reads, the pattern the zip reader produces, then descending ones.
    for (let at = 0; at + 120 <= bytes.length; at += 97) {
      await expect(cached.read(at, at + 120)).resolves.toEqual(await plain.read(at, at + 120))
    }
    for (let at = 250_000; at >= 0; at -= 31_111) {
      const end = Math.min(bytes.length, at + 300)
      await expect(cached.read(at, end)).resolves.toEqual(await plain.read(at, end))
    }
  })

  it('crosses window boundaries without dropping or duplicating a byte', async () => {
    const bytes = randomBytes(700_000)
    const blob = new Blob([bytes.buffer as ArrayBuffer])
    const cached = createBlobSource(blob)
    const plain = createMemorySource(bytes)

    // 512 KiB windows: a read that starts inside one window and ends past its end refetches.
    await expect(cached.read(500_000, 560_000)).resolves.toEqual(await plain.read(500_000, 560_000))
    await expect(cached.read(0, 40)).resolves.toEqual(await plain.read(0, 40))
    await expect(cached.read(bytes.length - 1, bytes.length)).resolves.toEqual(
      await plain.read(bytes.length - 1, bytes.length),
    )
  })

  it('serves a whole-window read directly and keeps larger reads uncached', async () => {
    const bytes = randomBytes(1_500_000)
    const blob = new Blob([bytes.buffer as ArrayBuffer])
    const cached = createBlobSource(blob)
    const plain = createMemorySource(bytes)

    const big = await cached.read(0, 600_000)
    expect(big).toEqual(await plain.read(0, 600_000))
    expect(big.length).toBe(600_000)
    await expect(cached.read(600_000, 700_000)).resolves.toEqual(await plain.read(600_000, 700_000))
  })

  it('returns an empty read at any offset and rejects ranges outside the file', async () => {
    const bytes = randomBytes(1_000)
    const blob = new Blob([bytes.buffer as ArrayBuffer])
    const cached = createBlobSource(blob)

    await expect(cached.read(500, 500)).resolves.toEqual(new Uint8Array(0))
    await expect(cached.read(-1, 10)).rejects.toThrow(RangeError)
    await expect(cached.read(0, 1_001)).rejects.toThrow(RangeError)
    await expect(cached.read(10, 5)).rejects.toThrow(RangeError)
  })

  it('throws when the signal aborts before or during a read', async () => {
    const bytes = randomBytes(1_000)
    const blob = new Blob([bytes.buffer as ArrayBuffer])
    const cached = createBlobSource(blob)

    const controller = new AbortController()
    controller.abort()
    await expect(cached.read(0, 10, controller.signal)).rejects.toThrow()
    await expect(createBlobSource(blob).read(0, 10, controller.signal)).rejects.toThrow()
  })

  it('keeps whole-archive parsing identical to the memory source', async () => {
    const { readArchiveSource } = await import('./guard')
    const { buildZip } = await import('../../../test/zipFixtures')
    const zip = buildZip([
      { name: 'src/a.js', content: 'const a = 1\n' },
      { name: 'src/b.py', content: 'print(1)\n' },
    ])
    const blob = new Blob([zip.buffer as ArrayBuffer])
    const fromMemory = await readArchiveSource(createMemorySource(zip))
    const fromCached = await readArchiveSource(createBlobSource(blob))
    expect(fromCached.refusal).toBeNull()
    expect(fromCached.entries.map((entry) => entry.name)).toEqual(fromMemory.entries.map((entry) => entry.name))
    expect(fromCached.entries.map((entry) => entry.text)).toEqual(fromMemory.entries.map((entry) => entry.text))
    expect(fromCached.stats).toEqual({ ...fromMemory.stats, durationMs: fromCached.stats.durationMs })
  })
})
