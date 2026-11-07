import { BINARY_EXTENSIONS, IGNORED_FOLDER_SEGMENTS, NESTED_ARCHIVE_EXTENSIONS, OS_METADATA_FILES } from './limits'
import { extensionOf } from './classify'
import type { ArchiveRefusalCode } from './reasons'

/**
 * The four structural rules a relative path must satisfy, shared by the archive reader and the
 * loose-file drop so the two can never disagree about what "outside the folder" means.
 */
export function relativePathRefusal(name: string): ArchiveRefusalCode | null {
  if (name.startsWith('/')) return 'absolute_path'
  if (/^[a-zA-Z]:/.test(name)) return 'drive_letter_path'
  if (name.split(/[\\/]+/).includes('..')) return 'path_traversal'
  if (name.includes('\\')) return 'backslash_in_path'
  return null
}

/**
 * The ZIP APPNOTE and ustar say entry names use "/" separators, but Windows writers — PowerShell
 * Compress-Archive above all — emit "\". No archive format gives "\" meaning inside a name, so it
 * is normalized the same way Explorer and 7-Zip extract: as a separator. The rules above then run
 * on the normalized name, so a `..\` escape still refuses as traversal. Loose files keep the
 * strict rule: a dropped file really named with a backslash stays refused.
 */
export function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, '/')
}

/**
 * `.git` is never read, even when the user asks for generated files: its objects are compressed
 * history rather than files. Every other ignored folder yields to that checkbox.
 */
export function isIgnoredPath(name: string, includeGenerated = false): boolean {
  return name.split('/').some((segment) => segment === '.git' || (!includeGenerated && IGNORED_FOLDER_SEGMENTS.includes(segment)))
}

/**
 * Files the operating system writes into a folder to remember its icon positions and view
 * settings. They are never source, and a zip from macOS Archive Utility or Windows Explorer is
 * full of them, so they are dropped before their bytes are read.
 */
export function isOsMetadataFile(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1)
  return OS_METADATA_FILES.includes(base)
}

export function isNestedArchive(name: string): boolean {
  return NESTED_ARCHIVE_EXTENSIONS.includes(extensionOf(name))
}

export function hasBinaryExtension(name: string): boolean {
  return BINARY_EXTENSIONS.includes(extensionOf(name))
}
