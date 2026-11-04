import type { ArchiveSkippedEntry } from '../archive/guard'
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from '../archive/limits'
import { isNestedArchive, relativePathRefusal } from '../archive/paths'
import { archiveReasonMessage, type ArchiveRefusalCode } from '../archive/reasons'
import type { IntakeSource } from '../archive/readLooseFiles'

/**
 * Several uploads, one run.
 *
 * A folder picked next to an archive picked earlier, or two folders that both contain `src/app.js`,
 * arrives as a list of uploads. Each one is judged on its own before anything is read: an upload with
 * an unsafe name inside it is set aside whole, with a reason, instead of stopping the other uploads
 * from being checked. What survives is concatenated, so the reader's entry-count and byte ceilings
 * apply to the total rather than to each upload.
 */

export interface CombinedUploads {
  sources: IntakeSource[]
  /** One row per upload that was left out, in the shape the coverage table already understands. */
  notes: ArchiveSkippedEntry[]
}

/** The namespace an upload's files live under: `upload-2/src/app.js`. */
export function uploadLabel(index: number): string {
  return `upload-${index + 1}`
}

/**
 * The structural name problems, phrased for a folder the user picked rather than for an archive: the
 * reader's own sentences say "the archive", which would be a lie about a dropped folder.
 */
function nameProblem(code: ArchiveRefusalCode): string | null {
  switch (code) {
    case 'absolute_path':
      return 'a name starts with "/" and points at your real filesystem'
    case 'drive_letter_path':
      return 'a name carries a Windows drive letter and points at your real filesystem'
    case 'path_traversal':
      return 'a name points out of the folder with ".."'
    case 'backslash_in_path':
      return 'a name uses backslashes where BugPilot expects "/"'
    default:
      return null
  }
}

/**
 * Why this upload cannot be read, or null when it can. Checked on the announced names only: a name
 * that points out of the upload, a name over the length ceiling, a container that would have to be
 * opened from inside an upload, and a name repeated inside the same upload are all decided before a
 * single byte is read.
 */
function refuseUpload(sources: readonly IntakeSource[], limits: ArchiveLimits): string | null {
  const seen = new Set<string>()
  for (const source of sources) {
    // Every reason quotes the offending name, because "this upload was refused" is not actionable.
    const named = (reason: string): string => `${reason} ("${source.path}")`
    if (source.path.includes('\0')) return named('a name contains a hidden NUL byte')
    const problem = relativePathRefusal(source.path)
    if (problem) return named(nameProblem(problem) ?? archiveReasonMessage(problem))
    if (source.path.length > limits.maxEntryNameBytes) {
      return `a name is longer than the ${limits.maxEntryNameBytes}-character ceiling BugPilot reads ("${source.path.slice(0, 40)}…")`
    }
    if (isNestedArchive(source.path)) {
      // A zip added as its own upload is not an archive inside an archive, so the reader's sentence
      // would misdescribe it; this one says what to do instead.
      return (
        `"${source.path}" is itself an archive. BugPilot opens one archive per run, so Clear and pick the archive on its own, ` +
        'or add loose files and folders here'
      )
    }
    if (seen.has(source.path)) return `a name appears twice in this upload ("${source.path}")`
    seen.add(source.path)
  }
  return null
}

export function combineUploads(
  uploads: readonly (readonly IntakeSource[])[],
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): CombinedUploads {
  const sources: IntakeSource[] = []
  const notes: ArchiveSkippedEntry[] = []

  uploads.forEach((upload, index) => {
    const label = uploadLabel(index)
    const reason = refuseUpload(upload, limits)
    if (reason !== null) {
      notes.push({
        name: label,
        code: 'source_set_aside',
        message: archiveReasonMessage('source_set_aside', label, reason),
      })
      return
    }
    // A lone upload keeps the names the user knows; namespaces only exist to separate two uploads.
    const prefix = uploads.length === 1 ? '' : `${label}/`
    for (const source of upload) sources.push({ ...source, path: `${prefix}${source.path}` })
  })

  return { sources, notes }
}
