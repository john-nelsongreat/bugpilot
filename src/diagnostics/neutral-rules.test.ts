import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import {
  DIAGNOSTIC_CATEGORY_LABELS,
  diagnosticCategoryLabel,
} from './labels'
import { neutralRules } from './rules/neutral'
import type { DiagnosticLanguage, DiagnosticResult } from './types'

const MODES: readonly DiagnosticLanguage[] = ['auto', 'python', 'javascript']

/**
 * Evidence quotes and the confidence reason name the line a message was read
 * on, so a longer paste legitimately shifts them. Comparisons across pastes of
 * different length compare everything else.
 */
function diagnosis(result: DiagnosticResult): unknown {
  return {
    ...result,
    confidence: {
      level: result.confidence.level,
      reason: result.confidence.reason.replace(/on line \d+/gu, 'on line N'),
    },
    evidence: result.evidence.map((entry) => ({
      source: entry.source,
      label: entry.label,
      quote: entry.quote,
    })),
  }
}

const NOT_A_REPOSITORY =
  'fatal: not a git repository (or any of the parent directories): .git'

const UNKNOWN_FATAL = 'fatal: bad object 0123456789abcdef'

describe('language-neutral rule support in the engine', () => {
  it('registers one neutral rule that declares no programming language', () => {
    expect(neutralRules).toHaveLength(1)
    expect(neutralRules[0].id).toBe('tool.git-error')
    expect(neutralRules[0].language).toBe('any')
    expect(neutralRules[0].category).toBe('git-error')
  })

  it('gives the git-error category a readable detail-page label', () => {
    expect(DIAGNOSTIC_CATEGORY_LABELS['git-error']).toBe('Git error')
    expect(diagnosticCategoryLabel('git-error')).toBe('Git error')
    expect(diagnosticCategoryLabel('git-error')).not.toBe('git-error')
    expect(diagnosticCategoryLabel('git-error')).toMatch(/^[A-Z]/)
  })

  it('recognises the same Git paste identically in every language mode', () => {
    for (const errorText of [NOT_A_REPOSITORY, UNKNOWN_FATAL]) {
      const results = MODES.map((language) =>
        diagnose({ language, errorText }),
      )
      const first = results[0]

      expect(first.category).toBe('git-error')
      for (const result of results) {
        expect(result).toEqual(first)
      }

      const rendered = JSON.stringify(first)
      expect(rendered).not.toMatch(/Python|JavaScript|runtime/)
      expect(first.confidence.reason).toMatch(/^[A-Z]/)
      expect(first.confidence.reason).toMatch(/[.!]$/)
    }
  })

  it('does not lower a neutral match for a selected-language conflict', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "app.py", line 4, in load',
      'PS C:\\Users\\dev\\app> node index.js',
      NOT_A_REPOSITORY,
    ].join('\n')
    const auto = diagnose({ language: 'auto', errorText })
    const javascript = diagnose({ language: 'javascript', errorText })

    expect(auto.category).toBe('git-error')
    expect(javascript).toEqual(auto)
    expect(auto.confidence.reason).not.toMatch(/conflict|uncertain/)
  })

  it('raises a neutral match on signature specificity alone', () => {
    const withoutClues = diagnose({ language: 'auto', errorText: UNKNOWN_FATAL })
    const withClues = diagnose({
      language: 'auto',
      errorText: `Traceback (most recent call last):\n  File "app.py", line 4, in load\n${UNKNOWN_FATAL}`,
    })

    expect(withoutClues.confidence.level).toBe(
      withClues.confidence.level,
    )
    expect(diagnosis(withoutClues)).toEqual(diagnosis(withClues))
  })

  it('never lets a neutral rule take a line a language rule already claimed', () => {
    const python = diagnose({
      language: 'auto',
      errorText: [
        'Traceback (most recent call last):',
        '  File "app.py", line 4, in load',
        NOT_A_REPOSITORY,
        "ModuleNotFoundError: No module named 'requests'",
      ].join('\n'),
    })

    expect(python.category).toBe('missing-module')
    expect(python.confidence.level).toBe('high')

    const javascript = diagnose({
      language: 'auto',
      errorText: [
        'PS C:\\Users\\dev\\app> git push',
        "error: failed to push some refs to 'https://github.com/dev/app.git'",
        "TypeError: Cannot read properties of undefined (reading 'name')",
      ].join('\n'),
    })

    expect(javascript.category).toBe('type-mismatch')
  })

  it('keeps an existing language diagnosis unchanged when a Git line is added', () => {
    const withoutGit = diagnose({
      language: 'auto',
      errorText: [
        'Traceback (most recent call last):',
        '  File "app.py", line 4, in load',
        "ModuleNotFoundError: No module named 'requests'",
      ].join('\n'),
    })
    const withGit = diagnose({
      language: 'auto',
      errorText: [
        'Traceback (most recent call last):',
        '  File "app.py", line 4, in load',
        'hint: using the wrong folder is a common mistake',
        NOT_A_REPOSITORY,
        "ModuleNotFoundError: No module named 'requests'",
      ].join('\n'),
    })

    expect(diagnosis(withGit)).toEqual(diagnosis(withoutGit))

    const corsPaste = [
      "Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
      'Uncaught (in promise) TypeError: Failed to fetch',
    ].join('\n')
    const jsWithout = diagnose({ language: 'auto', errorText: corsPaste })
    const jsWith = diagnose({
      language: 'auto',
      errorText: [
        'hint: the remote end hung up unexpectedly',
        NOT_A_REPOSITORY,
        corsPaste,
      ].join('\n'),
    })

    expect(diagnosis(jsWith)).toEqual(diagnosis(jsWithout))
    expect(jsWithout.category).toBe('cors-blocked')
  })

  it('diagnoses the Git line when a traceback sits above it', () => {
    for (const language of MODES) {
      const result = diagnose({
        language,
        errorText: [
          'Traceback (most recent call last):',
          '  File "app.py", line 4, in load',
          NOT_A_REPOSITORY,
        ].join('\n'),
      })

      expect(result.category).toBe('git-error')
    }
  })

  it('quotes the recognised Git line with its line number', () => {
    const result = diagnose({
      language: 'auto',
      errorText: `PS C:\\Users\\dev\\project> git status\n${NOT_A_REPOSITORY}`,
    })

    expect(result.evidence).toEqual([
      {
        source: 'error text',
        label: 'Final exception line',
        quote: NOT_A_REPOSITORY,
        lineNumber: 2,
      },
    ])
  })

  it('falls back to a low-confidence quotation for any other fatal line', () => {
    const result = diagnose({
      language: 'auto',
      errorText: [
        'PS C:\\Users\\dev\\app> git fetch',
        UNKNOWN_FATAL,
        'hint: the remote end hung up unexpectedly',
        'PS C:\\Users\\dev\\app>',
      ].join('\n'),
    })

    expect(result.category).toBe('git-error')
    expect(result.confidence.level).toBe('low')
    expect(result.matchedSignature).toBe('fatal: <message Git reported>')
    expect(result.likelyCause).toContain('bad object 0123456789abcdef')
    expect(result.likelyCause).toMatch(/no specific rule/)
    expect(result.debuggingSteps.join('\n')).toContain('git status')
    expect(result.debuggingSteps.join('\n')).toMatch(/hint/)
    expect(result.limitations.join(' ')).toMatch(/does not claim a cause/)
    expect(result.possibleFix).not.toBeNull()
    expect((result.possibleFix as { explanation: string }).explanation).toMatch(
      /No fix is offered/,
    )
    expect(result.possibleFix?.exampleCode).toMatch(/^cd /)
  })

  it('skips hint and remote lines when choosing which line to diagnose', () => {
    const result = diagnose({
      language: 'auto',
      errorText: [
        'PS C:\\Users\\dev\\app> git fetch',
        'To https://github.com/dev/app.git',
        'hint: some explanatory hint',
        UNKNOWN_FATAL,
        'hint: another explanatory hint',
        'PS C:\\Users\\dev\\app>',
      ].join('\n'),
    })

    expect(result.category).toBe('git-error')
    expect(result.evidence).toEqual([
      {
        source: 'error text',
        label: 'Final exception line',
        quote: 'PS C:\\Users\\dev\\app>',
        lineNumber: 6,
      },
      {
        source: 'error text',
        label: 'Matched context line',
        quote: UNKNOWN_FATAL,
        lineNumber: 4,
      },
    ])
  })

  it('leaves empty and oversized input handling unchanged', () => {
    for (const language of MODES) {
      const empty = diagnose({ language, errorText: '   \n\t\n' })
      expect(empty.category).toBe('unrecognized')
      expect(empty.likelyCause).toContain('No error text was provided')

      const oversized = diagnose({
        language,
        errorText: `${NOT_A_REPOSITORY}\n${'x'.repeat(20_001)}`,
      })
      expect(oversized.category).toBe('unrecognized')
      expect(oversized.likelyCause).toMatch(/longer than 20,000 characters/)
    }
  })

  it('still reads a long paste whose Git line sits under many hints', () => {
    const errorText = [
      ...Array.from({ length: 120 }, (_unused, index) => `hint: filler ${index}`),
      NOT_A_REPOSITORY,
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('git-error')
    expect(result.evidence[0].quote).toBe(NOT_A_REPOSITORY)
  })
})
