import { applyPatch, createTwoFilesPatch, parsePatch, reversePatch } from 'diff'
import { strToU8, zipSync } from 'fflate'
import type { ArchiveEntry } from '../archive/guard'
import { isNotebookDerivedName } from '../archive/notebook'
import { verifyFixCandidates, type VerifyFixesDeps } from '../analysis/verifyFixes'
import { reportForExport, renderReportMarkdown } from '../export/reportFiles'
import { applyEdits } from '../fixes/text'
import type { FixCandidate } from '../fixes/types'
import type { AnalyzerReport } from '../types'

export interface CleanExportSelections {
  patch: boolean
  zip: boolean
  changelog: boolean
  report: boolean
}

export const DEFAULT_CLEAN_EXPORT_SELECTIONS: CleanExportSelections = {
  patch: true,
  zip: true,
  changelog: true,
  report: true,
}

export interface CleanExportInput {
  report: AnalyzerReport
  sources: readonly ArchiveEntry[]
  candidates: readonly FixCandidate[]
}

export interface CleanExportFile {
  /** File name offered to the browser; never a path inside the user's project. */
  name: string
  bytes: Uint8Array
  mime: string
}

export interface AppliedChange {
  findingId: string
  ruleId: string
  file: string
  startLine: number
  endLine: number
  riskClass: FixCandidate['riskClass']
  description: string
  behaviourChange: boolean
  warnings: string[]
}

export interface CleanExportReady {
  status: 'ready'
  files: CleanExportFile[]
  applied: AppliedChange[]
  cleanFiles: { file: string; text: string }[]
}

export interface CleanExportBlocked {
  status: 'blocked'
  message: string
}

export type CleanExportResult = CleanExportReady | CleanExportBlocked

const CREDENTIAL_NOTE =
  'Credential values are never reproduced in this file. Rotating a leaked credential is still required; removing it from the code does not revoke it.'

function blocked(message: string): CleanExportBlocked {
  return { status: 'blocked', message }
}

function appliedChanges(candidates: readonly FixCandidate[]): AppliedChange[] {
  return candidates.map((candidate) => ({
    findingId: candidate.findingId,
    ruleId: candidate.ruleId,
    file: candidate.file,
    startLine: candidate.targetStartLine,
    endLine: candidate.targetEndLine,
    riskClass: candidate.riskClass,
    description: candidate.description,
    behaviourChange: candidate.behaviourChange,
    warnings: [...candidate.warnings],
  }))
}

function buildChangelog(report: AnalyzerReport, applied: readonly AppliedChange[]): string {
  const files = [...new Set(applied.map((change) => change.file))].sort((a, b) => a.localeCompare(b))
  const lines = [
    '# BugPilot clean export changelog',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Applied changes: ${applied.length} in ${files.length} file${files.length === 1 ? '' : 's'}.`,
    '',
    CREDENTIAL_NOTE,
    '',
  ]
  for (const file of files) {
    lines.push(`## ${file}`, '')
    for (const change of applied.filter((entry) => entry.file === file)) {
      lines.push(
        `### Line ${change.startLine}${change.endLine === change.startLine ? '' : `–${change.endLine}`}: ${change.ruleId}`,
        '',
        `- Finding id: \`${change.findingId}\``,
        `- Risk class: ${change.riskClass}`,
        `- Description: ${change.description}`,
        `- Behaviour change: ${change.behaviourChange ? 'yes' : 'no'}`,
      )
      if (change.warnings.length > 0) {
        lines.push('- Warnings:')
        for (const warning of change.warnings) lines.push(`  - ${warning}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

function buildManifest(
  sources: readonly ArchiveEntry[],
  fixedFiles: ReadonlySet<string>,
): string {
  const names = sources.map((source) => source.name).sort((a, b) => a.localeCompare(b))
  const lines = [
    '# BugPilot clean export',
    '',
    'This zip contains only the text files BugPilot analysed in this browser tab.',
    '',
    '- It is not a full copy of your project. Binary files, skipped files, files over the size limit and files inside ignored folders (such as node_modules, .git and dist) are not included, because the app never keeps their bytes.',
    '- Paths are the original relative paths inside the upload.',
    `- Fixed files: ${fixedFiles.size} of ${sources.length} analysed text file${sources.length === 1 ? '' : 's'}.`,
    '- Recommended: apply changes.patch to your original folder with git apply. That keeps every file the app never saw, and it is the only output that lets you check each change line by line.',
    `- ${CREDENTIAL_NOTE}`,
    '',
    '## Files in this zip',
    '',
  ]
  for (const name of names) lines.push(`- ${name} (${fixedFiles.has(name) ? 'fixed' : 'unchanged'})`)
  lines.push('')
  return lines.join('\n')
}

function includedFixesSection(applied: readonly AppliedChange[]): string {
  const files = new Set(applied.map((change) => change.file))
  const lines = [
    '## Included fixes',
    '',
    `Applied changes: ${applied.length} in ${files.size} file${files.size === 1 ? '' : 's'}.`,
    '',
    '| File | Line | Rule | Risk class | Description |',
    '| --- | ---: | --- | --- | --- |',
  ]
  for (const change of applied) {
    lines.push(
      `| ${change.file.replace(/\|/g, '\\|')} | ${change.startLine} | \`${change.ruleId}\` | ${change.riskClass} | ${change.description.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`,
    )
  }
  lines.push('', CREDENTIAL_NOTE, '')
  return lines.join('\n')
}

function buildCleanReportMarkdown(report: AnalyzerReport, applied: readonly AppliedChange[]): string {
  const base = renderReportMarkdown(reportForExport(report, false))
  const section = includedFixesSection(applied)
  const marker = '## Coverage'
  const index = base.indexOf(marker)
  return index === -1 ? `${base}\n${section}` : `${base.slice(0, index)}${section}${base.slice(index)}`
}

function buildCleanReportJson(report: AnalyzerReport, applied: readonly AppliedChange[]): string {
  const prepared = reportForExport(report, false)
  const payload = {
    ...prepared,
    includedFixes: applied.map((change) => ({
      findingId: change.findingId,
      ruleId: change.ruleId,
      file: change.file,
      lineRange: { start: change.startLine, end: change.endLine },
      riskClass: change.riskClass,
      description: change.description,
      behaviourChange: change.behaviourChange,
      warnings: change.warnings,
    })),
    includedFixesNote: CREDENTIAL_NOTE,
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * Builds every clean-export output in memory. Before a single file is offered, the selected
 * candidates are verified again through the real analyzer pipeline, changes.patch is applied
 * to the originals and compared byte for byte with the clean files, and the reverse patch is
 * applied to prove the originals can be restored. Any mismatch blocks the whole export.
 */
export async function buildCleanExport(
  input: CleanExportInput,
  selections: CleanExportSelections,
  deps: VerifyFixesDeps = {},
  signal?: AbortSignal,
): Promise<CleanExportResult> {
  if (input.candidates.length === 0) {
    return blocked('Select at least one change before building a clean export.')
  }
  if (!selections.patch && !selections.zip && !selections.changelog && !selections.report) {
    return blocked('Tick at least one output to build.')
  }

  // Notebooks are never exported and never edited. Dropping their fake file names here, as well as
  // in the fix proposal, means a caller cannot smuggle cell text into a patch or a zip.
  const sources = input.sources.filter((source) => !isNotebookDerivedName(source.name))
  const candidates = input.candidates.filter((candidate) => !isNotebookDerivedName(candidate.file))
  if (candidates.length === 0) {
    return blocked(
      'The only selected change is inside a notebook. BugPilot never edits or exports notebooks, so make that change in Jupyter by hand.',
    )
  }

  const verification = await verifyFixCandidates(
    candidates,
    sources,
    input.report.findings,
    deps,
    signal,
  )
  if (signal?.aborted) return blocked('The clean export was cancelled. Nothing was kept.')
  if (verification.dropped.length > 0) {
    const first = verification.dropped[0]
    return blocked(
      `The change for ${first.candidate.file} (line ${first.candidate.targetStartLine}) did not verify again: ${first.reason} The export was blocked; download the report only.`,
    )
  }

  const sourceByName = new Map(sources.map((source) => [source.name, source]))
  const candidatesByFile = new Map<string, FixCandidate[]>()
  for (const candidate of candidates) {
    const list = candidatesByFile.get(candidate.file)
    if (list) list.push(candidate)
    else candidatesByFile.set(candidate.file, [candidate])
  }

  const fixedTexts = new Map<string, string>()
  for (const [file, fileCandidates] of candidatesByFile) {
    const source = sourceByName.get(file)
    if (!source) {
      return blocked(
        `The analysed text for ${file} is no longer available, so the clean export was blocked.`,
      )
    }
    try {
      fixedTexts.set(file, applyEdits(source.text, fileCandidates.flatMap((candidate) => candidate.edits)))
    } catch (error) {
      return blocked(
        `The changes for ${file} could not be applied to the original text (${error instanceof Error ? error.message : 'unknown error'}). The export was blocked.`,
      )
    }
  }

  const fixedFiles = [...fixedTexts.keys()].sort((a, b) => a.localeCompare(b))
  const patchText = fixedFiles
    .map((file) =>
      createTwoFilesPatch(`a/${file}`, `b/${file}`, sourceByName.get(file)?.text ?? '', fixedTexts.get(file) ?? '', '', ''),
    )
    .join('')
  const parsed = parsePatch(patchText)
  if (parsed.length !== fixedFiles.length) {
    return blocked(
      'changes.patch could not be parsed back into one section per changed file, so the export was blocked.',
    )
  }
  const patchByOldName = new Map(parsed.map((section) => [section.oldFileName ?? '', section]))
  for (const file of fixedFiles) {
    const original = sourceByName.get(file)?.text ?? ''
    const clean = fixedTexts.get(file) ?? ''
    const section = patchByOldName.get(`a/${file}`)
    if (!section) {
      return blocked(`changes.patch has no section for ${file}, so the export was blocked.`)
    }
    const forward = applyPatch(original, section)
    if (forward === false || forward !== clean) {
      return blocked(
        `Applying changes.patch to ${file} did not reproduce the clean file byte for byte, so the export was blocked.`,
      )
    }
    const reverse = applyPatch(clean, reversePatch(section))
    if (reverse === false || reverse !== original) {
      return blocked(
        `Applying the reverse of changes.patch to ${file} did not restore the original byte for byte, so the export was blocked.`,
      )
    }
    if (sourceByName.get(file)?.language === 'json') {
      try {
        JSON.parse(clean)
      } catch {
        return blocked(`The clean version of ${file} is not valid JSON, so the export was blocked.`)
      }
    }
  }

  const applied = appliedChanges(candidates)
  const files: CleanExportFile[] = []

  if (selections.patch) {
    files.push({
      name: 'changes.patch',
      bytes: strToU8(patchText),
      mime: 'text/x-diff;charset=utf-8',
    })
  }

  if (selections.zip) {
    const entries: Record<string, Uint8Array> = {}
    for (const source of sources) {
      entries[source.name] = strToU8(fixedTexts.get(source.name) ?? source.text)
    }
    entries['MANIFEST.md'] = strToU8(buildManifest(sources, new Set(fixedTexts.keys())))
    files.push({
      name: 'clean.zip',
      bytes: zipSync(entries, { level: 6 }),
      mime: 'application/zip',
    })
  }

  if (selections.changelog) {
    files.push({
      name: 'CHANGELOG.md',
      bytes: strToU8(buildChangelog(input.report, applied)),
      mime: 'text/markdown;charset=utf-8',
    })
  }

  if (selections.report) {
    files.push({
      name: 'report.md',
      bytes: strToU8(buildCleanReportMarkdown(input.report, applied)),
      mime: 'text/markdown;charset=utf-8',
    })
    files.push({
      name: 'report.json',
      bytes: strToU8(buildCleanReportJson(input.report, applied)),
      mime: 'application/json;charset=utf-8',
    })
  }

  return {
    status: 'ready',
    files,
    applied,
    cleanFiles: fixedFiles.map((file) => ({ file, text: fixedTexts.get(file) ?? '' })),
  }
}
