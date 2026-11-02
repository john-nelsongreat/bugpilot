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
  /** fflate push size. 4 096 measured as the knee: same overshoot as 1 024 at 2.8x throughput. */
  inflateChunkBytes: number
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxSingleFileUncompressedBytes: 2 * 1024 * 1024,
  maxEntryCount: 2_000,
  maxEntryNameBytes: 1_024,
  maxDeclaredRatio: 60,
  maxActualRatio: 300,
  inflateChunkBytes: 4_096,
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
