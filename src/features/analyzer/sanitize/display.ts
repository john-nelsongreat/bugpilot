// Control characters are exactly what this sanitiser is for.
const INVISIBLE_OR_CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2069\uFEFF]/g

const INVISIBLE_OR_CONTROL_IN_CODE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2069\uFEFF]/g

const MARKER_TOKEN = /\\u[0-9A-F]{4}|./gu

function marker(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Turns characters that can hide or reorder text into literal escape markers. The original
 * string is never used for navigation or file writes; this is only what a human reads.
 */
export function sanitizeForDisplay(text: string): string {
  return text.replace(INVISIBLE_OR_CONTROL, marker)
}

/** Same as sanitizeForDisplay but keeps tabs and line breaks, for evidence inside a code block. */
export function sanitizeCodeForDisplay(code: string): string {
  return code.replace(INVISIBLE_OR_CONTROL_IN_CODE, marker)
}

export function truncateForDisplay(text: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if ([...text].length <= maxLength) return text
  if (maxLength === 1) return '…'

  let shown = ''
  let used = 0
  for (const token of text.match(MARKER_TOKEN) ?? []) {
    if (used + token.length + 1 > maxLength) break
    shown += token
    used += token.length
  }
  return `${shown}…`
}

export function escapeMarkdown(text: string): string {
  const entities = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return sanitizeForDisplay(entities.replace(/[\\`*_[\]()|~#]/g, '\\$&'))
}

export function codeFenceFor(code: string): string {
  let longest = 0
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

const UNSAFE_PATH =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2069\uFEFF]/

/**
 * A path may go into a patch only when it is a plain relative path. Patch lines end at a
 * newline, so a name with a line break would silently add a second header; a segment that
 * starts with a dash is refused because command-line tools read it as an option.
 */
export function isPatchSafePath(path: string): boolean {
  if (path.length === 0) return false
  if (UNSAFE_PATH.test(path)) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(path)) return false
  if (path.includes('\\')) return false
  return path
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        !segment.startsWith('-'),
    )
}
