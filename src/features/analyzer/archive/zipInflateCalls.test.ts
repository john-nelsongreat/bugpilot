import { describe, expect, it, vi } from 'vitest'
import { buildZip } from '../../../test/zipFixtures'

/**
 * Every deflated entry the reader accepts needs exactly one `Inflate`. Counting the constructions
 * proves what the byte-range test can only imply: an entry skipped from the index is never
 * decompressed at all.
 */
const counters = vi.hoisted(() => ({ inflateCalls: 0 }))

vi.mock('fflate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fflate')>()
  function CountingInflate(
    ...args: ConstructorParameters<typeof actual.Inflate>
  ): InstanceType<typeof actual.Inflate> {
    counters.inflateCalls += 1
    return new actual.Inflate(...args)
  }
  return { ...actual, Inflate: CountingInflate as unknown as typeof actual.Inflate }
})

import { createMemorySource, readArchiveSource } from './guard'

describe('random-access zip: inflate calls follow the classification', () => {
  it('never constructs an inflater for an ignored folder or a binary entry', async () => {
    counters.inflateCalls = 0
    const bytes = buildZip([
      { name: 'node_modules/pkg/index.js', content: 'x'.repeat(100_000), method: 8 },
      { name: 'assets/photo.png', content: new Uint8Array(64 * 1024).fill(0x89), method: 8 },
      { name: 'src/app.js', content: 'export const app = 1\n', method: 8 },
    ])

    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/app.js'])
    expect(counters.inflateCalls).toBe(1)
  })

  it('counts one inflater per accepted deflated entry', async () => {
    counters.inflateCalls = 0
    const bytes = buildZip([
      { name: 'src/a.js', content: 'export const a = 1\n', method: 8 },
      { name: 'src/b.js', content: 'export const b = 2\n', method: 8 },
    ])

    const result = await readArchiveSource(createMemorySource(bytes))

    expect(result.refusal).toBeNull()
    expect(result.entries).toHaveLength(2)
    expect(counters.inflateCalls).toBe(2)
  })
})
