import type { ArchiveEntry } from '../archive/guard'
import { makeRuleFile } from '../rules/context'
import { AST_RULES } from './astQueries'
import { evaluateAstRules } from './astRules'
import type { GrammarId } from './assets'
import { DownloadError, loadGrammar } from './treeSitter'
import { Parser, Query, type Language } from './treeSitter'
import { enginesFor } from './registry'
import { RuffRunner, ruffHitToEngineHit } from './ruff'
import { scanSyntax, type SyntaxNode } from './syntax'
import type { EngineFileResult, EngineHit, EngineLimits } from './protocol'

const parserCache = new Map<GrammarId, Parser>()
const ruffRunner = new RuffRunner()

export interface EngineRunContext {
  limits: EngineLimits
  signal?: AbortSignal | null
  onDownloading?: (url: string) => void
  /** Set when the whole run started, so one file cannot starve the rest. */
  runStartedAt: number
}

function parserFor(grammar: GrammarId, language: Language): Parser {
  const cached = parserCache.get(grammar)
  if (cached) {
    cached.setLanguage(language)
    return cached
  }
  const parser = new Parser()
  parser.setLanguage(language)
  parserCache.set(grammar, parser)
  return parser
}

function describeError(error: unknown): string {
  if (error instanceof DownloadError) return error.message
  return error instanceof Error ? error.message : 'an unknown error'
}

/** Two engines describing one line is one finding, not two. */
const EQUIVALENT_RULES: readonly [string, string][] = [
  ['ruff/E722', 'bugpilot/ast/python-bare-except'],
  ['ruff/S110', 'bugpilot/ast/empty-catch'],
  ['ruff/S608', 'bugpilot/ast/sql-built-by-concatenation'],
]

const CONFIDENCE_RANK: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 }

export function dedupeEngineHits(hits: EngineHit[]): EngineHit[] {
  const kept: EngineHit[] = []
  for (const hit of hits) {
    const clash = kept.find(
      (candidate) =>
        candidate.range.startLine === hit.range.startLine &&
        (candidate.ruleId === hit.ruleId ||
          EQUIVALENT_RULES.some(
            ([left, right]) =>
              (left === candidate.ruleId && right === hit.ruleId) ||
              (right === candidate.ruleId && left === hit.ruleId),
          )),
    )
    if (!clash) {
      kept.push(hit)
      continue
    }
    if (CONFIDENCE_RANK[hit.confidence.level] > CONFIDENCE_RANK[clash.confidence.level]) {
      kept[kept.indexOf(clash)] = hit
    }
  }
  return kept
}

function sortHits(hits: EngineHit[]): void {
  hits.sort(
    (left, right) =>
      left.range.startLine - right.range.startLine ||
      (left.range.startColumn ?? 0) - (right.range.startColumn ?? 0) ||
      left.ruleId.localeCompare(right.ruleId),
  )
}

/**
 * Runs every engine that owns this language over one decoded file. Each engine call is
 * individually guarded: an engine that panics or cannot download leaves a coverage note,
 * it never aborts the run or the worker.
 */
export async function runEngineFile(entry: ArchiveEntry, ctx: EngineRunContext): Promise<EngineFileResult> {
  const result: EngineFileResult = {
    file: entry.name,
    hits: [],
    enginesRan: [],
    parse: 'not-attempted',
    notes: [],
  }
  const profile = enginesFor(entry.language)
  if (!profile || profile.engines.length === 0) {
    result.parse = 'no-grammar'
    return result
  }
  if (entry.text.length > ctx.limits.maxFileBytes) {
    result.notes.push(
      `The deep engines skipped this file: ${entry.text.length} characters is over the ${ctx.limits.maxFileBytes} character engine limit.`,
    )
    return result
  }

  const started = Date.now()
  const file = makeRuleFile(entry)
  const outOfTime = (): boolean =>
    ctx.signal?.aborted === true ||
    Date.now() - started > ctx.limits.perFileBudgetMs ||
    Date.now() - ctx.runStartedAt > ctx.limits.totalBudgetMs

  if (profile.grammar) {
    let language: Language | null = null
    try {
      language = await loadGrammar(profile.grammar, ctx.limits.maxDownloadBytes, ctx.signal, ctx.onDownloading)
    } catch (error) {
      result.parse = 'engine-unavailable'
      result.notes.push(`The ${profile.grammar} grammar could not be loaded: ${describeError(error)}`)
    }

    if (language) {
      if (outOfTime()) {
        result.parse = 'engine-stopped-early'
        result.notes.push('The time budget ran out before this file could be parsed.')
        return result
      }
      let tree: ReturnType<Parser['parse']> = null
      try {
        const parser = parserFor(profile.grammar, language)
        tree = parser.parse(entry.text)
        if (!tree) {
          result.parse = 'engine-stopped-early'
          result.notes.push('The parser returned no tree for this file.')
        } else {
          const root = tree.rootNode
          const syntax = scanSyntax({ file, root: root as unknown as SyntaxNode, grammar: profile.grammar })
          result.parse = syntax.understood ? 'parsed' : 'grammar-did-not-understand'
          result.notes.push(...syntax.notes)
          result.hits.push(...syntax.hits)
          result.enginesRan.push('tree-sitter')

          const runQuery = (source: string) => {
            const query = new Query(language, source)
            try {
              return query.matches(root)
            } finally {
              query.delete()
            }
          }
          const astHits = evaluateAstRules(AST_RULES, {
            file,
            grammar: profile.grammar,
            runQuery,
            maxHits: ctx.limits.maxHitsPerFile,
          })
          result.hits.push(...astHits)
          tree.delete()
        }
      } catch (error) {
        result.parse = result.parse === 'parsed' ? result.parse : 'engine-stopped-early'
        result.notes.push(
          `The tree-sitter engine stopped on this file (${describeError(error)}); the file may be partly unanalysed.`,
        )
      }
    }
  } else {
    result.parse = 'no-grammar'
  }

  if (profile.engines.includes('ruff')) {
    if (outOfTime()) {
      result.notes.push('The time budget ran out before Ruff could check this file.')
    } else {
      try {
        await ruffRunner.start(ctx.limits.maxDownloadBytes, ctx.signal, ctx.onDownloading)
        const diagnostics = ruffRunner.check(entry.text)
        result.enginesRan.push('ruff')
        for (const diagnostic of diagnostics) {
          const hit = ruffHitToEngineHit(diagnostic, file)
          if (hit) result.hits.push(hit)
        }
      } catch (error) {
        result.notes.push(`Ruff could not check this file: ${describeError(error)}`)
      }
    }
  }

  sortHits(result.hits)
  const deduped = dedupeEngineHits(result.hits)
  if (deduped.length > ctx.limits.maxHitsPerFile) {
    const dropped = deduped.length - ctx.limits.maxHitsPerFile
    result.notes.push(`Only the first ${ctx.limits.maxHitsPerFile} engine findings are kept; ${dropped} more were dropped.`)
  }
  result.hits = deduped.slice(0, ctx.limits.maxHitsPerFile)
  return result
}
