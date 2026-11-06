import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARCHIVE_LIMITS,
  HIGH_CAPACITY_ARCHIVE_LIMITS,
  MAX_FINDINGS_STORED,
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
    maxSingleFileUncompressedBytes: limits.maxSingleFileUncompressedBytes / 2,
    maxParsedEntryCount: Math.floor(limits.maxParsedEntryCount / 2),
    maxEntryCount: Math.floor(limits.maxEntryCount / 2),
  }
}

describe('the upload ceilings', () => {
  it('matches the measured numbers for a normal machine', () => {
    expect(DEFAULT_ARCHIVE_LIMITS).toMatchObject({
      maxArchiveBytes: 2 * 1024 * MIB,
      maxTarArchiveBytes: 400 * MIB,
      maxTotalUncompressedBytes: 600 * MIB,
      maxSingleFileUncompressedBytes: 2 * MIB,
      maxParsedEntryCount: 250_000,
      maxEntryCount: 20_000,
      maxCentralDirectoryBytes: 64 * MIB,
      maxDeclaredRatio: 60,
      maxActualRatio: 300,
      maxChunkWallClockMs: 300_000,
    })
    expect(MAX_RETAINED_TEXT_BYTES).toBe(32 * MIB)
    expect(MAX_FINDINGS_STORED).toBe(200_000)
  })

  it('keeps the opt-in tier at the largest budgets a browser was measured to survive', () => {
    // The opt-in tier buys reach in archive bytes, inflated work, analysed entries and clock —
    // the budgets one pass spends — never in freezing the tab. It is opt-in for that reason.
    expect(HIGH_CAPACITY_ARCHIVE_LIMITS.maxArchiveBytes).toBe(8 * 1024 * MIB)
    expect(HIGH_CAPACITY_ARCHIVE_LIMITS.maxTarArchiveBytes).toBe(1024 * MIB)
    expect(HIGH_CAPACITY_ARCHIVE_LIMITS.maxTotalUncompressedBytes).toBe(1024 * MIB)
    expect(HIGH_CAPACITY_ARCHIVE_LIMITS.maxEntryCount).toBe(40_000)
    expect(HIGH_CAPACITY_ARCHIVE_LIMITS.maxChunkWallClockMs).toBe(600_000)
    // A pass walks far more index records than it analyses files: skipping an entry is cheap,
    // analysing one is not, so the parsed cap sits well above the analysed cap.
    expect(DEFAULT_ARCHIVE_LIMITS.maxParsedEntryCount).toBeGreaterThan(DEFAULT_ARCHIVE_LIMITS.maxEntryCount)
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
    expect(small.maxChunkWallClockMs).toBe(DEFAULT_ARCHIVE_LIMITS.maxChunkWallClockMs)
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
    expect(archiveCeilingFor('zip', DEFAULT_ARCHIVE_LIMITS)).toBe(2 * 1024 * MIB)
    expect(archiveCeilingFor('tar', DEFAULT_ARCHIVE_LIMITS)).toBe(400 * MIB)
    expect(archiveCeilingFor('gzip', DEFAULT_ARCHIVE_LIMITS)).toBe(400 * MIB)
    expect(archiveCeilingFor('folder', DEFAULT_ARCHIVE_LIMITS)).toBe(600 * MIB)
    expect(archiveCeilingFor('zip', HIGH_CAPACITY_ARCHIVE_LIMITS)).toBe(8 * 1024 * MIB)
  })
})
