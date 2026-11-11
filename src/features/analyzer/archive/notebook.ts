import type { SourceLanguage } from './classify'
import type { ArchiveEntry, ArchiveSkippedEntry } from './guard'
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './limits'
import { archiveReasonMessage } from './reasons'

/**
 * A Jupyter notebook is one JSON document that holds many small programs plus whatever a kernel
 * printed while somebody was running them. BugPilot never executes it: it reads the JSON, hands
 * every code cell to the rules as its own file named `notebook.ipynb#cell-N`, and hands each piece
 * of stored output to the credential rules as `notebook.ipynb#cell-N.output-M`. Markdown cells are
 * documentation, not programs, so they are ignored.
 *
 * The output name is not cosmetic. Only the credential rules are allowed to look at it, its text
 * never reaches the report, the fix review or a re-run, and the cell entries are what the user
 * sees in the coverage table.
 */

/** The notebook JSON is read at all only up to the per-file ceiling the reader already enforces. */
export const NOTEBOOK_MAX_BYTES = 2 * 1024 * 1024
/** Nesting depth of the raw JSON, counted before it is parsed, so a deep file cannot blow the stack. */
export const NOTEBOOK_MAX_DEPTH = 64
/** Cells per notebook. A notebook with more than this is treated as generated, not as a document. */
export const NOTEBOOK_MAX_CELLS = 1_000

const NOTEBOOK_MAX_OUTPUT_BYTES = 512 * 1024
const TEXT_OUTPUT_KEYS = [
  'text/plain',
  'text/html',
  'text/markdown',
  'text/latex',
  'application/json',
  'application/javascript',
] as const

/**
 * Control sequences a terminal inserted into captured output. A credential rule runs on plain
 * text, and an ANSI colour code glued to the front of a value must not hide the value from it.
 */
const ANSI_ESCAPE =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:\[[0-9;:?<=>]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '')
}

const KERNEL_LANGUAGES: readonly { marker: string; language: SourceLanguage }[] = [
  { marker: 'python', language: 'python' },
  { marker: 'ipython', language: 'python' },
  { marker: 'typescript', language: 'typescript' },
  { marker: 'javascript', language: 'javascript' },
  { marker: 'node', language: 'javascript' },
]

/**
 * Why a notebook could not be split. `json` is the one failure that becomes a JSON syntax finding
 * instead of a skipped row: the text is still valid input for the syntax rule, and a broken notebook
 * is better reported as a syntax error than dropped quietly.
 */
export type NotebookFailureKind = 'size' | 'depth' | 'json' | 'shape' | 'cells' | 'empty'

export type NotebookRead =
  | { ok: true; cells: ArchiveEntry[]; outputs: ArchiveEntry[] }
  | { ok: false; refusal: string; kind: NotebookFailureKind }

export function isNotebookName(name: string): boolean {
  return /\.ipynb$/i.test(name)
}

export function isNotebookOutputName(name: string): boolean {
  return /#cell-\d+\.output-\d+$/.test(name)
}

export function isNotebookCellName(name: string): boolean {
  return /#cell-\d+$/.test(name)
}

/** A name BugPilot invented for a notebook: the document, a cell, or a piece of stored output. */
export function isNotebookDerivedName(name: string): boolean {
  return isNotebookName(name) || isNotebookCellName(name) || isNotebookOutputName(name)
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function makeEntry(name: string, text: string, language: SourceLanguage): ArchiveEntry {
  return {
    name,
    text,
    language,
    languageSource: 'content',
    encoding: 'utf-8',
    bytes: byteLength(text),
  }
}

/**
 * A cheap pass over the raw characters, because `JSON.parse` on a pathologically nested document
 * throws a stack overflow instead of refusing the file. Strings and their escapes are skipped, so
 * braces inside a value cannot inflate the count.
 */
function deepestNesting(text: string): number {
  let depth = 0
  let deepest = 0
  let inString = false
  let escaped = false
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === '{' || character === '[') {
      depth += 1
      if (depth > deepest) deepest = depth
    } else if (character === '}' || character === ']') {
      depth -= 1
    }
  }
  return deepest
}

function kernelLanguage(metadata: unknown): SourceLanguage {
  const record = (metadata ?? {}) as {
    kernelspec?: { name?: unknown; language?: unknown }
    language_info?: { name?: unknown }
  }
  const declared = [record.kernelspec?.name, record.kernelspec?.language, record.language_info?.name]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  for (const entry of KERNEL_LANGUAGES) {
    if (declared.includes(entry.marker)) return entry.language
  }
  return 'text'
}

function joinSource(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === 'string').join('')
  return ''
}

/**
 * Only the text a kernel stored is collected, one item per stored output so a finding can name both
 * the cell and the output. Stream text, rich display data, and the message fields of error outputs
 * are all read; image and other binary payloads are base64 noise with no line a credential rule can
 * match, so they are not read at all. ANSI control sequences are stripped so a colour code glued to
 * a value cannot hide it from the credential rules.
 */
function outputTexts(outputs: unknown): { index: number; text: string }[] {
  if (!Array.isArray(outputs)) return []
  const collected: { index: number; text: string }[] = []
  outputs.forEach((output, index) => {
    if (typeof output !== 'object' || output === null) return
    const record = output as {
      text?: unknown
      data?: unknown
      traceback?: unknown
      ename?: unknown
      evalue?: unknown
    }
    const parts: string[] = []
    const text = joinSource(record.text)
    if (text !== '') parts.push(text)
    // Traceback lines carry their own terminators, so they are concatenated, not re-joined.
    const traceback = Array.isArray(record.traceback)
      ? record.traceback.filter((line) => typeof line === 'string').join('')
      : ''
    if (traceback !== '') parts.push(traceback)
    for (const value of [record.ename, record.evalue]) {
      const joined = joinSource(value)
      if (joined !== '') parts.push(joined)
    }
    if (typeof record.data === 'object' && record.data !== null) {
      const data = record.data as Record<string, unknown>
      for (const key of TEXT_OUTPUT_KEYS) {
        const value = joinSource(data[key])
        if (value !== '') parts.push(value)
      }
    }
    const joined = stripAnsi(parts.join('\n'))
    if (joined !== '') collected.push({ index, text: joined })
  })
  return collected
}

export function readNotebook(name: string, text: string): NotebookRead {
  if (byteLength(text) > NOTEBOOK_MAX_BYTES) {
    return {
      ok: false,
      kind: 'size',
      refusal:
        `the JSON is ${text.length.toLocaleString('en-US')} bytes, over the 2 MiB notebook ceiling BugPilot parses. ` +
        'Clear the stored output or split the notebook.',
    }
  }
  const deepest = deepestNesting(text)
  if (deepest > NOTEBOOK_MAX_DEPTH) {
    return {
      ok: false,
      kind: 'depth',
      refusal: `the JSON nests ${deepest} levels deep, over the ${NOTEBOOK_MAX_DEPTH}-level ceiling BugPilot parses.`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      kind: 'json',
      refusal: 'the JSON does not parse, so there is no cell list to read. Re-save it from Jupyter and upload it again.',
    }
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { cells?: unknown }).cells)) {
    return { ok: false, kind: 'shape', refusal: 'it has no "cells" list, so it does not look like a notebook' }
  }

  const cells = (parsed as { cells: unknown[]; metadata?: unknown }).cells
  if (cells.length > NOTEBOOK_MAX_CELLS) {
    return {
      ok: false,
      kind: 'cells',
      refusal: `it has ${cells.length} cells, over the ${NOTEBOOK_MAX_CELLS}-cell ceiling BugPilot reads. Split the notebook.`,
    }
  }

  const kernel = kernelLanguage((parsed as { metadata?: unknown }).metadata)
  const cellEntries: ArchiveEntry[] = []
  const outputEntries: ArchiveEntry[] = []
  let outputBudget = NOTEBOOK_MAX_OUTPUT_BYTES

  cells.forEach((cell, index) => {
    if (typeof cell !== 'object' || cell === null) return
    const record = cell as { cell_type?: unknown; source?: unknown; outputs?: unknown }
    // Markdown is documentation. Analysing it would report TODO markers and long lines from prose
    // the user never asked BugPilot to check.
    if (record.cell_type === 'markdown') return
    const source = joinSource(record.source)
    const label = `${name}#cell-${index + 1}`
    if (source !== '') cellEntries.push(makeEntry(label, source, kernel))
    for (const stored of outputTexts(record.outputs)) {
      if (outputBudget <= 0) break
      const text = stored.text.length > outputBudget ? stored.text.slice(0, outputBudget) : stored.text
      outputBudget -= text.length
      outputEntries.push(makeEntry(`${label}.output-${stored.index + 1}`, text, 'text'))
    }
  })

  if (cellEntries.length === 0 && outputEntries.length === 0) {
    return {
      ok: false,
      kind: 'empty',
      refusal: 'it has no code cell with any text to check, so only markdown and empty cells were found.',
    }
  }
  return { ok: true, cells: cellEntries, outputs: outputEntries }
}

/**
 * Every notebook in the read list becomes its code cells plus its stored output; anything else
 * travels through untouched. A notebook whose JSON cannot be parsed is kept as a JSON file so the
 * syntax rule reports the error instead of the file disappearing; every other failure is recorded
 * as a skipped file, exactly like an entry the reader skipped, and the other files are still analysed.
 *
 * Cells count against the run's entry ceiling, because a hundred notebooks of a thousand cells each
 * would otherwise turn a five-thousand-entry cap into a million-row coverage table.
 */
export function expandNotebooks(
  entries: readonly ArchiveEntry[],
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): {
  entries: readonly ArchiveEntry[]
  skipped: ArchiveSkippedEntry[]
} {
  // A run with no notebook keeps the very array it was handed; the page compares that array by
  // reference to know whether the text it holds is still the text the first pass read.
  if (!entries.some((entry) => isNotebookName(entry.name))) return { entries, skipped: [] }

  const expanded: ArchiveEntry[] = []
  const skipped: ArchiveSkippedEntry[] = []
  let budget = limits.maxEntryCount

  for (const entry of entries) {
    if (!isNotebookName(entry.name)) {
      expanded.push(entry)
      budget -= 1
      continue
    }
    const read = readNotebook(entry.name, entry.text)
    if (read.ok === false) {
      if (read.kind === 'json') {
        expanded.push({ ...entry, language: 'json', languageSource: 'fallback' })
        budget -= 1
        continue
      }
      skipped.push({
        name: entry.name,
        code: 'notebook_unreadable',
        message: archiveReasonMessage('notebook_unreadable', entry.name, read.refusal),
      })
      continue
    }
    const produced = read.cells.length + read.outputs.length
    if (produced > budget) {
      skipped.push({
        name: entry.name,
        code: 'notebook_unreadable',
        message: archiveReasonMessage(
          'notebook_unreadable',
          entry.name,
          `its ${produced} cells and outputs would push this run past the ${limits.maxEntryCount}-entry ceiling`,
        ),
      })
      continue
    }
    budget -= produced
    expanded.push(...read.cells, ...read.outputs)
  }

  return { entries: expanded, skipped }
}
