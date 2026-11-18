/**
 * The headless BugPilot CLI: the same deep engines the browser worker runs, over plain
 * files on disk. It exists so the engine layer can be exercised — in CI, in review, on a
 * machine without a browser — without a second implementation of it: the CLI downloads
 * the same WebAssembly binaries through the same byte-capped, header-checked fetch and
 * reports the same engine result shapes the app renders.
 *
 * Usage: npm run analyze -- <file> [<file>...] [--json]
 * Exit codes: 0 for a completed run (findings never change it), 2 for a usage or
 * file-reading failure.
 */
import fs from 'node:fs'
import path from 'node:path'
import { detectLanguage } from '../archive/classify'
import type { ArchiveEntry } from '../archive/bounds'
import { probeWebAssembly } from '../engines/featureProbe'
import { DEFAULT_ENGINE_LIMITS, type EngineFileResult, type EngineRunResult } from '../engines/protocol'
import { configureEngineSources } from '../engines/engineSources'
import { runEngineFile } from '../engines/runFile'
import { startNodeAssets } from './nodeAssets'

export interface CliOptions {
  paths: string[]
  json: boolean
}

export function parseArgs(argv: readonly string[]): CliOptions | { error: string } {
  const paths: string[] = []
  let json = false
  for (const arg of argv) {
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg.startsWith('--')) {
      return { error: `Unknown option ${arg}. The only option is --json.` }
    }
    paths.push(arg)
  }
  if (paths.length === 0) {
    return { error: 'No files given. Usage: npm run analyze -- <file> [<file>...] [--json]' }
  }
  return { paths, json }
}

/** The entry the engines consume, built from a disk file the way the archive readers build theirs. */
export function buildArchiveEntry(name: string, raw: Buffer): ArchiveEntry {
  const hadBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
  const text = (hadBom ? raw.subarray(3) : raw).toString('utf8')
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: hadBom ? 'utf-8-bom' : 'utf-8',
    bytes: Buffer.byteLength(text, 'utf8'),
  }
}

export function formatFindingsText(result: EngineRunResult): string {
  const lines: string[] = []
  let findings = 0
  let notes = 0
  for (const file of result.files) {
    const engines = file.enginesRan.length > 0 ? file.enginesRan.join(', ') : 'none'
    lines.push(`${file.file}: ${file.parse} (engines: ${engines})`)
    for (const hit of file.hits) {
      findings += 1
      lines.push(`  ${hit.range.startLine}:${hit.range.startColumn ?? 0} ${hit.severity} [${hit.ruleId}] ${hit.message}`)
    }
    for (const note of file.notes) {
      notes += 1
      lines.push(`  note: ${note}`)
    }
  }
  for (const skipped of result.filesNotRun) {
    lines.push(`${skipped}: not run`)
  }
  lines.push(`files: ${result.files.length}, findings: ${findings}, notes: ${notes}`)
  return lines.join('\n')
}

export function formatFindingsJson(result: EngineRunResult): string {
  return JSON.stringify(result, null, 2)
}

export async function analyzeMain(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv)
  if ('error' in parsed) {
    process.stderr.write(`${parsed.error}\n`)
    return 2
  }

  const entries: ArchiveEntry[] = []
  for (const given of parsed.paths) {
    const file = path.resolve(given)
    let raw: Buffer
    try {
      raw = fs.readFileSync(file)
    } catch (error) {
      process.stderr.write(`Could not read ${given}: ${error instanceof Error ? error.message : 'unknown error'}\n`)
      return 2
    }
    entries.push(buildArchiveEntry(path.basename(file), raw))
  }

  const probe = await probeWebAssembly()
  if (!probe.ok) {
    process.stderr.write(`${probe.message}\n`)
    return 2
  }

  const assets = await startNodeAssets()
  configureEngineSources(assets.engineSourcesConfig())

  const runStartedAt = Date.now()
  const files: EngineFileResult[] = []
  try {
    for (const [index, entry] of entries.entries()) {
      process.stderr.write(`[${index + 1}/${entries.length}] ${entry.name} (${entry.language})\n`)
      files.push(await runEngineFile(entry, { limits: DEFAULT_ENGINE_LIMITS, runStartedAt }))
    }
  } finally {
    assets.close()
  }

  const result: EngineRunResult = { files, filesNotRun: [], cancelled: false, unavailable: null }
  process.stdout.write(parsed.json ? `${formatFindingsJson(result)}\n` : `${formatFindingsText(result)}\n`)
  return 0
}
