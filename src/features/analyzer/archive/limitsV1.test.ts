import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARCHIVE_LIMITS,
  MAX_RETAINED_TEXT_BYTES,
  limitsForDevice,
  type ArchiveLimits,
} from './limits'

const MIB = 1024 * 1024

function halved(limits: ArchiveLimits): ArchiveLimits {
  return {
    ...limits,
    maxArchiveBytes: limits.maxArchiveBytes / 2,
    maxTotalUncompressedBytes: limits.maxTotalUncompressedBytes / 2,
    maxSingleFileUncompressedBytes: limits.maxSingleFileUncompressedBytes / 2,
    maxEntryCount: Math.floor(limits.maxEntryCount / 2),
  }
}

describe('the v1 upload ceilings', () => {
  it('matches the numbers the brief sets for a normal machine', () => {
    expect(DEFAULT_ARCHIVE_LIMITS).toMatchObject({
      maxArchiveBytes: 25 * MIB,
      maxTotalUncompressedBytes: 150 * MIB,
      maxSingleFileUncompressedBytes: 2 * MIB,
      maxEntryCount: 5_000,
      maxDeclaredRatio: 60,
      maxActualRatio: 300,
      maxWallClockMs: 180_000,
    })
    expect(MAX_RETAINED_TEXT_BYTES).toBe(32 * MIB)
  })

  it('halves the ceilings that hold memory on a 2 GiB device', () => {
    expect(limitsForDevice(2)).toEqual(halved(DEFAULT_ARCHIVE_LIMITS))
    expect(limitsForDevice(0.5)).toEqual(halved(DEFAULT_ARCHIVE_LIMITS))
    expect(limitsForDevice(2)).toEqual(limitsForDevice(1))
  })

  it('leaves the ratio and time ceilings alone when it halves', () => {
    const small = limitsForDevice(2)
    expect(small.maxDeclaredRatio).toBe(DEFAULT_ARCHIVE_LIMITS.maxDeclaredRatio)
    expect(small.maxActualRatio).toBe(DEFAULT_ARCHIVE_LIMITS.maxActualRatio)
    // A slower machine needs the same wall clock, not a shorter one: halving the time budget
    // would refuse a legitimate upload that the same machine could still have read.
    expect(small.maxWallClockMs).toBe(DEFAULT_ARCHIVE_LIMITS.maxWallClockMs)
    expect(small.inflateChunkBytes).toBe(DEFAULT_ARCHIVE_LIMITS.inflateChunkBytes)
  })

  it('keeps the v1 ceilings for a roomy device and for a browser that says nothing', () => {
    expect(limitsForDevice(4)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(8)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(undefined)).toBe(DEFAULT_ARCHIVE_LIMITS)
  })

  it('treats a nonsensical device report as no report at all', () => {
    expect(limitsForDevice(Number.NaN)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(0)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(-4)).toBe(DEFAULT_ARCHIVE_LIMITS)
  })
})
