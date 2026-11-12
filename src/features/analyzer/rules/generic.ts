import type { DiagnosticEvidence } from '../../../diagnostics/types'
import type { SourceLanguage } from '../archive/classify'
import { MAX_RULE_HITS, lineEvidence, lineIndexAt, quoteLine, rangeForLine, rangeFromOffsets } from './context'
import type { AnalyzerRule, RuleFile, RuleHit } from './types'

const LANGUAGES_WITH_INDENTATION_SEMANTICS: readonly SourceLanguage[] = [
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'python',
  'java',
  'kotlin',
  'csharp',
  'php',
  'ruby',
  'go',
  'rust',
  'c',
  'cpp',
  'swift',
  'scala',
  'shell',
  'sql',
  'json',
  'yaml',
  'toml',
  'xml',
  'html',
  'css',
]

const ALL_TEXT_LANGUAGES_WITH_FALLBACKS: readonly SourceLanguage[] = [
  ...LANGUAGES_WITH_INDENTATION_SEMANTICS,
  'markdown',
  'template',
  'text',
  'unknown',
]

const C_LIKE_EMPTY_CATCH_LANGUAGES: readonly SourceLanguage[] = [
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'java',
  'kotlin',
  'csharp',
  'php',
]

const C_LIKE_EMPTY_CATCH = /\bcatch\s*(?:\([^()\n]*\))?\s*\{\s*\}/g
const GO_EMPTY_ERROR_CHECK = /\bif\s+[^{\n]*\berr\b[^{\n]*!=\s*nil\s*\{\s*\}/g

function evidenceFor(file: RuleFile, lineIndex: number, quote?: string): DiagnosticEvidence[] {
  return [lineEvidence(file, lineIndex, quote)]
}

const mergeConflictRule: AnalyzerRule = {
  id: 'bugpilot/generic/merge-conflict-markers',
  title: 'Merge-conflict markers',
  tier: 'pattern',
  severity: 'High',
  languages: ALL_TEXT_LANGUAGES_WITH_FALLBACKS,
  description: 'Finds git conflict markers (<<<<<<<, =======, >>>>>>>) left in a file.',
  check: (file) => {
    const starts = /^<{7}(?:[ \t]|$)/
    const separator = /^={7}[ \t]*$/
    const close = /^>{7}(?:[ \t]|$)/
    const hits: RuleHit[] = []

    for (let index = 0; index < file.lines.length; index += 1) {
      if (hits.length >= MAX_RULE_HITS) break
      if (!starts.test(file.lines[index])) continue
      let end = index
      let sawSeparator = false
      for (let scan = index + 1; scan < file.lines.length; scan += 1) {
        if (starts.test(file.lines[scan])) break
        if (separator.test(file.lines[scan])) sawSeparator = true
        if (close.test(file.lines[scan])) {
          end = scan
          break
        }
      }
      const range =
        end > index
          ? {
              startLine: index + 1,
              startColumn: 1,
              endLine: end + 1,
              endColumn: Math.max(1, file.lines[end].length + 1),
            }
          : rangeForLine(index, file.lines[index])
      const evidence = [lineEvidence(file, index), ...(end > index ? [lineEvidence(file, end)] : [])]
      hits.push({
        range,
        message: 'Merge-conflict markers are still in this file.',
        explanation: sawSeparator
          ? 'The file contains an opening marker, the ======= separator and a closing marker, so two versions of this region were committed unresolved. The file will not parse in most languages and will not behave as either version intended.'
          : 'The file contains a line that begins with seven < characters, the shape git writes when a merge stops with a conflict. Even without the closing marker this normally means an unresolved conflict was committed.',
        confidence: {
          level: 'high',
          reason: 'Conflict markers are fixed character sequences at the start of a line; they do not occur in ordinary code.',
        },
        evidence,
        fix: {
          explanation:
            'Resolve the conflict by keeping the intended version, delete all marker lines, then run the project tests so both sides of the merge are checked.',
          whereItMayApply:
            'The marker lines and the two versions between them. BugPilot cannot know which side is correct.',
          exampleCode: '',
          riskClass: 'manual-only',
          riskReason: 'Choosing between the two versions needs knowledge of the change that caused the merge.',
        },
        verificationSteps: [
          'Read both sides and the commit that introduced each change.',
          'Remove every <<<<<<<, =======, ||||||| and >>>>>>> line.',
          'Run the tests and a build, then search the tree for remaining markers.',
        ],
        limitations: ['Only markers at the start of a line are recognised; marker text quoted inside a string is not analysed.'],
      })
      index = Math.max(index, end)
    }
    return hits
  },
}

const todoRule: AnalyzerRule = {
  id: 'bugpilot/generic/todo-marker',
  title: 'TODO, FIXME or HACK marker',
  tier: 'pattern',
  severity: 'Low',
  languages: ALL_TEXT_LANGUAGES_WITH_FALLBACKS,
  description: 'Finds TODO, FIXME and HACK markers that mark unfinished work.',
  check: (file) => {
    const marker = /\b(TODO|FIXME|HACK)\b/g
    const seen = new Set<number>()
    const hits: RuleHit[] = []

    for (const match of file.text.matchAll(marker)) {
      if (hits.length >= MAX_RULE_HITS) break
      const offset = match.index ?? 0
      const lineIndex = lineIndexAt(file.lineStarts, offset)
      const key = lineIndex * 10 + (match[1] === 'TODO' ? 0 : match[1] === 'FIXME' ? 1 : 2)
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({
        range: rangeFromOffsets(file.lineStarts, offset, offset + match[0].length),
        message: `${match[1]} marker in this file.`,
        explanation:
          'The marker records unfinished or known-problematic work inside the code. It is not a defect by itself, but markers are easy to forget and often mark a path that was never finished.',
        confidence: {
          level: 'high',
          reason: `The text contains the literal marker ${match[1]}.`,
        },
        evidence: evidenceFor(file, lineIndex),
        fix: {
          explanation:
            'Turn the marker into a tracked ticket, or resolve the work and delete the marker. Deleting it without doing either loses the information.',
          whereItMayApply: 'The line holding the marker.',
          exampleCode: '',
          riskClass: 'manual-only',
          riskReason: 'Only the project owner can decide whether the remaining work is still needed.',
        },
        verificationSteps: ['Copy the marker text into the issue tracker, then remove the marker once the work is done.'],
        limitations: ['The marker is matched wherever it appears, including inside strings and documentation.'],
      })
    }
    return hits
  },
}

const mixedIndentationRule: AnalyzerRule = {
  id: 'bugpilot/generic/mixed-indentation',
  title: 'Mixed tab and space indentation',
  tier: 'pattern',
  severity: 'Low',
  languages: ALL_TEXT_LANGUAGES_WITH_FALLBACKS,
  description: 'Finds files whose leading whitespace uses both tabs and spaces.',
  check: (file) => {
    let firstTab = -1
    let firstSpace = -1
    let tabLines = 0
    let spaceLines = 0

    for (let index = 0; index < file.lines.length; index += 1) {
      const line = file.lines[index]
      if (line.trim() === '') continue
      const lead = /^[ \t]+/.exec(line)
      if (!lead) continue
      if (lead[0][0] === '\t') {
        if (firstTab === -1) firstTab = index
        tabLines += 1
      } else if (lead[0][0] === ' ') {
        if (firstSpace === -1) firstSpace = index
        spaceLines += 1
      }
    }

    if (firstTab === -1 || firstSpace === -1) return []
    const reported = firstTab < firstSpace ? firstSpace : firstTab
    return [
      {
        range: rangeForLine(reported, file.lines[reported]),
        message: 'This file indents lines with both tabs and spaces.',
        explanation: `${tabLines} line(s) start with a tab and ${spaceLines} line(s) start with a space. In languages where indentation carries meaning, such as Python and YAML, the mix can change behaviour or make the file unreadable to some tools. Elsewhere it produces inconsistent diffs.`,
        confidence: {
          level: 'low',
          reason: 'BugPilot compares the first character of leading whitespace only; aligned continuation text can look mixed without being a problem.',
        },
        evidence: evidenceFor(file, reported),
        fix: {
          explanation:
            'Configure the editor for this file type to indent with either tabs or spaces, then reformat the file in one commit. Do not rewrite Python or YAML indentation without running the tests.',
          whereItMayApply: 'Leading whitespace throughout the file, not the content of any line.',
          exampleCode: '',
          riskClass: 'needs-review',
          riskReason: 'Reformatting can change block structure in indentation-sensitive languages.',
        },
        verificationSteps: [
          'Check the project editor configuration for the chosen indentation style.',
          'Run the formatter and review the diff for accidental block changes.',
          'Run the tests and linter for the file.',
        ],
        limitations: ['Inline alignment spaces after a tab are counted as tab indentation, not as a mix.'],
      },
    ]
  },
}

const LONG_LINE_CHARACTERS = 1_000
const LARGE_FILE_LINES = 4_000
const LARGE_FILE_CHARACTERS = 512 * 1_024

const longLineRule: AnalyzerRule = {
  id: 'bugpilot/generic/long-line',
  title: 'Very long lines',
  tier: 'pattern',
  severity: 'Low',
  languages: ALL_TEXT_LANGUAGES_WITH_FALLBACKS,
  description: `Finds lines longer than ${LONG_LINE_CHARACTERS.toLocaleString('en-US')} characters.`,
  check: (file) => {
    let count = 0
    let worstIndex = -1
    let worstLength = 0
    for (let index = 0; index < file.lines.length; index += 1) {
      const length = file.lines[index].length
      if (length <= LONG_LINE_CHARACTERS) continue
      count += 1
      if (length > worstLength) {
        worstLength = length
        worstIndex = index
      }
    }
    if (count === 0) return []
    return [
      {
        range: rangeForLine(worstIndex, file.lines[worstIndex]),
        message: `${count} line${count === 1 ? '' : 's'} longer than ${LONG_LINE_CHARACTERS.toLocaleString('en-US')} characters.`,
        explanation: `The longest line is ${worstLength.toLocaleString('en-US')} characters. Very long lines are hard to review and diff, and they often mean a literal was pasted in a form that cannot be checked by reading.`,
        confidence: {
          level: 'high',
          reason: 'Line length is measured directly; the threshold is a readability choice, not a correctness rule.',
        },
        evidence: evidenceFor(file, worstIndex),
        fix: {
          explanation: 'Split the value into named parts or load it from a data file, then wrap the code at the project line-length setting.',
          whereItMayApply: 'The quoted line and any other line over the threshold.',
          exampleCode: '',
          riskClass: 'needs-review',
          riskReason: 'Splitting a string literal can change its exact contents.',
        },
        verificationSteps: ['Confirm the long value is not a generated or minified asset.', 'Refactor in a way that preserves the exact bytes of any literal.'],
        limitations: ['Generated bundles and data files were already skipped by the archive reader; this rule only sees files that reached analysis.'],
      },
    ]
  },
}

const largeFileRule: AnalyzerRule = {
  id: 'bugpilot/generic/large-file',
  title: 'Large source file',
  tier: 'pattern',
  severity: 'Low',
  languages: ALL_TEXT_LANGUAGES_WITH_FALLBACKS,
  description: `Finds files over ${LARGE_FILE_LINES.toLocaleString('en-US')} lines or ${Math.round(LARGE_FILE_CHARACTERS / 1_024).toLocaleString('en-US')} KiB of text.`,
  check: (file) => {
    if (file.lines.length <= LARGE_FILE_LINES && file.text.length <= LARGE_FILE_CHARACTERS) return []
    return [
      {
        range: rangeForLine(0, file.lines[0] ?? ''),
        message: `Large file: ${file.lines.length.toLocaleString('en-US')} lines, ${file.text.length.toLocaleString('en-US')} characters.`,
        explanation:
          'Files this large are reviewed less carefully and are more likely to hide a problem in a region nobody re-reads. Size alone is not a defect, so this is reported as a maintenance observation.',
        confidence: {
          level: 'high',
          reason: 'The size is measured directly from the file that was read.',
        },
        evidence: evidenceFor(file, 0),
        fix: {
          explanation: 'Split the file along the responsibilities it already contains, without changing behaviour.',
          whereItMayApply: 'The file as a whole.',
          exampleCode: '',
          riskClass: 'manual-only',
          riskReason: 'Deciding module boundaries requires understanding the code, not just its size.',
        },
        verificationSteps: ['Identify the separate concerns in the file.', 'Move one concern at a time and run the tests after each move.'],
        limitations: ['Generated files that were not caught by the folder rules can trigger this observation.'],
      },
    ]
  },
}

const emptyCatchRule: AnalyzerRule = {
  id: 'bugpilot/generic/empty-catch',
  title: 'Empty error handler',
  tier: 'pattern',
  severity: 'Low',
  languages: [...C_LIKE_EMPTY_CATCH_LANGUAGES, 'python', 'ruby', 'go'] as readonly SourceLanguage[],
  description: 'Finds empty catch, except, rescue and error-check blocks in common languages.',
  check: (file) => {
    const hits: RuleHit[] = []

    const pushHit = (index: number, length: number, what: string) => {
      if (hits.length >= MAX_RULE_HITS) return
      const lineStarts = file.lineStarts
      const lineIndex = lineIndexAt(lineStarts, index)
      hits.push({
        range: rangeFromOffsets(lineStarts, index, index + length),
        message: `Empty ${what}.`,
        explanation:
          'The handler catches the error and immediately does nothing. The failure disappears silently, and the code continues in a state the error was warning about.',
        confidence: {
          level: 'low',
          reason: 'An empty handler is legal and is sometimes a deliberate choice; the pattern cannot tell whether the error was meant to be ignored.',
        },
        evidence: evidenceFor(file, lineIndex),
        fix: {
          explanation:
            'Handle the error, rethrow it with context, or add a comment that states why ignoring it is safe. An empty block without a reason hides failures.',
          whereItMayApply: 'The handler block; the correct action depends on what the surrounding code promises.',
          exampleCode: '',
          riskClass: 'needs-review',
          riskReason: 'Changing error handling changes behaviour and can surface errors that were previously swallowed.',
        },
        verificationSteps: [
          'Decide whether the failure is safe to ignore.',
          'If it is, add a comment explaining why; if not, log or rethrow with context.',
          'Run the tests that exercise the failure path.',
        ],
        limitations: ['Only literally empty blocks are found. A handler that contains a comment or a single no-op statement is not reported.'],
      })
    }

    if (C_LIKE_EMPTY_CATCH_LANGUAGES.includes(file.language)) {
      C_LIKE_EMPTY_CATCH.lastIndex = 0
      for (const match of file.text.matchAll(C_LIKE_EMPTY_CATCH)) {
        pushHit(match.index ?? 0, match[0].length, 'catch block')
      }
    }

    if (file.language === 'go') {
      GO_EMPTY_ERROR_CHECK.lastIndex = 0
      for (const match of file.text.matchAll(GO_EMPTY_ERROR_CHECK)) {
        pushHit(match.index ?? 0, match[0].length, 'error check')
      }
    }

    if (file.language === 'python') {
      for (let index = 0; index < file.lines.length; index += 1) {
        const line = file.lines[index]
        const match = /^([ \t]*)except\b[^:\n]*:(.*)$/.exec(line)
        if (!match) continue
        const rest = match[2].trim()
        if (/^(?:pass|\.\.\.)\s*(?:#.*)?$/.test(rest)) {
          pushHit(file.lineStarts[index], line.length, 'except block')
          continue
        }
        if (rest !== '' && !rest.startsWith('#')) continue
        let next = index + 1
        while (next < file.lines.length && file.lines[next].trim() === '') next += 1
        if (next >= file.lines.length) continue
        const body = file.lines[next]
        const bodyIndent = /^[ \t]*/.exec(body)?.[0].length ?? 0
        if (bodyIndent > match[1].length && /^(?:pass|\.\.\.)\s*(?:#.*)?$/.test(body.trim())) {
          pushHit(file.lineStarts[index], line.length, 'except block')
        }
      }
    }

    if (file.language === 'ruby') {
      for (let index = 0; index < file.lines.length; index += 1) {
        const line = file.lines[index]
        if (!/^[ \t]*rescue\b/.test(line)) continue
        let next = index + 1
        while (next < file.lines.length && file.lines[next].trim() === '') next += 1
        if (next < file.lines.length && /^[ \t]*end\b/.test(file.lines[next])) {
          pushHit(file.lineStarts[index], line.length, 'rescue block')
        }
      }
    }

    return hits
  },
}

const HTTP_URL = /\bhttp:\/\/[^\s"'`<>)\]}]+/gi
const MAX_HTTP_HITS = 10

function httpHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isLocalOrDocumentationHost(hostname: string): boolean {
  if (hostname === '') return true
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.example') ||
    hostname === 'example.com' ||
    hostname === 'example.org' ||
    hostname === 'example.net'
  ) {
    return true
  }
  if (/^(?:0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|\[::1\])$/.test(hostname)) {
    return true
  }
  return (
    hostname === 'www.w3.org' ||
    hostname === 'w3.org' ||
    hostname === 'json-schema.org' ||
    hostname === 'opensource.org' ||
    hostname.startsWith('schemas.') ||
    hostname.startsWith('xmlns.') ||
    hostname.endsWith('.apache.org')
  )
}

const insecureHttpRule: AnalyzerRule = {
  id: 'bugpilot/generic/insecure-http-url',
  title: 'http:// URL',
  tier: 'pattern',
  severity: 'Low',
  languages: ALL_TEXT_LANGUAGES_WITH_FALLBACKS,
  description: 'Finds literal http:// URLs that are not local or documentation hosts.',
  check: (file) => {
    const hits: RuleHit[] = []
    HTTP_URL.lastIndex = 0
    for (const match of file.text.matchAll(HTTP_URL)) {
      if (hits.length >= MAX_HTTP_HITS) break
      const raw = match[0].replace(/[.,;:!?]+$/, '')
      const hostname = httpHostname(raw)
      if (isLocalOrDocumentationHost(hostname)) continue
      const index = match.index ?? 0
      const lineIndex = lineIndexAt(file.lineStarts, index)
      hits.push({
        range: rangeFromOffsets(file.lineStarts, index, index + raw.length),
        message: 'Literal URL uses the http scheme.',
        explanation:
          'The address is hard-coded with http://, so the request and response travel without transport encryption and can be changed in transit. Many hosts support https://; the literal may also belong in configuration rather than in source.',
        confidence: {
          level: 'medium',
          reason: 'The scheme is certain, but BugPilot cannot tell whether this host supports HTTPS or whether the request is already upgraded elsewhere.',
        },
        evidence: evidenceFor(file, lineIndex, quoteLine(raw)),
        fix: {
          explanation: 'Use https:// if the host supports it, and move environment-specific URLs into configuration.',
          whereItMayApply: 'The quoted URL.',
          exampleCode: '',
          riskClass: 'needs-review',
          riskReason: 'Some legacy hosts do not serve HTTPS, and changing the scheme can break the request.',
        },
        verificationSteps: ['Open the same address with https:// and confirm the certificate and response.', 'Update the call site or configuration and test the request.'],
        limitations: ['URLs assembled at run time and URLs inside skipped files are not checked.'],
      })
    }
    return hits
  },
}

const mixedLineEndingsRule: AnalyzerRule = {
  id: 'bugpilot/generic/mixed-line-endings',
  title: 'Mixed CRLF and LF line endings',
  tier: 'pattern',
  severity: 'Low',
  languages: ALL_TEXT_LANGUAGES_WITH_FALLBACKS,
  description: 'Finds text files that end some lines with CRLF and others with a bare LF.',
  check: (file) => {
    // A binary payload never reaches the rules, but a cheap guard keeps the count honest anyway.
    if (file.text.includes('\u0000')) return []
    let crlfLines = 0
    let bareLfLines = 0
    let firstChange = -1
    for (let index = 0; index < file.lines.length; index += 1) {
      const line = file.lines[index]
      // Splitting always leaves an empty final element after a trailing \n, and a final line with
      // no terminator has no ending to judge.
      if (index === file.lines.length - 1 && (line === '' || !file.text.endsWith('\n'))) continue
      const isCrlf = line.endsWith('\r')
      if (isCrlf) crlfLines += 1
      else bareLfLines += 1
      if (crlfLines > 0 && bareLfLines > 0 && firstChange === -1) firstChange = index
    }
    if (firstChange === -1) return []
    return [
      {
        range: rangeForLine(firstChange, file.lines[firstChange]),
        message: `This file ends ${crlfLines} line(s) with CRLF and ${bareLfLines} line(s) with a bare LF.`,
        explanation:
          'The file mixes Windows-style and Unix-style line endings. The first style change is on the quoted line. Mixed endings make every diff noisier and can break tools that treat the file as a whole; a file that uses one style everywhere is not reported.',
        confidence: {
          level: 'high',
          reason: 'The line terminators are measured directly from the bytes that were read.',
        },
        evidence: evidenceFor(file, firstChange),
        fix: {
          explanation:
            'Choose the line-ending style the project already uses (usually declared in .gitattributes or .editorconfig) and normalise the file to it in one commit.',
          whereItMayApply: 'Line terminators throughout the file, not the content of any line.',
          exampleCode: '',
          riskClass: 'needs-review',
          riskReason: 'Rewriting terminators rewrites every line of the diff, so the change must land alone to stay reviewable.',
        },
        verificationSteps: [
          'Check .gitattributes or .editorconfig for the project style.',
          'Normalise the file to that style and review the diff, which should show no content change.',
          'Run the tests and linter for the file.',
        ],
        limitations: [
          'Only CRLF mixed with bare LF is reported; files that use one style everywhere, or CR-only old-Mac endings, are not flagged.',
          'Generated and binary files never reach this rule.',
        ],
      },
    ]
  },
}

export const genericRules: readonly AnalyzerRule[] = [
  mergeConflictRule,
  todoRule,
  mixedIndentationRule,
  mixedLineEndingsRule,
  longLineRule,
  largeFileRule,
  emptyCatchRule,
  insecureHttpRule,
]
