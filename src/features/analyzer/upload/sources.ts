import { DEFAULT_ARCHIVE_LIMITS } from '../archive/limits'
import type { IntakeSource } from '../archive/readLooseFiles'

/** One past the reader's own cap: the extra item is enough to make the reader refuse the run. */
export const MAX_COLLECTED_SOURCES = DEFAULT_ARCHIVE_LIMITS.maxEntryCount + 1

export function isZipFile(file: File): boolean {
  return /\.zip$/i.test(file.name)
}

export function sourceForFile(file: File, path: string): IntakeSource {
  return {
    path,
    size: file.size,
    file,
    read: async () => {
      const buffer = await file.arrayBuffer()
      return new Uint8Array(buffer)
    },
  }
}

export function sourcesFromFiles(files: readonly File[]): IntakeSource[] {
  return files
    .slice(0, MAX_COLLECTED_SOURCES)
    .map((file) => sourceForFile(file, file.webkitRelativePath || file.name))
}

interface DroppedFileEntry {
  isFile: true
  isDirectory: false
  fullPath: string
  file: (onSuccess: (file: File) => void, onError?: (error: unknown) => void) => void
}

interface DroppedDirectoryEntry {
  isFile: false
  isDirectory: true
  fullPath: string
  createReader: () => {
    readEntries: (
      onSuccess: (entries: DroppedEntry[]) => void,
      onError?: (error: unknown) => void,
    ) => void
  }
}

type DroppedEntry = DroppedFileEntry | DroppedDirectoryEntry

function entryPath(entry: DroppedEntry, file?: File): string {
  const trimmed = entry.fullPath.replace(/^\/+/, '')
  return trimmed === '' ? (file?.name ?? 'dropped-file') : trimmed
}

async function collectEntry(entry: DroppedEntry, out: IntakeSource[]): Promise<void> {
  if (out.length > MAX_COLLECTED_SOURCES) return

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    out.push(sourceForFile(file, entryPath(entry, file)))
    return
  }

  const reader = entry.createReader()
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return
    for (const child of batch) {
      await collectEntry(child, out)
      if (out.length > MAX_COLLECTED_SOURCES) return
    }
  }
}

/**
 * Folder drops arrive as FileSystemEntry trees, which have to be walked asynchronously.
 * Returns null when the browser exposes no entry API, so the caller can fall back to files.
 */
export async function sourcesFromDrop(dataTransfer: DataTransfer): Promise<IntakeSource[] | null> {
  const items = Array.from(dataTransfer.items ?? [])
  const entries = items
    .map((item) => {
      const accessor = item as unknown as { webkitGetAsEntry?: () => DroppedEntry | null }
      return typeof accessor.webkitGetAsEntry === 'function' ? accessor.webkitGetAsEntry() : null
    })
    .filter((entry): entry is DroppedEntry => entry !== null)

  if (entries.length === 0) return null

  const sources: IntakeSource[] = []
  for (const entry of entries) {
    if (sources.length > MAX_COLLECTED_SOURCES) break
    await collectEntry(entry, sources)
  }
  return sources
}
