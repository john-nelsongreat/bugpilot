// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { gzipSync, strToU8 } from 'fflate'
import { readArchive } from './guard'
import { readTar } from './tar'
import { readGzipPayload } from './gzip'
import { readLooseFiles, type IntakeSource } from './readLooseFiles'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'
import { buildZip } from '../../../test/zipFixtures'
import { buildTar } from '../../../test/tarFixtures'

const STOPPED_EVERYWHERE = { ...DEFAULT_ARCHIVE_LIMITS, maxWallClockMs: 0 }

function looseSources(): IntakeSource[] {
  const body = 'const a = 1\n'
  return [
    { path: 'src/a.js', size: body.length, read: async () => strToU8(body) },
    { path: 'src/b.js', size: body.length, read: async () => strToU8(body) },
  ]
}

describe('the wall clock every reader shares', () => {
  it('stops a zip read whose budget is already spent', async () => {
    const result = await readArchive(buildZip([{ name: 'src/a.js', content: 'const a = 1\n' }]), {
      limits: STOPPED_EVERYWHERE,
    })
    expect(result.refusal?.code).toBe('wall_clock_exceeded')
    expect(result.entries).toHaveLength(0)
    expect(result.stats.producedBytes).toBe(0)
  })

  it('stops a tar read whose budget is already spent', async () => {
    const result = await readTar(buildTar([{ name: 'src/a.js', content: 'const a = 1\n' }]), {
      limits: STOPPED_EVERYWHERE,
    })
    expect(result.refusal?.code).toBe('wall_clock_exceeded')
    expect(result.entries).toHaveLength(0)
  })

  it('stops a gzip read whose budget is already spent', async () => {
    const result = await readGzipPayload(gzipSync(strToU8('a = 1\n')), { limits: STOPPED_EVERYWHERE })
    expect(result.refusal?.code).toBe('wall_clock_exceeded')
    expect(result.stats.producedBytes).toBe(0)
  })

  it('stops a folder read whose budget is already spent', async () => {
    const result = await readLooseFiles(looseSources(), { limits: STOPPED_EVERYWHERE })
    expect(result.refusal?.code).toBe('wall_clock_exceeded')
    expect(result.entries).toHaveLength(0)
    expect(result.stats.producedBytes).toBe(0)
  })

  it('says how long it spent, in the message', async () => {
    const result = await readLooseFiles(looseSources(), { limits: { ...DEFAULT_ARCHIVE_LIMITS, maxWallClockMs: 45_000 } })
    expect(result.refusal).toBeNull()
    const stopped = await readLooseFiles(looseSources(), { limits: STOPPED_EVERYWHERE })
    expect(stopped.refusal?.message).toContain('second')
  })

  it('reads the same upload when the budget is the shipped one', async () => {
    const result = await readLooseFiles(looseSources(), { limits: DEFAULT_ARCHIVE_LIMITS })
    expect(result.refusal).toBeNull()
    expect(result.entries.map((entry) => entry.name)).toEqual(['src/a.js', 'src/b.js'])
  })
})
