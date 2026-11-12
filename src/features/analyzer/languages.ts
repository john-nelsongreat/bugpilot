import type { SourceLanguage } from './archive/classify'
import { enginesFor, grammarFor } from './engines/registry'
import type { CoverageTier } from './types'

export const LANGUAGE_LABELS: Record<SourceLanguage, string> = {
  javascript: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  typescript: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  python: 'Python',
  java: 'Java',
  kotlin: 'Kotlin',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  go: 'Go',
  rust: 'Rust',
  c: 'C',
  cpp: 'C++',
  swift: 'Swift',
  scala: 'Scala',
  shell: 'Shell',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  template: 'Template markup',
  markdown: 'Markdown',
  text: 'Plain text',
  unknown: 'Unrecognised file type',
}

const TS_FAMILY: readonly SourceLanguage[] = ['javascript', 'jsx', 'typescript', 'tsx']

export function isTsFamily(language: SourceLanguage): boolean {
  return TS_FAMILY.includes(language)
}

const PATTERN_ONLY_REASON =
  'Only BugPilot pattern rules run on this language; no syntax engine is bundled for it.'

export function tierAvailability(language: SourceLanguage): CoverageTier[] {
  if (isTsFamily(language)) {
    return [
      {
        tier: 'syntax',
        available: true,
        ran: false,
        reason: 'TypeScript parser, syntax diagnostics only (no types or imports).',
      },
      {
        tier: 'pattern',
        available: true,
        ran: false,
        reason: 'BugPilot generic and secret pattern rules.',
      },
    ]
  }
  if (language === 'json') {
    return [
      {
        tier: 'syntax',
        available: true,
        ran: false,
        reason: 'Strict JSON.parse syntax check.',
      },
      {
        tier: 'pattern',
        available: true,
        ran: false,
        reason: 'BugPilot generic and secret pattern rules.',
      },
    ]
  }

  if (language === 'template') {
    return [
      {
        tier: 'syntax',
        available: false,
        ran: false,
        reason:
          'No syntax engine runs on template files: the bundled HTML and JavaScript grammars cannot read <% %> directives, so the file is recorded as un-checked instead of reported on.',
      },
      {
        tier: 'pattern',
        available: true,
        ran: false,
        reason: 'BugPilot generic and secret pattern rules.',
      },
    ]
  }

  const engines = enginesFor(language)
  if (engines?.grammar) {
    const patternParts = ['BugPilot generic and secret pattern rules', 'tree-sitter AST rules']
    if (engines.engines.includes('ruff')) patternParts.push('Ruff lint rules')
    return [
      {
        tier: 'syntax',
        available: true,
        ran: false,
        reason: `tree-sitter ${engines.grammar} grammar: ERROR and MISSING nodes only, no compiler.`,
      },
      {
        tier: 'pattern',
        available: true,
        ran: false,
        reason: `${patternParts.join(' and ')}.`,
      },
    ]
  }

  return [
    {
      tier: 'syntax',
      available: false,
      ran: false,
      reason: `No ${LANGUAGE_LABELS[language]} syntax engine is bundled.`,
    },
    {
      tier: 'pattern',
      available: true,
      ran: false,
      reason: PATTERN_ONLY_REASON,
    },
  ]
}

/** Languages a deep engine can open at all; the page uses it to decide what to offer. */
export function hasDeepEngine(language: SourceLanguage): boolean {
  const engines = enginesFor(language)
  return engines !== null && (engines.grammar !== null || engines.engines.length > 0)
}

export function grammarLabel(language: SourceLanguage): string | null {
  return grammarFor(language)
}

/** One line for every language a deep engine now covers; the rest keep the slice A text. */
const ENGINE_NOT_CHECKED: Record<string, string[]> = {
  python: [
    'No type checking, import resolution, or data-flow: Ruff reads one file at a time with no project context.',
    'The Ruff WebAssembly build exposes no automatic fix, so Python findings are manual-only and never appear in a clean export.',
    'Nothing is executed: no interpreter, no test run, no dependency install.',
  ],
  java: [
    'No compiler, type, or data-flow analysis: tree-sitter only reports what it cannot parse and what its queries match.',
    'No lint rules beyond the AST rules listed in the README.',
    'Engine findings are manual-only; no automatic change is offered for Java.',
  ],
  kotlin: [
    'No compiler or type analysis; the Kotlin grammar is large (4 MiB) and is only fetched when a .kt file is present.',
    'No AST rules are written for Kotlin yet: this language gets syntax coverage only.',
    'Engine findings are manual-only.',
  ],
  csharp: [
    'No compiler, type, or data-flow analysis.',
    'The C# grammar is the largest shipped (5.3 MiB) and is only fetched for a .cs file.',
    'Engine findings are manual-only.',
  ],
  php: [
    'No runtime, type, or data-flow analysis; the grammar treats the whole file as PHP, so template markup can look like code.',
    'Only the AST rules listed in the README run.',
    'Engine findings are manual-only.',
  ],
  ruby: [
    'No interpreter, type, or data-flow analysis.',
    'Only the AST rules listed in the README run.',
    'Engine findings are manual-only.',
  ],
  go: [
    'No compiler, type, or data-flow analysis; `go vet` style checks are not run.',
    'Only the AST rules listed in the README run.',
    'Engine findings are manual-only.',
  ],
  rust: [
    'No compiler or borrow-checker: only the tree-sitter grammar reads this file.',
    'Only the AST rules listed in the README run.',
    'Engine findings are manual-only.',
  ],
  c: [
    'No compiler, preprocessor expansion, or memory-safety analysis: `#include` bodies are not read.',
    'Only the AST rules listed in the README run.',
    'Engine findings are manual-only.',
  ],
  cpp: [
    'No compiler, template, or memory-safety analysis; headers and templates are not resolved.',
    'Only the AST rules listed in the README run.',
    'Engine findings are manual-only.',
  ],
  swift: [
    'No compiler or type analysis; the Swift grammar is large (3.3 MiB) and only loads for a .swift file.',
    'Only the AST rules listed in the README run.',
    'Engine findings are manual-only.',
  ],
  shell: [
    'No ShellCheck rules and no execution: the bash grammar reports parse failures and nothing else.',
    'Variables, quoting, and control flow are not evaluated.',
  ],
  sql: [
    'The SQL grammar is not trusted for syntax claims: in the spike it reported errors in valid files, so BugPilot records it as missing coverage instead of as a bug.',
    'No dialect, schema, or performance checks.',
  ],
  yaml: [
    'The YAML grammar is not trusted for syntax claims: in the spike it reported errors in valid files, so BugPilot records it as missing coverage instead of as a bug.',
    'No anchor, alias, or schema checks.',
  ],
  html: [
    'Embedded scripts and styles are not parsed as JavaScript or CSS.',
    'No accessibility audit and no tag-balance rules beyond what the grammar reports.',
  ],
  css: [
    'No property, value, or browser-compatibility checks.',
    'Only what the grammar reports as unparseable is claimed.',
  ],
}

/**
 * The honest half of the feature: what each language did NOT get checked for.
 * The page prints this verbatim whenever a file of the language was uploaded.
 */
const BASE_NOT_CHECKED: Record<SourceLanguage, string[]> = {
  javascript: [
    'No lint rules (unused variables, unreachable code, risky equality).',
    'No type checking, import resolution, data-flow or taint analysis.',
    'Automatic changes are limited to the verified fixers in the README; every other finding is manual-only.',
  ],
  jsx: [
    'No React or JSX semantics, hooks checks, or accessibility checks.',
    'No type checking, import resolution, data-flow or taint analysis.',
    'Automatic changes are limited to the verified fixers in the README; every other finding is manual-only.',
  ],
  typescript: [
    'No type checking: unresolved imports and undefined names are deliberately suppressed.',
    'No lint rules, data-flow, taint analysis, or project-wide checks.',
    'Automatic changes are limited to the verified fixers in the README; every other finding is manual-only.',
  ],
  tsx: [
    'No React or JSX semantics, hooks checks, or accessibility checks.',
    'No type checking: syntax diagnostics only.',
    'Automatic changes are limited to the verified fixers in the README; every other finding is manual-only.',
  ],
  python: [
    'No Python syntax, indentation, import, or type checks.',
    'No behaviour or data-flow analysis.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  java: [
    'No Java syntax, compiler, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  kotlin: [
    'No Kotlin syntax, compiler, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  csharp: [
    'No C# syntax, compiler, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  php: [
    'No PHP syntax, runtime, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  ruby: [
    'No Ruby syntax, runtime, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  go: [
    'No Go syntax, compiler, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  rust: [
    'No Rust syntax, compiler, borrow-checker, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  c: [
    'No C syntax, compiler, or memory-safety checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  cpp: [
    'No C++ syntax, compiler, or memory-safety checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  swift: [
    'No Swift syntax, compiler, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  scala: [
    'No Scala syntax, compiler, type, or data-flow checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  shell: [
    'No shell parsing or ShellCheck rules.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  sql: [
    'No SQL parsing, dialect, schema, or performance checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  json: [
    'Only strict JSON syntax; no schema, duplicate-key, or type checks.',
    'No semantic checks of what the JSON describes.',
  ],
  yaml: [
    'No YAML parsing, anchor, or schema checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  toml: [
    'No TOML parsing or schema checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  xml: [
    'No XML parsing, DTD, or schema checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  html: [
    'No HTML or CSS syntax checks and no accessibility audit.',
    'Embedded scripts and styles are not parsed as JavaScript or CSS.',
  ],
  css: [
    'No CSS parsing, property, or compatibility checks.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  template: [
    'No template language is analysed. EJS, ERB, Handlebars, Mustache and Twig are recognised so these files can be reported as un-checked honestly, not because they are supported.',
    'Markup, partials, layout inheritance and the expressions inside <% %> tags are not parsed or evaluated.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  markdown: [
    'No Markdown linting; code examples inside fences are not parsed.',
    'Only generic text patterns and credential shapes were checked.',
  ],
  text: ['No language parser; only generic text patterns and credential shapes were checked.'],
  unknown: [
    'The file type was not recognised, so no language parser ran.',
    'Only generic text patterns and credential shapes were checked.',
  ],
}

/**
 * Slice A text for every language, replaced for the languages a deep engine now opens.
 * Both halves are kept so the old wording stays reviewable next to the new one.
 */
export const NOT_CHECKED_BY_LANGUAGE: Record<SourceLanguage, string[]> = {
  ...BASE_NOT_CHECKED,
  ...ENGINE_NOT_CHECKED,
}

export function languageLabel(language: SourceLanguage): string {
  return LANGUAGE_LABELS[language]
}
