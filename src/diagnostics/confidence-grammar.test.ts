import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'

const TRACEBACK_JS =
  "TypeError: Cannot read properties of undefined (reading 'name')"

describe('confidence reason grammar', () => {
  it('uses a singular verb when the runtime sentence lists one clue', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'npm error code ERESOLVE',
    })

    expect(result.confidence.reason).toBe(
      'The final exception line contains a specific JavaScript signature, and ' +
        'an npm log line supports the JavaScript runtime.',
    )
  })

  it('uses a singular verb for a lone Python clue', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        "Traceback (most recent call last):\n" +
        '  File "<stdin>", line 1, in <module>\n' +
        "ModuleNotFoundError: No module named 'requests'",
    })

    expect(result.confidence.reason).toContain(
      'a Python traceback header supports the Python runtime.',
    )
  })

  it('keeps the plural verb when the runtime sentence lists two clues', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'Uncaught (in promise) TypeError: Failed to fetch',
    })

    expect(result.confidence.reason).toContain(
      'an Uncaught console prefix and a network error message support the JavaScript runtime.',
    )
  })

  it('joins three clues with commas and keeps the plural verb', () => {
    const result = diagnose({
      language: 'auto',
      errorText: `${TRACEBACK_JS}\n    at renderName (src/App.js:12:5)`,
    })

    expect(result.confidence.reason).toContain(
      'a JavaScript stack frame with file positions, JavaScript-style stack ' +
        'frames, and a .js or .ts filename support the JavaScript runtime.',
    )
  })

  it('agrees with a single clue in the generic-shape sentence and starts it as a sentence', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        'npm error code ELIFECYCLE\n' +
        'npm error Failed at the bugpilot@1.0.0 build script.',
    })

    expect(result.confidence.reason).toBe(
      'A JavaScript message on line 1 explains the final line, but it is a ' +
        'generic error shape. An npm log line supports JavaScript, but the ' +
        'specific cause remains less certain.',
    )
  })

  it('keeps the plural verb for three clues in the generic-shape sentence', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        'npm error code ELIFECYCLE\n' +
        'node scripts/build.js exited with 1\n' +
        'npm error Failed at the build script.',
    })

    expect(result.confidence.reason).toMatch(/ error shape\. [A-Z]/)
    expect(result.confidence.reason).toContain(
      ' support JavaScript, but the specific cause remains less certain.',
    )
    expect(result.confidence.reason).not.toMatch(/ shape\. [a-z]/)
  })

  it('describes a lone conflicting clue as pointing to the other runtime', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: `Traceback (most recent call last):\n${TRACEBACK_JS}`,
    })

    expect(result.confidence.reason).toContain(
      'conflicts with a Python traceback header that points to Python.',
    )
  })

  it('describes two conflicting clues as pointing to the other runtime', () => {
    const result = diagnose({
      language: 'javascript',
      errorText:
        'Traceback (most recent call last):\n' +
        'app.py reads the record\n' +
        TRACEBACK_JS,
    })

    expect(result.confidence.reason).toContain(
      'a Python traceback header and a .py filename that point to Python.',
    )
  })

  it('agrees with a lone clue when Auto falls back to the other language', () => {
    const result = diagnose({
      language: 'auto',
      errorText: `Traceback (most recent call last):\n${TRACEBACK_JS}`,
    })

    expect(result.confidence.reason).toContain(
      'conflicts with a Python traceback header that points to Python, but no supported Python signature matched the final line.',
    )
  })

  it('never leaves a singular subject with a plural verb in any reason', () => {
    const pastes = [
      'npm error code ERESOLVE',
      'Uncaught (in promise) TypeError: Failed to fetch',
      "Traceback (most recent call last):\nModuleNotFoundError: No module named 'requests'",
      `Traceback (most recent call last):\n${TRACEBACK_JS}`,
      'npm error code ELIFECYCLE\nnpm error Failed at the build script.',
    ]

    for (const language of ['auto', 'python', 'javascript'] as const) {
      for (const errorText of pastes) {
        const { confidence } = diagnose({ language, errorText })

        expect(
          /\b(an [a-z. ]+?|the matched signature) (support|point) to?\b/.test(
            confidence.reason,
          ),
        ).toBe(false)
      }
    }
  })
})
