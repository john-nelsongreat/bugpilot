export interface ArchiveLimits {
  /** Zip archive bytes. The zip is read by seeking, so these bytes are never all held. */
  maxArchiveBytes: number
  /** tar and tar.gz archive bytes. Sequential formats are held while they are walked. */
  maxTarArchiveBytes: number
  /**
   * Work budget for ONE pass: uncompressed bytes really produced while unpacking, including
   * entries that turn out to be binary. A pass that reaches it stops and keeps what it read,
   * and the user continues from the original file with a new pass.
   */
  maxTotalUncompressedBytes: number
  /** A single entry bigger than this is skipped with a reason, not fatal. */
  maxSingleFileUncompressedBytes: number
  /**
   * Index records one pass may parse. This is a walk ceiling, not an analysis ceiling: it bounds
   * the record list the reader builds so a huge index cannot fill the tab even before any file
   * is chosen.
   */
  maxParsedEntryCount: number
  /**
   * Files one pass may analyse. Skipped entries never count toward it, so an archive that is
   * mostly node_modules can hold far more records than this cap.
   */
  maxEntryCount: number
  /** One entry name longer than this is treated as a crafted archive, not a file. */
  maxEntryNameBytes: number
  /** The index is read in one bounded slice; a bigger one is refused before it is parsed. */
  maxCentralDirectoryBytes: number
  /** declaredUncompressed / declaredCompressed, checked before inflating. */
  maxDeclaredRatio: number
  /** bytes actually produced / compressed bytes, checked while inflating. */
  maxActualRatio: number
  /** Wall clock for one pass. A pass that runs out stops and keeps what it read. */
  maxChunkWallClockMs: number
  /** fflate push size. 4 096 measured as the knee: same overshoot as 1 024 at 2.8x throughput. */
  inflateChunkBytes: number
}

/**
 * The caps for a normal machine. The zip cap is far above the tar cap because a zip can skip
 * node_modules and images without inflating them, while a tar has to walk every byte. Analysis
 * is bounded by the entry cap and the findings store rather than by a byte ceiling on collected
 * text: one pass reads up to its work budget for as long as its clock allows, and a pass that
 * stops keeps what it read for the user to continue from.
 */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 2 * 1024 * 1024 * 1024,
  maxTarArchiveBytes: 400 * 1024 * 1024,
  maxTotalUncompressedBytes: 600 * 1024 * 1024,
  maxSingleFileUncompressedBytes: 2 * 1024 * 1024,
  maxParsedEntryCount: 250_000,
  maxEntryCount: 20_000,
  maxEntryNameBytes: 1_024,
  maxCentralDirectoryBytes: 64 * 1024 * 1024,
  maxDeclaredRatio: 60,
  maxActualRatio: 300,
  maxChunkWallClockMs: 300_000,
  inflateChunkBytes: 4_096,
}

/**
 * The opt-in tier for a machine that reports at least 8 GiB and a user who ticked "Large project
 * mode". It raises every budget that costs memory, with the plain warning shown before upload.
 * It is never selected automatically: `navigator.deviceMemory` is a coarse hint, not a promise.
 * The extra reach of this tier is in archive bytes, inflated work, entry count and clock, not in
 * freezing the tab.
 */
export const HIGH_CAPACITY_ARCHIVE_LIMITS: ArchiveLimits = {
  ...DEFAULT_ARCHIVE_LIMITS,
  maxArchiveBytes: 8 * 1024 * 1024 * 1024,
  maxTarArchiveBytes: 1024 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxEntryCount: 40_000,
  maxChunkWallClockMs: 600_000,
}

/** `navigator.deviceMemory` at or above this many GiB may opt into the high-capacity tier. */
export const HIGH_CAPACITY_DEVICE_MEMORY_GIB = 8

/**
 * How much analysed text the session may keep in memory so the fix review can build edits.
 * Above it only the files that produced findings are kept: a tab that cannot hold the whole
 * upload should still be able to hold the part the user will act on.
 */
export const MAX_RETAINED_TEXT_BYTES = 32 * 1024 * 1024

/**
 * How many findings the report stores, however many the rules matched. Everything past the cap
 * is counted per rule and named in the report, so a rule that fires on every line of a generated
 * file cannot push the rest of the report out of the tab's memory.
 */
export const MAX_FINDINGS_STORED = 200_000

/** `navigator.deviceMemory` at or below this many GiB means the tab shares a small machine. */
const SMALL_DEVICE_MEMORY_GIB = 2

/**
 * The ceilings for this machine. `navigator.deviceMemory` is a coarse, rounded figure (0.5, 1, 2,
 * 4, 8) and is missing altogether in Safari and Firefox, so an absent or nonsensical report keeps
 * the normal ceilings rather than guessing. Only the ceilings that decide how many bytes stay in
 * memory are halved: the ratio ceilings are security limits, and a slow machine needs the same
 * wall clock as a fast one — halving the time budget would refuse an upload the device could read.
 */
export function limitsForDevice(deviceMemoryGiB: number | undefined, largeProjectMode = false): ArchiveLimits {
  const known =
    typeof deviceMemoryGiB === 'number' && Number.isFinite(deviceMemoryGiB) && deviceMemoryGiB > 0
  const small = known && deviceMemoryGiB <= SMALL_DEVICE_MEMORY_GIB
  if (small) {
    return {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxArchiveBytes: DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes / 2,
      maxTarArchiveBytes: DEFAULT_ARCHIVE_LIMITS.maxTarArchiveBytes / 2,
      maxTotalUncompressedBytes: DEFAULT_ARCHIVE_LIMITS.maxTotalUncompressedBytes / 2,
      maxSingleFileUncompressedBytes: DEFAULT_ARCHIVE_LIMITS.maxSingleFileUncompressedBytes / 2,
      maxParsedEntryCount: Math.floor(DEFAULT_ARCHIVE_LIMITS.maxParsedEntryCount / 2),
      maxEntryCount: Math.floor(DEFAULT_ARCHIVE_LIMITS.maxEntryCount / 2),
    }
  }
  const high = largeProjectMode && known && deviceMemoryGiB >= HIGH_CAPACITY_DEVICE_MEMORY_GIB
  return high ? HIGH_CAPACITY_ARCHIVE_LIMITS : DEFAULT_ARCHIVE_LIMITS
}

/** The archive bytes a format is checked against before a header is read. */
export function archiveCeilingFor(format: 'zip' | 'tar' | 'gzip' | 'folder', limits: ArchiveLimits): number {
  if (format === 'zip') return limits.maxArchiveBytes
  if (format === 'folder') return limits.maxTotalUncompressedBytes
  return Math.min(limits.maxArchiveBytes, limits.maxTarArchiveBytes)
}

/** Path segments that are never analysed: generated or vendored trees. */
export const IGNORED_FOLDER_SEGMENTS: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  '.gradle',
  '.terraform',
  '__MACOSX',
]

/** Files the operating system leaves behind in a folder; no editor writes them. */
export const OS_METADATA_FILES: readonly string[] = ['.DS_Store', 'Thumbs.db', 'desktop.ini']

/** Archives that must never be re-opened from inside an archive. */
export const NESTED_ARCHIVE_EXTENSIONS: readonly string[] = [
  'zip',
  'jar',
  'war',
  'ear',
  'apk',
  'aab',
  'egg',
  'whl',
  'nupkg',
  'vsix',
  'crate',
  'rpm',
  'deb',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'zst',
]

export const BINARY_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'cur',
  'tif',
  'tiff',
  'heic',
  'avif',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'mp4',
  'm4v',
  'mov',
  'webm',
  'avi',
  'mkv',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'otf',
  'ttf',
  'woff',
  'woff2',
  'eot',
  'so',
  'dll',
  'dylib',
  'exe',
  'msi',
  'class',
  'pyc',
  'pyo',
  'o',
  'a',
  'obj',
  'lib',
  'wasm',
  'dat',
  'db',
  'sqlite',
  'lockb',
  'pack',
  'mpg',
  'iso',
  'img',
]
