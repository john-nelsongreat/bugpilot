import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry, ArchiveSkippedEntry } from '../archive/guard'
import { isTsFamily, languageLabel, tierAvailability } from '../languages'
import type { CoverageTier, FileCoverage } from '../types'
import type { FileAnalysis } from './engine'

export interface TypeScriptStatus {
  ran: boolean
  reason: string
}

const SKIPPED_TIERS: CoverageTier[] = [
  {
    tier: 'syntax',
    available: false,
    ran: false,
    reason: 'The file was skipped by the archive reader, so no syntax engine saw it.',
  },
  {
    tier: 'pattern',
    available: false,
    ran: false,
    reason: 'The file was skipped by the archive reader, so no pattern rule saw it.',
  },
]

function encodingNote(entry: ArchiveEntry): string[] {
  if (entry.encoding === 'latin-1') {
    return ['The bytes were not valid UTF-8, so the text was interpreted as Latin-1; accented characters may still be misread.']
  }
  if (entry.encoding === 'utf-16-le' || entry.encoding === 'utf-16-be') {
    return [`The file was decoded as ${entry.encoding.toUpperCase()}.`]
  }
  if (entry.encoding === 'utf-8-bom') {
    return ['The file starts with a UTF-8 byte-order mark; it was removed before analysis.']
  }
  return []
}

function languageSourceNote(entry: ArchiveEntry): string[] {
  if (entry.languageSource === 'content') {
    return ['The file name did not identify a language; the content was sniffed and it is labelled accordingly.']
  }
  if (entry.languageSource === 'shebang') {
    return ['The language comes from the shebang line, not from the file extension.']
  }
  if (entry.languageSource === 'fallback') {
    return ['No language was recognised from the name or the content.']
  }
  return []
}

export function buildCoverage(
  entries: readonly ArchiveEntry[],
  skipped: readonly ArchiveSkippedEntry[],
  analyses: readonly FileAnalysis[],
  typescript: ReadonlyMap<string, TypeScriptStatus> = new Map(),
): FileCoverage[] {
  const byFile = new Map(analyses.map((analysis) => [analysis.file, analysis]))
  const coverage: FileCoverage[] = []

  for (const entry of entries) {
    const analysis = byFile.get(entry.name)
    const ts = typescript.get(entry.name)
    const tiers = tierAvailability(entry.language).map((tier) => {
      if (tier.tier === 'pattern') {
        return { ...tier, ran: analysis !== undefined }
      }
      if (!tier.available) return tier
      if (entry.language === 'json') {
        return { ...tier, ran: analysis?.rulesRan.includes('bugpilot/syntax/json') ?? false }
      }
      if (isTsFamily(entry.language) && ts) {
        return { ...tier, ran: ts.ran, reason: ts.reason }
      }
      return tier
    })

    coverage.push({
      file: entry.name,
      status: 'analysed',
      language: entry.language,
      languageSource: entry.languageSource,
      languageLabel: languageLabel(entry.language),
      encoding: entry.encoding,
      bytes: entry.bytes,
      findings: analysis?.findings.length ?? 0,
      tiers,
      skipReason: null,
      notes: [...(analysis?.notes ?? []), ...encodingNote(entry), ...languageSourceNote(entry)],
    })
  }

  for (const item of skipped) {
    const detection = detectLanguage(item.name, '')
    coverage.push({
      file: item.name,
      status: 'skipped',
      language: detection.language,
      languageSource: 'name-only',
      languageLabel: languageLabel(detection.language),
      encoding: null,
      bytes: 0,
      findings: 0,
      tiers: SKIPPED_TIERS.map((tier) => ({ ...tier })),
      skipReason: item.message,
      notes: [],
    })
  }

  return coverage
}
