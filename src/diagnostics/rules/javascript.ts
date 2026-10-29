import type {
  DiagnosticRule,
  RuleContext,
  RuleMatch,
  RuleNarrative,
} from '../types'

const REFERENCE_ERROR = /^ReferenceError:\s+(.+)$/
const NOT_DEFINED =
  /^ReferenceError:\s+([A-Za-z_$][\w$]*) is not defined/
const BEFORE_INITIALIZATION =
  /^ReferenceError:\s+Cannot access '([A-Za-z_$][\w$]*)' before initialization/

const TYPE_ERROR = /^TypeError:\s+(.+)$/
const PYTHON_TYPE_ERROR =
  /(?:unsupported operand type|can only concatenate|object is not (?:subscriptable|callable|iterable)|required positional argument|takes \d+ positional arguments?|object of type .+ has no len|not supported between instances of|NoneType)/i
const READ_PROPERTY_MODERN =
  /^Cannot read properties of (undefined|null) \(reading '([^']+)'\)$/
const READ_PROPERTY_LEGACY =
  /^Cannot read property '([^']+)' of (undefined|null)$/
const WRITE_PROPERTY_MODERN =
  /^Cannot set properties of (undefined|null) \(setting '([^']+)'\)$/
const WRITE_PROPERTY = /^Cannot set propert(?:y|ies) .+ of (?:undefined|null)/
const NOT_A_FUNCTION = /^(.+) is not a function$/
const NOT_ITERABLE =
  /^(.+) is not iterable(?: \(cannot read property Symbol\(Symbol\.iterator\)\))?$/
const ASSIGNMENT_TO_CONSTANT = /^Assignment to constant variable\.?$/
const NOT_A_CONSTRUCTOR = /^(.+) is not a constructor$/
const FIREFOX_PROPERTY_ACCESS =
  /^can't access property ["']([^"']+)["'], (.+) is (undefined|null)$/
const OTHER_JAVASCRIPT_TYPE_ERROR =
  /(?:Cannot convert undefined or null|Cannot destructure|reading ')/i

const SYNTAX_ERROR = /^SyntaxError:\s+(.+)$/
const PYTHON_SYNTAX_ERROR =
  /(?:invalid syntax|unexpected indent|was never closed|unmatched\s+'\)'|unterminated string literal|expected\s+':'|EOL while scanning string literal|missing parentheses in call|invalid decimal literal)/i
const KNOWN_JAVASCRIPT_SYNTAX_ERROR =
  /(?:Unexpected token|Unexpected end of JSON input|Invalid or unexpected token|missing \S+ after argument list|Cannot use import statement outside a module|Unexpected identifier|Invalid left-hand side in assignment|Unexpected end of input|Unexpected number)/i

const JSON_V8_OLD_TOKEN =
  /^SyntaxError: Unexpected token (\S{1,40}) in JSON at position (\d+)$/
const JSON_V8_NOT_VALID =
  /^SyntaxError: Unexpected token '([^']{1,40})', .+ is not valid JSON$/
const JSON_UNDEFINED_STRING = /^SyntaxError: "undefined" is not valid JSON$/
const JSON_V8_EMPTY = /^SyntaxError: Unexpected end of JSON input$/
const JSON_FIREFOX =
  /^SyntaxError: JSON\.parse: (unexpected character|unexpected end of data)(?: at line .+)?$/
const JSON_SAFARI =
  /^SyntaxError: JSON Parse error: (?:Unrecognized token '([^']{1,40})'|Unexpected EOF)$/

const NETWORK_CONSOLE_LINE =
  /^(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) https?:\/\/\S+ )?net::ERR_([A-Z0-9_]+)$/
const NETWORK_NODE_CAUSE =
  /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET)\b/

const CORS_MESSAGE =
  /^Access to (fetch|XMLHttpRequest) at '([^']{1,500})' from origin '([^']{1,500})' has been blocked by CORS policy: (.+)$/

const REACT_PREFIX = '^(?:Uncaught\\s+)?(?:Error:\\s+)?'
const REACT_INVALID_HOOK = new RegExp(
  `${REACT_PREFIX}Invalid hook call\\. Hooks can only be called inside of the body of a function component\\.`,
)
const REACT_TOO_MANY_RERENDERS = new RegExp(
  `${REACT_PREFIX}Too many re-renders\\. React limits the number of renders to prevent an infinite loop\\.`,
)
const REACT_UPDATE_DEPTH = new RegExp(
  `${REACT_PREFIX}Maximum update depth exceeded\\.`,
)
const REACT_OBJECT_CHILD = new RegExp(
  `${REACT_PREFIX}Objects are not valid as a React child \\(found: (.+?)\\)\\.?(?: If you meant to render a collection of children, use an array instead\\.)?$`,
)
const REACT_INVALID_HOOK_WARNING =
  /^Warning: Invalid hook call\. Hooks can only be called inside of the body of a function component\./

const FETCH_FAILURE_SYMPTOMS = [
  /^TypeError: Failed to fetch$/,
  /^(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) https?:\/\/\S+ )?net::ERR_FAILED$/,
] as const

const REACT_HOOK_SYMPTOM =
  /^TypeError: Cannot read propert(?:y|ies) of null \(reading 'use[A-Z][A-Za-z]*'\)$/

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

function propertyExample(property: string): string {
  return `object[${JSON.stringify(property)}]`
}

function readPropertyNarrative(
  legacy: boolean,
  property: string,
): RuleNarrative {
  return {
    likelyCause: legacy
      ? 'The older "Cannot read property ... of undefined" wording means JavaScript read a property from a value that was undefined or null. Older engines and older bundled code still emit this form.'
      : 'JavaScript tried to read a property from a value that was undefined or null, so the property access could not be evaluated. The object expected at that point was probably never assigned, has not loaded yet, or was replaced by an empty value.',
    debuggingSteps: [
      'Identify the property in the message and the stack line that belongs to your source.',
      'Log or inspect the object immediately before the property access to confirm it is undefined or null.',
      'Trace where the object should have been created, fetched, or passed in.',
      legacy
        ? 'Check older build output or transpiled bundles for the same access if the source line looks correct.'
        : 'Check whether asynchronous data is used before it has loaded.',
    ],
    possibleFix: {
      explanation:
        'Check that the object is not undefined or null before reading the property, and fix the code or data source that should have provided it. Optional chaining can express an expected empty state, but it should not hide required data.',
      whereItMayApply:
        'Apply this at the property access that threw; confirm which callers can legitimately provide undefined or null.',
      exampleCode: [
        'function readValue(object) {',
        '  if (object == null) {',
        '    return undefined',
        '  }',
        `  return ${propertyExample(property)}`,
        '}',
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the same interaction or command.',
      'Test both a populated object and the missing-object path.',
      'Check the caller that supplies the object, not only the failing line.',
    ],
    limitations: [
      'The message does not show where the object came from or why it was empty.',
      'This engine cannot inspect runtime values or JavaScript source.',
    ],
    alternativeExplanations: [
      'Asynchronous data was used before it finished loading.',
      'An API or state store returned a different shape than expected.',
      'The property belongs to a different object or was misspelled.',
    ],
  }
}

function writePropertyNarrative(property: string): RuleNarrative {
  return {
    likelyCause:
      'JavaScript tried to assign a property on a value that was undefined or null. The target object was never created, or it was replaced by an empty value before the assignment.',
    debuggingSteps: [
      'Read the property name and the assignment line from the message and stack.',
      'Check where the target object is created and whether that code runs before the assignment.',
      'Look for refs, module state, or form values that are still null when the assignment happens.',
      'Confirm the value is not reset to null or undefined between creation and assignment.',
    ],
    possibleFix: {
      explanation:
        'Initialise the object before assigning properties to it, or guard the assignment when the target can be missing. Optional chaining cannot be used on the left side of an assignment, so create the container instead.',
      whereItMayApply:
        'Apply this where the object should be created, before the failing assignment; check every caller that can pass null or undefined.',
      exampleCode: [
        'let state = {}',
        'if (payload != null) {',
        '  state = payload',
        '}',
        `state[${JSON.stringify(property)}] = true`,
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the same interaction or command.',
      'Test both a populated target and the missing-target path.',
      'Check the code that creates the target, not only the failing assignment.',
    ],
    limitations: [
      'The message does not show whether the target was never created or was cleared later.',
      'This engine cannot inspect runtime values or JavaScript source.',
    ],
    alternativeExplanations: [
      'A ref or DOM lookup returned null because the element was not mounted yet.',
      'Asynchronous code assigned the property before the object was created.',
      'The receiver is a different object than the one that was initialised.',
    ],
  }
}

function notAFunctionNarrative(value: string): RuleNarrative {
  return {
    likelyCause: `The value "${value}" was called as a function, but it is not callable at that point. It may be undefined, a different type, or a property that was never defined on the receiver.`,
    debuggingSteps: [
      'Identify the expression that was called from the message and the stack line.',
      'Log the value and its type immediately before the call.',
      'Check the import: a default import in place of a named export, or the reverse, often produces this error.',
      'Check that the method exists on the receiver and that the receiver is the object you expect.',
    ],
    possibleFix: {
      explanation:
        'Check that the value is callable before calling it, and fix the import, property name, or assignment that should provide a function. A typeof check makes the expectation explicit.',
      whereItMayApply:
        'Apply this at the call site or at the module import that supplies the value.',
      exampleCode: [
        'function callIfFunction(fn, input) {',
        "  if (typeof fn !== 'function') {",
        "    throw new TypeError('Expected a function')",
        '  }',
        '  return fn(input)',
        '}',
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the same interaction or command.',
      'Test both the working path and the missing-function path.',
      'Confirm the import or property resolves to a function before the call.',
    ],
    limitations: [
      'The message does not show what the value was, only that it could not be called.',
      'This engine cannot inspect module exports or runtime values.',
    ],
    alternativeExplanations: [
      'A named export was imported as a default export, or the reverse.',
      'The method was renamed or removed in a dependency update.',
      'The receiver is undefined, so the method lookup happened on the wrong object.',
    ],
  }
}

function notIterableNarrative(): RuleNarrative {
  return {
    likelyCause:
      'A value was used where JavaScript expects an iterable, such as spread, destructuring, Array.from, or a for...of loop, but the value is not iterable.',
    debuggingSteps: [
      'Find the spread, destructuring, Array.from call, or for...of loop named in the stack.',
      'Log the value and its type just before it is iterated.',
      'Check whether the API returns an object, null, or a single value where an array was expected.',
      'Confirm the value is not reset to null after loading.',
    ],
    possibleFix: {
      explanation:
        'Guard or convert the value so it is iterable before iterating it, for example with Array.isArray, Object.values, or a default empty array. Make the conversion match what the following code expects.',
      whereItMayApply:
        'Apply this where the value enters the iteration, and check the function or API that should return a collection.',
      exampleCode: [
        'const list = Array.isArray(value) ? value : []',
        'for (const item of list) {',
        '  console.log(item)',
        '}',
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the same interaction or command.',
      'Test both a real collection and the empty or invalid value.',
      'Check the API or caller that supplies the collection.',
    ],
    limitations: [
      'The message does not show which operation tried to iterate the value.',
      'This engine cannot inspect runtime values or JavaScript source.',
    ],
    alternativeExplanations: [
      'The API returned an object instead of the array the code expects.',
      'Asynchronous data was iterated before it loaded.',
      'A custom object is missing the iterator protocol method.',
    ],
  }
}

function constantAssignmentNarrative(): RuleNarrative {
  return {
    likelyCause:
      'The code assigned a new value to a binding declared with const. A const binding can be initialised once and cannot be reassigned.',
    debuggingSteps: [
      'Find the assignment the message points to and confirm the binding was declared with const.',
      'Decide whether the binding needs a new value or only a mutated object.',
      'Change const to let only when reassignment is intended; otherwise compute the value once.',
      'Recheck loop counters and accumulator variables, which are common cases.',
    ],
    possibleFix: {
      explanation:
        'Declare the binding with let when it must change, or restructure the code so the value is computed once. Mutating an object is fine; reassigning the binding is not.',
      whereItMayApply:
        'Apply this at the declaration or at the assignment, whichever expresses the intent more clearly.',
      exampleCode: ['let total = 0', 'total = total + 1', 'console.log(total)'].join(
        '\n',
      ),
    },
    verificationSteps: [
      'Rerun the same interaction or command.',
      'Check that the value changes where it should and stays fixed elsewhere.',
      'Check every branch that assigns the binding.',
    ],
    limitations: [
      'The message does not reveal whether a new value or a mutation was intended.',
      'This engine cannot inspect the surrounding module or closure.',
    ],
    alternativeExplanations: [
      'The declaration keyword was copied from a value that never changes.',
      'A loop counter or accumulator was declared with const by mistake.',
      'The code mutates an imported binding, which is also read-only.',
    ],
  }
}

function notAConstructorNarrative(value: string): RuleNarrative {
  return {
    likelyCause: `The code called new on "${value}", but that value is not a constructor. The reference is probably undefined, a plain function, or a different export than expected.`,
    debuggingSteps: [
      'Identify the value after new in the message and the construction line in the stack.',
      'Log the value and its type before the new expression.',
      'Check default versus named exports for the class or constructor function.',
      'Look for circular imports that leave the value undefined at construction time.',
    ],
    possibleFix: {
      explanation:
        'Check what the reference resolves to and use the actual class or constructor function. With default and named exports, confirm the shape of the module before constructing the value.',
      whereItMayApply:
        'Apply this at the construction site or at the import that supplies the constructor.',
      exampleCode: ['class Cart {}', 'const cart = new Cart()'].join('\n'),
    },
    verificationSteps: [
      'Rerun the same interaction or command.',
      'Check that the constructed value has the expected methods.',
      'Check the import shape in the module that defines the class.',
    ],
    limitations: [
      'The message does not show what the value was, only that it cannot be constructed.',
      'This engine cannot inspect module exports or runtime values.',
    ],
    alternativeExplanations: [
      'A named export was imported as a default export, or the reverse.',
      'The dependency changed its export shape in an update.',
      'A circular import left the class undefined at construction time.',
    ],
  }
}

function firefoxPropertyNarrative(property: string): RuleNarrative {
  return {
    likelyCause:
      'Firefox reports this wording when a property is read from undefined or null. The receiver named in the message was empty before the property access.',
    debuggingSteps: [
      'Identify the receiver and property named in the message.',
      'Log the receiver immediately before the property access.',
      'Trace where the receiver should have been created or passed in.',
      'Check whether the code runs before the receiver is mounted or loaded.',
    ],
    possibleFix: {
      explanation:
        'Firefox uses this wording for the same property-read failure; check that the receiver is not undefined or null before reading the property, and fix the code that should provide the object.',
      whereItMayApply:
        'Apply this at the property access that threw; confirm which callers can legitimately provide undefined or null.',
      exampleCode: [
        'function readValue(object) {',
        '  if (object == null) {',
        '    return undefined',
        '  }',
        `  return ${propertyExample(property)}`,
        '}',
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the same interaction or command in Firefox.',
      'Test both a populated object and the missing-object path.',
      'Check the caller that supplies the object, not only the failing line.',
    ],
    limitations: [
      'The wording is Firefox-specific; other browsers report the same cause differently.',
      'This engine cannot inspect runtime values or JavaScript source.',
    ],
    alternativeExplanations: [
      'Asynchronous data was used before it finished loading.',
      'The receiver is a different object than the one that was initialised.',
      'The property belongs to a different object or was misspelled.',
    ],
  }
}

function genericTypeErrorNarrative(): RuleNarrative {
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

    const modernRead = READ_PROPERTY_MODERN.exec(detail)
    if (modernRead) {
      return {
        signature: `TypeError: Cannot read properties of ${modernRead[1]} (reading '${modernRead[2]}')`,
        specificity: 'specific',
        captures: {
          detail,
          shape: 'read-modern',
          target: modernRead[1],
          property: modernRead[2],
        },
      }
    }

    const legacyRead = READ_PROPERTY_LEGACY.exec(detail)
    if (legacyRead) {
      return {
        signature: `TypeError: Cannot read property '${legacyRead[1]}' of ${legacyRead[2]}`,
        specificity: 'specific',
        captures: {
          detail,
          shape: 'read-legacy',
          target: legacyRead[2],
          property: legacyRead[1],
        },
      }
    }

    const modernWrite = WRITE_PROPERTY_MODERN.exec(detail)
    if (modernWrite) {
      return {
        signature: `TypeError: Cannot set properties of ${modernWrite[1]} (setting '${modernWrite[2]}')`,
        specificity: 'specific',
        captures: {
          detail,
          shape: 'write',
          target: modernWrite[1],
          property: modernWrite[2],
        },
      }
    }

    if (WRITE_PROPERTY.test(detail)) {
      return {
        signature: 'TypeError: Cannot set properties of undefined or null',
        specificity: 'specific',
        captures: { detail },
      }
    }

    const notAFunction = NOT_A_FUNCTION.exec(detail)
    if (notAFunction) {
      return {
        signature: `TypeError: ${notAFunction[1]} is not a function`,
        specificity: 'specific',
        captures: {
          detail,
          shape: 'not-a-function',
          value: notAFunction[1],
        },
      }
    }

    const notIterable = NOT_ITERABLE.exec(detail)
    if (notIterable) {
      return {
        signature: `TypeError: ${notIterable[1]} is not iterable`,
        specificity: 'specific',
        captures: {
          detail,
          shape: 'not-iterable',
          value: notIterable[1],
        },
      }
    }

    if (ASSIGNMENT_TO_CONSTANT.test(detail)) {
      return {
        signature: 'TypeError: Assignment to constant variable.',
        specificity: 'specific',
        captures: { detail, shape: 'constant' },
      }
    }

    const notAConstructor = NOT_A_CONSTRUCTOR.exec(detail)
    if (notAConstructor) {
      return {
        signature: `TypeError: ${notAConstructor[1]} is not a constructor`,
        specificity: 'specific',
        captures: {
          detail,
          shape: 'not-a-constructor',
          value: notAConstructor[1],
        },
      }
    }

    const firefox = FIREFOX_PROPERTY_ACCESS.exec(detail)
    if (firefox) {
      return {
        signature: `TypeError: can't access property "${firefox[1]}", ${firefox[2]} is ${firefox[3]}`,
        specificity: 'specific',
        captures: {
          detail,
          shape: 'firefox-property',
          receiver: firefox[2],
          property: firefox[1],
          target: firefox[3],
        },
      }
    }

    if (OTHER_JAVASCRIPT_TYPE_ERROR.test(detail)) {
      return {
        signature: 'TypeError: <JavaScript value type problem>',
        specificity: 'specific',
        captures: { detail },
      }
    }

    return {
      signature: 'TypeError: <JavaScript type mismatch>',
      specificity: 'generic',
      captures: { detail },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    switch (match.captures.shape) {
      case 'read-modern':
        return readPropertyNarrative(false, match.captures.property ?? '')
      case 'read-legacy':
        return readPropertyNarrative(true, match.captures.property ?? '')
      case 'write':
        return writePropertyNarrative(match.captures.property ?? '')
      case 'not-a-function':
        return notAFunctionNarrative(match.captures.value ?? '')
      case 'not-iterable':
        return notIterableNarrative()
      case 'constant':
        return constantAssignmentNarrative()
      case 'not-a-constructor':
        return notAConstructorNarrative(match.captures.value ?? '')
      case 'firefox-property':
        return firefoxPropertyNarrative(match.captures.property ?? '')
      default:
        return genericTypeErrorNarrative()
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

export const javascriptJsonParseErrorRule: DiagnosticRule = {
  id: 'javascript.json-parse-error',
  language: 'javascript',
  category: 'json-decode-error',
  supersedes: ['javascript.syntax-error'],
  match(line: string): RuleMatch | null {
    // error.message keeps the parser wording but drops the error class prefix.
    if (!line.startsWith('SyntaxError: ')) {
      const match = javascriptJsonParseErrorRule.match(`SyntaxError: ${line}`)
      return match ? { ...match, confidenceCeiling: 'medium' } : null
    }

    const oldToken = JSON_V8_OLD_TOKEN.exec(line)
    if (oldToken) {
      if (oldToken[1] === '<') {
        return {
          signature:
            "SyntaxError: Unexpected token '<' in JSON at position <position>",
          specificity: 'specific',
          captures: { reason: 'html' },
        }
      }

      if (oldToken[1] === 'u' && oldToken[2] === '0') {
        return {
          signature: 'SyntaxError: Unexpected token u in JSON at position 0',
          specificity: 'specific',
          captures: { reason: 'undefined' },
        }
      }

      return {
        signature: 'SyntaxError: <invalid JSON payload>',
        specificity: 'specific',
        captures: { reason: 'invalid' },
      }
    }

    const notValid = JSON_V8_NOT_VALID.exec(line)
    if (notValid) {
      if (notValid[1] === '<') {
        return {
          signature: "SyntaxError: Unexpected token '<', ... is not valid JSON",
          specificity: 'specific',
          captures: { reason: 'html' },
        }
      }

      return {
        signature: 'SyntaxError: <invalid JSON payload>',
        specificity: 'specific',
        captures: { reason: 'invalid' },
      }
    }

    if (JSON_UNDEFINED_STRING.test(line)) {
      return {
        signature: 'SyntaxError: "undefined" is not valid JSON',
        specificity: 'specific',
        captures: { reason: 'undefined' },
      }
    }

    if (JSON_V8_EMPTY.test(line)) {
      return {
        signature: 'SyntaxError: Unexpected end of JSON input',
        specificity: 'specific',
        captures: { reason: 'empty' },
      }
    }

    const firefox = JSON_FIREFOX.exec(line)
    if (firefox) {
      return firefox[1] === 'unexpected end of data'
        ? {
            signature: 'SyntaxError: JSON.parse: unexpected end of data',
            specificity: 'specific',
            captures: { reason: 'empty' },
          }
        : {
            signature: 'SyntaxError: JSON.parse: unexpected character',
            specificity: 'specific',
            captures: { reason: 'invalid' },
          }
    }

    const safari = JSON_SAFARI.exec(line)
    if (safari) {
      if (safari[1] === '<') {
        return {
          signature: "SyntaxError: JSON Parse error: Unrecognized token '<'",
          specificity: 'specific',
          captures: { reason: 'html' },
        }
      }

      return safari[1] === undefined
        ? {
            signature: 'SyntaxError: JSON Parse error: Unexpected EOF',
            specificity: 'specific',
            captures: { reason: 'empty' },
          }
        : {
            signature: 'SyntaxError: <invalid JSON payload>',
            specificity: 'specific',
            captures: { reason: 'invalid' },
          }
    }

    return null
  },
  explain(match: RuleMatch): RuleNarrative {
    const reason = match.captures.reason
    const commonSteps = [
      'Log the response status, the content-type, and the first part of the raw response text before calling JSON.parse or response.json().',
      'Check the request URL and method, and confirm the request reaches the API rather than a redirect, a login page, or the development server.',
      'Inspect the same request in the Network tab and compare the response body with what the code expects.',
    ]
    const commonFix = {
      explanation:
        'Inspect the response before parsing it: print the status, the content-type, and the raw text, then parse only after confirming the body is JSON. Check that the URL and method reach the API, handle an empty response explicitly, and make sure a missing await does not pass a pending value.',
      whereItMayApply:
        'Apply this at the fetch or HTTP client call that produced the parsed value, before the JSON.parse call; the fix belongs to the request and response handling, not to the parser call itself.',
    }
    const commonVerification = [
      'Rerun the same request after the change.',
      'Check that the log shows the real response status and body, and that the body starts with JSON.',
      'Confirm the parsed value has the expected shape before using its fields.',
    ]
    const commonLimitations = [
      'The engine only sees the pasted message; it cannot inspect the network response, the URL, or the server.',
      'The parser message shows where parsing failed but not why the body had that content.',
    ]

    if (reason === 'html') {
      return {
        likelyCause:
          "The JSON parser received HTML instead of JSON. The request probably reached an HTML page such as the development server's index.html, a proxy or gateway error page, or a login page, so the API URL, a redirect, or the server routing is likely wrong.",
        debuggingSteps: [
          ...commonSteps,
          'Open the response body and check whether it starts with "<!DOCTYPE" or "<html"; if it does, fix the URL or the server route so the API returns JSON.',
        ],
        possibleFix: {
          ...commonFix,
          exampleCode: [
            "const response = await fetch('/api/data')",
            "console.log(response.status, response.headers.get('content-type'))",
            'const raw = await response.text()',
            'console.log(raw.slice(0, 200))',
            'const data = JSON.parse(raw)',
          ].join('\n'),
        },
        verificationSteps: commonVerification,
        limitations: commonLimitations,
        alternativeExplanations: [
          'The API URL points at the front-end development server, which answers with index.html.',
          'A proxy, gateway, or authentication redirect returned an HTML page.',
          'The server returned an HTML error page with a 200 status code.',
        ],
      }
    }

    if (reason === 'empty') {
      return {
        likelyCause:
          'The response body was empty or truncated, so the parser reached the end of the input before a complete JSON value was read. A failed request, an empty 204 response, or reading the body twice can produce this.',
        debuggingSteps: [
          ...commonSteps,
          'Check the response status and body: an empty body or a partial payload cannot be parsed as JSON.',
        ],
        possibleFix: {
          ...commonFix,
          exampleCode: [
            'const raw = await response.text()',
            "if (raw.trim() === '') {",
            "  throw new Error('The response body was empty; check the endpoint and status ' + response.status)",
            '}',
            'const data = JSON.parse(raw)',
          ].join('\n'),
        },
        verificationSteps: commonVerification,
        limitations: commonLimitations,
        alternativeExplanations: [
          'The endpoint returned an empty body or a 204 No Content response.',
          'The connection closed before the full payload arrived.',
          'The body was already consumed, for example by reading response.json() and response.text() on the same response.',
        ],
      }
    }

    if (reason === 'undefined') {
      return {
        likelyCause:
          'The value passed to the JSON parser was undefined, often because the code parsed a missing return value, a variable that was never assigned, or the string "undefined" returned by a broken endpoint.',
        debuggingSteps: [
          ...commonSteps,
          'Trace the value passed to the parser and check that the function that produces it actually returns the response text.',
        ],
        possibleFix: {
          ...commonFix,
          exampleCode: [
            '// A missing await or return can leave the value undefined.',
            "const response = await fetch('/api/data')",
            'const raw = await response.text()',
            'const data = JSON.parse(raw)',
          ].join('\n'),
        },
        verificationSteps: commonVerification,
        limitations: commonLimitations,
        alternativeExplanations: [
          'A function forgot to return the fetched value, so the caller parsed undefined.',
          'The response body was the text "undefined" because a template or serializer received an undefined value.',
          'An await was missing, so a Promise was parsed instead of its result.',
        ],
      }
    }

    return {
      likelyCause:
        'The response text is not valid JSON: it contains an unexpected token where JSON expected a value. The body may be plain text, a partial payload, or JSON with a trailing comma or quote problem.',
      debuggingSteps: [
        ...commonSteps,
        'Look at the character or token named in the message and compare it with the raw body around that position.',
      ],
      possibleFix: {
        ...commonFix,
        exampleCode: [
          "const response = await fetch('/api/data')",
          "console.log(response.status, response.headers.get('content-type'))",
          'const raw = await response.text()',
          'console.log(raw.slice(0, 200))',
          'const data = JSON.parse(raw)',
        ].join('\n'),
      },
      verificationSteps: commonVerification,
      limitations: commonLimitations,
      alternativeExplanations: [
        'The body is plain text or an error message rather than JSON.',
        'The JSON is truncated or has a trailing comma or single quotes.',
        'The content-type says JSON but the server sent a different format.',
      ],
    }
  },
}

export const javascriptNetworkRequestFailedRule: DiagnosticRule = {
  id: 'javascript.network-request-failed',
  language: 'javascript',
  category: 'network-request-failed',
  supersedes: ['javascript.type-error'],
  match(line: string): RuleMatch | null {
    if (line === 'TypeError: Failed to fetch') {
      return {
        signature: 'TypeError: Failed to fetch',
        specificity: 'specific',
        captures: { reason: 'browser' },
      }
    }

    if (line === 'TypeError: NetworkError when attempting to fetch resource.') {
      return {
        signature: 'TypeError: NetworkError when attempting to fetch resource.',
        specificity: 'specific',
        captures: { reason: 'browser' },
      }
    }

    if (line === 'TypeError: Load failed') {
      return {
        signature: 'TypeError: Load failed',
        specificity: 'generic',
        confidenceCeiling: 'low',
        captures: { reason: 'generic' },
      }
    }

    if (line === 'TypeError: fetch failed') {
      return {
        signature: 'TypeError: fetch failed',
        specificity: 'specific',
        captures: { reason: 'node' },
      }
    }

    const consoleLine = NETWORK_CONSOLE_LINE.exec(line)
    if (!consoleLine) {
      return null
    }

    const code = consoleLine[1]
    if (code.startsWith('CERT_')) {
      return {
        signature: 'net::ERR_CERT_<reason>',
        specificity: 'specific',
        captures: { reason: 'certificate' },
      }
    }

    if (code === 'CONNECTION_REFUSED') {
      return {
        signature: 'net::ERR_CONNECTION_REFUSED',
        specificity: 'specific',
        captures: { reason: 'refused' },
      }
    }

    if (code === 'NAME_NOT_RESOLVED') {
      return {
        signature: 'net::ERR_NAME_NOT_RESOLVED',
        specificity: 'specific',
        captures: { reason: 'dns' },
      }
    }

    if (code === 'INTERNET_DISCONNECTED') {
      return {
        signature: 'net::ERR_INTERNET_DISCONNECTED',
        specificity: 'specific',
        captures: { reason: 'offline' },
      }
    }

    return null
  },
  explain(match: RuleMatch, context: RuleContext): RuleNarrative {
    const reason = match.captures.reason
    const commonSteps = [
      'Open the browser DevTools Network tab, or log the request in Node.js, and repeat the request.',
      'Check whether the request was sent, what status came back, and whether the browser shows a blocked reason or a failed connection.',
      'Confirm the server is running and reachable at the exact host, protocol, and port in the URL; try the same URL with curl or in a browser tab.',
      'Check the network connection, DNS, and any TLS certificate or mixed-content warning before changing application code.',
    ]
    const commonFix = {
      explanation:
        "Make the request reachable: start or fix the server, correct the URL, protocol, or port, restore the network connection, and if the request is cross-origin configure the server's CORS response headers. A retry or a second client-side wrapper cannot fix a request the browser never completed.",
      whereItMayApply:
        'Apply this to the request URL, the server that should answer it, or the network in between; changing the client-side error handler only hides the failure.',
      exampleCode: [
        "const response = await fetch('http://localhost:3000/api/health')",
        'console.log(response.status, response.ok)',
        'if (!response.ok) {',
        "  console.error('Request failed with status', response.status)",
        '}',
      ].join('\n'),
    }
    const commonVerification = [
      'Repeat the same request and check the Network tab shows a response instead of a failed request.',
      'Check that the status code and body match what the code expects.',
      'Confirm no certificate, mixed-content, or CORS warning appears in the console.',
    ]
    const commonLimitations = [
      'The engine only sees the pasted message; browsers hide the underlying network reason from scripts.',
      'This rule also matches the Chrome console net::ERR_* lines, which describe a browser-level failure rather than an application error.',
    ]

    let likelyCause: string
    let debuggingSteps = commonSteps
    let limitations = commonLimitations
    let alternatives: string[]

    if (reason === 'browser') {
      const consoleCode = /net::ERR_([A-Z0-9_]+)/.exec(context.errorText)
      likelyCause = consoleCode
        ? `The browser could not complete the fetch request. The pasted output reports net::ERR_${consoleCode[1]}, which is the browser's own reason for the failure; check the server, URL, port, network, certificate, and CORS settings for that address.`
        : 'The browser could not complete the fetch request. Browsers deliberately hide the underlying reason, so the server may be down or unreachable, the URL or port may be wrong, the network may be offline, or a CORS rejection, a browser extension, or a TLS or mixed-content problem may have stopped it.'
      alternatives = [
        'The server is not running or the port is wrong.',
        'The host name does not resolve, or the device is offline.',
        'A CORS rejection, browser extension, or ad blocker stopped the request.',
        'A TLS certificate or mixed-content problem blocked an HTTPS request.',
      ]
    } else if (reason === 'node') {
      const cause = NETWORK_NODE_CAUSE.exec(context.errorText)
      likelyCause = cause
        ? `Node.js fetch failed before a response was received. The surrounding output reports ${cause[1]}, so the connection was refused, the host was not resolved, the request timed out, or the connection was reset; check the server, DNS, and network for that address.`
        : 'Node.js fetch failed before a response was received. The underlying network error may be hidden in the [cause] property of this error; without that detail the server, DNS, timeout, or TLS layer may be responsible.'
      alternatives = [
        'The server is not running or is listening on a different port.',
        'The host name does not resolve from this machine.',
        'A firewall, proxy, or timeout interrupted the connection.',
        'A TLS certificate problem stopped the HTTPS request.',
      ]
    } else if (reason === 'refused') {
      likelyCause =
        'The server refused the connection: nothing is listening on that address and port, or the development server is not running.'
      alternatives = [
        'The development server stopped or was never started.',
        'The request uses a different port or protocol than the server listens on.',
        'A firewall or container port mapping blocks the connection.',
      ]
    } else if (reason === 'dns') {
      likelyCause =
        'The browser could not resolve the host name to an address. The domain may be misspelled, DNS may be unavailable, or the host may not exist in this environment.'
      alternatives = [
        'The host name is misspelled or missing a subdomain.',
        'The domain does not exist or is not registered in this environment.',
        'A VPN, hosts file, or DNS configuration redirects or blocks the name.',
      ]
    } else if (reason === 'offline') {
      likelyCause =
        'The browser reports that this device is not connected to the internet, so the request could not leave the machine.'
      alternatives = [
        'The device is offline or the network connection dropped.',
        'A captive portal or VPN requires attention before traffic can flow.',
        'The browser has been set to offline mode in the DevTools Network tab.',
      ]
    } else if (reason === 'certificate') {
      likelyCause =
        'The HTTPS certificate for this address failed validation, for example because it is self-signed, expired, issued for another host, or signed by an authority the browser does not trust.'
      alternatives = [
        'The local development server uses a self-signed certificate.',
        'The certificate expired or was issued for a different host name.',
        'A proxy or antivirus tool replaces the certificate with an untrusted one.',
        'The page mixes HTTPS and HTTP resources and the browser blocks the request.',
      ]
      debuggingSteps = [
        ...commonSteps,
        'Open the certificate details for the URL and check the issuer, host name, and expiry date before trusting or replacing it.',
      ]
      limitations = [
        ...commonLimitations,
        'Bypassing a certificate warning in the browser is not a fix; replace or trust the certificate properly instead.',
      ]
    } else {
      likelyCause =
        'Safari could not complete the request. This wording is generic: it does not say whether the server was unreachable, the URL or port was wrong, the network was offline, or a CORS or TLS problem blocked the request.'
      alternatives = [
        'The server is not running or the URL or port is wrong.',
        'The device is offline or DNS cannot resolve the host.',
        'A CORS rejection or a TLS certificate problem blocked the request.',
      ]
    }

    return {
      likelyCause,
      debuggingSteps,
      possibleFix: commonFix,
      verificationSteps: commonVerification,
      limitations,
      alternativeExplanations: alternatives,
    }
  },
}

function classifyCorsReason(detail: string): string | null {
  if (/^Response to preflight request doesn't pass access control check/.test(detail)) {
    return 'preflight'
  }

  if (/credentials mode|must not be the wildcard/i.test(detail)) {
    return 'credentials'
  }

  if (/is not equal to the supplied origin|does not match the supplied origin/i.test(detail)) {
    return 'origin-mismatch'
  }

  if (/No 'Access-Control-Allow-Origin' header is present/i.test(detail)) {
    return 'missing-header'
  }

  return null
}

const CORS_SIGNATURES: Readonly<Record<string, string>> = {
  'missing-header':
    "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: missing 'Access-Control-Allow-Origin' header",
  preflight:
    "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: preflight request does not pass access control check",
  'origin-mismatch':
    "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: 'Access-Control-Allow-Origin' does not match the supplied origin",
  credentials:
    "Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: credentials mode cannot use a wildcard origin",
}

export const javascriptCorsBlockedRule: DiagnosticRule = {
  id: 'javascript.cors-blocked',
  language: 'javascript',
  category: 'cors-blocked',
  contextSymptoms: FETCH_FAILURE_SYMPTOMS,
  match(line: string): RuleMatch | null {
    const matched = CORS_MESSAGE.exec(line)
    if (!matched) {
      return null
    }

    const reason = classifyCorsReason(matched[4])
    if (!reason) {
      return null
    }

    return {
      signature: CORS_SIGNATURES[reason],
      specificity: 'specific',
      captures: {
        transport: matched[1],
        url: matched[2],
        origin: matched[3],
        reason,
      },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const reason = match.captures.reason

    let likelyCause: string
    if (reason === 'preflight') {
      likelyCause =
        "The browser sent an OPTIONS preflight request and the server's response failed the access control check. A request with custom headers or a non-simple method triggers the preflight, and the server must answer it with the right 'Access-Control-Allow-Origin', methods, and headers."
    } else if (reason === 'origin-mismatch') {
      likelyCause =
        "The server returned an 'Access-Control-Allow-Origin' value that does not match the origin that sent the request, so the browser blocked the response. The header must match the exact origin, including scheme, host, and port."
    } else if (reason === 'credentials') {
      likelyCause =
        "The request asked for credentials, but the server answered with the wildcard '*' origin. When credentials mode is 'include', the response must name the specific origin and allow credentials; a wildcard is not accepted."
    } else {
      likelyCause =
        "The response did not include an 'Access-Control-Allow-Origin' header, so the browser blocked the JavaScript from reading it. The API answered, but the browser refused to expose the response to this origin."
    }

    let exampleCode = [
      '// Server-side example: allow the exact calling origin.',
      'app.use((req, res, next) => {',
      "  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173')",
      "  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')",
      "  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')",
      "  if (req.method === 'OPTIONS') return res.sendStatus(204)",
      '  next()',
      '})',
    ].join('\n')

    let explanation =
      "The server that answers the request must send the correct access-control headers. CORS is enforced by the browser, so the front-end cannot fix it on its own: the response needs an 'Access-Control-Allow-Origin' value that matches the calling origin, and a preflight OPTIONS request must be answered with the allowed methods and headers. During local development a dev-server proxy can forward the call so the browser sees a same-origin request. The mode: 'no-cors' option does not fix this, because it produces an opaque response your code cannot read. Turning off browser security checks is not a fix."

    if (reason === 'credentials') {
      explanation =
        "When the request uses credentials, the server must return the specific origin in 'Access-Control-Allow-Origin' and add 'Access-Control-Allow-Credentials: true'. The wildcard '*' is not accepted with credentials mode 'include'. CORS is enforced by the browser, so the front-end cannot fix this on its own, and the mode: 'no-cors' option only produces an opaque response your code cannot read."
      exampleCode = [
        "// Credentials require the exact origin, not '*'.",
        "res.setHeader('Access-Control-Allow-Origin', 'https://app.example.com')",
        "res.setHeader('Access-Control-Allow-Credentials', 'true')",
        "res.setHeader('Vary', 'Origin')",
      ].join('\n')
    }

    return {
      likelyCause,
      debuggingSteps: [
        'Read the blocked URL and origin in the message and compare them with the API you think you are calling.',
        'Open the Network tab, find the failed request, and inspect the response headers (and the OPTIONS preflight, if present).',
        'Change the server response headers so the exact origin is allowed, or route the request through a same-origin proxy during development.',
        'Never work around this by turning off browser security checks or by hiding the error.',
      ],
      possibleFix: {
        explanation,
        whereItMayApply:
          'Apply this on the server, gateway, or dev proxy that owns the API; a change in the component that calls fetch cannot add the missing header.',
        exampleCode,
      },
      verificationSteps: [
        'Repeat the same request from the same origin and check the browser console has no CORS message.',
        'Check the Network tab shows the expected access-control headers on the response (and on the OPTIONS response, if a preflight is sent).',
        'Confirm the response body is readable in the app and that no credential or cookie change was needed.',
      ],
      limitations: [
        'The engine only sees the console message; it cannot inspect the server, the actual response headers, or the proxy configuration.',
        'The browser decides what to expose; a request that is blocked can still have reached the server.',
      ],
      alternativeExplanations: [
        'The API does not allow this origin because the browser and API are on different ports or domains.',
        'The preflight is rejected because the server does not handle OPTIONS or does not allow the request headers or methods.',
        'The API sends a wildcard origin while the client requests credentials.',
        'A proxy, gateway, or authentication layer strips or rewrites the access-control headers.',
      ],
    }
  },
}

export const javascriptReactErrorRule: DiagnosticRule = {
  id: 'javascript.react-error',
  language: 'javascript',
  category: 'react-error',
  contextSymptoms: [REACT_HOOK_SYMPTOM],
  match(line: string): RuleMatch | null {
    if (REACT_INVALID_HOOK_WARNING.test(line)) {
      return {
        signature:
          'Error: Invalid hook call. Hooks can only be called inside of the body of a function component.',
        specificity: 'specific',
        confidenceCeiling: 'medium',
        captures: { reason: 'hooks' },
      }
    }

    if (REACT_INVALID_HOOK.test(line)) {
      return {
        signature:
          'Error: Invalid hook call. Hooks can only be called inside of the body of a function component.',
        specificity: 'specific',
        captures: { reason: 'hooks' },
      }
    }

    if (REACT_TOO_MANY_RERENDERS.test(line)) {
      return {
        signature:
          'Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.',
        specificity: 'specific',
        captures: { reason: 'rerenders' },
      }
    }

    if (REACT_UPDATE_DEPTH.test(line)) {
      return {
        signature: 'Error: Maximum update depth exceeded.',
        specificity: 'specific',
        captures: { reason: 'update-depth' },
      }
    }

    const objectChild = REACT_OBJECT_CHILD.exec(line)
    if (objectChild) {
      return {
        signature: 'Error: Objects are not valid as a React child (found: <value>)',
        specificity: 'specific',
        captures: { found: objectChild[1], reason: 'child-object' },
      }
    }

    return null
  },
  explain(match: RuleMatch): RuleNarrative {
    const reason = match.captures.reason

    if (reason === 'hooks') {
      return {
        likelyCause:
          'React found a hook call outside the body of a function component. Hooks must run in the same order on every render, so calling one inside a loop, a condition, an event handler, a class component, or a plain function breaks the Rules of Hooks.',
        debuggingSteps: [
          'Find the component and line named in the stack and check every hook call in that file.',
          'Move the hook to the top level of the function component, before any early return, loop, or condition.',
          'Check that the project uses one copy of React: run npm ls react react-dom and look for duplicate versions.',
          'Check that react and react-dom versions match and that only one renderer is used for this tree.',
        ],
        possibleFix: {
          explanation:
            'Call hooks only at the top level of function components or custom hooks, and make sure the app resolves a single copy of react and react-dom. A duplicate copy, a mismatched version, or a hook inside a callback produces this error.',
          whereItMayApply:
            'Apply this to the component that calls the hook and to the dependency tree that provides React; the error usually comes from code structure or duplicate packages, not from the hook itself.',
          exampleCode: [
            'function Profile({ user }) {',
            '  // Hooks run at the top level, on every render.',
            '  const [open, setOpen] = useState(false)',
            '  return <button onClick={() => setOpen(!open)}>{user.name}</button>',
            '}',
          ].join('\n'),
        },
        verificationSteps: [
          'Rerun the same interaction and check the invalid hook call error is gone.',
          'Check that npm ls react react-dom shows a single version.',
          'Test the component through the same route or test renderer that failed.',
        ],
        limitations: [
          'The message lists possible reasons but does not say which one applies.',
          'The engine cannot inspect the component tree, the package tree, or the bundler configuration.',
        ],
        alternativeExplanations: [
          'A hook runs inside a condition, loop, or event handler.',
          'Two copies of React are installed, or react and react-dom versions do not match.',
          'A hook is called from a class component or a plain function.',
          'A test renderer or another renderer is mixed with react-dom in the same tree.',
        ],
      }
    }

    if (reason === 'rerenders') {
      return {
        likelyCause:
          'A state setter ran while React was rendering the component, so React started another render immediately and stopped after too many attempts. The usual cause is calling the setter during render, such as onClick={setCount(1)} instead of passing a function.',
        debuggingSteps: [
          'Find the component named in the stack and look for a state update that runs during render.',
          'Check event handler props such as onClick={setCount(1)}, which call the setter immediately instead of passing a function.',
          'Wrap the call in an arrow function, for example onClick={() => setCount(1)}, or move the update into an effect or event handler.',
          'Check for an early return or condition that changes which hooks run between renders.',
        ],
        possibleFix: {
          explanation:
            'Pass a function to event handlers instead of calling the state setter during render, and move updates that depend on props or state into an event handler or effect.',
          whereItMayApply:
            'Apply this to the JSX that wires the handler and to any update that runs while the component renders.',
          exampleCode: [
            'function Counter() {',
            '  const [count, setCount] = useState(0)',
            '  return (',
            '    <button onClick={() => setCount(count + 1)}>',
            '      Count: {count}',
            '    </button>',
            '  )',
            '}',
          ].join('\n'),
        },
        verificationSteps: [
          'Rerun the same interaction and check the too many re-renders error is gone.',
          'Check that clicking the control updates state once per click.',
          'Test the component with the initial props and with updated props.',
        ],
        limitations: [
          'The message does not name the setter or the component that triggered the loop.',
          'The engine cannot inspect the component tree or React internals.',
        ],
        alternativeExplanations: [
          'A state setter is called directly in JSX, such as onClick={setCount(1)}.',
          'An update runs during render instead of inside an event handler or effect.',
          'A parent re-renders the child with a new value that immediately triggers another update.',
        ],
      }
    }

    if (reason === 'update-depth') {
      return {
        likelyCause:
          'A component kept scheduling its own update, so React stopped after the maximum update depth. This usually comes from an effect that sets state and depends on a value it changes, with a missing or unstable dependency array.',
        debuggingSteps: [
          'Find the effect or handler named in the stack and list the state it sets.',
          'Check the dependency array: an effect that sets a value listed in its dependencies repeats forever.',
          'Use the functional form of the setter or depend on a narrower value so the effect stops repeating.',
          'Check for an object or array created during render and passed as a dependency, which changes identity on every render.',
        ],
        possibleFix: {
          explanation:
            'Make the effect stop depending on the value it updates, narrow the dependencies to stable values, or use the functional setter form. An effect that sets state and depends on that same state keeps scheduling updates.',
          whereItMayApply:
            'Apply this to the effect or update chain that keeps rescheduling itself, not to the component that happens to render last.',
          exampleCode: [
            'useEffect(() => {',
            '  setCount((current) => current + 1)',
            '  // Depend only on values that should retrigger the effect.',
            '}, [userId])',
          ].join('\n'),
        },
        verificationSteps: [
          'Rerun the same interaction and check the maximum update depth error is gone.',
          'Check that the effect runs only when its real dependencies change.',
          'Watch the component for a render loop while changing the relevant props.',
        ],
        limitations: [
          'The message does not name the effect or the state that keeps changing.',
          'The engine cannot inspect the component tree or the dependency arrays.',
        ],
        alternativeExplanations: [
          'An effect sets state that is part of its own dependency array.',
          'An object or array is recreated on every render and used as a dependency.',
          'A child calls a parent setter during render, so the parent updates repeatedly.',
        ],
      }
    }

    return {
      likelyCause:
        'A plain object was placed directly in JSX. React can render strings, numbers, elements, and arrays of those, but not objects, Promises, Dates, or arrays of objects.',
      debuggingSteps: [
        'Find the value named in the message and the JSX expression that renders it.',
        'Render a field of the object, such as user.name, or map an array of objects to elements.',
        'Convert Dates, Promises, or other non-renderable values to a string before rendering.',
        'If the value arrives asynchronously, render a loading state until it is available.',
      ],
      possibleFix: {
        explanation:
          'Render a string or element from the object instead of the object itself: map arrays to elements with a stable key, read the fields you need, and convert Dates or Promises to text before rendering.',
        whereItMayApply:
          'Apply this where the object is rendered in JSX; changing the data shape is usually better than hiding the value.',
        exampleCode: [
          'function UserList({ users }) {',
          '  return (',
          '    <ul>',
          '      {users.map((user) => (',
          '        <li key={user.id}>{user.name}</li>',
          '      ))}',
          '    </ul>',
          '  )',
          '}',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same render and check the React child error is gone.',
        'Check that the screen shows the expected text or elements instead of a blank region.',
        'Add or rerun a component test that renders the same data shape.',
      ],
      limitations: [
        'The message shows the value that failed to render but not which component rendered it.',
        'The engine cannot inspect the component tree or the data passed to it.',
      ],
      alternativeExplanations: [
        'An object from state or props is rendered directly instead of one of its fields.',
        'An array of objects is rendered without mapping each item to an element.',
        'A Promise or Date is rendered before it is resolved or formatted.',
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
  javascriptJsonParseErrorRule,
  javascriptNetworkRequestFailedRule,
  javascriptCorsBlockedRule,
  javascriptReactErrorRule,
]
