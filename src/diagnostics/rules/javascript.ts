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

export const javascriptRules: readonly DiagnosticRule[] = [
  javascriptReferenceErrorRule,
  javascriptTypeErrorRule,
  javascriptSyntaxErrorRule,
]
