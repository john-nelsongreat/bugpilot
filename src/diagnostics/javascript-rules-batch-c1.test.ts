import { describe, expect, it } from 'vitest'
import { diagnose, MAX_ERROR_TEXT_LENGTH } from './engine'
import {
  DIAGNOSTIC_CATEGORY_LABELS,
  diagnosticCategoryLabel,
} from './labels'
import {
  javascriptCorsBlockedRule,
  javascriptNetworkRequestFailedRule,
  javascriptNodeFileErrorRule,
  javascriptNpmErrorRule,
  javascriptPermissionErrorRule,
  javascriptPortInUseRule,
  javascriptRules,
  javascriptTypeScriptErrorRule,
} from './rules/javascript'
import type { DiagnosticResult } from './types'

const TS_2322 = "Type 'string' is not assignable to type 'number'."
const TS_2339 = "Property 'countt' does not exist on type 'Counter'."
const TS_2345 =
  "Argument of type 'number' is not assignable to parameter of type 'string'."
const TS_2304 = "Cannot find name 'userCount'."
const TS_2307 =
  "Cannot find module 'lodash' or its corresponding type declarations."
const TS_7006 = "Parameter 'value' implicitly has an 'any' type."
const TS_2532 = "Object is possibly 'undefined'."
const TS_18048 = "'items' is possibly 'undefined'."
const TS_2554 = 'Expected 1 arguments, but got 0.'
const TS_2769 = 'No overload matches this call.'

const SIG_2322 =
  "error TS2322: Type '<type>' is not assignable to type '<type>'."
const SIG_2339 =
  "error TS2339: Property '<name>' does not exist on type '<type>'."
const SIG_2345 =
  "error TS2345: Argument of type '<type>' is not assignable to parameter of type '<type>'."
const SIG_2304 = "error TS2304: Cannot find name '<name>'."
const SIG_2307 =
  "error TS2307: Cannot find module '<module>' or its corresponding type declarations."
const SIG_7006 =
  "error TS7006: Parameter '<name>' implicitly has an 'any' type."
const SIG_2532 = "error TS2532: Object is possibly '<value>'."
const SIG_18048 = "error TS18048: '<name>' is possibly '<value>'."
const SIG_2554 = 'error TS2554: Expected <count> arguments, but got <count>.'
const SIG_2769 = 'error TS2769: No overload matches this call.'

const CLASSIC_2322 = `src/App.tsx(12,5): error TS2322: ${TS_2322}`
const CLASSIC_WINDOWS_2322 = String.raw`C:\Users\dev\project\src\App.tsx(12,5): error TS2322: ${TS_2322}`
const PRETTY_2322 = `src/App.tsx:12:5 - error TS2322: ${TS_2322}`
const PRETTY_2339 = `src/App.tsx:5:7 - error TS2339: ${TS_2339}`
const PRETTY_WINDOWS_2339 = String.raw`C:\Users\dev\project\src\Counter.tsx:7:10 - error TS2339: ${TS_2339}`
const PRETTY_COLON_2345 = `src/cart.ts:88:3: error TS2345: ${TS_2345}`
const BARE_2322 = `error TS2322: ${TS_2322}`
const EDITOR_2322 = `${TS_2322.slice(0, -1)}.ts(2322)`

const TS_JSX_FRAME = [
  '    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)',
  '    at App (src/App.tsx:12:5)',
].join('\n')

const NPM9_ERESOLVE = [
  'npm error code ERESOLVE',
  'npm error ERESOLVE unable to resolve dependency tree',
  'npm error',
  'npm error While resolving: bugpilot@1.0.0',
  'npm error Found: react@18.2.0',
  'npm error node_modules/react',
  'npm error   react@"^18.2.0" from the root project',
  'npm error',
  'npm error Could not resolve dependency:',
  'npm error peer react@"^17.0.0" from some-ui-lib@2.1.0',
  'npm error node_modules/some-ui-lib',
  'npm error   some-ui-lib@"^2.1.0" from the root project',
  'npm error',
  'npm error Fix the upstream dependency conflict, or retry',
  'npm error this command with --force, or --legacy-peer-deps',
  'npm error to accept an incorrect (and potentially broken) dependency resolution.',
  'npm error A complete log of this run can be found in:',
  'npm error     /home/dev/.npm/_logs/2026-10-31T10_00_00_000Z-debug-0.log',
].join('\n')

const NPM8_ERESOLVE = [
  'npm ERR! code ERESOLVE',
  'npm ERR! ERESOLVE unable to resolve dependency tree',
  'npm ERR!',
  'npm ERR! While resolving: bugpilot@1.0.0',
  'npm ERR! Found: react@18.2.0',
  'npm ERR! node_modules/react',
  'npm ERR!   react@"^18.2.0" from the root project',
  'npm ERR!',
  'npm ERR! Could not resolve dependency:',
  'npm ERR! peer react@"^17.0.0" from some-ui-lib@2.1.0',
  'npm ERR! Conflicting peer dependency: react@17.0.2',
  'npm ERR! node_modules/react',
  'npm ERR!   peer react@"^17.0.0" from some-ui-lib@2.1.0',
  'npm ERR!',
  'npm ERR! A complete log of this run can be found in:',
  String.raw`npm ERR!     C:\Users\dev\AppData\Local\npm-cache\_logs\2026-10-31T10_00_00_000Z-debug-0.log`,
].join('\n')

const NPM9_E404 = [
  'npm error code E404',
  'npm error 404 Not Found - GET https://registry.npmjs.org/not-a-real-package-xyz - Not found',
  'npm error 404',
  "npm error 404  'not-a-real-package-xyz@*' is not in this registry.",
  'npm error 404',
  'npm error A complete log of this run can be found in:',
  'npm error     /home/dev/.npm/_logs/2026-10-31T10_00_00_000Z-debug-0.log',
].join('\n')

const NPM8_E404 = [
  'npm ERR! code E404',
  'npm ERR! 404 Not Found - GET https://registry.npmjs.org/nope - Not found',
  'npm ERR! 404',
  "npm ERR! 404  'nope@*' is not in this registry.",
].join('\n')

const NPM9_ETARGET = [
  'npm error code ETARGET',
  'npm error notarget No matching version found for some-ui-lib@2.9.9.',
  'npm error notarget In most cases you or one of your dependencies are requesting',
  'npm error notarget a package version that does not exist.',
].join('\n')

const NPM10_ENOENT_WINDOWS = [
  'npm error code ENOENT',
  String.raw`npm error path C:\Users\dev\project\package.json`,
  String.raw`npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open 'C:\Users\dev\project\package.json'`,
].join('\n')

const NPM8_ENOENT = [
  'npm ERR! code ENOENT',
  'npm ERR! syscall open',
  'npm ERR! path /home/dev/package.json',
  'npm ERR! errno -2',
  "npm ERR! enoent ENOENT: no such file or directory, open '/home/dev/package.json'",
  'npm ERR! enoent This is related to npm not being able to find a file.',
  'npm ERR! enoent',
].join('\n')

const NPM9_EACCES = [
  'npm error code EACCES',
  'npm error syscall mkdir',
  'npm error path /usr/local/lib/node_modules',
  "npm error Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'",
].join('\n')

const NPM8_EPERM = [
  'npm ERR! code EPERM',
  'npm ERR! syscall rename',
  String.raw`npm ERR! path C:\Program Files\nodejs\node_modules\bugpilot`,
  String.raw`npm ERR! dest C:\Program Files\nodejs\node_modules\.bugpilot.delete`,
  String.raw`npm ERR! Error: EPERM: operation not permitted, rename 'C:\Program Files\nodejs\node_modules\bugpilot' -> 'C:\Program Files\nodejs\node_modules\.bugpilot.delete'`,
].join('\n')

const NPM9_NETWORK = [
  'npm error code ENOTFOUND',
  'npm error syscall getaddrinfo',
  'npm error errno ENOTFOUND',
  'npm error network request to https://registry.npmjs.org/express failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org',
].join('\n')

const NPM8_NETWORK = [
  'npm ERR! code ECONNRESET',
  'npm ERR! network request to https://registry.npmjs.org/vite failed, reason: read ECONNRESET',
].join('\n')

const ELIFECYCLE_AFTER_TS = [
  CLASSIC_2322,
  `src/App.tsx(13,9): error TS2345: ${TS_2345}`,
  'npm error code ELIFECYCLE',
  'npm error Failed at the build script.',
].join('\n')

const ELIFECYCLE_NPM9_ONLY = [
  'npm error code ELIFECYCLE',
  'npm error command failed',
  'npm error',
  'npm error> bugpilot@1.0.0 build',
  'npm error Failed at the bugpilot@1.0.0 build script.',
  'npm error A complete log of this run can be found in:',
  'npm error     /home/dev/.npm/_logs/2026-10-31T10_00_00_000Z-debug-0.log',
].join('\n')

const ELIFECYCLE_NPM8_ONLY = [
  'npm ERR! code ELIFECYCLE',
  'npm ERR! errno 1',
  'npm ERR! bugpilot@1.0.0 build: `tsc -b`',
  'npm ERR! Failed at the bugpilot@1.0.0 build script.',
  'npm ERR! This is probably not a problem with npm. There is likely additional logging output above.',
].join('\n')

const ELIFECYCLE_AFTER_NODE_ERROR = [
  String.raw`Error: EACCES: permission denied, mkdir 'C:\Users\dev\project\dist'`,
  'npm ERR! Failed at the bugpilot@1.0.0 build script.',
  'npm ERR! This is probably not a problem with npm. There is likely additional logging output above.',
].join('\n')

const ELIFECYCLE_AFTER_PRETTY_TS = [
  PRETTY_2339,
  'Found 1 error in src/App.tsx:5',
  '',
  'npm error code ELIFECYCLE',
  'npm error Failed at the build script.',
].join('\n')

interface TypeScriptCase {
  name: string
  input: string
  signature: string
  cause: RegExp
  level: 'low' | 'medium' | 'high'
}

const TYPESCRIPT_CASES: TypeScriptCase[] = [
  {
    name: 'classic POSIX location',
    input: CLASSIC_2322,
    signature: SIG_2322,
    cause: /assignable/i,
    level: 'high',
  },
  {
    name: 'classic Windows location',
    input: CLASSIC_WINDOWS_2322,
    signature: SIG_2322,
    cause: /assignable/i,
    level: 'high',
  },
  {
    name: 'pretty location',
    input: PRETTY_2322,
    signature: SIG_2322,
    cause: /assignable/i,
    level: 'high',
  },
  {
    name: 'pretty Windows location with TS2339',
    input: PRETTY_WINDOWS_2339,
    signature: SIG_2339,
    cause: /does not exist|property/i,
    level: 'high',
  },
  {
    name: 'pretty colon location with TS2345',
    input: PRETTY_COLON_2345,
    signature: SIG_2345,
    cause: /argument|parameter/i,
    level: 'high',
  },
  {
    name: 'bare message without a location',
    input: BARE_2322,
    signature: SIG_2322,
    cause: /assignable/i,
    level: 'medium',
  },
  {
    name: 'editor style suffix',
    input: EDITOR_2322,
    signature: SIG_2322,
    cause: /assignable/i,
    level: 'low',
  },
  {
    name: 'TS2304 missing name',
    input: `src/App.tsx(4,17): error TS2304: ${TS_2304}`,
    signature: SIG_2304,
    cause: /name|import|declar/i,
    level: 'high',
  },
  {
    name: 'TS2307 missing module',
    input: `src/App.tsx(2,20): error TS2307: ${TS_2307}`,
    signature: SIG_2307,
    cause: /module|types|install/i,
    level: 'high',
  },
  {
    name: 'TS7006 implicit any parameter',
    input: `src/cart.ts(9,21): error TS7006: ${TS_7006}`,
    signature: SIG_7006,
    cause: /implicitly|annotat|any/i,
    level: 'high',
  },
  {
    name: 'TS2532 possibly undefined',
    input: `src/App.tsx(21,9): error TS2532: ${TS_2532}`,
    signature: SIG_2532,
    cause: /possibly|undefined|narrow/i,
    level: 'high',
  },
  {
    name: 'TS18048 possibly undefined name',
    input: `src/App.tsx(30,5): error TS18048: ${TS_18048}`,
    signature: SIG_18048,
    cause: /possibly|undefined|narrow/i,
    level: 'high',
  },
  {
    name: 'TS2554 argument count',
    input: `src/App.tsx(44,3): error TS2554: ${TS_2554}`,
    signature: SIG_2554,
    cause: /argument/i,
    level: 'high',
  },
  {
    name: 'TS2769 overload',
    input: `src/App.tsx(51,18): error TS2769: ${TS_2769}`,
    signature: SIG_2769,
    cause: /overload/i,
    level: 'high',
  },
]

interface NpmCase {
  name: string
  input: string
  signature: string
  cause: RegExp
}

const NPM_CASES: NpmCase[] = [
  {
    name: 'npm 9 ERESOLVE block',
    input: NPM9_ERESOLVE,
    signature: 'npm error code ERESOLVE',
    cause: /peer|dependenc/i,
  },
  {
    name: 'npm 8 ERESOLVE block',
    input: NPM8_ERESOLVE,
    signature: 'npm ERR! code ERESOLVE',
    cause: /peer|dependenc/i,
  },
  {
    name: 'npm 9 E404 block',
    input: NPM9_E404,
    signature: 'npm error code E404',
    cause: /registry|spelling|name/i,
  },
  {
    name: 'npm 8 E404 block',
    input: NPM8_E404,
    signature: 'npm ERR! code E404',
    cause: /registry|spelling|name/i,
  },
  {
    name: 'npm 9 ETARGET block',
    input: NPM9_ETARGET,
    signature: 'npm error code ETARGET',
    cause: /version/i,
  },
  {
    name: 'npm 10 ENOENT Windows package.json',
    input: NPM10_ENOENT_WINDOWS,
    signature: 'npm error code ENOENT',
    cause: /package\.json|folder|director/i,
  },
  {
    name: 'npm 8 ENOENT package.json block',
    input: NPM8_ENOENT,
    signature: 'npm ERR! code ENOENT',
    cause: /package\.json|folder|director/i,
  },
  {
    name: 'npm 9 EACCES block',
    input: NPM9_EACCES,
    signature: 'npm error code EACCES',
    cause: /permission|write|folder/i,
  },
  {
    name: 'npm 8 EPERM Windows block',
    input: NPM8_EPERM,
    signature: 'npm ERR! code EPERM',
    cause: /permission|locked|another|hold/i,
  },
  {
    name: 'npm 9 network block',
    input: NPM9_NETWORK,
    signature: 'npm error code <network error code>',
    cause: /network|connection|registry/i,
  },
  {
    name: 'npm 8 network block',
    input: NPM8_NETWORK,
    signature: 'npm ERR! code <network error code>',
    cause: /network|connection|registry/i,
  },
]

const NPM_SINGLE_LINE_CASES: NpmCase[] = [
  {
    name: 'ERESOLVE headline',
    input: 'npm error ERESOLVE unable to resolve dependency tree',
    signature: 'npm error ERESOLVE unable to resolve dependency tree',
    cause: /peer|dependenc/i,
  },
  {
    name: 'Could not resolve dependency',
    input: 'npm error Could not resolve dependency:',
    signature: 'npm error Could not resolve dependency:',
    cause: /peer|dependenc/i,
  },
  {
    name: 'Conflicting peer dependency',
    input: 'npm ERR! Conflicting peer dependency: react@17.0.2',
    signature: 'npm ERR! Conflicting peer dependency: <package>@<version>',
    cause: /peer|dependenc/i,
  },
  {
    name: '404 Not Found line',
    input:
      'npm error 404 Not Found - GET https://registry.npmjs.org/not-a-real-package-xyz - Not found',
    signature: 'npm error 404 Not Found - GET <url>',
    cause: /registry|spelling|name/i,
  },
  {
    name: 'not in this registry line',
    input: "npm ERR! 404  'nope@*' is not in this registry.",
    signature: "npm ERR! 404 '<package>' is not in this registry.",
    cause: /registry|spelling|name/i,
  },
  {
    name: 'No matching version found line',
    input: 'npm error notarget No matching version found for some-ui-lib@2.9.9.',
    signature:
      'npm error No matching version found for <package>@<version>.',
    cause: /version/i,
  },
  {
    name: 'Could not read package.json line',
    input: String.raw`npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open 'C:\Users\dev\project\package.json'`,
    signature: 'npm error Could not read package.json',
    cause: /package\.json|folder|director/i,
  },
  {
    name: 'network request to line',
    input:
      'npm error network request to https://registry.npmjs.org/express failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org',
    signature: 'npm error network request to <url> failed, reason: <reason>',
    cause: /network|connection|registry/i,
  },
]

const TS_LOOKALIKES = [
  String.raw`2026-10-31T10:00:00Z src/App.tsx(12,5): error TS2322: Type 'a' is not assignable to type 'b'.`,
  'The TS2322 error is a type mismatch in TypeScript.',
  'See error TS2322 in the migration notes for details.',
  String.raw`const message = "error TS2322: Type 'a' is not assignable to type 'b'."`,
  '// error TS2322: Type "a" is not assignable to type "b".',
  String.raw`src/App copy.tsx(12,5): error TS2322: Type 'a' is not assignable to type 'b'.`,
  String.raw`src/App.tsx(12): error TS2322: Type 'a' is not assignable to type 'b'.`,
  String.raw`src/App.tsx(12,5): warning TS2322: Type 'a' is not assignable to type 'b'.`,
  String.raw`src/App.vue(12,5): error TS2322: Type 'a' is not assignable to type 'b'.`,
  String.raw`src/App.css(12,5): error TS2322: Type 'a' is not assignable to type 'b'.`,
  'tsc --noEmit finished with a type error in App.tsx.',
]

const NPM_LOOKALIKES = [
  '2026-10-31T10:00:00Z npm error code ERESOLVE',
  'see the ERESOLVE docs',
  'The build log mentioned ERESOLVE earlier.',
  'npm install failed with a dependency conflict',
  'npm',
  'npm error',
  'npm ERR!',
  'npm error code',
  'npm ERR! 404',
  'ERR_PNPM_NO_MATCHING_VERSION  No matching version found for some-ui-lib@2.9.9.',
  'Progress: resolved 214, reused 0, downloaded 0, added 0',
  'yarn add v1.22.19',
  'error Command failed.',
  '[!] npm ERR! code ERESOLVE (managed by pnpm)',
]

const CORS_SAMPLE =
  "Access to fetch at 'http://localhost:3000/api' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource."

interface ExistingCase {
  name: string
  line: string
  category: string
  signature: string
}

const EXISTING_UNCHANGED_CASES: ExistingCase[] = [
  {
    name: 'Node ENOENT file error',
    line: String.raw`Error: ENOENT: no such file or directory, open 'C:\app\package.json'`,
    category: 'missing-file',
    signature: "Error: ENOENT: no such file or directory, <operation> '<path>'",
  },
  {
    name: 'Node EACCES permission error',
    line: "Error: EACCES: permission denied, mkdir '/var/app/cache'",
    category: 'permission-denied',
    signature: "Error: EACCES: permission denied, <operation> '<path>'",
  },
  {
    name: 'Node EADDRINUSE port error',
    line: 'Error: listen EADDRINUSE: address already in use :::3000',
    category: 'port-in-use',
    signature: 'Error: listen EADDRINUSE: address already in use <address>',
  },
  {
    name: 'Node missing module error',
    line: "Error: Cannot find module 'express'",
    category: 'missing-module',
    signature: "Error: Cannot find module '<package>'",
  },
  {
    name: 'browser fetch failure',
    line: 'TypeError: Failed to fetch',
    category: 'network-request-failed',
    signature: 'TypeError: Failed to fetch',
  },
  {
    name: 'CORS blocked request',
    line: CORS_SAMPLE,
    category: 'cors-blocked',
    signature:
      "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: missing 'Access-Control-Allow-Origin' header",
  },
  {
    name: 'JavaScript TypeError',
    line: "TypeError: Cannot read properties of undefined (reading 'name')",
    category: 'type-mismatch',
    signature: "TypeError: Cannot read properties of undefined (reading 'name')",
  },
  {
    name: 'JSON parse failure',
    line: "SyntaxError: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
    category: 'json-decode-error',
    signature: "SyntaxError: Unexpected token '<', ... is not valid JSON",
  },
]

function expectCompleteNarrative(result: DiagnosticResult) {
  expect(result.likelyCause.trim()).not.toBe('')
  expect(result.debuggingSteps.length).toBeGreaterThan(0)
  expect(result.possibleFix).not.toBeNull()
  expect(result.possibleFix?.explanation.trim()).not.toBe('')
  expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
  expect(result.possibleFix?.exampleCode.trim()).not.toBe('')
  expect(result.verificationSteps.length).toBeGreaterThan(0)
  expect(result.limitations.length).toBeGreaterThan(0)
  expect(result.alternativeExplanations.length).toBeGreaterThan(0)
  expect(result.limitations[result.limitations.length - 1]).toMatch(
    /local, rule-based guidance/i,
  )
}

function run(errorText: string, language: 'auto' | 'javascript' = 'javascript') {
  return diagnose({ language, errorText })
}

describe('TypeScript compiler rule', () => {
  it.each(TYPESCRIPT_CASES)(
    '$name matches and reports the recorded signature',
    ({ input, signature, cause, level }) => {
      expect(javascriptTypeScriptErrorRule.match(input)).not.toBeNull()

      const result = run(input)

      expect(result.category).toBe('typescript-error')
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe(level)
      expect(result.likelyCause).toMatch(cause)
      expect(result.evidence).toEqual([
        expect.objectContaining({
          source: 'error text',
          label: 'Final exception line',
          quote: input,
          lineNumber: 1,
        }),
      ])
      expectCompleteNarrative(result)
    },
  )

  it('quotes only the wording from the paste and names the location', () => {
    const result = run(CLASSIC_2322)
    const text = JSON.stringify(result)

    expect(text).toContain('TS2322')
    expect(text).toContain("'string'")
    expect(text).toContain("'number'")
    expect(result.likelyCause).toMatch(/line 12|column 5/)
    expect(result.likelyCause).not.toMatch(/npm install/i)
  })

  it.each([
    ['TS2532', `src/App.tsx(21,9): error TS2532: ${TS_2532}`],
    ['TS18048', `src/App.tsx(30,5): error TS18048: ${TS_18048}`],
  ] as const)(
    'narrows %s with a check or optional chaining before any assertion',
    (_code, input) => {
      const result = run(input)
      const explanation = result.possibleFix?.explanation ?? ''

      expect(explanation).toMatch(/narrow|check|guard/i)
      expect(explanation).toMatch(/optional chaining/i)
      expect(explanation).toMatch(/non-null assertion/i)
      expect(
        explanation.search(/narrow|check|optional chaining/i),
      ).toBeLessThan(explanation.search(/non-null assertion/i))
      expect(explanation).toMatch(/does not make|only silences|only after/i)
    },
  )

  it('explains TS2304 with an import, a declaration and the compiler setup', () => {
    const text = JSON.stringify(run(`src/App.tsx(4,17): error TS2304: ${TS_2304}`))

    expect(text).toMatch(/import/i)
    expect(text).toMatch(/declar/)
    expect(text).toMatch(/lib|target/)
  })

  it('gives TS2339 advice about a typo, optional chaining and declarations', () => {
    const text = JSON.stringify(run(PRETTY_2339))

    expect(text).toMatch(/typo|misspelled|spelling/i)
    expect(text).toMatch(/optional chaining|\?\./)
    expect(text).toMatch(/declar/)
  })

  it('explains TS2307 with install, types and tsconfig paths', () => {
    const text = JSON.stringify(run(`src/App.tsx(2,20): error TS2307: ${TS_2307}`))

    expect(text).toMatch(/not installed|install/i)
    expect(text).toMatch(/@types/)
    expect(text).toMatch(/paths|moduleResolution/)
    expect(text).toMatch(/extension|\.js/i)
  })

  it('counts the TypeScript error lines in the limitations', () => {
    const errorText = [
      CLASSIC_2322,
      `src/App.tsx(13,9): error TS2345: ${TS_2345}`,
      `src/App.tsx(21,9): error TS2532: ${TS_2532}`,
      'Found 3 errors.',
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('typescript-error')
    expect(result.matchedSignature).toBe(SIG_2322)
    expect(result.confidence.level).toBe('high')
    expect(result.evidence).toEqual([
      expect.objectContaining({
        label: 'Final exception line',
        quote: `src/App.tsx(21,9): error TS2532: ${TS_2532}`,
        lineNumber: 3,
      }),
      expect.objectContaining({
        label: 'Matched context line',
        quote: CLASSIC_2322,
        lineNumber: 1,
      }),
    ])
    expect(
      result.limitations.some((line) =>
        /contains 3 TypeScript error lines/i.test(line),
      ),
    ).toBe(true)
  })

  it('uses the first error line even when two errors share a signature', () => {
    const errorText = [
      `src/cart.ts(4,5): error TS2304: ${TS_2304}`,
      "src/cart.ts(9,5): error TS2304: Cannot find name 'totalCount'.",
    ].join('\n')

    const result = run(errorText)

    expect(result.matchedSignature).toBe(SIG_2304)
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        label: 'Matched context line',
        quote: `src/cart.ts(4,5): error TS2304: ${TS_2304}`,
        lineNumber: 1,
      }),
    )
    expect(result.likelyCause).toContain('userCount')
    expect(result.likelyCause).not.toContain('totalCount')
  })

  it.each([
    ['the Found N errors summary', 'Found 2 errors.'],
    ['the Found N errors in M files summary', 'Found 2 errors in 2 files.'],
    ['the single file summary', 'Found 1 error in src/App.tsx:5'],
    ['the Errors Files table header', 'Errors  Files'],
    ['the Errors Files table row', '     2  src/App.tsx:12'],
  ] as const)('skips %s when choosing the line to diagnose' , (_name, trailer) => {
    const result = diagnose({
      language: 'auto',
      errorText: [PRETTY_2339, trailer].join('\n'),
    })

    expect(result.category).toBe('typescript-error')
    expect(result.matchedSignature).toBe(SIG_2339)
    expect(result.confidence.level).toBe('high')
    expect(result.evidence).toEqual([
      expect.objectContaining({
        label: 'Final exception line',
        quote: PRETTY_2339,
        lineNumber: 1,
      }),
    ])
  })

  it('detects TypeScript in Auto from the error code alone', () => {
    const result = diagnose({ language: 'auto', errorText: CLASSIC_2322 })

    expect(result.category).toBe('typescript-error')
    expect(result.confidence.level).toBe('high')
    expect(result.confidence.reason).toMatch(/JavaScript/i)
  })

  it('detects the editor style form in Auto', () => {
    const result = diagnose({ language: 'auto', errorText: EDITOR_2322 })

    expect(result.category).toBe('typescript-error')
    expect(result.matchedSignature).toBe(SIG_2322)
    expect(result.confidence.level).toBe('low')
  })

  it('keeps JavaScript stack frames supporting the TypeScript match', () => {
    const result = diagnose({
      language: 'auto',
      errorText: `${CLASSIC_2322}\n${TS_JSX_FRAME}`,
    })

    expect(result.category).toBe('typescript-error')
    expect(result.confidence.level).toBe('high')
  })

  it('lowers confidence when Python context surrounds a TypeScript line', () => {
    const errorText = [
      'Traceback (most recent call last):',
      '  File "/home/ana/project/app.py", line 4, in <module>',
      '    value = data["count"]',
      CLASSIC_2322,
    ].join('\n')

    const result = diagnose({ language: 'auto', errorText })

    expect(result.category).toBe('typescript-error')
    expect(result.confidence.level).toBe('low')
    expect(result.confidence.reason).toMatch(/conflict|uncertain/i)
  })

  it('gives a lower-confidence generic result for an unknown code', () => {
    const input =
      "src/App.tsx(9,3): error TS2551: Property 'countt' does not exist on type 'Counter'. Did you mean 'count'?"

    const result = run(input)

    expect(result.category).toBe('typescript-error')
    expect(result.matchedSignature).toBe('error TS2551: <message>')
    expect(['low', 'medium']).toContain(result.confidence.level)
    expect(result.likelyCause).toContain('TS2551')
    expect(result.likelyCause).toMatch(/no specific rule|does not have a specific/)
    expect(result.likelyCause).toMatch(/does not exist on type 'Counter'/)
    expect(result.possibleFix?.explanation).toMatch(/TypeScript documentation/i)
    expect(result.possibleFix?.explanation).toMatch(/continuation line/i)
    expect(result.possibleFix?.explanation).not.toMatch(/rename|install a package/i)
    expect(result.likelyCause).not.toMatch(/is caused by|the cause is/i)
  })

  it('falls back to the generic result when a known code has another message', () => {
    const input =
      "src/App.tsx(6,3): error TS2322: Types of property 'id' are incompatible."

    const result = run(input)

    expect(result.matchedSignature).toBe('error TS2322: <message>')
    expect(['low', 'medium']).toContain(result.confidence.level)
    expect(result.likelyCause).toMatch(/no specific rule|does not have a specific/)
    expect(result.likelyCause).toMatch(/Types of property 'id' are incompatible/)
  })

  it.each(TS_LOOKALIKES)('does not claim a TypeScript mention in: %s', (line) => {
    expect(javascriptTypeScriptErrorRule.match(line)).toBeNull()

    const result = run(line)

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })

  it('never claims a cause the message does not state', () => {
    const result = run(`src/App.tsx(2,20): error TS2307: ${TS_2307}`)

    expect(result.likelyCause).toMatch(/likely|may|means/i)
    expect(result.likelyCause).not.toMatch(/is definitely|you must have/i)
    expect(result.likelyCause).toMatch(/'lodash'/)
    expect(result.likelyCause).not.toMatch(/some-ui-lib/)
  })

  it('quotes the location when the paste gives one and stays quiet when it does not', () => {
    const located = run(CLASSIC_2322)
    const bare = run(BARE_2322)

    expect(located.likelyCause).toMatch(/line 12/)
    expect(bare.likelyCause).not.toMatch(/line 12|column 5/)
  })

  it('shows the Windows commands before the POSIX ones', () => {
    const result = run(`src/App.tsx(2,20): error TS2307: ${TS_2307}`)
    const commands = result.possibleFix?.exampleCode ?? ''

    expect(commands).toMatch(/npm install/)
    expect(commands).toMatch(/PowerShell|Get-ChildItem|dir\b/)
    expect(commands.search(/Windows|PowerShell/i)).toBeLessThan(
      commands.search(/macOS|Linux/i),
    )
  })

  it('does not claim the fix is verified', () => {
    const text = JSON.stringify(run(CLASSIC_2322))

    expect(text).not.toMatch(/verified|confirmed working|tested on your/i)
  })

  it('flags the TypeScript language signal in Auto without a stack frame', () => {
    const result = diagnose({ language: 'auto', errorText: BARE_2322 })

    expect(result.category).toBe('typescript-error')
    expect(result.confidence.level).toBe('medium')
    expect(result.confidence.reason).toMatch(/JavaScript/i)
  })

  it('adds the related code line to the evidence for a quoted identifier', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: `src/App.tsx(12,5): error TS2304: ${TS_2304}`,
      codeSnippet: 'const total = userCount + 1\n\nexport default App',
    })

    expect(result.category).toBe('typescript-error')
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        source: 'code snippet',
        quote: 'const total = userCount + 1',
        lineNumber: 1,
      }),
    )
  })
})

describe('npm error rule', () => {
  it.each(NPM_CASES)(
    '$name matches and reports the recorded signature',
    ({ input, signature, cause }) => {
      const result = run(input)

      expect(result.category).toBe('npm-error')
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
      expect(result.likelyCause).toMatch(cause)
      expectCompleteNarrative(result)
    },
  )

  it.each(NPM_SINGLE_LINE_CASES)(
    'matches the single-line $name form',
    ({ input, signature, cause }) => {
      expect(javascriptNpmErrorRule.match(input)).not.toBeNull()

      const result = run(input)

      expect(result.category).toBe('npm-error')
      expect(result.matchedSignature).toBe(signature)
      expect(result.likelyCause).toMatch(cause)
      expectCompleteNarrative(result)
    },
  )

  it.each([
    ['ERESOLVE', NPM9_ERESOLVE],
    ['E404', NPM9_E404],
    ['ENOENT', NPM10_ENOENT_WINDOWS],
    ['network', NPM9_NETWORK],
  ] as const)('detects %s in Auto without a stack frame', (_code, input) => {
    const result = diagnose({ language: 'auto', errorText: input })

    expect(result.category).toBe('npm-error')
    expect(result.confidence.level).toBe('high')
    expect(result.confidence.reason).toMatch(/JavaScript/i)
  })

  it('names the packages quoted in the ERESOLVE block', () => {
    const result = run(NPM9_ERESOLVE)
    const text = JSON.stringify(result)

    expect(result.likelyCause).toContain('some-ui-lib')
    expect(result.likelyCause).toMatch(/react/)
    expect(text).toMatch(/npm ls/)
    expect(text).toMatch(/upgrade|replace|peer/i)
  })

  it('presents --legacy-peer-deps and --force only as a last resort', () => {
    const result = run(NPM9_ERESOLVE)
    const explanation = result.possibleFix?.explanation ?? ''

    expect(explanation).toMatch(/npm ls|which package/i)
    expect(explanation).toMatch(/--legacy-peer-deps|--force/)
    expect(explanation.search(/npm ls|upgrade|replace|peer dependency/i)).toBeLessThan(
      explanation.search(/--legacy-peer-deps|--force/),
    )
    expect(explanation).toMatch(/last resort|risk|not a fix|incorrect/i)
  })

  it('does not tell the user to run npm with sudo', () => {
    const result = run(NPM9_EACCES)
    const text = JSON.stringify(result)

    expect(result.possibleFix?.exampleCode).not.toMatch(/sudo/)
    expect(text).toMatch(/ownership|chown|version manager|prefix/i)
    expect(text).not.toMatch(/disable (your )?(antivirus|security|firewall)/i)
  })

  it('shows cd and dir for a Windows package.json problem', () => {
    const result = run(NPM10_ENOENT_WINDOWS)
    const commands = result.possibleFix?.exampleCode ?? ''

    expect(commands).toMatch(/\bcd\b/)
    expect(commands).toMatch(/dir|Get-ChildItem/)
    expect(commands.search(/dir|Get-ChildItem/i)).toBeLessThan(
      commands.search(/(?:^|\s)ls(?:\s|$)/),
    )
    expect(result.likelyCause).toContain('package.json')
    expect(result.likelyCause).toMatch(/current folder|working directory|root/i)
  })

  it('does not invent a package.json mention for a plain ENOENT', () => {
    const input = String.raw`npm error code ENOENT`

    const result = run(input)

    expect(result.category).toBe('npm-error')
    expect(result.likelyCause).toMatch(/file or folder|cannot find|missing/i)
    expect(result.likelyCause).not.toMatch(/package\.json/)
  })

  it('mentions the path and registry settings for a network failure', () => {
    const text = JSON.stringify(run(NPM9_NETWORK))

    expect(text).toMatch(/proxy/i)
    expect(text).toMatch(/registry/i)
    expect(text).toMatch(/retry|connection/i)
    expect(text).toMatch(/ENOTFOUND/)
  })

  it('does not suggest disabling security tools for EPERM', () => {
    const result = run(NPM8_EPERM)
    const text = JSON.stringify(result)

    expect(result.likelyCause).toMatch(/another program|locked|in use|hold/i)
    expect(text).not.toMatch(/disable (your )?(antivirus|security|firewall)/i)
    expect(text).not.toMatch(/run as administrator/i)
  })

  it('names the script and says the real error is printed above', () => {
    const result = diagnose({
      language: 'auto',
      errorText: ELIFECYCLE_NPM9_ONLY,
    })

    expect(result.category).toBe('npm-error')
    expect(result.matchedSignature).toBe('npm error code ELIFECYCLE')
    expect(['low', 'medium']).toContain(result.confidence.level)
    expect(result.likelyCause).toContain('build')
    expect(result.likelyCause).toMatch(/above/i)
    expect(result.possibleFix?.explanation).toMatch(/run the script (on its own|by itself|directly)/i)
    expect(result.confidence.reason).toMatch(/generic|no specific|trailer/i)
  })

  it('names the script for the npm 6 to 8 lifecycle line', () => {
    const result = run('npm ERR! Failed at the bugpilot@1.0.0 build script.')

    expect(result.category).toBe('npm-error')
    expect(result.matchedSignature).toBe(
      'npm ERR! Failed at the <script> script.',
    )
    expect(result.likelyCause).toContain('build')
    expect(['low', 'medium']).toContain(result.confidence.level)
  })

  it('reports ELIFECYCLE for the npm 6 to 8 lifecycle block', () => {
    const result = run(ELIFECYCLE_NPM8_ONLY)

    expect(result.category).toBe('npm-error')
    expect(result.matchedSignature).toBe('npm ERR! code ELIFECYCLE')
    expect(['low', 'medium']).toContain(result.confidence.level)
    expect(result.likelyCause).toContain('build')
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        label: 'Matched context line',
        quote: 'npm ERR! code ELIFECYCLE',
        lineNumber: 1,
      }),
    )
  })

  it('reports a lifecycle failure from the npm errno line alone', () => {
    const result = run('npm ERR! errno 1')

    expect(result.category).toBe('npm-error')
    expect(result.matchedSignature).toBe('npm ERR! errno <exit code>')
    expect(['low', 'medium']).toContain(result.confidence.level)
    expect(result.likelyCause).toMatch(/script|command|above/i)
  })

  it('lets an earlier TypeScript error win over the ELIFECYCLE trailer', () => {
    const result = diagnose({ language: 'auto', errorText: ELIFECYCLE_AFTER_TS })

    expect(result.category).toBe('typescript-error')
    expect(result.matchedSignature).toBe(SIG_2322)
    expect(result.confidence.level).toBe('high')
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        label: 'Matched context line',
        quote: CLASSIC_2322,
        lineNumber: 1,
      }),
    )
    expect(result.likelyCause).not.toMatch(/ELIFECYCLE/)
  })

  it('lets an earlier TypeScript error win when the summary sits between them', () => {
    const result = diagnose({
      language: 'auto',
      errorText: ELIFECYCLE_AFTER_PRETTY_TS,
    })

    expect(result.category).toBe('typescript-error')
    expect(result.matchedSignature).toBe(SIG_2339)
    expect(result.likelyCause).not.toMatch(/ELIFECYCLE/)
  })

  it('lets an earlier Node error win over the ELIFECYCLE trailer', () => {
    const result = run(ELIFECYCLE_AFTER_NODE_ERROR)

    expect(result.category).toBe('permission-denied')
    expect(result.matchedSignature).toBe(
      "Error: EACCES: permission denied, <operation> '<path>'",
    )
    expect(JSON.stringify(result)).not.toMatch(/ELIFECYCLE/)
  })

  it.each(NPM_LOOKALIKES)('does not claim an npm mention in: %s', (line) => {
    expect(javascriptNpmErrorRule.match(line)).toBeNull()

    const result = run(line)

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
  })

  it('keeps yarn and pnpm output unrecognised', () => {
    const yarn = [
      'yarn add v1.22.19',
      '[1/4] Resolving packages...',
      'error Command failed.',
      'Exit code: 1',
    ].join('\n')
    const pnpm = [
      'Progress: resolved 214, reused 0',
      ' ERR_PNPM_NO_MATCHING_VERSION  No matching version found for some-ui-lib@2.9.9',
      'Failed to create install "tree"',
    ].join('\n')

    expect(run(yarn).category).toBe('unrecognized')
    expect(run(pnpm).category).toBe('unrecognized')
  })
})

describe('compiler and package manager rule boundaries', () => {
  it.each(EXISTING_UNCHANGED_CASES)(
    'keeps the existing result for $name',
    ({ line, category, signature }) => {
      expect(javascriptNpmErrorRule.match(line)).toBeNull()
      expect(javascriptTypeScriptErrorRule.match(line)).toBeNull()

      const result = run(line)

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
    },
  )

  it('keeps the existing Node rules matching their own lines', () => {
    expect(
      javascriptNodeFileErrorRule.match(EXISTING_UNCHANGED_CASES[0].line),
    ).not.toBeNull()
    expect(
      javascriptPermissionErrorRule.match(EXISTING_UNCHANGED_CASES[1].line),
    ).not.toBeNull()
    expect(
      javascriptPortInUseRule.match(EXISTING_UNCHANGED_CASES[2].line),
    ).not.toBeNull()
    expect(
      javascriptNetworkRequestFailedRule.match(EXISTING_UNCHANGED_CASES[4].line),
    ).not.toBeNull()
    expect(javascriptCorsBlockedRule.match(CORS_SAMPLE)).not.toBeNull()
  })

  it.each([
    [
      'ENOENT',
      String.raw`Error: ENOENT: no such file or directory, open 'C:\Users\dev\project\package.json'`,
      'missing-file',
      String.raw`npm error code ENOENT`,
      'npm-error',
    ],
    [
      'EACCES',
      "Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'",
      'permission-denied',
      'npm error code EACCES',
      'npm-error',
    ],
    [
      'EADDRINUSE',
      'Error: listen EADDRINUSE: address already in use :::5173',
      'port-in-use',
      'npm error code ELIFECYCLE',
      'npm-error',
    ],
  ] as const)(
    'routes the bare Node %s line to the existing rule and the npm %s line to the npm rule',
    (_code, nodeLine, nodeCategory, npmLine, npmCategory) => {
      expect(run(nodeLine).category).toBe(nodeCategory)
      expect(javascriptNpmErrorRule.match(nodeLine)).toBeNull()

      expect(run(npmLine).category).toBe(npmCategory)
    },
  )

  it('keeps a TypeScript error out of the npm rule and vice versa', () => {
    expect(javascriptNpmErrorRule.match(CLASSIC_2322)).toBeNull()
    expect(javascriptTypeScriptErrorRule.match(NPM9_ERESOLVE.split('\n')[0])).toBeNull()
  })

  it('keeps a Python traceback result unchanged when TypeScript wording appears in Python', () => {
    const result = diagnose({
      language: 'python',
      errorText: 'ValueError: invalid literal for int() with base 10: TS2322',
    })

    expect(result.category).toBe('invalid-value')
  })
})

describe('engine support for batch C1', () => {
  it.each([
    ['error TS2322 with a location', `src/App.tsx(12,5): error TS2322: ${TS_2322}`],
    ['error TS2322 without a location', BARE_2322],
    ['the editor style suffix', EDITOR_2322],
    ['npm ERR! code', 'npm ERR! code E404'],
    ['npm error code', 'npm error code E404'],
    ['npm error network', NPM9_NETWORK],
  ] as const)('infers JavaScript in Auto for %s', (_name, input) => {
    const result = diagnose({ language: 'auto', errorText: input })

    expect(result.category).not.toBe('unrecognized')
    expect(result.confidence.reason).toMatch(/JavaScript/i)
  })

  it.each([
    [
      'ModuleNotFoundError',
      "ModuleNotFoundError: No module named 'requests'",
      'missing-module',
    ],
    [
      'TypeError',
      "TypeError: unsupported operand type(s) for /: 'int' and 'str'",
      'type-mismatch',
    ],
    [
      'SyntaxError',
      'SyntaxError: invalid syntax',
      'syntax-error',
    ],
    [
      'FileNotFoundError',
      "FileNotFoundError: [Errno 2] No such file or directory: 'data.csv'",
      'missing-file',
    ],
  ] as const)(
    'keeps the existing Python %s detection unchanged',
    (_name, input, category) => {
      const auto = diagnose({ language: 'auto', errorText: input })

      expect(auto.category).toBe(category)
      expect(auto.confidence.reason).not.toMatch(/JavaScript/i)

      const withTraceback = diagnose({
        language: 'auto',
        errorText: [
          'Traceback (most recent call last):',
          '  File "/home/ana/project/app.py", line 4, in <module>',
          '    run()',
          input,
        ].join('\n'),
      })

      expect(withTraceback.category).toBe(category)
      expect(withTraceback.confidence.level).toBe('high')
    },
  )

  it('does not let the new signals change an existing JavaScript result', () => {
    const result = diagnose({
      language: 'auto',
      errorText: [
        'Uncaught TypeError: Cannot read properties of undefined (reading \'total\')',
        '    at Cart (src/Cart.jsx:24:11)',
      ].join('\n'),
    })

    expect(result.category).toBe('type-mismatch')
    expect(result.confidence.level).toBe('high')
  })

  it('declares the first-match capability on both new rules', () => {
    expect(javascriptTypeScriptErrorRule.firstMatchWins).toBe(true)
    expect(javascriptNpmErrorRule.firstMatchWins).toBe(true)
    expect(
      javascriptRules.filter((rule) => rule.firstMatchWins === true),
    ).toEqual([javascriptTypeScriptErrorRule, javascriptNpmErrorRule])
    expect(javascriptCorsBlockedRule.firstMatchWins ?? false).toBe(false)
  })

  it('declares context symptoms so a trailer cannot hide the real error', () => {
    expect(javascriptTypeScriptErrorRule.contextSymptoms?.length).toBeGreaterThan(
      0,
    )
    expect(javascriptNpmErrorRule.contextSymptoms?.length).toBeGreaterThan(0)
  })

  it('gives both new rules a JavaScript language and no supersedes', () => {
    expect(javascriptTypeScriptErrorRule.language).toBe('javascript')
    expect(javascriptNpmErrorRule.language).toBe('javascript')
    expect(javascriptTypeScriptErrorRule.supersedes ?? []).toEqual([])
    expect(javascriptNpmErrorRule.supersedes ?? []).toEqual([])
  })

  it('registers both categories with readable labels', () => {
    expect(DIAGNOSTIC_CATEGORY_LABELS['typescript-error']).toBe(
      'TypeScript compiler error',
    )
    expect(DIAGNOSTIC_CATEGORY_LABELS['npm-error']).toBe(
      'NPM install or run error',
    )
    expect(diagnosticCategoryLabel('typescript-error')).toBe(
      'TypeScript compiler error',
    )
    expect(diagnosticCategoryLabel('npm-error')).toBe(
      'NPM install or run error',
    )
  })

  it('registers both rules after every existing JavaScript rule', () => {
    expect(javascriptRules.slice(12).map((rule) => rule.id)).toEqual([
      'javascript.typescript-error',
      'javascript.npm-error',
    ])
    expect(javascriptRules).toHaveLength(14)
  })

  it('rejects empty and oversized input', () => {
    expect(run('').category).toBe('unrecognized')
    expect(
      run(`${BARE_2322}${'x'.repeat(MAX_ERROR_TEXT_LENGTH)}`).category,
    ).toBe('unrecognized')
  })
})
