import { structuredPatch } from 'diff'
import type { FixMaskedSpan } from '../fixes/types'

export type DiffRowKind = 'hunk' | 'context' | 'add' | 'remove' | 'pair'

export interface DiffRow {
  kind: DiffRowKind
  oldLine: number | null
  newLine: number | null
  oldText: string | null
  newText: string | null
  text: string
  changeIndex: number | null
}

export interface MaskedLine {
  startColumn: number
  endColumn: number
  maskedText: string
}

export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

/** Maps absolute mask spans onto zero-based line indexes and zero-based columns. */
export function masksByLine(text: string, spans: readonly FixMaskedSpan[]): Map<number, MaskedLine[]> {
  const starts = lineStartsOf(text)
  const masks = new Map<number, MaskedLine[]>()
  for (const span of spans) {
    for (let line = 0; line < starts.length; line += 1) {
      const start = starts[line]
      const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
      const from = Math.max(span.startOffset, start)
      const to = Math.min(span.endOffset, end)
      if (from >= to) continue
      const list = masks.get(line) ?? []
      list.push({ startColumn: from - start, endColumn: to - start, maskedText: span.maskedText })
      masks.set(line, list)
    }
  }
  return masks
}

export function maskLine(text: string, masks: readonly MaskedLine[]): string {
  if (masks.length === 0) return text
  const ordered = [...masks].sort((left, right) => left.startColumn - right.startColumn)
  let out = ''
  let cursor = 0
  for (const mask of ordered) {
    if (mask.startColumn < cursor) continue
    out += text.slice(cursor, mask.startColumn) + mask.maskedText
    cursor = mask.endColumn
  }
  return out + text.slice(cursor)
}

interface HunkLine {
  kind: 'context' | 'add' | 'remove'
  oldLine: number | null
  newLine: number | null
  text: string
}

function hunkLines(hunk: { oldStart: number; newStart: number; lines: string[] }): HunkLine[] {
  const rows: HunkLine[] = []
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  for (const raw of hunk.lines) {
    if (raw.startsWith('\\')) continue
    const marker = raw[0]
    const text = raw.slice(1)
    if (marker === '+') {
      rows.push({ kind: 'add', oldLine: null, newLine, text })
      newLine += 1
    } else if (marker === '-') {
      rows.push({ kind: 'remove', oldLine, newLine: null, text })
      oldLine += 1
    } else {
      rows.push({ kind: 'context', oldLine, newLine, text })
      oldLine += 1
      newLine += 1
    }
  }
  return rows
}

function hunkHeader(hunk: {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}): string {
  const oldPart = hunk.oldLines === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldLines}`
  const newPart = hunk.newLines === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newLines}`
  return `@@ -${oldPart} +${newPart} @@`
}

export interface FileDiff {
  file: string
  rows: DiffRow[]
  changeCount: number
}

/** Unified rows: one line per row, changes carry a change index for keyboard jumps. */
function unifiedRowsFromPatch(
  file: string,
  patch: { hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[] },
  masks: Map<number, MaskedLine[]>,
): FileDiff {
  const rows: DiffRow[] = []
  let changes = 0
  for (const hunk of patch.hunks) {
    rows.push({
      kind: 'hunk',
      oldLine: null,
      newLine: null,
      oldText: null,
      newText: null,
      text: hunkHeader(hunk),
      changeIndex: null,
    })
    for (const line of hunkLines(hunk)) {
      if (line.kind === 'context') {
        rows.push({
          kind: 'context',
          oldLine: line.oldLine,
          newLine: line.newLine,
          oldText: line.text,
          newText: line.text,
          text: maskLine(line.text, masks.get((line.oldLine ?? 1) - 1) ?? []),
          changeIndex: null,
        })
        continue
      }
      const changeIndex = changes
      changes += 1
      const masked =
        line.kind === 'remove'
          ? maskLine(line.text, masks.get((line.oldLine ?? 1) - 1) ?? [])
          : line.text
      rows.push({
        kind: line.kind,
        oldLine: line.oldLine,
        newLine: line.newLine,
        oldText: line.kind === 'remove' ? masked : null,
        newText: line.kind === 'add' ? line.text : null,
        text: masked,
        changeIndex,
      })
    }
  }
  return { file, rows, changeCount: changes }
}

export function buildUnifiedRows(
  file: string,
  before: string,
  after: string,
  masks: Map<number, MaskedLine[]>,
  context = 3,
): FileDiff {
  const patch = structuredPatch(`a/${file}`, `b/${file}`, before, after, '', '', { context })
  return unifiedRowsFromPatch(file, patch, masks)
}

interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/**
 * Side-by-side rows: each removal run is paired with the additions that replaced it.
 * Context rows appear once and span both sides.
 */
function splitRowsFromPatch(
  file: string,
  patch: { hunks: PatchHunk[] },
  masks: Map<number, MaskedLine[]>,
): FileDiff {
  const rows: DiffRow[] = []
  let changes = 0

  const pushChange = (row: Omit<DiffRow, 'changeIndex'>) => {
    rows.push({ ...row, changeIndex: changes })
    changes += 1
  }

  for (const hunk of patch.hunks) {
    rows.push({
      kind: 'hunk',
      oldLine: null,
      newLine: null,
      oldText: null,
      newText: null,
      text: hunkHeader(hunk),
      changeIndex: null,
    })
    const lines = hunkLines(hunk)
    let index = 0
    while (index < lines.length) {
      const line = lines[index]
      if (line.kind === 'context') {
        const masked = maskLine(line.text, masks.get((line.oldLine ?? 1) - 1) ?? [])
        rows.push({
          kind: 'context',
          oldLine: line.oldLine,
          newLine: line.newLine,
          oldText: masked,
          newText: masked,
          text: masked,
          changeIndex: null,
        })
        index += 1
        continue
      }

      const removed: HunkLine[] = []
      while (index < lines.length && lines[index].kind === 'remove') {
        removed.push(lines[index])
        index += 1
      }
      const added: HunkLine[] = []
      while (index < lines.length && lines[index].kind === 'add') {
        added.push(lines[index])
        index += 1
      }
      const pairs = Math.max(removed.length, added.length)
      for (let pair = 0; pair < pairs; pair += 1) {
        const oldLine = removed[pair]?.oldLine ?? null
        const newLine = added[pair]?.newLine ?? null
        if (oldLine !== null && newLine !== null) {
          const oldText = maskLine(removed[pair].text, masks.get(oldLine - 1) ?? [])
          pushChange({
            kind: 'pair',
            oldLine,
            newLine,
            oldText,
            newText: added[pair].text,
            text: oldText,
          })
        } else if (oldLine !== null) {
          const oldText = maskLine(removed[pair].text, masks.get(oldLine - 1) ?? [])
          pushChange({ kind: 'remove', oldLine, newLine: null, oldText, newText: null, text: oldText })
        } else {
          pushChange({
            kind: 'add',
            oldLine: null,
            newLine,
            oldText: null,
            newText: added[pair].text,
            text: added[pair].text,
          })
        }
      }
    }
  }

  return { file, rows, changeCount: changes }
}

export function buildSplitRows(
  file: string,
  before: string,
  after: string,
  masks: Map<number, MaskedLine[]>,
  context = 3,
): FileDiff {
  const patch = structuredPatch(`a/${file}`, `b/${file}`, before, after, '', '', { context })
  return splitRowsFromPatch(file, patch, masks)
}

export interface DiffViews {
  unified: FileDiff
  split: FileDiff
}

/** One patch computation feeds both views, which halves the work on large diffs. */
export function buildDiffViews(
  file: string,
  before: string,
  after: string,
  masks: Map<number, MaskedLine[]>,
  context = 3,
): DiffViews {
  const patch = structuredPatch(`a/${file}`, `b/${file}`, before, after, '', '', { context })
  return {
    unified: unifiedRowsFromPatch(file, patch, masks),
    split: splitRowsFromPatch(file, patch, masks),
  }
}
