import type { DiagnosticRule, RuleMatch, RuleNarrative } from '../types'

const REFERENCE_ERROR = /^ReferenceError:\s+(.+)$/
const NOT_DEFINED =
  /^ReferenceError:\s+([A-Za-z_$][\w$]*) is not defined/
const BEFORE_INITIALIZATION =
  /^ReferenceError:\s+Cannot access '([A-Za-z_$][\w$]*)' before initialization/

const TYPE_ERROR = /^TypeError:\s+(.+)$/
const PYTHON_TYPE_ERROR =
  /(?:unsupported operand type|can only concatenate|object is not (?:subscriptable|callable|iterable)|required positional argument|takes \d+ positional arguments?|object of type .+ has no len|not supported between instances of|NoneType)/i
const READ_PROPERTY =
  /^Cannot read propert(?:y|ies) .+ of (?:undefined|null)/
const WRITE_PROPERTY =
  /^Cannot set propert(?:y|ies) .+ of (?:undefined|null)/
const NOT_A_FUNCTION = /^.+ is not a function/
const OTHER_JAVASCRIPT_TYPE_ERROR =
  /(?:Assignment to constant variable|Cannot convert undefined or null|Cannot destructure|is not iterable|reading ')/i

const SYNTAX_ERROR = /^SyntaxError:\s+(.+)$/
const PYTHON_SYNTAX_ERROR =
  /(?:invalid syntax|unexpected indent|was never closed|unmatched\s+'\)'|unterminated string literal|expected\s+':'|EOL while scanning string literal|missing parentheses in call|invalid decimal literal)/i
const KNOWN_JAVASCRIPT_SYNTAX_ERROR =
  /(?:Unexpected token|Unexpected end of JSON input|Invalid or unexpected token|missing \S+ after argument list|Cannot use import statement outside a module|Unexpected identifier|Invalid left-hand side in assignment|Unexpected end of input|Unexpected number)/i

export const javascriptReferenceErrorRule: DiagnosticRule = {
  id: 'javascript.reference-error',
  language: 'javascript',
  category: 'undefined-name',
  match(line: string): RuleMatch | null {
    const notDefined = NOT_DEFINED.exec(line)
    if (notDefined) {
      return {
        signature: 'ReferenceError: <name> is not defined',
        specificity: 'specific',
        captures: { name: notDefined[1], reason: 'not-defined' },
      }
    }

    const beforeInitialization = BEFORE_INITIALIZATION.exec(line)
    if (beforeInitialization) {
      return {
        signature: 'ReferenceError: Cannot access <name> before initialization',
        specificity: 'specific',
        captures: {
          name: beforeInitialization[1],
          reason: 'before-initialization',
        },
      }
    }

    const generic = REFERENCE_ERROR.exec(line)
    if (!generic) {
      return null
    }

    return {
      signature: 'ReferenceError: <undefined variable>',
      specificity: 'generic',
      captures: { detail: generic[1] },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const name = match.captures.name
    const beforeInitialization = match.captures.reason === 'before-initialization'
    let likelyCause =
      'JavaScript tried to read a variable that is not available in the current scope. The variable may be misspelled, not imported or declared on this path, or accessed in the wrong scope.'

    if (name && beforeInitialization) {
      likelyCause = `The binding "${name}" exists but is still in its temporal dead zone, so it was read before its declaration finished initializing.`
    } else if (name) {
      likelyCause = `The binding "${name}" was not available in this scope when JavaScript evaluated it. It may be misspelled, missing an import or declaration, or declared in a different scope.`
    }

    return {
      likelyCause,
      debuggingSteps: [
        'Find the line in the stack that points to your source and identify the missing name.',
        'Check whether the name is declared or imported before the failing line runs.',
        'Check the scope: a variable declared inside a block or function is not available outside it.',
        'Look for a typo or for a property being used as a standalone variable.',
      ],
      possibleFix: {
        explanation: name
          ? `Declare or import "${name}" in the scope where it is used, or correct the spelling if the intended name is different.${beforeInitialization ? ' Otherwise move the access after the declaration has initialized the value.' : ''}`
          : 'Declare or import the missing value in the scope where it is used, or correct the spelling.',
        whereItMayApply:
          'Apply this before the failing reference in the same scope; avoid adding an unrelated global variable to silence the error.',
        exampleCode: [
          '// Declare or import the name before this line runs.',
          `const ${name ?? 'value'} = []`,
          `console.log(${name ?? 'value'})`,
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same command or browser interaction.',
        'Check that the ReferenceError is gone and the value has the expected type.',
        'Check both branches that can reach the failing line.',
      ],
      limitations: [
        'The error line does not show the surrounding module scope, bundler transform, or runtime globals.',
        'This engine cannot inspect JavaScript source, module resolution, or browser and Node globals.',
      ],
      alternativeExplanations: [
        'The name is a typo for another local variable.',
        'A missing import or an export-name mismatch left the value unavailable.',
        'The value is declared later, or the code is running in an old compiled bundle.',
      ],
    }
  },
}

export const javascriptTypeErrorRule: DiagnosticRule = {
  id: 'javascript.type-error',
  language: 'javascript',
  category: 'type-mismatch',
  match(line: string): RuleMatch | null {
    const matched = TYPE_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const detail = matched[1]
    if (PYTHON_TYPE_ERROR.test(detail)) {
      return null
    }

    let signature = 'TypeError: <JavaScript type mismatch>'
    let specificity: RuleMatch['specificity'] = 'generic'
    if (READ_PROPERTY.test(detail)) {
      signature = 'TypeError: Cannot read properties of undefined or null'
      specificity = 'specific'
    } else if (WRITE_PROPERTY.test(detail)) {
      signature = 'TypeError: Cannot set properties of undefined or null'
      specificity = 'specific'
    } else if (NOT_A_FUNCTION.test(detail)) {
      signature = 'TypeError: value is not a function'
      specificity = 'specific'
    } else if (OTHER_JAVASCRIPT_TYPE_ERROR.test(detail)) {
      signature = 'TypeError: <JavaScript value type problem>'
      specificity = 'specific'
    }

    return {
      signature,
      specificity,
      captures: { detail },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'JavaScript tried to read a property, assign a property, call a value, or use a value in a way that its runtime type does not support. The value may be undefined, null, or a different type than the code expects.',
      debuggingSteps: [
        'Read the TypeError message to identify the property or call that failed.',
        'Trace the failing value back to where it was fetched, parsed, or assigned.',
        'Check whether asynchronous data has loaded yet and whether an API returned the expected shape.',
        'Use a small reproduction to confirm the value type at the failing line before changing the wider flow.',
      ],
      possibleFix: {
        explanation:
          'Validate or default the value before using it, or correct the object or API shape that provides it. Optional chaining can express an expected empty state, but it should not hide required data.',
        whereItMayApply:
          'Apply this at the property access or call site; confirm which callers can legitimately provide null or undefined.',
        exampleCode: [
          'function readName(user) {',
          "  if (user == null) {",
          "    return 'Unknown'",
          '  }',
          '  return user.name',
          '}',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same interaction or command.',
        'Test both a populated value and the missing-value case.',
        'Check the API or caller that supplies the value, not only the failing line.',
      ],
      limitations: [
        'The exception does not reveal whether the value came from an API, state store, DOM lookup, or earlier logic.',
        'This engine cannot inspect runtime values or JavaScript source.',
      ],
      alternativeExplanations: [
        'Asynchronous data was used before it finished loading.',
        'An API or component returned a different object shape than expected.',
        'The wrong value or receiver was used for a method call.',
      ],
    }
  },
}

export const javascriptSyntaxErrorRule: DiagnosticRule = {
  id: 'javascript.syntax-error',
  language: 'javascript',
  category: 'syntax-error',
  match(line: string): RuleMatch | null {
    const matched = SYNTAX_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const detail = matched[1]
    if (PYTHON_SYNTAX_ERROR.test(detail)) {
      return null
    }

    return {
      signature: 'SyntaxError: <JavaScript parser error>',
      specificity: KNOWN_JAVASCRIPT_SYNTAX_ERROR.test(detail)
        ? 'specific'
        : 'generic',
      captures: { detail },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'The JavaScript engine could not parse the source, or a JSON parser could not parse a string. The message usually points to an unexpected token, a missing delimiter, or content that is not valid JavaScript or JSON.',
      debuggingSteps: [
        'Open the source file named in the stack or build output and inspect the reported token.',
        'Check nearby quotes, parentheses, brackets, commas, and template literals.',
        'If the source is fetched data, check whether the code is parsing JSON and whether the response is actually JSON.',
        'Make sure the browser or runtime is running the file being edited rather than a stale bundle.',
      ],
      possibleFix: {
        explanation:
          'Correct the reported source so it parses, or parse incoming data with the format it actually uses. Confirm that the file extension and loader match the syntax being used.',
        whereItMayApply:
          'Apply this to the reported source or JSON boundary; a parser error usually does not mean a dependency must be installed.',
        exampleCode: [
          '// Keep delimiters and object syntax balanced.',
          'const config = { retries: 3 }',
          'console.log(config.retries)',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same command or browser load.',
        'Check the parser error is gone and the file is served or executed successfully.',
        'If the error was in JSON, test the parsing boundary with a valid and an invalid payload.',
      ],
      limitations: [
        'The stack may point into bundled, minified, or generated output rather than the original source.',
        'This engine cannot parse project files or determine whether a server returned JSON or HTML.',
      ],
      alternativeExplanations: [
        'A JSON parser received HTML, an empty body, or another non-JSON response.',
        'The browser or Node.js runtime is loading an old or transpiled file.',
        'A template, generated file, or copy-paste introduced an incomplete delimiter or token.',
      ],
    }
  },
}

const CJS_CANNOT_FIND_MODULE =
  /^Error:\s+Cannot find module '([^']{1,300})'\s*$/
const ESM_MODULE_NOT_FOUND =
  /^Error \[ERR_MODULE_NOT_FOUND\]:\s+Cannot find (package|module) '([^']{1,300})' imported from (\S{1,300})\s*$/

const EADDRINUSE =
  /^Error:\s+listen EADDRINUSE:\s+address already in use\s+(\S{1,120})\s*$/

const ENOENT_FILE =
  /^Error:\s+ENOENT:\s+no such file or directory,\s+(open|stat|scandir|mkdir|readFile)\s+'([^']{1,300})'\s*$/
const ENOENT_SPAWN = /^Error:\s+spawn\s+(.+?)\s+ENOENT\s*$/

const EACCES_FILE =
  /^Error:\s+EACCES:\s+permission denied,\s+(open|mkdir|scandir)\s+'([^']{1,300})'\s*$/
const EACCES_LISTEN =
  /^Error:\s+listen EACCES:\s+permission denied\s+(\S{1,120})\s*$/
const EPERM_OPERATION =
  /^Error:\s+EPERM:\s+operation not permitted(?:\s*,\s*[a-zA-Z]+\s+'([^']{1,300})')?\s*$/

const CALL_STACK_EXCEEDED =
  /^RangeError:\s+Maximum call stack size exceeded\s*$/

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/

function isPathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('\\\\') ||
    specifier.startsWith('file://') ||
    WINDOWS_PATH.test(specifier)
  )
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function portFromAddress(address: string): string {
  const matched = /:(\d{1,5})$/.exec(address)
  return matched ? matched[1] : ''
}

export const javascriptNodeModuleNotFoundRule: DiagnosticRule = {
  id: 'javascript.node-module-not-found',
  language: 'javascript',
  category: 'missing-module',
  match(line: string): RuleMatch | null {
    const commonJs = CJS_CANNOT_FIND_MODULE.exec(line)
    if (commonJs) {
      const specifier = commonJs[1]
      if (isPathSpecifier(specifier)) {
        return {
          signature: "Error: Cannot find module '<path>'",
          specificity: 'specific',
          captures: { path: specifier, reason: 'cjs-path' },
        }
      }

      return {
        signature: "Error: Cannot find module '<package>'",
        specificity: 'specific',
        captures: { package: specifier, reason: 'cjs-package' },
      }
    }

    const esm = ESM_MODULE_NOT_FOUND.exec(line)
    if (!esm) {
      return null
    }

    const keyword = esm[1]
    const specifier = esm[2]

    if (keyword === 'package') {
      return {
        signature:
          "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<package>' imported from <path>",
        specificity: 'specific',
        captures: { package: specifier, reason: 'esm-package' },
      }
    }

    if (isPathSpecifier(specifier)) {
      return {
        signature:
          "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<path>' imported from <path>",
        specificity: 'specific',
        captures: {
          path: specifier,
          reason: isRelativeSpecifier(specifier)
            ? 'esm-relative-path'
            : 'esm-path',
        },
      }
    }

    return {
      signature:
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<package>' imported from <path>",
      specificity: 'specific',
      captures: { package: specifier, reason: 'esm-package' },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const reason = match.captures.reason
    const packageName = match.captures.package
    const path = match.captures.path

    if (reason === 'cjs-package' || reason === 'esm-package') {
      const name = packageName ?? 'the package'

      return {
        likelyCause: `Node.js could not resolve the package "${name}" from the file that asked for it. The package is likely not installed in this project, the name may be misspelled, or the command may be running from a different folder than the one that contains package.json.`,
        debuggingSteps: [
          'Confirm the exact package name and spelling used by the failing import; scoped names include the @scope/ prefix.',
          'Check that the failing command runs in the project folder that contains package.json and node_modules.',
          `Install "${name}" with the package manager this project already uses, and check that it is declared in package.json.`,
          'Rerun the same command after the install; if it still fails, check a monorepo or workspace that may resolve the package differently.',
        ],
        possibleFix: {
          explanation: `Install "${name}" in the project that produces this error, or correct the import if the package name is misspelled.`,
          whereItMayApply:
            'Apply this near the failing import only after confirming the package is expected and safe to add; avoid installing an unknown package just to silence the error.',
          exampleCode: [
            '# Run from the folder that contains package.json.',
            `npm install ${name}`,
            '# Then rerun the failing command.',
            'node index.js',
          ].join('\n'),
        },
        verificationSteps: [
          'Rerun the same command from the same project folder.',
          'Check that the module resolves and the original error is gone.',
          'Confirm package.json and the lockfile changed only for the dependency you intended to add.',
        ],
        limitations: [
          'The engine cannot inspect package.json, node_modules, workspaces, or the command that started the process.',
          'The message does not reveal whether the dependency is missing, misspelled, or hidden by a different resolution path.',
        ],
        alternativeExplanations: [
          'The package is installed in a different workspace, folder, or Node.js version than the one that failed.',
          'The import name or letter case does not match the installed package.',
          'A production-style install left out a dependency that is declared only for development.',
        ],
      }
    }

    if (reason === 'esm-relative-path') {
      return {
        likelyCause: `Node.js could not resolve "${path}" as an ES module import. ESM relative imports must include the real file extension, so a path like "./utils" is not enough, and the file may also be missing from the build output.`,
        debuggingSteps: [
          'Open the file named after "imported from" and find the failing import.',
          'Add the real file extension to the relative specifier, for example "./utils.js".',
          'Check that the target file exists next to the importing file and that the build emits it with the same name.',
          'Check the case of every folder and file name on case-sensitive systems.',
        ],
        possibleFix: {
          explanation:
            'Add the real file extension to the relative import, or point it at the built file that actually exists.',
          whereItMayApply:
            'Apply this to the reported import; ESM does not guess extensions the way CommonJS require sometimes does.',
          exampleCode: [
            '// ESM relative imports need the real filename and extension.',
            "import { helper } from './utils.js'",
          ].join('\n'),
        },
        verificationSteps: [
          'Rerun the same command.',
          'Check that the import resolves from the same file named in the error.',
          'Run the built output, not only the source files, if this error appeared in production.',
        ],
        limitations: [
          'The engine cannot inspect the project files, TypeScript configuration, bundler configuration, or build output.',
          'The message shows the resolved path attempt but not which import statement produced it.',
        ],
        alternativeExplanations: [
          'The file exists in source but the build did not emit it.',
          'The import path is misspelled or has the wrong letter case.',
          'A bundler or TypeScript setting rewrites extensions differently from what Node.js expects at runtime.',
        ],
      }
    }

    const target = path ?? 'the file'

    return {
      likelyCause: `Node.js could not resolve the file path "${target}". The path may be wrong, may use different letter case than the file on disk, or may point at build output that has not been generated.`,
      debuggingSteps: [
        'Open the file that contains the failing require or import and check the path exactly as written.',
        'Check whether the file exists at that location, including its letter case.',
        'If the file is generated, check that the build ran before this command and emitted the file.',
        'Prefer a path built from the module location, such as path.join(__dirname, ...), over one that assumes the process working directory.',
      ],
      possibleFix: {
        explanation:
          'Correct the path or generate the missing file, then point the import at the file that actually exists.',
        whereItMayApply:
          'Apply this at the failing require or import; do not add a fallback that hides a missing build step.',
        exampleCode: [
          "const path = require('node:path')",
          "const fs = require('node:fs')",
          "const target = path.resolve(__dirname, 'relative-path-from-the-error')",
          'console.log({ target, exists: fs.existsSync(target) })',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same command from the same working directory.',
        'Check that the target file exists in development and in the built output.',
        'Test the path on the same operating system that produced the error.',
      ],
      limitations: [
        'The engine cannot inspect the filesystem, build output, package exports, or bundler aliases.',
        'The message shows the attempted specifier but not the working directory.',
      ],
      alternativeExplanations: [
        'The file was never generated because the build step did not run.',
        'The path is relative to a different folder than expected.',
        'The filename or folder name has different letter case on a case-sensitive system.',
      ],
    }
  },
}

export const javascriptPortInUseRule: DiagnosticRule = {
  id: 'javascript.port-in-use',
  language: 'javascript',
  category: 'port-in-use',
  match(line: string): RuleMatch | null {
    const matched = EADDRINUSE.exec(line)
    if (!matched) {
      return null
    }

    const address = matched[1]
    const port = portFromAddress(address)

    return {
      signature: 'Error: listen EADDRINUSE: address already in use <address>',
      specificity: 'specific',
      captures: port === '' ? { address } : { address, port },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const address = match.captures.address
    const port = match.captures.port
    const findCommand =
      port === '' ? 'netstat -ano' : `netstat -ano | findstr :${port}`
    const lsofCommand = port === '' ? 'lsof -i' : `lsof -i :${port}`

    return {
      likelyCause: `The address "${address}" is already in use, so Node.js could not start listening on it. Another process, often a previous dev server that did not shut down, is probably holding the port.`,
      debuggingSteps: [
        'Stop the earlier server in the terminal where you started it, if that server is yours.',
        `To find the process holding the port on Windows, run ${findCommand} and then tasklist /FI "PID eq <pid>" with the PID that netstat reports.`,
        `On macOS or Linux, run ${lsofCommand} to see which process holds the port.`,
        'End only a process you recognise. Never end unknown system processes.',
        'Otherwise start this app on a different free port and update the clients or proxy that connect to it.',
      ],
      possibleFix: {
        explanation:
          'Stop the earlier process that holds the port, or configure this app to listen on a different free port.',
        whereItMayApply:
          'Apply this to your own server process or port configuration; do not stop processes you cannot identify.',
        exampleCode: [
          'const port = Number(process.env.PORT) || 3001',
          'server.listen(port, () => {',
          '  console.log(`listening on ${port}`)',
          '})',
        ].join('\n'),
      },
      verificationSteps: [
        'Restart the app and check that it logs that it is listening.',
        'Request the same URL or port again and check that the connection succeeds.',
        'Confirm the earlier server is stopped, or that clients use the new port.',
      ],
      limitations: [
        'The message shows the address but not which process holds it or when it started.',
        'The engine cannot inspect open ports, containers, proxies, or reserved port ranges on this machine.',
      ],
      alternativeExplanations: [
        'A previous dev server or nodemon process is still running in another terminal.',
        'Another application or container is using the same port.',
        'Windows has reserved the port in an excluded range even though no app is listening on it.',
      ],
    }
  },
}

export const javascriptNodeFileErrorRule: DiagnosticRule = {
  id: 'javascript.node-file-error',
  language: 'javascript',
  category: 'missing-file',
  match(line: string): RuleMatch | null {
    const file = ENOENT_FILE.exec(line)
    if (file) {
      return {
        signature:
          "Error: ENOENT: no such file or directory, <operation> '<path>'",
        specificity: 'specific',
        captures: { path: file[2], reason: 'file' },
      }
    }

    const spawn = ENOENT_SPAWN.exec(line)
    if (!spawn) {
      return null
    }

    return {
      signature: 'Error: spawn <command> ENOENT',
      specificity: 'specific',
      captures: { command: spawn[1], reason: 'spawn' },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    if (match.captures.reason === 'spawn') {
      const command = match.captures.command

      return {
        likelyCause: `Node.js could not start the executable "${command}" because it was not found. The command is probably not installed, or it is installed somewhere that is not on the PATH of this process.`,
        debuggingSteps: [
          `Run "${command}" directly in the same terminal that starts the app and check whether it is found.`,
          `Check that "${command}" is installed and that its folder appears in PATH for this user and for the process that runs the app.`,
          'On Windows, some command-line tools need their .cmd or .exe name, or the spawn option shell: true; check the exact name the tool installs.',
          'Restart the terminal or service after installing a tool so it receives the updated PATH.',
        ],
        possibleFix: {
          explanation: `Install "${command}" and make sure it is on the PATH for the environment that starts the app, or call the exact executable name and extension the platform uses.`,
          whereItMayApply:
            'Apply this at the spawn call or in the environment that starts the process; do not add a fallback that hides a missing dependency.',
          exampleCode: [
            "const { spawnSync } = require('node:child_process')",
            `const result = spawnSync('${command}', ['--version'], {`,
            '  stdio: \'inherit\',',
            '  shell: process.platform === \'win32\',',
            '})',
            'console.log(result.error ?? result.status)',
          ].join('\n'),
        },
        verificationSteps: [
          'Run the command directly in the same terminal and check that it starts.',
          'Rerun the app through the same command, service, or task runner that failed.',
          'Check that the process finds the command with the same PATH and user account.',
        ],
        limitations: [
          'The message does not show the PATH, the working directory, or which user started the process.',
          'The engine cannot inspect installed programs or environment variables.',
        ],
        alternativeExplanations: [
          'The command is installed for a different user, shell, or Node.js process than the one that failed.',
          'The command exists but the platform needs a different executable name or extension.',
          'The tool was removed or renamed after the app was configured.',
        ],
      }
    }

    const path = match.captures.path

    return {
      likelyCause: `Node.js could not find the file or folder at "${path}". A relative path is resolved from process.cwd(), not from the source file, so the working directory may differ from where the file exists.`,
      debuggingSteps: [
        'Check the path exactly as written in the failing call and whether the file exists there.',
        'Log process.cwd() and resolve the path against it to see what the process actually uses.',
        'Compare that with the folder of the source file; use __dirname or import.meta.url when the path should be relative to the module.',
        'Check the spelling and letter case of every folder and file, and check whether the file is generated earlier in the workflow.',
      ],
      possibleFix: {
        explanation:
          'Resolve the path from a known base directory, such as path.resolve(__dirname, ...), and check that the file exists before using it. If the file should be generated, create it before this step.',
        whereItMayApply:
          'Apply this before the file operation; avoid hard-coding a path that only exists on one machine.',
        exampleCode: [
          "const path = require('node:path')",
          "const fs = require('node:fs')",
          "const target = path.resolve(__dirname, 'config.json')",
          'console.log({ cwd: process.cwd(), target, exists: fs.existsSync(target) })',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun from the same working directory as the original command.',
        'Test the case where the file exists and the case where it is absent.',
        'Check that the chosen base directory behaves the same in local and deployed environments.',
      ],
      limitations: [
        'The engine cannot check the filesystem, the working directory, or deployment contents.',
        'ENOENT can also mean that a parent folder is missing, not only the final file.',
      ],
      alternativeExplanations: [
        'A relative path is resolved from a different working directory than expected.',
        'The filename or folder name is misspelled or has different case.',
        'The file exists locally but was not copied into the build or deployed artifact.',
      ],
    }
  },
}

export const javascriptPermissionErrorRule: DiagnosticRule = {
  id: 'javascript.permission-error',
  language: 'javascript',
  category: 'permission-denied',
  match(line: string): RuleMatch | null {
    const file = EACCES_FILE.exec(line)
    if (file) {
      return {
        signature: "Error: EACCES: permission denied, <operation> '<path>'",
        specificity: 'specific',
        captures: { path: file[2], reason: 'file' },
      }
    }

    const listen = EACCES_LISTEN.exec(line)
    if (listen) {
      const address = listen[1]
      const port = portFromAddress(address)

      return {
        signature: 'Error: listen EACCES: permission denied <address>',
        specificity: 'specific',
        captures:
          port === ''
            ? { address, reason: 'listen' }
            : { address, port, reason: 'listen' },
      }
    }

    const eperm = EPERM_OPERATION.exec(line)
    if (!eperm) {
      return null
    }

    const path = eperm[1]

    return {
      signature: 'Error: EPERM: operation not permitted',
      specificity: 'specific',
      captures: path
        ? { path, reason: 'eperm' }
        : { reason: 'eperm' },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    if (match.captures.reason === 'listen') {
      const address = match.captures.address

      return {
        likelyCause: `Node.js could not bind to "${address}" because the process lacks permission for that address. Ports below 1024 and some reserved ranges require elevated privileges or specific configuration.`,
        debuggingSteps: [
          'Check which port the server uses and whether it is below 1024 or in a range reserved by the operating system.',
          'Choose a port above 1024 that the process is allowed to use.',
          'If the service must answer on a privileged port, put a reverse proxy in front of it instead of running the whole app with elevated privileges.',
          'Check container or host port mapping if the app runs inside a container.',
        ],
        possibleFix: {
          explanation:
            'Listen on a port above 1024 that the process is allowed to use, or use a reverse proxy when a privileged port is required.',
          whereItMayApply:
            'Apply this to the server configuration or deployment; avoid granting broad privileges to the whole process.',
          exampleCode: [
            'const port = Number(process.env.PORT) || 3000',
            'server.listen(port, () => {',
            '  console.log(`listening on ${port}`)',
            '})',
          ].join('\n'),
        },
        verificationSteps: [
          'Restart the app and check that it binds to the new port.',
          'Request the service through the port or proxy and check that it responds.',
          'Check that no service account or container permission changed more than necessary.',
        ],
        limitations: [
          'The message does not show the user, capabilities, or container configuration of the process.',
          'The engine cannot inspect open ports, reserved ranges, or proxy configuration.',
        ],
        alternativeExplanations: [
          'The app is trying to bind a privileged port below 1024.',
          'The operating system or container runtime reserved the port.',
          'A firewall or security policy blocks binding to that address.',
        ],
      }
    }

    if (match.captures.reason === 'eperm') {
      const path = match.captures.path
      const target = path ? ` "${path}"` : ''

      return {
        likelyCause: `The operating system refused the operation${target} with EPERM. On Windows this commonly means the file is locked by another program, marked read-only, or protected by antivirus or a sync tool.`,
        debuggingSteps: [
          'Close the program that may be holding the file, then retry the operation.',
          'Check whether the file or folder is marked read-only.',
          'Check antivirus, backup, or file-sync tools that may hold the file briefly.',
          'Retry once the lock is released; avoid running the whole app with elevated privileges as a workaround.',
        ],
        possibleFix: {
          explanation:
            'Release the lock or use a path the process can write, then retry. If the file must be replaced, close the program that holds it first.',
          whereItMayApply:
            'Apply this to the file operation and the program that holds the file; do not loosen permissions for the whole system.',
          exampleCode: [
            "const fs = require('node:fs')",
            'fs.accessSync(process.cwd(), fs.constants.W_OK)',
            "console.log('working directory is writable')",
          ].join('\n'),
        },
        verificationSteps: [
          'Retry the same operation under the same account.',
          'Check that the other program released the file.',
          'Confirm the fix did not require broader permissions than the operation needs.',
        ],
        limitations: [
          'EPERM is a broad code and the message may not identify the program that holds the file.',
          'The engine cannot inspect file locks, antivirus software, or account permissions.',
        ],
        alternativeExplanations: [
          'Another program currently holds the file open.',
          'The file or folder is read-only or protected by the operating system.',
          'Antivirus or a sync client temporarily locked the file.',
        ],
      }
    }

    const path = match.captures.path

    return {
      likelyCause: `The process was denied access to "${path}". The account running Node.js may lack permission, the file may be read-only or locked by another program, or a sync or antivirus tool may hold it.`,
      debuggingSteps: [
        'Identify the path and whether the operation is a read, write, or directory listing.',
        'Check the account and permissions of the process that runs the code, not only the account in your terminal.',
        'Check whether the file is open in another program or on a read-only volume.',
        'Prefer granting the minimum permission needed, or choose an output directory the process already owns.',
      ],
      possibleFix: {
        explanation:
          'Write to a path the process already owns, or grant the minimum required permission to the existing path. Avoid running the whole app with elevated privileges as a workaround.',
        whereItMayApply:
          'Apply this at the file operation and deployment configuration; permissions should be granted to the specific account and path involved.',
        exampleCode: [
          "const fs = require('node:fs')",
          "const path = require('node:path')",
          "const target = path.join(process.cwd(), 'output', 'report.json')",
          'fs.mkdirSync(path.dirname(target), { recursive: true })',
          "fs.writeFileSync(target, '{}')",
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the operation under the same account and environment that failed.',
        'Check both the file and its parent directory permissions.',
        'Confirm the process can still read its required inputs with the minimum change.',
      ],
      limitations: [
        'The message does not explain which permission or parent directory caused the denial.',
        'The engine cannot inspect operating-system users, access rules, mounts, or file locks.',
      ],
      alternativeExplanations: [
        'The file or directory is owned by another user or requires elevated access.',
        'The file is read-only, open elsewhere, or on a read-only filesystem.',
        'The process is writing to a path that does not exist or is not writable by its service account.',
      ],
    }
  },
}

export const javascriptCallStackExceededRule: DiagnosticRule = {
  id: 'javascript.call-stack-exceeded',
  language: 'javascript',
  category: 'recursion-error',
  match(line: string): RuleMatch | null {
    if (!CALL_STACK_EXCEEDED.test(line)) {
      return null
    }

    return {
      signature: 'RangeError: Maximum call stack size exceeded',
      specificity: 'specific',
      captures: {},
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'JavaScript exceeded the maximum call stack size. A recursive function is probably missing a reachable base case, or a getter, setter, serializer, or deep-clone helper is calling itself indirectly.',
      debuggingSteps: [
        'Find the repeating frames in the stack and identify the function that calls itself.',
        'Log or print the argument that should reach the base case at each call to see whether it approaches the stop condition.',
        'Look for a getter or setter that reads or writes its own property, and for circular references passed to JSON.stringify or a deep clone or merge.',
        'Convert the recursion to an explicit loop or queue when the depth is legitimately large.',
      ],
      possibleFix: {
        explanation:
          'Make the base case reachable for every input, break the circular reference, or replace the recursion with an explicit stack or loop. Raising the stack limit is not a fix.',
        whereItMayApply:
          'Apply this to the recursive function, serializer, or accessor; do not treat a raised runtime limit as a fix for a missing base case.',
        exampleCode: [
          'function depth(node) {',
          '  let count = 0',
          '  for (let current = node; current != null; current = current.next) {',
          '    count += 1',
          '  }',
          '  return count',
          '}',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same input or interaction that triggered the RangeError.',
        'Check that the function or serializer terminates and returns the expected result.',
        'Test the smallest input, the boundary input, and any input that contains a cycle.',
      ],
      limitations: [
        'Raising the stack size is not a fix for a missing base case or a circular reference; it can trade the error for a crash.',
        'The message does not name the function that recursed or show the call depth.',
        'The engine cannot inspect the call stack, source, or runtime objects.',
      ],
      alternativeExplanations: [
        'The base case is unreachable because the argument does not change as expected.',
        'Two or more functions call each other without a shared stopping condition.',
        'JSON.stringify, a deep clone, or a deep merge received a circular object.',
        'A getter or setter triggers itself through another property access.',
      ],
    }
  },
}

export const javascriptRules: readonly DiagnosticRule[] = [
  javascriptReferenceErrorRule,
  javascriptTypeErrorRule,
  javascriptSyntaxErrorRule,
  javascriptNodeModuleNotFoundRule,
  javascriptPortInUseRule,
  javascriptNodeFileErrorRule,
  javascriptPermissionErrorRule,
  javascriptCallStackExceededRule,
]
