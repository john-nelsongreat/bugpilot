import { BINARY_EXTENSIONS, IGNORED_FOLDER_SEGMENTS, NESTED_ARCHIVE_EXTENSIONS } from './limits'
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

export function isIgnoredPath(name: string): boolean {
  return name.split('/').some((segment) => IGNORED_FOLDER_SEGMENTS.includes(segment))
}

export function isNestedArchive(name: string): boolean {
  return NESTED_ARCHIVE_EXTENSIONS.includes(extensionOf(name))
}

export function hasBinaryExtension(name: string): boolean {
  return BINARY_EXTENSIONS.includes(extensionOf(name))
}
