import { DEFAULT_ARCHIVE_LIMITS } from '../archive/limits'
import { isIgnoredPath } from '../archive/paths'
import { isAbortError } from '../archive/bounds'
import type { IntakeSource } from '../archive/readLooseFiles'
import { yieldToMain } from '../yieldToMain'

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

export interface WalkOptions {
  /** Descend into vendored and generated folders too. `.git` is never descended. */
  includeGenerated?: boolean
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

async function collectEntry(entry: DroppedEntry, out: IntakeSource[], options: WalkOptions): Promise<void> {
  if (out.length > MAX_COLLECTED_SOURCES) return

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    out.push(sourceForFile(file, entryPath(entry, file)))
    return
  }

  // A folder the reader would only skip anyway is never walked into: a drag of a whole checkout
  // must not spend minutes enumerating hundreds of thousands of files it will refuse to read.
  const dirPath = entryPath(entry)
  if (isIgnoredPath(dirPath, options.includeGenerated === true)) return

  const reader = entry.createReader()
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return
    for (const child of batch) {
      if (out.length > MAX_COLLECTED_SOURCES) return
      if (child.isDirectory && isIgnoredPath(entryPath(child), options.includeGenerated === true)) continue
      await collectEntry(child, out, options)
      await yieldToMain()
    }
  }
}

/**
 * Folder drops arrive as FileSystemEntry trees, which have to be walked asynchronously.
 * Returns null when the browser exposes no entry API, so the caller can fall back to files.
 */
export async function sourcesFromDrop(dataTransfer: DataTransfer, options: WalkOptions = {}): Promise<IntakeSource[] | null> {
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
    await collectEntry(entry, sources, options)
  }
  return sources
}

/** The File System Access picker, a Chromium-only API the folder button prefers when present. */
export function supportsDirectoryPicker(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

interface PickerFileHandle {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
}

interface PickerDirectoryHandle {
  kind: 'directory'
  name: string
  values: () => AsyncIterableIterator<PickerHandle>
}

type PickerHandle = PickerFileHandle | PickerDirectoryHandle

async function collectHandle(
  handle: PickerDirectoryHandle,
  prefix: string,
  out: IntakeSource[],
  includeGenerated: boolean,
): Promise<void> {
  for await (const child of handle.values()) {
    if (out.length > MAX_COLLECTED_SOURCES) return
    const path = prefix === '' ? child.name : `${prefix}/${child.name}`
    if (child.kind === 'directory') {
      if (isIgnoredPath(path, includeGenerated)) continue
      await collectHandle(child, path, out, includeGenerated)
    } else {
      out.push(sourceForFile(await child.getFile(), path))
    }
    await yieldToMain()
  }
}

/**
 * Opens the folder picker on a browser that has it and walks the picked tree under the same rules
 * as a drop: ignored folders are never descended into, and the walk yields between children so a
 * huge tree cannot pin the tab. Returns null when the user closed the picker without choosing;
 * a real failure is thrown so the page can say what went wrong.
 */
export async function sourcesFromDirectoryPicker(includeGenerated = false): Promise<IntakeSource[] | null> {
  const picker = (globalThis as {
    showDirectoryPicker?: () => Promise<PickerDirectoryHandle>
  }).showDirectoryPicker
  if (typeof picker !== 'function') return null

  let root: PickerDirectoryHandle
  try {
    root = await picker()
  } catch (error) {
    if (isAbortError(error)) return null
    throw error
  }

  const sources: IntakeSource[] = []
  await collectHandle(root, '', sources, includeGenerated)
  return sources
}
