import type { SourceLanguage } from './archive/classify'
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
  markdown: 'Markdown',
  text: 'Plain text',
  unknown: 'Unrecognised file type',
}

const TS_FAMILY: readonly SourceLanguage[] = ['javascript', 'jsx', 'typescript', 'tsx']

export function isTsFamily(language: SourceLanguage): boolean {
  return TS_FAMILY.includes(language)
}

const PATTERN_ONLY_REASON =
  'Only BugPilot pattern rules run on this language in slice A; no syntax or type engine was bundled.'

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
  return [
    {
      tier: 'syntax',
      available: false,
      ran: false,
      reason: `No ${LANGUAGE_LABELS[language]} syntax engine is bundled in slice A.`,
    },
    {
      tier: 'pattern',
      available: true,
      ran: false,
      reason: PATTERN_ONLY_REASON,
    },
  ]
}

/**
 * The honest half of the feature: what each language did NOT get checked for.
 * The page prints this verbatim whenever a file of the language was uploaded.
 */
export const NOT_CHECKED_BY_LANGUAGE: Record<SourceLanguage, string[]> = {
  javascript: [
    'No lint rules (unused variables, unreachable code, risky equality).',
    'No type checking, import resolution, data-flow or taint analysis.',
    'No automatic code changes or clean-version export.',
  ],
  jsx: [
    'No React or JSX semantics, hooks checks, or accessibility checks.',
    'No type checking, import resolution, data-flow or taint analysis.',
    'No automatic code changes or clean-version export.',
  ],
  typescript: [
    'No type checking: unresolved imports and undefined names are deliberately suppressed.',
    'No lint rules, data-flow, taint analysis, or project-wide checks.',
    'No automatic code changes or clean-version export.',
  ],
  tsx: [
    'No React or JSX semantics, hooks checks, or accessibility checks.',
    'No type checking: syntax diagnostics only.',
    'No lint rules, data-flow, taint analysis, or automatic fixes.',
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

export function languageLabel(language: SourceLanguage): string {
  return LANGUAGE_LABELS[language]
}
