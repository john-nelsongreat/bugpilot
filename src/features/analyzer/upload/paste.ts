import { detectLanguage, type SourceLanguage } from '../archive/classify'
import type { IntakeSource } from '../archive/readLooseFiles'

/**
 * Pasted code is a file the browser never saw. It goes through the same reader, the same ceilings
 * and the same in-memory retention as a picked file, so the only difference is where the bytes come
 * from: a string in this tab, encoded once, and dropped by Clear.
 */

/** One MiB of UTF-8, which is what a paste is allowed to occupy in this tab. */
export const MAX_PASTED_BYTES = 1024 * 1024

/** The longest virtual name a paste may carry; the report shows the whole name it accepted. */
export const MAX_PASTED_NAME_LENGTH = 80

/** `auto` leaves the language to the same detector that reads a picked file's name and content. */
export const PASTE_AUTO = 'auto'

/** The names a paste can be given, so the language rules still have something to read. */
export const PASTE_LANGUAGES: readonly { extension: string; label: string }[] = [
  { extension: PASTE_AUTO, label: 'Auto (detect from the name or the text)' },
  { extension: 'txt', label: 'Plain text' },
  { extension: 'py', label: 'Python' },
  { extension: 'js', label: 'JavaScript' },
  { extension: 'ts', label: 'TypeScript' },
  { extension: 'json', label: 'JSON' },
  { extension: 'yml', label: 'YAML' },
  { extension: 'sh', label: 'Shell script' },
]

export const DEFAULT_PASTE_EXTENSION = PASTE_AUTO

export type PastedSource =
  | { ok: true; source: IntakeSource }
  | { ok: false; /** Plain-language reason the paste was refused. */ refusal: string }

function mebibytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(2)} MiB`
}

/** The extensions the content detector can recognise; anything else stays plain text. */
const DETECTED_EXTENSIONS: Partial<Record<SourceLanguage, string>> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  shell: 'sh',
  ruby: 'rb',
  php: 'php',
}

/**
 * The optional virtual name is a label, not a path: only its last segment is kept, control
 * characters are removed, and the result is bounded. Anything the user typed that looks like a
 * directory is discarded rather than reproduced in the report.
 */
function virtualName(virtualName: string, extension: string, text: string): string {
  const lastSegment = virtualName.split(/[\\/]/).pop() ?? ''
  let name = lastSegment
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
  if (name === '' || name === '.' || name === '..') name = 'snippet'
  if (extension !== PASTE_AUTO) {
    const dot = name.lastIndexOf('.')
    // The chosen language decides the rules, so the name is given that extension; a name that
    // already has another one is replaced rather than doubled (`.env` keeps its leading dot).
    name = dot > 0 ? `${name.slice(0, dot)}.${extension}` : `${name}.${extension}`
  } else if (!name.includes('.')) {
    // Auto leans on the same detector a picked file goes through; the extension it returns only
    // labels the name, since the session classifies the final path again.
    const detected = DETECTED_EXTENSIONS[detectLanguage(name, text).language]
    name = `${name}.${detected ?? 'txt'}`
  }
  return name.length > MAX_PASTED_NAME_LENGTH ? name.slice(name.length - MAX_PASTED_NAME_LENGTH) : name
}

/**
 * The paste becomes one source whose `read` returns the bytes already held in this tab. The byte
 * count is UTF-8, not `text.length`, because that is what the reader's ceilings are written in.
 * With Auto, the chosen name travels unchanged and the normal detector decides the language; with
 * an explicit language, the name is given that extension so the chosen rules really run.
 */
export function pastedSource(text: string, extension: string, virtualNameInput = ''): PastedSource {
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
  const chosen = PASTE_LANGUAGES.some((option) => option.extension === extension) ? extension : PASTE_AUTO
  return {
    ok: true,
    source: {
      path: `pasted/${virtualName(virtualNameInput, chosen, text)}`,
      size: bytes.length,
      read: async () => bytes,
    },
  }
}
