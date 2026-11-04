export interface ArchiveLimits {
  /** Refuse the archive outright before any header is read. */
  maxArchiveBytes: number
  /** Sum of uncompressed bytes across every entry. */
  maxTotalUncompressedBytes: number
  /** A single entry bigger than this is skipped with a reason, not fatal. */
  maxSingleFileUncompressedBytes: number
  /** Counted on records actually walked, not on the number the archive declares. */
  maxEntryCount: number
  /** One entry name longer than this is treated as a crafted archive, not a file. */
  maxEntryNameBytes: number
  /** declaredUncompressed / declaredCompressed, checked before inflating. */
  maxDeclaredRatio: number
  /** bytes actually produced / compressed bytes, checked while inflating. */
  maxActualRatio: number
  /** Wall clock for one read. A huge archive is stopped rather than left to run out the tab. */
  maxWallClockMs: number
  /** fflate push size. 4 096 measured as the knee: same overshoot as 1 024 at 2.8x throughput. */
  inflateChunkBytes: number
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxTotalUncompressedBytes: 150 * 1024 * 1024,
  maxSingleFileUncompressedBytes: 2 * 1024 * 1024,
  maxEntryCount: 5_000,
  maxEntryNameBytes: 1_024,
  maxDeclaredRatio: 60,
  maxActualRatio: 300,
  maxWallClockMs: 180_000,
  inflateChunkBytes: 4_096,
}

/**
 * How much analysed text the session may keep in memory so the fix review can build edits.
 * Above it only the files that produced findings are kept: a tab that cannot hold the whole
 * upload should still be able to hold the part the user will act on.
 */
export const MAX_RETAINED_TEXT_BYTES = 32 * 1024 * 1024

/** `navigator.deviceMemory` at or below this many GiB means the tab shares a small machine. */
const SMALL_DEVICE_MEMORY_GIB = 2

/**
 * The ceilings for this machine. `navigator.deviceMemory` is a coarse, rounded figure (0.5, 1, 2,
 * 4, 8) and is missing altogether in Safari and Firefox, so an absent or nonsensical report keeps
 * the normal ceilings rather than guessing. Only the ceilings that decide how many bytes stay in
 * memory are halved: the ratio ceilings are security limits, and a slow machine needs the same
 * wall clock as a fast one — halving the time budget would refuse an upload the device could read.
 */
export function limitsForDevice(deviceMemoryGiB: number | undefined): ArchiveLimits {
  const small =
    typeof deviceMemoryGiB === 'number' &&
    Number.isFinite(deviceMemoryGiB) &&
    deviceMemoryGiB > 0 &&
    deviceMemoryGiB <= SMALL_DEVICE_MEMORY_GIB
  if (!small) return DEFAULT_ARCHIVE_LIMITS
  return {
    ...DEFAULT_ARCHIVE_LIMITS,
    maxArchiveBytes: DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes / 2,
    maxTotalUncompressedBytes: DEFAULT_ARCHIVE_LIMITS.maxTotalUncompressedBytes / 2,
    maxSingleFileUncompressedBytes: DEFAULT_ARCHIVE_LIMITS.maxSingleFileUncompressedBytes / 2,
    maxEntryCount: Math.floor(DEFAULT_ARCHIVE_LIMITS.maxEntryCount / 2),
  }
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
]

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
