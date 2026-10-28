import { describe, expect, it } from 'vitest'
import { MAX_ERROR_TEXT_LENGTH, diagnose } from './engine'
import {
  javascriptCallStackExceededRule,
  javascriptNodeFileErrorRule,
  javascriptNodeModuleNotFoundRule,
  javascriptPermissionErrorRule,
  javascriptPortInUseRule,
} from './rules/javascript'
import {
  pythonFileNotFoundErrorRule,
  pythonModuleNotFoundErrorRule,
  pythonPermissionErrorRule,
} from './rules/python'
import type { DiagnosticRule, SupportedDiagnosticCategory } from './types'

const NODE_FRAMES = [
  '    at Module._resolveFilename (node:internal/modules/cjs/loader:1228:15)',
  '    at Module._load (node:internal/modules/cjs/loader:1054:27)',
  '    at Module.require (node:internal/modules/cjs/loader:1288:19)',
  '    at Object.<anonymous> (C:\\Users\\ana\\app\\server.js:1:17)',
  '    at Module._compile (node:internal/modules/cjs/loader:1521:14)',
  '    at node:internal/main/run_main_module:23:47',
].join('\n')

function nodeTrace(errorLine: string, afterErrorLine = ''): string {
  return [errorLine, afterErrorLine, NODE_FRAMES, 'Node.js v22.11.0']
    .filter((part) => part !== '')
    .join('\n')
}

interface PositiveCase {
  name: string
  line: string
  category: SupportedDiagnosticCategory
  signature: string
}

const MODULE_CASES: PositiveCase[] = [
  {
    name: 'CommonJS bare package',
    line: "Error: Cannot find module 'express'",
    category: 'missing-module',
    signature: "Error: Cannot find module '<package>'",
  },
  {
    name: 'CommonJS relative path',
    line: "Error: Cannot find module './missing-handler'",
    category: 'missing-module',
    signature: "Error: Cannot find module '<path>'",
  },
  {
    name: 'CommonJS Windows absolute path',
    line: "Error: Cannot find module 'C:\\Users\\ana\\app\\dist\\missing.js'",
    category: 'missing-module',
    signature: "Error: Cannot find module '<path>'",
  },
  {
    name: 'ESM bare package',
    line: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'date-fns' imported from /home/ana/app/src/index.mjs",
    category: 'missing-module',
    signature:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<package>' imported from <path>",
  },
  {
    name: 'ESM scoped package',
    line: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@scope/toolkit' imported from C:\\Users\\ana\\app\\src\\index.mjs",
    category: 'missing-module',
    signature:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<package>' imported from <path>",
  },
  {
    name: 'ESM relative file without an extension',
    line: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './utils' imported from /home/ana/app/src/index.mjs",
    category: 'missing-module',
    signature:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<path>' imported from <path>",
  },
  {
    name: 'ESM absolute file path',
    line: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/ana/app/lib/missing.js' imported from /home/ana/app/src/index.mjs",
    category: 'missing-module',
    signature:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<path>' imported from <path>",
  },
]

const PORT_CASES: PositiveCase[] = [
  {
    name: 'IPv6 wildcard address',
    line: 'Error: listen EADDRINUSE: address already in use :::3000',
    category: 'port-in-use',
    signature: 'Error: listen EADDRINUSE: address already in use <address>',
  },
  {
    name: 'IPv4 wildcard address',
    line: 'Error: listen EADDRINUSE: address already in use 0.0.0.0:3000',
    category: 'port-in-use',
    signature: 'Error: listen EADDRINUSE: address already in use <address>',
  },
  {
    name: 'IPv4 loopback address',
    line: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:8080',
    category: 'port-in-use',
    signature: 'Error: listen EADDRINUSE: address already in use <address>',
  },
  {
    name: 'localhost address',
    line: 'Error: listen EADDRINUSE: address already in use localhost:3000',
    category: 'port-in-use',
    signature: 'Error: listen EADDRINUSE: address already in use <address>',
  },
]

const FILE_CASES: PositiveCase[] = [
  {
    name: 'ENOENT open',
    line: "Error: ENOENT: no such file or directory, open '/home/ana/app/config.json'",
    category: 'missing-file',
    signature: "Error: ENOENT: no such file or directory, <operation> '<path>'",
  },
  {
    name: 'ENOENT stat',
    line: "Error: ENOENT: no such file or directory, stat 'C:\\Users\\ana\\app\\data\\input.csv'",
    category: 'missing-file',
    signature: "Error: ENOENT: no such file or directory, <operation> '<path>'",
  },
  {
    name: 'ENOENT scandir',
    line: "Error: ENOENT: no such file or directory, scandir '/home/ana/app/uploads'",
    category: 'missing-file',
    signature: "Error: ENOENT: no such file or directory, <operation> '<path>'",
  },
  {
    name: 'ENOENT mkdir',
    line: "Error: ENOENT: no such file or directory, mkdir '/home/ana/app/cache/tmp'",
    category: 'missing-file',
    signature: "Error: ENOENT: no such file or directory, <operation> '<path>'",
  },
  {
    name: 'ENOENT readFile',
    line: "Error: ENOENT: no such file or directory, readFile './package.json'",
    category: 'missing-file',
    signature: "Error: ENOENT: no such file or directory, <operation> '<path>'",
  },
  {
    name: 'spawn ENOENT',
    line: 'Error: spawn ffmpeg ENOENT',
    category: 'missing-file',
    signature: 'Error: spawn <command> ENOENT',
  },
]

const PERMISSION_CASES: PositiveCase[] = [
  {
    name: 'EACCES open',
    line: "Error: EACCES: permission denied, open '/var/app/config.json'",
    category: 'permission-denied',
    signature: "Error: EACCES: permission denied, <operation> '<path>'",
  },
  {
    name: 'EACCES mkdir',
    line: "Error: EACCES: permission denied, mkdir 'C:\\ProgramData\\app\\cache'",
    category: 'permission-denied',
    signature: "Error: EACCES: permission denied, <operation> '<path>'",
  },
  {
    name: 'EACCES scandir',
    line: "Error: EACCES: permission denied, scandir '/root/private'",
    category: 'permission-denied',
    signature: "Error: EACCES: permission denied, <operation> '<path>'",
  },
  {
    name: 'listen EACCES on a restricted port',
    line: 'Error: listen EACCES: permission denied 0.0.0.0:80',
    category: 'permission-denied',
    signature: 'Error: listen EACCES: permission denied <address>',
  },
  {
    name: 'EPERM without an operation',
    line: 'Error: EPERM: operation not permitted',
    category: 'permission-denied',
    signature: 'Error: EPERM: operation not permitted',
  },
  {
    name: 'EPERM with a locked file',
    line: "Error: EPERM: operation not permitted, open 'C:\\Users\\ana\\AppData\\Local\\app\\cache.db'",
    category: 'permission-denied',
    signature: 'Error: EPERM: operation not permitted',
  },
]

const STACK_CASES: PositiveCase[] = [
  {
    name: 'maximum call stack',
    line: 'RangeError: Maximum call stack size exceeded',
    category: 'recursion-error',
    signature: 'RangeError: Maximum call stack size exceeded',
  },
]

const ALL_POSITIVE_CASES = [
  ...MODULE_CASES,
  ...PORT_CASES,
  ...FILE_CASES,
  ...PERMISSION_CASES,
  ...STACK_CASES,
]

function expectCompleteResult(
  line: string,
  category: SupportedDiagnosticCategory,
  signature: string,
): void {
  const result = diagnose({ language: 'javascript', errorText: line })

  expect(result.category).toBe(category)
  expect(result.matchedSignature).toBe(signature)
  expect(result.confidence.level).toBe('high')
  expect(result.likelyCause.trim()).not.toBe('')
  expect(result.evidence[0]).toEqual({
    source: 'error text',
    label: 'Final exception line',
    quote: line,
    lineNumber: 1,
  })
  expect(result.debuggingSteps.length).toBeGreaterThan(0)
  expect(result.possibleFix).not.toBeNull()
  expect(result.possibleFix?.explanation.trim()).not.toBe('')
  expect(result.possibleFix?.whereItMayApply.trim()).not.toBe('')
  expect(result.possibleFix?.exampleCode.trim()).not.toBe('')
  expect(result.verificationSteps.length).toBeGreaterThan(0)
  expect(result.limitations.length).toBeGreaterThan(0)
  expect(result.alternativeExplanations.length).toBeGreaterThan(0)
}

describe('Node module-not-found rule', () => {
  it.each(MODULE_CASES)(
    'diagnoses $name with the documented signature',
    ({ line, category, signature }) => {
      expect(javascriptNodeModuleNotFoundRule.match(line)).not.toBeNull()
      expectCompleteResult(line, category, signature)
    },
  )

  it('keeps one stable signature for each sub-signature', () => {
    expect(
      javascriptNodeModuleNotFoundRule.match("Error: Cannot find module 'express'")
        ?.signature,
    ).toBe("Error: Cannot find module '<package>'")
    expect(
      javascriptNodeModuleNotFoundRule.match(
        "Error: Cannot find module './missing-handler'",
      )?.signature,
    ).toBe("Error: Cannot find module '<path>'")
    expect(
      javascriptNodeModuleNotFoundRule.match(
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'date-fns' imported from /app/index.mjs",
      )?.signature,
    ).toBe(
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<package>' imported from <path>",
    )
  })

  it('gives a bare package, a missing path, and a missing ESM extension different advice', () => {
    const packageResult = diagnose({
      language: 'javascript',
      errorText: "Error: Cannot find module 'express'",
    })
    const pathResult = diagnose({
      language: 'javascript',
      errorText: "Error: Cannot find module './missing-handler'",
    })
    const esmResult = diagnose({
      language: 'javascript',
      errorText:
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './utils' imported from /home/ana/app/src/index.mjs",
    })

    expect(packageResult.likelyCause).toMatch(
      /not installed|misspelled|package\.json/i,
    )
    expect(pathResult.likelyCause).toMatch(/path|case|build output/i)
    expect(esmResult.likelyCause).toMatch(/extension/i)

    const causes = new Set([
      packageResult.likelyCause,
      pathResult.likelyCause,
      esmResult.likelyCause,
    ])
    expect(causes.size).toBe(3)

    expect(packageResult.possibleFix?.explanation).toMatch(/install/i)
    expect(pathResult.possibleFix?.explanation).toMatch(/path|file/i)
    expect(esmResult.possibleFix?.explanation).toMatch(/extension/i)
  })

  it('handles a CommonJS trace with and without a Require stack list', () => {
    const withRequireStack = nodeTrace(
      "Error: Cannot find module 'express'",
      'Require stack:\n- C:\\Users\\ana\\app\\server.js',
    )
    const withoutRequireStack = nodeTrace("Error: Cannot find module 'express'")

    for (const text of [withRequireStack, withoutRequireStack]) {
      const result = diagnose({ language: 'auto', errorText: text })

      expect(result.category).toBe('missing-module')
      expect(result.matchedSignature).toBe(
        "Error: Cannot find module '<package>'",
      )
      expect(result.confidence.level).toBe('high')
      expect(result.evidence[0]).toEqual({
        source: 'error text',
        label: 'Final exception line',
        quote: "Error: Cannot find module 'express'",
        lineNumber: 1,
      })
    }
  })

  it.each([
    "Cannot find module 'express' was mentioned in the docs.",
    "2026-10-28 12:00:00 WARN Cannot find module 'express'",
    'Error: Cannot find module express',
    "Error: Cannot find module 'express' was only logged, not thrown.",
    "Error: unable to find module 'express'",
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find package \"date-fns\" imported from /app/index.mjs",
  ])('does not claim the lookalike: %s', (line) => {
    expect(javascriptNodeModuleNotFoundRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('does not match a prose mention of the rule name', () => {
    expect(
      javascriptNodeModuleNotFoundRule.match(
        'A teammate mentioned the Node module not found error while reviewing the log.',
      ),
    ).toBeNull()
  })

  it('does not interfere with the Python module-not-found rule', () => {
    expect(
      pythonModuleNotFoundErrorRule.match("Error: Cannot find module 'express'"),
    ).toBeNull()
    expect(
      javascriptNodeModuleNotFoundRule.match(
        "ModuleNotFoundError: No module named 'requests'",
      ),
    ).toBeNull()

    const python = diagnose({
      language: 'python',
      errorText: [
        'Traceback (most recent call last):',
        '  File "/home/ana/app/main.py", line 2, in <module>',
        '    import requests',
        "ModuleNotFoundError: No module named 'requests'",
      ].join('\n'),
    })

    expect(python.category).toBe('missing-module')
    expect(python.matchedSignature).toBe(
      "ModuleNotFoundError: No module named '<module>'",
    )
    expect(python.likelyCause).toMatch(/Python/i)
    expect(python.confidence.level).toBe('high')
  })
})

describe('Node port-in-use rule', () => {
  it.each(PORT_CASES)(
    'diagnoses $name with the documented signature',
    ({ line, category, signature }) => {
      expect(javascriptPortInUseRule.match(line)).not.toBeNull()
      expectCompleteResult(line, category, signature)
    },
  )

  it('names the address and offers safe process-inspection steps for each platform', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: 'Error: listen EADDRINUSE: address already in use :::3000',
    })
    const steps = result.debuggingSteps.join('\n')

    expect(result.likelyCause).toMatch(/already in use/i)
    expect(result.likelyCause).toMatch(/dev server|another process/i)
    expect(steps).toMatch(/netstat -ano \| findstr :3000/)
    expect(steps).toMatch(/lsof -i :3000/)
    expect(steps).toMatch(/only a process you recognise/i)
    expect(steps).toMatch(/never end unknown system processes/i)
    expect(result.possibleFix?.explanation).toMatch(/stop|different port/i)
  })

  it.each([
    '2026-10-28 12:00:00 WARN EADDRINUSE: address already in use :::3000',
    'Error: listen EADDRINUSE: address already in use',
    'The teammate said EADDRINUSE means the port is busy.',
    'EADDRINUSE: address already in use :::3000',
    'Error: listen EADDRINUSE',
  ])('does not claim the lookalike: %s', (line) => {
    expect(javascriptPortInUseRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('does not match a prose mention of a busy port', () => {
    expect(
      javascriptPortInUseRule.match(
        'A busy port sometimes produces a port in use message in the console.',
      ),
    ).toBeNull()
  })
})

describe('Node file-error rule', () => {
  it.each(FILE_CASES)(
    'diagnoses $name with the documented signature',
    ({ line, category, signature }) => {
      expect(javascriptNodeFileErrorRule.match(line)).not.toBeNull()
      expectCompleteResult(line, category, signature)
    },
  )

  it('gives a missing file and a missing executable different causes and fixes', () => {
    const fileResult = diagnose({
      language: 'javascript',
      errorText:
        "Error: ENOENT: no such file or directory, open '/home/ana/app/config.json'",
    })
    const spawnResult = diagnose({
      language: 'javascript',
      errorText: 'Error: spawn ffmpeg ENOENT',
    })

    expect(fileResult.likelyCause).toMatch(/file|folder|process\.cwd/i)
    expect(spawnResult.likelyCause).toMatch(/executable|PATH|not installed/i)
    expect(fileResult.likelyCause).not.toBe(spawnResult.likelyCause)

    const spawnAdvice = [
      spawnResult.likelyCause,
      spawnResult.possibleFix?.explanation,
      spawnResult.debuggingSteps.join(' '),
    ].join(' ')
    expect(spawnAdvice).toMatch(/PATH/)
    expect(spawnAdvice).toMatch(/\.cmd|shell: true/i)
    expect(spawnAdvice).toMatch(/restart|reopen/i)
  })

  it.each([
    "2026-10-28 12:00:00 WARN ENOENT: no such file or directory, open '/app/x.json'",
    "Error: ENOENT: no such file or directory, lstat '/app/x.json'",
    "Error: ENOENT: no such file or directory, open /app/x.json",
    'Error: spawn ffmpeg',
    'The docs mention spawn ffmpeg ENOENT as an example.',
    'ENOENT: no such file or directory',
  ])('does not claim the lookalike: %s', (line) => {
    expect(javascriptNodeFileErrorRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('does not interfere with the Python file-not-found rule', () => {
    expect(
      pythonFileNotFoundErrorRule.match(
        "Error: ENOENT: no such file or directory, open '/app/x.json'",
      ),
    ).toBeNull()
    expect(
      javascriptNodeFileErrorRule.match(
        "FileNotFoundError: [Errno 2] No such file or directory: 'data/input.csv'",
      ),
    ).toBeNull()

    const python = diagnose({
      language: 'python',
      errorText:
        "FileNotFoundError: [Errno 2] No such file or directory: 'data/input.csv'",
    })

    expect(python.category).toBe('missing-file')
    expect(python.matchedSignature).toBe(
      'FileNotFoundError: No such file or directory',
    )
    expect(python.confidence.level).toBe('high')
  })

  it('does not match a prose mention of a missing file', () => {
    expect(
      javascriptNodeFileErrorRule.match(
        'The log said the process failed because a file was missing.',
      ),
    ).toBeNull()
  })
})

describe('Node permission rule', () => {
  it.each(PERMISSION_CASES)(
    'diagnoses $name with the documented signature',
    ({ line, category, signature }) => {
      expect(javascriptPermissionErrorRule.match(line)).not.toBeNull()
      expectCompleteResult(line, category, signature)
    },
  )

  it('distinguishes file permissions, a restricted port, and EPERM', () => {
    const fileResult = diagnose({
      language: 'javascript',
      errorText: "Error: EACCES: permission denied, open '/var/app/config.json'",
    })
    const portResult = diagnose({
      language: 'javascript',
      errorText: 'Error: listen EACCES: permission denied 0.0.0.0:80',
    })
    const epermResult = diagnose({
      language: 'javascript',
      errorText: 'Error: EPERM: operation not permitted',
    })

    expect(fileResult.likelyCause).toMatch(/permission|read-only|locked/i)
    expect(portResult.likelyCause).toMatch(/port|privilege|1024/i)
    expect(epermResult.likelyCause).toMatch(/locked|another program|Windows/i)

    expect(
      new Set([
        fileResult.likelyCause,
        portResult.likelyCause,
        epermResult.likelyCause,
      ]).size,
    ).toBe(3)

    expect(portResult.possibleFix?.explanation).toMatch(
      /port above 1024|higher port|reverse proxy/i,
    )
    expect(portResult.possibleFix?.explanation).toMatch(
      /privileged port/i,
    )
  })

  it.each([
    "2026-10-28 12:00:00 ERROR EACCES: permission denied, open '/app/x'",
    'Error: EACCES: permission denied',
    'Error: EACCES: permission denied, open /app/x',
    'Error: EPERM',
    'A comment mentions EACCES: permission denied, open \'/app/x\'.',
    'The docs say permission errors are common.',
  ])('does not claim the lookalike: %s', (line) => {
    expect(javascriptPermissionErrorRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('does not interfere with the Python permission rule', () => {
    expect(
      pythonPermissionErrorRule.match(
        "Error: EACCES: permission denied, open '/var/app/config.json'",
      ),
    ).toBeNull()
    expect(
      javascriptPermissionErrorRule.match(
        "PermissionError: [Errno 13] Permission denied: '/var/app/config.json'",
      ),
    ).toBeNull()

    const python = diagnose({
      language: 'python',
      errorText:
        "PermissionError: [Errno 13] Permission denied: '/var/app/config.json'",
    })

    expect(python.category).toBe('permission-denied')
    expect(python.matchedSignature).toBe('PermissionError: Permission denied')
    expect(python.confidence.level).toBe('high')
  })

  it('does not match a prose mention of a permission error', () => {
    expect(
      javascriptPermissionErrorRule.match(
        'The README warns about a permission error when writing outside the project.',
      ),
    ).toBeNull()
  })
})

describe('JavaScript call-stack rule', () => {
  it.each(STACK_CASES)(
    'diagnoses $name with the documented signature',
    ({ line, category, signature }) => {
      expect(javascriptCallStackExceededRule.match(line)).not.toBeNull()
      expectCompleteResult(line, category, signature)
    },
  )

  it('advises a base case, iteration, getters, and circular data without raising the limit', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: 'RangeError: Maximum call stack size exceeded',
    })
    const steps = result.debuggingSteps.join('\n')

    expect(steps).toMatch(/base case/i)
    expect(steps).toMatch(/log|print/i)
    expect(steps).toMatch(/loop|iterat|explicit stack/i)
    expect(steps).toMatch(/getter|setter/i)
    expect(steps).toMatch(/circular|JSON\.stringify|deep clone/i)
    expect(result.possibleFix?.explanation).not.toMatch(
      /increase (?:the )?stack|--stack-size/i,
    )
    expect(result.possibleFix?.exampleCode).not.toMatch(
      /increase (?:the )?stack|--stack-size/i,
    )
    expect(result.limitations.join(' ')).toMatch(
      /raising the stack (?:size|limit) is not a fix/i,
    )
  })

  it.each([
    'RangeError: Invalid array length',
    'RangeError: Maximum call stack size exceeded in the previous run',
    '2026-10-28 12:00:00 WARN RangeError: Maximum call stack size exceeded',
    'A teammate mentioned the maximum call stack size exceeded message.',
  ])('does not claim the lookalike: %s', (line) => {
    expect(javascriptCallStackExceededRule.match(line)).toBeNull()

    const result = diagnose({ language: 'javascript', errorText: line })
    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.possibleFix).toBeNull()
  })

  it('leaves other RangeError messages unrecognised', () => {
    for (const line of [
      'RangeError: Invalid array length',
      'RangeError: Invalid string length',
      'RangeError: precision is out of range',
    ]) {
      const result = diagnose({ language: 'auto', errorText: line })
      expect(result.category).toBe('unrecognized')
      expect(result.matchedSignature).toBeNull()
    }
  })
})

describe('Node runtime auto-detection', () => {
  it.each([
    [
      "Error: Cannot find module 'express'",
      'missing-module',
      'medium',
    ],
    [
      "Error: Cannot find module './missing-handler'",
      'missing-module',
      'medium',
    ],
    [
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'date-fns' imported from /home/ana/app/src/index.mjs",
      'missing-module',
      'high',
    ],
    [
      'Error: listen EADDRINUSE: address already in use :::3000',
      'port-in-use',
      'high',
    ],
    [
      "Error: ENOENT: no such file or directory, open '/home/ana/app/config.json'",
      'missing-file',
      'high',
    ],
    ['Error: spawn ffmpeg ENOENT', 'missing-file', 'high'],
    [
      "Error: EACCES: permission denied, open '/var/app/config.json'",
      'permission-denied',
      'high',
    ],
    ['Error: EPERM: operation not permitted', 'permission-denied', 'high'],
    [
      'RangeError: Maximum call stack size exceeded',
      'recursion-error',
      'medium',
    ],
  ] as const)(
    'detects %s as JavaScript in auto mode',
    (line, category, level) => {
      const result = diagnose({ language: 'auto', errorText: line })

      expect(result.category).toBe(category)
      expect(result.confidence.level).toBe(level)
    },
  )

  it.each(ALL_POSITIVE_CASES)(
    'raises $name to high confidence with real Node stack frames',
    ({ line }) => {
      const trace = nodeTrace(line, 'Require stack:\n- /home/ana/app/server.js')
      const result = diagnose({ language: 'auto', errorText: trace })

      expect(result.category).not.toBe('unrecognized')
      expect(result.confidence.level).toBe('high')
      expect(result.evidence[0]).toEqual({
        source: 'error text',
        label: 'Final exception line',
        quote: line,
        lineNumber: 1,
      })
    },
  )

  it('lowers confidence when Python trace evidence conflicts with a Node line', () => {
    const result = diagnose({
      language: 'auto',
      errorText:
        "Error: ENOENT: no such file or directory, open '/app/config.json'",
      reproductionDetails: [
        'Traceback (most recent call last):',
        '  File "/app/run.py", line 3, in <module>',
        '    main()',
      ].join('\n'),
    })

    expect(result.category).toBe('missing-file')
    expect(result.matchedSignature).toBe(
      "Error: ENOENT: no such file or directory, <operation> '<path>'",
    )
    expect(result.confidence.level).toBe('low')
    expect(result.confidence.reason).toMatch(/conflict/i)
  })
})

describe('Node result evidence', () => {
  it.each([
    [
      "Error: Cannot find module 'express'",
      "const express = require('express')",
    ],
    [
      "Error: Cannot find module './missing-handler'",
      "const handler = require('./missing-handler')",
    ],
    [
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'date-fns' imported from /home/ana/app/src/index.mjs",
      "import { format } from 'date-fns'",
    ],
    [
      "Error: ENOENT: no such file or directory, open './config.json'",
      "fs.readFileSync('./config.json')",
    ],
    [
      'Error: spawn ffmpeg ENOENT',
      "execFile('ffmpeg', ['-version'])",
    ],
    [
      "Error: EACCES: permission denied, open '/var/app/config.json'",
      "fs.openSync('/var/app/config.json', 'r')",
    ],
    [
      'Error: listen EADDRINUSE: address already in use :::3000',
      'const port = 3000',
    ],
  ] as const)(
    'adds one related snippet line for %s',
    (line, snippet) => {
      const result = diagnose({
        language: 'javascript',
        errorText: line,
        codeSnippet: snippet,
      })

      expect(result.evidence).toHaveLength(2)
      expect(result.evidence[1]).toEqual({
        source: 'code snippet',
        label: 'Related line from the supplied code',
        quote: snippet,
        lineNumber: 1,
      })
    },
  )

  it('does not invent snippet evidence without a captured value', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: 'RangeError: Maximum call stack size exceeded',
      codeSnippet: 'function walk(node) { return walk(node) }',
    })

    expect(result.evidence).toHaveLength(1)
  })
})

describe('Node rule robustness', () => {
  it.each(ALL_POSITIVE_CASES)(
    'rejects empty input around $name',
    () => {
      const result = diagnose({ language: 'javascript', errorText: '' })

      expect(result.category).toBe('unrecognized')
      expect(result.matchedSignature).toBeNull()
      expect(result.possibleFix).toBeNull()
    },
  )

  it('rejects oversized Node input instead of truncating it', () => {
    const result = diagnose({
      language: 'javascript',
      errorText: `Error: Cannot find module '${'x'.repeat(MAX_ERROR_TEXT_LENGTH)}'`,
    })

    expect(result.category).toBe('unrecognized')
    expect(result.matchedSignature).toBeNull()
    expect(result.confidence.level).toBe('low')
  })
})

describe('Existing JavaScript rules keep their behaviour', () => {
  it.each([
    [
      'ReferenceError: cart is not defined',
      'undefined-name',
      'ReferenceError: <name> is not defined',
    ],
    [
      "TypeError: Cannot read properties of undefined (reading 'name')",
      'type-mismatch',
      'TypeError: <JavaScript value type problem>',
    ],
    [
      "SyntaxError: Unexpected token '<'",
      'syntax-error',
      'SyntaxError: <JavaScript parser error>',
    ],
  ] as const)(
    'keeps the existing diagnosis for %s',
    (line, category, signature) => {
      const result = diagnose({ language: 'javascript', errorText: line })

      expect(result.category).toBe(category)
      expect(result.matchedSignature).toBe(signature)
      expect(result.confidence.level).toBe('high')
    },
  )

  it('keeps TypeError [ERR_INVALID_ARG_TYPE] unrecognised as before', () => {
    const line =
      'TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined'

    for (const language of ['auto', 'javascript'] as const) {
      const result = diagnose({ language, errorText: line })

      expect(result.category).toBe('unrecognized')
      expect(result.matchedSignature).toBeNull()
    }
  })

  it('keeps a Python exception line selected ahead of a later Node log line', () => {
    const text = [
      "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
      'Error: Cannot find module was printed by a logger afterwards',
    ].join('\n')
    const result = diagnose({ language: 'python', errorText: text })

    expect(result.category).toBe('type-mismatch')
    expect(result.matchedSignature).toBe('TypeError: <Python type mismatch>')
    expect(result.evidence[0].quote).toBe(
      "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
    )
  })
})

describe('Registered Node rules', () => {
  it('uses the documented ids and categories', () => {
    const expectations: Array<[DiagnosticRule, string, string]> = [
      [
        javascriptNodeModuleNotFoundRule,
        'javascript.node-module-not-found',
        'missing-module',
      ],
      [javascriptPortInUseRule, 'javascript.port-in-use', 'port-in-use'],
      [
        javascriptNodeFileErrorRule,
        'javascript.node-file-error',
        'missing-file',
      ],
      [
        javascriptPermissionErrorRule,
        'javascript.permission-error',
        'permission-denied',
      ],
      [
        javascriptCallStackExceededRule,
        'javascript.call-stack-exceeded',
        'recursion-error',
      ],
    ]

    for (const [rule, id, category] of expectations) {
      expect(rule.id).toBe(id)
      expect(rule.language).toBe('javascript')
      expect(rule.category).toBe(category)
    }
  })

  it('is appended after the three pre-existing JavaScript rules', async () => {
    const { javascriptRules } = await import('./rules/javascript')

    expect(javascriptRules.slice(0, 3).map((rule) => rule.id)).toEqual([
      'javascript.reference-error',
      'javascript.type-error',
      'javascript.syntax-error',
    ])
    expect(javascriptRules.slice(3).map((rule) => rule.id)).toEqual([
      'javascript.node-module-not-found',
      'javascript.port-in-use',
      'javascript.node-file-error',
      'javascript.permission-error',
      'javascript.call-stack-exceeded',
    ])
  })

  it('does not duplicate an existing category for module, file, permission, or recursion errors', () => {
    expect(javascriptNodeModuleNotFoundRule.category).toBe(
      pythonModuleNotFoundErrorRule.category,
    )
    expect(javascriptNodeFileErrorRule.category).toBe(
      pythonFileNotFoundErrorRule.category,
    )
    expect(javascriptPermissionErrorRule.category).toBe(
      pythonPermissionErrorRule.category,
    )
    expect(javascriptCallStackExceededRule.category).toBe('recursion-error')
  })
})
