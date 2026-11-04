import type { IntakeSource } from '../archive/readLooseFiles'

/**
 * Pasted code is a file the browser never saw. It goes through the same reader, the same ceilings
 * and the same in-memory retention as a picked file, so the only difference is where the bytes come
 * from: a string in this tab, encoded once, and dropped by Clear.
 */

/** One MiB of UTF-8, which is what a paste is allowed to occupy in this tab. */
export const MAX_PASTED_BYTES = 1024 * 1024

/** The names a paste can be given, so the language rules still have something to read. */
export const PASTE_LANGUAGES: readonly { extension: string; label: string }[] = [
  { extension: 'txt', label: 'Plain text' },
  { extension: 'py', label: 'Python' },
  { extension: 'js', label: 'JavaScript' },
  { extension: 'ts', label: 'TypeScript' },
  { extension: 'json', label: 'JSON' },
  { extension: 'yml', label: 'YAML' },
  { extension: 'sh', label: 'Shell script' },
]

export const DEFAULT_PASTE_EXTENSION = 'txt'

export type PastedSource =
  | { ok: true; source: IntakeSource }
  | { ok: false; /** Plain-language reason the paste was refused. */ refusal: string }

function mebibytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(2)} MiB`
}

/**
 * The paste becomes one source whose `read` returns the bytes already held in this tab. The byte
 * count is UTF-8, not `text.length`, because that is what the reader's ceilings are written in.
 */
export function pastedSource(text: string, extension: string): PastedSource {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length === 0) {
    return { ok: false, refusal: 'Nothing was pasted, so there is no text to check.' }
  }
  if (bytes.length > MAX_PASTED_BYTES) {
    return {
      ok: false,
      refusal:
        `The pasted text is ${bytes.length.toLocaleString('en-US')} bytes (${mebibytes(bytes.length)}), over the 1 MiB ceiling ` +
        'BugPilot keeps for a paste. Paste a smaller piece, or pick the file instead.',
    }
  }
  return { ok: true, source: { path: `pasted/snippet.${extension}`, size: bytes.length, read: async () => bytes } }
}
