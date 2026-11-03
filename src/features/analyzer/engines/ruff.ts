import initRuff, { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-web'
import type { DiagnosticConfidence } from '../../../diagnostics/types'
import type { Severity } from '../../bugs/types'
import { lineEvidence, manualFix, quoteLine } from '../rules/context'
import type { RuleFile } from '../rules/types'
import { RUFF_WASM_URL } from './assets'
import { fetchCapped } from './treeSitter'
import type { EngineHit } from './protocol'
import { redactCredentialInMessage, redactIfCredential } from './redact'

/**
 * Ruff's own `check()` payload carries a `fix` field. It is deliberately not read: the
 * spike measured zero fix-bearing findings out of the WASM build in every settings
 * combination, and Python is detector-only in this slice, so no engine finding can reach
 * the clean export.
 */
const SELECT = [
  'F401', // unused import
  'F811', // redefinition of unused name
  'F821', // undefined name
  'F841', // unused variable
  'E711', // comparison to None should be 'if cond is None:'
  'E712', // comparison to True/False should be 'if cond is True:'
  'E722', // bare except
  'B006', // mutable default argument
  'B007', // unused loop control variable
  'B008', // function call in default argument
  'S105', // hardcoded password string
  'S106', // hardcoded password in function argument
  'S107', // hardcoded password in function default
  'S110', // try-except-pass
  'S301', // pickle usage
  'S307', // eval usage
  'S324', // insecure hash function
  'S602', // subprocess with shell=True
  'S605', // starting a process with a shell
  'S607', // starting a process with a partial path
  'S608', // SQL built by string concatenation or f-string
] as const

interface RuffRuleSpec {
  severity: Severity
  confidence: DiagnosticConfidence['level']
  /** What the rule means, in the engine's own terms. */
  meaning: string
  extraLimitations?: readonly string[]
}

export const RULE_SPECS: Record<string, RuffRuleSpec> = {
  F401: { severity: 'Low', confidence: 'high', meaning: 'the name is imported and never used in this file' },
  F811: { severity: 'Medium', confidence: 'high', meaning: 'a name is defined twice, so the first definition is dead' },
  F821: {
    severity: 'High',
    confidence: 'medium',
    meaning: 'a name is used without being bound in this file',
    extraLimitations: [
      'Ruff checks one file at a time here: a name injected by a fixture, a wildcard import, or a build step looks undefined.',
    ],
  },
  F841: { severity: 'Low', confidence: 'high', meaning: 'a variable is assigned and never read' },
  E711: { severity: 'Medium', confidence: 'high', meaning: 'the comparison uses == where the language wants `is`' },
  E712: { severity: 'Medium', confidence: 'high', meaning: 'the comparison against a boolean literal can be written directly' },
  E722: { severity: 'Medium', confidence: 'high', meaning: 'a bare `except:` also catches KeyboardInterrupt and SystemExit' },
  B006: { severity: 'Medium', confidence: 'high', meaning: 'a mutable default is created once and shared between every call' },
  B007: { severity: 'Low', confidence: 'high', meaning: 'a loop variable is never used' },
  B008: { severity: 'Low', confidence: 'medium', meaning: 'a default argument is computed once, at import time' },
  S105: {
    severity: 'Critical',
    confidence: 'medium',
    meaning: 'a string that looks like a password is assigned',
    extraLimitations: ['A match is not proof the value is a real secret; test fixtures and placeholders look identical.'],
  },
  S106: {
    severity: 'Critical',
    confidence: 'medium',
    meaning: 'a password-shaped value is passed straight into a function call',
  },
  S107: {
    severity: 'Critical',
    confidence: 'medium',
    meaning: 'a function defaults to a password-shaped value',
  },
  S110: { severity: 'Medium', confidence: 'high', meaning: 'an exception is caught and discarded with `pass`' },
  S301: { severity: 'High', confidence: 'high', meaning: 'pickle deserialises arbitrary code from the bytes it reads' },
  S307: { severity: 'High', confidence: 'high', meaning: 'eval runs whatever string reaches it' },
  S324: { severity: 'Medium', confidence: 'high', meaning: 'the hash function is broken for security use' },
  S602: { severity: 'High', confidence: 'medium', meaning: 'the command is handed to a shell, so quoting and metacharacters matter', extraLimitations: ['Whether that is a real problem depends on whether an attacker can influence the string.'] },
  S605: { severity: 'High', confidence: 'medium', meaning: 'a shell is started with a command string' },
  S607: { severity: 'Medium', confidence: 'high', meaning: 'the program is started from a relative path, which depends on what PATH holds at that moment' },
  S608: {
    severity: 'High',
    confidence: 'low',
    meaning: 'an SQL string is assembled from pieces instead of written whole',
    extraLimitations: [
      'This is a shape, not a data-flow result: concatenation is only dangerous when an untrusted value reaches it, and nothing here proves that it does.',
      'Ruff sees one file; the value may be built somewhere else.',
    ],
  },
}

export interface RuffLocation {
  row: number
  column: number
}

export interface RuffDiagnostic {
  code: string | null
  message: string
  start_location: RuffLocation
  end_location: RuffLocation
}

let ruffPromise: Promise<void> | null = null

export function initRuffEngine(
  maxBytes: number,
  signal?: AbortSignal | null,
  onDownloading?: (url: string) => void,
): Promise<void> {
  ruffPromise ??= (async () => {
    onDownloading?.(RUFF_WASM_URL)
    const bytes = await fetchCapped(RUFF_WASM_URL, maxBytes, signal)
    await initRuff({ module_or_path: bytes })
  })().catch((error: unknown) => {
    ruffPromise = null
    throw error
  })
  return ruffPromise
}

/** Exported so the real-grammar test builds the same workspace the worker does. */
export const RUFF_SETTINGS = {
  'line-length': 120,
  'indent-width': 4,
  format: { 'quote-style': 'double', 'indent-style': 'space' },
  lint: { select: [...SELECT] },
} as const

export const RUFF_SELECTED_RULES: readonly string[] = SELECT

/**
 * One `Workspace` per worker run. `check` is synchronous inside the wasm and returns the
 * diagnostics for the text it is given; positions are UTF-16 code units, which is how
  JavaScript strings are indexed.
 */
export class RuffRunner {
  private workspace: Workspace | null = null

  async start(maxBytes: number, signal?: AbortSignal | null, onDownloading?: (url: string) => void): Promise<void> {
    await initRuffEngine(maxBytes, signal, onDownloading)
    this.workspace ??= new Workspace(RUFF_SETTINGS, PositionEncoding.Utf16)
  }

  version(): string {
    try {
      return Workspace.version()
    } catch {
      return 'unknown'
    }
  }

  free(): void {
    this.workspace?.free()
    this.workspace = null
  }

  check(text: string): RuffDiagnostic[] {
    if (!this.workspace) throw new Error('Ruff was not started.')
    const result = this.workspace.check(text)
    if (Array.isArray(result)) return result as RuffDiagnostic[]
    if (result && typeof result === 'object' && Array.isArray((result as { diagnostics?: unknown }).diagnostics)) {
      return (result as { diagnostics: RuffDiagnostic[] }).diagnostics
    }
    return []
  }
}

/** Maps a Ruff code to a BugPilot finding; an unknown code is reported with low confidence. */
export function ruffHitToEngineHit(
  diagnostic: RuffDiagnostic,
  file: RuleFile,
): EngineHit | null {
  const code = diagnostic.code ?? ''
  const shortCode = code.split('[')[0] ?? code
  const spec = RULE_SPECS[shortCode]
  const lineIndex = Math.max(0, Math.min(file.lines.length - 1, diagnostic.start_location.row - 1))
  const range = {
    startLine: diagnostic.start_location.row,
    startColumn: diagnostic.start_location.column + 1,
    endLine: Math.max(diagnostic.start_location.row, diagnostic.end_location.row),
    endColumn: Math.max(diagnostic.start_location.column + 1, diagnostic.end_location.column + 1),
  }

  // Measured against the shipped binary: a file Ruff cannot parse comes back with the code
  // `invalid-syntax` (older builds used `E999`/`SyntaxError`, and a missing code is the same
  // case). It is a syntax finding, not a style finding, and its position is the tokenizer's.
  const isSyntax = shortCode === 'E999' || shortCode === 'SyntaxError' || shortCode === 'invalid-syntax' || code === ''
  const severity: Severity = spec?.severity ?? (isSyntax ? 'High' : 'Medium')
  const level = spec?.confidence ?? (isSyntax ? 'high' : 'low')

  return {
    ruleId: `ruff/${shortCode || 'syntax-error'}`,
    engine: 'ruff',
    tier: isSyntax ? 'syntax' : 'pattern',
    severity,
    confidence: {
      level,
      reason: isSyntax
        ? 'Ruff could not parse this file, so the position comes from the tokenizer.'
        : spec
          ? `Ruff rule ${shortCode} reports ${spec.meaning}; it reads one file at a time and does not follow values.`
          : `Ruff reported a rule BugPilot has no description for (${shortCode}); the engine's own text is shown.`,
    },
    range,
    evidence: [lineEvidence(file, lineIndex, redactIfCredential(quoteLine(file.lines[lineIndex] ?? '')))],
    message: isSyntax
      ? `Syntax error: ${redactCredentialInMessage(diagnostic.message)}`
      : `${redactCredentialInMessage(diagnostic.message)} (${shortCode})`,
    explanation: isSyntax
      ? 'Ruff stopped parsing this file at the quoted line. Everything after it in this file is unparsed.'
      : `Ruff rule ${shortCode} fired because ${spec?.meaning ?? 'of the reason in the message above'}.`,
    fix: manualFix(
      isSyntax
        ? 'Repair the syntax at the quoted line; nothing else in this file can be trusted until Ruff parses it.'
        : 'Change the code, then run Ruff or your own Python linter over the file again.',
      'This rule only reports what it sees in this file.',
      'manual-only',
      'The Ruff WebAssembly build exposes no automatic fix, so the engine cannot propose an edit BugPilot could verify.',
    ),
    verificationSteps: [
      `Open line ${range.startLine} and read the quoted line against Ruff's message.`,
      'Run `ruff check` (the native tool) on the same file: it is the authority on what this rule means.',
    ],
    limitations: [
      'Ruff in this build checks one file with no imports resolved and no types inferred.',
      ...(spec?.extraLimitations ?? []),
      'No automatic change is offered for Python: every Ruff finding needs a person to decide.',
    ],
  }
}
