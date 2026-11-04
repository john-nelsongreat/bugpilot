import { detectLanguage, type LanguageSource, type SourceLanguage } from './classify'
import { isWallClockSpent, wallClockSeconds } from './bounds'
import { decodeBytes, looksBinary, type TextEncoding } from './decode'
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './limits'
import type { ArchiveEntry, ArchiveReadProgress, ArchiveReadResult, ArchiveReadStats, ArchiveRefusal, ArchiveSkippedEntry } from './guard'
import { hasBinaryExtension, isIgnoredPath, isNestedArchive, relativePathRefusal } from './paths'
import { archiveReasonMessage, type ArchiveRefusalCode } from './reasons'

/**
 * One picked file or folder entry. `size` is announced by the browser and is used to refuse a
 * file before its bytes are read; `read` is only ever called for a file that survived validation.
 */
export interface IntakeSource {
  path: string
  size: number
  read: () => Promise<Uint8Array>
}

export interface ReadLooseFilesOptions {
  limits?: ArchiveLimits
  signal?: AbortSignal
  onProgress?: (progress: ArchiveReadProgress) => void
}

export type LooseFilesResult = ArchiveReadResult
export type {
  ArchiveEntry,
  ArchiveRefusal,
  ArchiveSkippedEntry,
  ArchiveReadProgress,
  ArchiveReadStats,
  SourceLanguage,
  LanguageSource,
  TextEncoding,
}

export async function readLooseFiles(
  sources: readonly IntakeSource[],
  options: ReadLooseFilesOptions = {},
): Promise<LooseFilesResult> {
  const limits = options.limits ?? DEFAULT_ARCHIVE_LIMITS
  const signal = options.signal
  const started = Date.now()
  const entries: ArchiveEntry[] = []
  const skipped: ArchiveSkippedEntry[] = []
  const stats: ArchiveReadStats = { walkedRecords: 0, producedBytes: 0, entries: 0, skipped: 0, durationMs: 0, peakEntryBytes: 0 }

  const finish = (refusal: ArchiveRefusal | null): LooseFilesResult => ({
    refusal,
    entries: refusal ? [] : entries,
    skipped: refusal ? [] : skipped,
    stats: { ...stats, durationMs: Date.now() - started },
  })
  const fail = (code: ArchiveRefusalCode, subject: string | number = ''): LooseFilesResult =>
    finish({ code, message: archiveReasonMessage(code, subject) })
  const report = (phase: 'walk' | 'extract'): void => {
    options.onProgress?.({
      phase,
      walkedRecords: stats.walkedRecords,
      extractedEntries: entries.length,
      producedBytes: stats.producedBytes,
    })
  }

  if (signal?.aborted) return fail('cancelled')

  const accepted: IntakeSource[] = []
  const seen = new Set<string>()
  let declaredTotal = 0
  for (const item of sources) {
    if (signal?.aborted) return fail('cancelled')
    if (isWallClockSpent(limits, started)) return fail('wall_clock_exceeded', wallClockSeconds(limits))
    stats.walkedRecords += 1
    if (stats.walkedRecords > limits.maxEntryCount) return fail('entry_count_exceeded', limits.maxEntryCount)
    const pathProblem = relativePathRefusal(item.path)
    if (pathProblem) return fail(pathProblem)
    if (item.path.length > limits.maxEntryNameBytes) return fail('name_too_long', item.path.length)
    if (seen.has(item.path)) return fail('duplicate_name', item.path)
    seen.add(item.path)
    // A dropped folder is a container too, so an archive inside it is refused exactly the way
    // an archive inside an archive is.
    if (isNestedArchive(item.path)) return fail('nested_archive', item.path)

    const skipCode = skipCodeFor(item, limits)
    if (skipCode) {
      skipped.push({ name: item.path, code: skipCode, message: archiveReasonMessage(skipCode, item.path) })
      continue
    }
    declaredTotal += item.size
    if (declaredTotal > limits.maxTotalUncompressedBytes) {
      return fail('total_uncompressed_exceeded', limits.maxTotalUncompressedBytes)
    }
    accepted.push(item)
  }
  report('walk')

  for (const item of accepted) {
    if (signal?.aborted) return fail('cancelled')
    // A folder read spends its time inside the browser's own file reads, which no slice yield
    // can interrupt, so the clock is checked here rather than only between chunks.
    if (isWallClockSpent(limits, started)) return fail('wall_clock_exceeded', wallClockSeconds(limits))
    const bytes = await item.read()
    if (bytes.length > item.size) return fail('declared_size_understated')
    if (stats.producedBytes + bytes.length > limits.maxTotalUncompressedBytes) {
      return fail('total_uncompressed_exceeded', limits.maxTotalUncompressedBytes)
    }
    if (looksBinary(bytes)) {
      skipped.push({
        name: item.path,
        code: 'binary_content',
        message: archiveReasonMessage('binary_content', item.path),
      })
      continue
    }
    const decoded = decodeBytes(bytes)
    const detection = detectLanguage(item.path, decoded.text)
    entries.push({
      name: item.path,
      text: decoded.text,
      language: detection.language,
      languageSource: detection.source,
      encoding: decoded.encoding,
      bytes: bytes.length,
    })
    stats.producedBytes += bytes.length
    stats.peakEntryBytes = Math.max(stats.peakEntryBytes, bytes.length)
    report('extract')
  }

  return finish(null)
}

function skipCodeFor(item: IntakeSource, limits: ArchiveLimits) {
  if (isIgnoredPath(item.path)) return 'ignored_folder' as const
  if (hasBinaryExtension(item.path)) return 'binary_content' as const
  if (item.size === 0) return 'empty_entry' as const
  if (item.size > limits.maxSingleFileUncompressedBytes) return 'single_file_too_large' as const
  return null
}
