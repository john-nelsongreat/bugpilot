import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARCHIVE_LIMITS,
  HIGH_CAPACITY_ARCHIVE_LIMITS,
  MAX_RETAINED_TEXT_BYTES,
  archiveCeilingFor,
  limitsForDevice,
  type ArchiveLimits,
} from './limits'

const MIB = 1024 * 1024

function halved(limits: ArchiveLimits): ArchiveLimits {
  return {
    ...limits,
    maxArchiveBytes: limits.maxArchiveBytes / 2,
    maxTarArchiveBytes: limits.maxTarArchiveBytes / 2,
    maxTotalUncompressedBytes: limits.maxTotalUncompressedBytes / 2,
    maxAnalysableTextBytes: limits.maxAnalysableTextBytes / 2,
    maxSingleFileUncompressedBytes: limits.maxSingleFileUncompressedBytes / 2,
    maxEntryCount: Math.floor(limits.maxEntryCount / 2),
  }
}

describe('the upload ceilings', () => {
  it('matches the measured numbers for a normal machine', () => {
    expect(DEFAULT_ARCHIVE_LIMITS).toMatchObject({
      maxArchiveBytes: 250 * MIB,
      maxTarArchiveBytes: 100 * MIB,
      maxTotalUncompressedBytes: 600 * MIB,
      maxAnalysableTextBytes: 12 * MIB,
      maxSingleFileUncompressedBytes: 2 * MIB,
      maxEntryCount: 20_000,
      maxCentralDirectoryBytes: 16 * MIB,
      maxDeclaredRatio: 60,
      maxActualRatio: 300,
      maxWallClockMs: 300_000,
    })
    expect(MAX_RETAINED_TEXT_BYTES).toBe(32 * MIB)
  })

  it('keeps the opt-in tier at the largest analysed amount that was measured in a browser', () => {
    // 20 MiB of analysed text measured a 281 ms task with no findings at all, and 150 MiB measured
    // 2,537 ms with a 1,049 MiB process tree. The opt-in tier stops where the pause is still under a
    // second, and buys its extra reach with archive bytes, work and time instead.
    expect(HIGH_CAPACITY_ARCHIVE_LIMITS.maxAnalysableTextBytes).toBe(40 * MIB)
    // The normal tier never retains more text than the session can hold, so the deep pass always
    // works from the complete set here; the retention cut-in belongs to the opt-in tier.
    expect(DEFAULT_ARCHIVE_LIMITS.maxAnalysableTextBytes).toBeLessThan(MAX_RETAINED_TEXT_BYTES)
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

  it('keeps the normal ceilings for a roomy device and for a browser that says nothing', () => {
    expect(limitsForDevice(4)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(8)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(undefined)).toBe(DEFAULT_ARCHIVE_LIMITS)
  })

  it('treats a nonsensical device report as no report at all', () => {
    expect(limitsForDevice(Number.NaN)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(0)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(-4)).toBe(DEFAULT_ARCHIVE_LIMITS)
  })

  it('opens the high-capacity tier only for an 8 GiB report plus the opt-in', () => {
    expect(limitsForDevice(8, true)).toBe(HIGH_CAPACITY_ARCHIVE_LIMITS)
    expect(limitsForDevice(16, true)).toBe(HIGH_CAPACITY_ARCHIVE_LIMITS)
    expect(limitsForDevice(4, true)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(8, false)).toBe(DEFAULT_ARCHIVE_LIMITS)
    expect(limitsForDevice(undefined, true)).toBe(DEFAULT_ARCHIVE_LIMITS)
  })

  it('never lets the opt-in override a small device', () => {
    expect(limitsForDevice(2, true)).toEqual(halved(DEFAULT_ARCHIVE_LIMITS))
    expect(limitsForDevice(0.5, true)).toEqual(halved(DEFAULT_ARCHIVE_LIMITS))
  })

  it('reports the ceiling that applies to each upload shape', () => {
    expect(archiveCeilingFor('zip', DEFAULT_ARCHIVE_LIMITS)).toBe(250 * MIB)
    expect(archiveCeilingFor('tar', DEFAULT_ARCHIVE_LIMITS)).toBe(100 * MIB)
    expect(archiveCeilingFor('gzip', DEFAULT_ARCHIVE_LIMITS)).toBe(100 * MIB)
    expect(archiveCeilingFor('folder', DEFAULT_ARCHIVE_LIMITS)).toBe(600 * MIB)
    expect(archiveCeilingFor('zip', HIGH_CAPACITY_ARCHIVE_LIMITS)).toBe(500 * MIB)
  })
})
