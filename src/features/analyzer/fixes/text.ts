import type { FixCandidate, FixEdit, FixResolution, OverlapDrop } from './types'

export function editsOverlap(left: FixEdit, right: FixEdit): boolean {
  const leftInsert = left.startOffset === left.endOffset
  const rightInsert = right.startOffset === right.endOffset
  if (leftInsert && rightInsert) return left.startOffset === right.startOffset
  if (leftInsert) return right.startOffset < left.startOffset && left.startOffset < right.endOffset
  if (rightInsert) return left.startOffset < right.startOffset && right.startOffset < left.endOffset
  return left.startOffset < right.endOffset && right.startOffset < left.endOffset
}

/** Applies non-overlapping edits to the original text. Throws when an edit is impossible. */
export function applyEdits(text: string, edits: readonly FixEdit[]): string {
  const sorted = [...edits].sort(
    (left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset,
  )
  let cursor = 0
  let out = ''
  for (const edit of sorted) {
    if (
      edit.startOffset < 0 ||
      edit.endOffset < edit.startOffset ||
      edit.endOffset > text.length ||
      edit.startOffset < cursor
    ) {
      throw new Error(`The edit for ${edit.file} is outside the file or overlaps another edit.`)
    }
    out += text.slice(cursor, edit.startOffset) + edit.newText
    cursor = edit.endOffset
  }
  return out + text.slice(cursor)
}

function riskRank(candidate: FixCandidate): number {
  return candidate.riskClass === 'safe' ? 0 : 1
}

function firstStart(candidate: FixCandidate): number {
  return candidate.edits.reduce((lowest, edit) => Math.min(lowest, edit.startOffset), Number.MAX_SAFE_INTEGER)
}

/**
 * Deterministic precedence: safe before needs-review, then earlier in the file, then finding id.
 * A dropped candidate always names the candidate that won the range.
 */
export function resolveFixOverlaps(candidates: readonly FixCandidate[]): FixResolution {
  const ordered = [...candidates].sort(
    (left, right) =>
      riskRank(left) - riskRank(right) ||
      firstStart(left) - firstStart(right) ||
      left.findingId.localeCompare(right.findingId),
  )
  const kept: FixCandidate[] = []
  const dropped: OverlapDrop[] = []

  for (const candidate of ordered) {
    let conflict: { kept: FixCandidate; edit: FixEdit } | null = null
    for (const accepted of kept) {
      if (accepted.file !== candidate.file) continue
      const hit = candidate.edits.find((edit) =>
        accepted.edits.some((other) => editsOverlap(edit, other)),
      )
      if (hit) {
        conflict = { kept: accepted, edit: hit }
        break
      }
    }
    if (conflict) {
      dropped.push({
        candidate,
        kept: conflict.kept,
        reason: `Dropped because it overlaps the ${conflict.kept.riskClass} fix for ${conflict.kept.findingId} (${conflict.kept.ruleId}) in the same range.`,
      })
      continue
    }
    kept.push(candidate)
  }

  return { kept, dropped }
}

export function groupCandidatesByFile(
  candidates: readonly FixCandidate[],
): Map<string, FixCandidate[]> {
  const groups = new Map<string, FixCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.file)
    if (group) group.push(candidate)
    else groups.set(candidate.file, [candidate])
  }
  return groups
}
