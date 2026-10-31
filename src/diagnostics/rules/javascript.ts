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

/**
 * A TypeScript location is only accepted in the exact shapes the compiler
 * prints: a file path with a source extension, then (line,column) or
 * line:column. The character class deliberately excludes spaces so a
 * timestamp or a sentence in front of the path can never match.
 */
const TS_LOCATION_PATH = String.raw`([\w.\-:~\\/]*\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))`
const TS_CLASSIC_LOCATION = new RegExp(
  `^${TS_LOCATION_PATH}\\((\\d{1,7}),(\\d{1,7})\\): error TS(\\d{3,5}): (.+)$`,
)
const TS_PRETTY_LOCATION = new RegExp(
  `^${TS_LOCATION_PATH}:(\\d{1,7}):(\\d{1,7})(?:\\s+-\\s+|:\\s+)error TS(\\d{3,5}): (.+)$`,
)
const TS_BARE = /^error TS(\d{3,5}): (.+)$/
const TS_EDITOR = /^([^\\/]{5,300}?)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)\((\d{3,5})\)$/
const TS_ERROR_MENTION = /error TS(\d{3,5}): /

/** Every message shape this rule explains by itself, keyed by error code. */
const TYPESCRIPT_SHAPES: ReadonlyArray<{
  code: string
  shape: string
  pattern: RegExp
  signature: string
  capture?: 'name' | 'module' | 'property'
}> = [
  {
    code: '2322',
    shape: 'assignable',
    pattern: /^Type '[^']*' is not assignable to type '[^']*'\.$/,
    signature: "error TS2322: Type '<type>' is not assignable to type '<type>'.",
  },
  {
    code: '2339',
    shape: 'property',
    pattern: /^Property '([^']*)' does not exist on type '[^']*'\.$/,
    signature: "error TS2339: Property '<name>' does not exist on type '<type>'.",
    capture: 'property',
  },
  {
    code: '2345',
    shape: 'argument',
    pattern:
      /^Argument of type '[^']*' is not assignable to parameter of type '[^']*'\.$/,
    signature:
      "error TS2345: Argument of type '<type>' is not assignable to parameter of type '<type>'.",
  },
  {
    code: '2304',
    shape: 'name',
    pattern: /^Cannot find name '([^']*)'\.$/,
    signature: "error TS2304: Cannot find name '<name>'.",
    capture: 'name',
  },
  {
    code: '2307',
    shape: 'module',
    pattern:
      /^Cannot find module '([^']*)' or its corresponding type declarations\.$/,
    signature:
      "error TS2307: Cannot find module '<module>' or its corresponding type declarations.",
    capture: 'module',
  },
  {
    code: '7006',
    shape: 'implicit-any',
    pattern: /^Parameter '([^']*)' implicitly has an 'any' type\.$/,
    signature: "error TS7006: Parameter '<name>' implicitly has an 'any' type.",
    capture: 'name',
  },
  {
    code: '2532',
    shape: 'object-possibly',
    pattern: /^Object is possibly '[^']*'\.$/,
    signature: "error TS2532: Object is possibly '<value>'.",
  },
  {
    code: '18048',
    shape: 'name-possibly',
    pattern: /^'([^']*)' is possibly '[^']*'\.$/,
    signature: "error TS18048: '<name>' is possibly '<value>'.",
    capture: 'name',
  },
  {
    code: '2554',
    shape: 'argument-count',
    pattern: /^Expected \d+ arguments?, but got \d+\.$/,
    signature: 'error TS2554: Expected <count> arguments, but got <count>.',
  },
  {
    code: '2769',
    shape: 'overload',
    pattern: /^No overload matches this call\.$/,
    signature: 'error TS2769: No overload matches this call.',
  },
]

const NPM_LOG_LINE = /^npm (ERR!|error)\s+(\S.*)$/
const NPM_CODE_LINE = /^code\s+(\S+)$/
const NPM_NETWORK_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])
const NPM_SCRIPT_LINE = /Failed at the (?:\S+@\S+\s+)?(\S+) script\b/
const NPM_PEER_LINE =
  /^npm (?:ERR!|error)\s+peer (\S+?)@"([^"]+)" from (\S+?)@(\S+)$/m
const NPM_FOUND_LINE = /^npm (?:ERR!|error)\s+Found: (\S+?)@(\S+)$/m
const NPM_LOG_SYMPTOM = /^npm (?:ERR!|error)(?:\s|$)/
const NPM_LOG_FILE_SYMPTOM =
  /^(?:npm (?:ERR!|error)\s*)?\S*(?:\.npm|npm-cache)[\\/]_logs[\\/]/i
const STACK_FRAME_SYMPTOM = /^at\s+\S/

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

function countTypeScriptErrorLines(errorText: string): number {
  return errorText.split(/\r?\n/).filter((line) => TS_ERROR_MENTION.test(line))
    .length
}

/**
 * Each branch reads only the message the compiler printed. The location, when
 * the paste carried one, is already inside `reported`.
 */
function typeScriptNarrative(
  code: string,
  shape: string,
  message: string,
  reported: string,
): RuleNarrative {
  if (shape === 'assignable') {
    return {
      likelyCause: `The TypeScript compiler found a value whose type does not match the type the target expects: ${reported}. The message names the two types but not the variable, property, or call that produced the mismatch, so the assignment itself is the only thing this rule can point at.`,
      debuggingSteps: [
        'Open the file and position in the message and look at what is assigned, returned, or passed there.',
        'Find the declared type of the target: an annotation, an interface property, a parameter, or a return type.',
        'Log the value just before that line and compare what it actually holds with the type in the message.',
        'If the value comes from state, props, or a response, check the type that produces it rather than the line that reads it.',
      ],
      possibleFix: {
        explanation:
          'Make the two sides agree: convert or build the value so it has the type the target expects, or widen the declared type when the extra shape is intended. A type assertion or cast only silences the check; use it after you have confirmed the runtime value really has that shape.',
        whereItMayApply:
          'Apply it at the position named in the message, or at the declaration that gives the target its type; the value and the annotation are often in different files.',
        exampleCode: [
          '// Convert the value to the type the target declares.',
          'const total: number = Number(count)',
          '',
          '// Or declare the target with the type the value really has.',
          "const total: string = `${count}`",
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler on the same file and check whether this message is gone.',
        'Exercise the same code path and confirm the value still behaves as the type claims.',
        'Check whether the error moved to another assignment, which means the type is fixed one level up.',
      ],
      limitations: [
        'The message does not name the variable or property involved, only the two types.',
        'An inferred, generic, or union type can make the reported types look different from what the source says.',
      ],
      alternativeExplanations: [
        'The value is correct and the target annotation is too narrow.',
        'Two declarations with the same name are in scope, for example one from a package and one local.',
        'The mismatch is on a nested property rather than on the value quoted in the message.',
      ],
    }
  }

  if (shape === 'property') {
    return {
      likelyCause: `The code reads a property that the type the compiler resolved for that value does not have: ${reported}. That usually means a misspelled name, a property that is optional and needs a check, a value whose declared type is narrower than what is there at runtime, or a missing declaration.`,
      debuggingSteps: [
        'Compare the spelling and letter case of the property with the type it should come from.',
        'Open the declaration of that type and list the properties it really has.',
        'Check whether the property is optional; reading it directly on an optional value is a separate error from a missing one.',
        'If the value comes from an API response, a JSON file, or state, compare the real shape with the declared type.',
      ],
      possibleFix: {
        explanation:
          'Use a property the declared type has: correct a typo, add the missing property to the interface or type, or narrow the value before reading it. Optional chaining (value?.name) is the right shape when the property really can be absent.',
        whereItMayApply:
          'Apply it to the expression at the position in the message, or to the type declaration that should describe the value; the type is usually defined elsewhere.',
        exampleCode: [
          'interface Counter {',
          '  count: number',
          '}',
          '',
          'function show(counter: Counter) {',
          '  return counter.count // not counter.countt',
          '}',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and check the message no longer names that property.',
        'Log the value at runtime and confirm the property exists with the expected type.',
        'If the type was widened, check the places that read it still compile.',
      ],
      limitations: [
        'The message names the property and the type, not where the value was created.',
        'A union, an index signature, or a type from another package can make a valid property look missing.',
      ],
      alternativeExplanations: [
        'The property exists at runtime but the declared type does not list it.',
        'The value is a union and the property only exists on one member.',
        'An import brought in a different type with the same name.',
        'The object is one level deeper than the expression in the message.',
      ],
    }
  }

  if (shape === 'argument') {
    return {
      likelyCause: `A value passed to a function does not match the parameter type the compiler expects: ${reported}. The call site and the signature disagree, and the message does not say which argument or which call it is.`,
      debuggingSteps: [
        'Open the file and position in the message and list the arguments at that call.',
        'Read the parameter types of the function or method being called.',
        'Match the arguments by position, not by name, and find the one whose type differs.',
        'If the argument comes from a response or state, check the type that produces it.',
      ],
      possibleFix: {
        explanation:
          'Pass the type the parameter declares, or change the parameter to the type the callers really have. Wrapping the argument in a cast only hides the mismatch, so confirm the runtime value first.',
        whereItMayApply:
          'Apply it at the call position in the message or at the function declaration; when a shared function changes signature, every caller of it is affected.',
        exampleCode: [
          "function setLabel(text: string) {}",
          '',
          'setLabel(String(count)) // was setLabel(count)',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and check the message is gone from that call.',
        'Call the function with the same input and confirm the result is unchanged.',
        'Check the other callers still compile after any signature change.',
      ],
      limitations: [
        'The message does not say which argument position failed.',
        'Overloads and default parameters can make the expected signature hard to read from the call.',
      ],
      alternativeExplanations: [
        'The argument order changed and two parameters were swapped.',
        'An optional parameter was passed where the signature expects the next one.',
        'The function comes from a package version with a different signature.',
      ],
    }
  }

  if (shape === 'name') {
    return {
      likelyCause: `The compiler cannot resolve the name it was asked about: ${reported}. A name it cannot find is normally not imported or not declared in this file, or it only exists under different compiler settings.`,
      debuggingSteps: [
        'Search the file for a declaration or an import that provides that name.',
        'Check the letter case and the spelling, and check that the file that declares it is part of the compilation.',
        'If the name comes from a package, confirm the package is installed and its types are available.',
        'If the name is a built-in such as fetch, Promise, or a DOM type, check the "lib" and "target" settings in tsconfig.json.',
      ],
      possibleFix: {
        explanation:
          'Add the import or declaration that provides the name, install the matching @types package for a library, or raise "target" and "lib" in tsconfig.json so the built-in name belongs to the compilation.',
        whereItMayApply:
          'Apply it to the file named in the message; when the name is provided by configuration, the change belongs in tsconfig.json instead of the source file.',
        exampleCode: [
          '# Windows (PowerShell)',
          'npm install --save-dev @types/lodash',
          'Get-Content tsconfig.json',
          '',
          '# macOS or Linux',
          'npm install --save-dev @types/lodash',
          'cat tsconfig.json',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and check the message about that name is gone.',
        'Jump to the definition of the name to confirm it resolves to the file you expect.',
        'Check that the tsconfig change did not add new errors elsewhere.',
      ],
      limitations: [
        'The message gives the name but not the scope it was searched in.',
        'A name can also be missing because the file that declares it is excluded from the compilation.',
      ],
      alternativeExplanations: [
        'The import exists but uses a different local name.',
        'The declaration is inside another module or block and not exported.',
        'The "lib" setting does not include the environment that provides the built-in.',
      ],
    }
  }

  if (shape === 'module') {
    const moduleName = message.replace(
      /^Cannot find module '([^']*)'.*$/s,
      '$1',
    )
    return {
      likelyCause: `The compiler cannot resolve the module the code imports: ${reported}. What it points at may be missing from the install, unreachable through the configured resolution rules, or written in a form the resolver does not accept.`,
      debuggingSteps: [
        `Check the spelling and letter case of '${moduleName}' and the path the import uses.`,
        'Look in package.json, or run npm ls, to see whether the package is actually installed.',
        'For a JavaScript package with no bundled types, check whether a matching @types package is missing.',
        'Check "paths" and "moduleResolution" in tsconfig.json when the import is a local file or an alias.',
        'Check the extension the resolver expects; with node16 or nodenext a relative import needs the exact file name.',
      ],
      possibleFix: {
        explanation:
          'Install the package or its type declarations, correct the path or alias so the resolver can find it, and when importing a local ES module use the extension and casing that "moduleResolution" expects.',
        whereItMayApply:
          'Apply it to the import statement in the file named in the message, to the dependency list, or to tsconfig.json; the file that fails to compile is not always the place that needs the change.',
        exampleCode: [
          '# Windows (PowerShell)',
          'npm install lodash',
          'npm install --save-dev @types/lodash',
          'Get-ChildItem src/App.tsx',
          '',
          '# macOS or Linux',
          'npm install lodash',
          'npm install --save-dev @types/lodash',
          'ls src/App.tsx',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and check the module resolves.',
        'Run the app or the test that imports it, because a type-only resolution does not prove the runtime import works.',
        'If the alias was changed, check the other files that use the same alias.',
      ],
      limitations: [
        'The message does not say which of the resolution rules was tried.',
        'A package can resolve for TypeScript and still fail at runtime, or the other way round.',
        'The engine cannot read package.json, tsconfig.json, or the installed tree.',
      ],
      alternativeExplanations: [
        'The package is a devDependency and the build runs where it is not installed.',
        'The types are bundled under a different entry point than the runtime file.',
        'The import is a directory that only has an ESM entry for the configured module mode.',
        'A bundler alias exists in the app but not in tsconfig.json "paths".',
      ],
    }
  }

  if (shape === 'implicit-any') {
    return {
      likelyCause: `The compiler could not infer a type for a parameter and "noImplicitAny" is on, so it reports one instead: ${reported}. The parameter normally has no annotation and the value arrives from a place the compiler cannot read a type from.`,
      debuggingSteps: [
        'Open the file and position in the message and look at the parameter that has no type.',
        'Check how the function is called or passed; an untyped callback, a JSON parse, or an event handler left the parameter unknown.',
        'Check whether the surrounding tsconfig enables "noImplicitAny" directly or through "strict".',
        'Decide whether the real fix is a type annotation or a type on the value that feeds it.',
      ],
      possibleFix: {
        explanation:
          'Annotate the parameter with the type it receives, or type the value that is passed in so inference works. Turning "noImplicitAny" off removes the check for the whole project, so treat that as a deliberate choice rather than a fix.',
        whereItMayApply:
          'Apply it at the parameter in the message; when the function is a callback, the type usually belongs to the caller or to the event that provides it.',
        exampleCode: [
          'function format(value: string) {',
          "  return value.trim()",
          '}',
          '',
          'list.map((item: Product) => item.price)',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and check the parameter no longer reports an implicit any.',
        'Check the annotation against what the call sites really pass.',
        'Confirm no new errors appeared where the value is used.',
      ],
      limitations: [
        'The message does not show what the argument is at runtime.',
        'The annotation that fits depends on the caller, which the pasted text may not include.',
      ],
      alternativeExplanations: [
        'The value comes from JSON.parse or an untyped API response.',
        'A generic parameter was not supplied, so inference fell back to any.',
        'The project turned on "strict" recently and several older files now report this.',
      ],
    }
  }

  if (shape === 'object-possibly' || shape === 'name-possibly') {
    const subject = shape === 'name-possibly' ? 'the name' : 'the object'
    return {
      likelyCause: `The compiler knows ${subject} can be missing on the path that reaches this line, and the code uses it as though it were always present: ${reported}. The value is optional, comes from a lookup that can return nothing, or is narrowed away in another branch.`,
      debuggingSteps: [
        'Open the file and position in the message and find where the value is produced.',
        'Read its type and look for ?, undefined, or null in it.',
        'Check whether a guard exists earlier in the block but does not apply to this line.',
        'Look at the runtime path that reached the line, especially array lookups, Map.get, and optional properties.',
      ],
      possibleFix: {
        explanation:
          'Check for the missing value before using it, or reach it with optional chaining, so the compiler narrows the type for the rest of the block. A non-null assertion (value!) only silences the compiler and is defensible only after you have already guaranteed the value exists; it does not make the value defined at runtime.',
        whereItMayApply:
          'Apply it at the expression in the message, or at the point where the value is produced if that is where the optionality should be removed.',
        exampleCode: [
          'if (value === undefined) {',
          '  return 0',
          '}',
          '',
          'return value.length',
          '',
          '// Or without a branch:',
          'return value?.length ?? 0',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and check the possibly-undefined report is gone.',
        'Test the input that produced the missing value, not only the happy path.',
        'If you used a non-null assertion, confirm the guard that makes it true still runs first.',
      ],
      limitations: [
        'The message says the value can be missing but not which path made it so.',
        'A guard the compiler cannot see, such as one inside a callback, still reports this error.',
      ],
      alternativeExplanations: [
        'The type is honest and the runtime value really can be undefined.',
        'A lookup such as find or Map.get returns undefined for this input.',
        'The property is optional in the interface but always set by the code that builds it.',
      ],
    }
  }

  if (shape === 'argument-count') {
    return {
      likelyCause: `The number of arguments at the call does not match the signature: ${reported}. The message gives both counts but not which parameter is missing or extra.`,
      debuggingSteps: [
        'Open the file and position in the message and count the arguments in that call.',
        'Read the signature and count the required parameters, noting defaults and optional ones.',
        'Check whether the function came from a different version or package than the code was written against.',
        'Check for a spread or an array passed where separate arguments were expected.',
      ],
      possibleFix: {
        explanation:
          'Pass the arguments the signature asks for, or give the parameter a default or make it optional when callers legitimately leave it out. Adding a placeholder value only matches the count, so check what the parameter is used for.',
        whereItMayApply:
          'Apply it at the call in the message, or at the declaration when the signature changed and several callers still use the old shape.',
        exampleCode: [
          'function sum(a: number, b: number = 0) {',
          '  return a + b',
          '}',
          '',
          'sum(1) // with the default, or sum(1, 2)',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and check the counts agree.',
        'Run the call with the same input and confirm the extra or missing argument does not change the result.',
        'Check the other call sites of that function.',
      ],
      limitations: [
        'The message reports the two counts, not which argument is wrong.',
        'Rest parameters, defaults, and overloads change what "expected" means.',
      ],
      alternativeExplanations: [
        'A refactor added a parameter and this caller was missed.',
        'A dependency updated and its function signature changed.',
        'Arguments were spread from an array that is shorter than intended.',
      ],
    }
  }

  if (shape === 'overload') {
    return {
      likelyCause: `None of the accepted call shapes matched what the code passes: ${reported}. This is a general failure, so the useful detail is normally in the indented lines the compiler prints under this message.`,
      debuggingSteps: [
        'Read the continuation lines below the message; each one names an overload and why it did not match.',
        'Compare the argument types at the call with each signature in the declaration or the .d.ts file.',
        'Check whether an argument is a union or a broad type that no single overload accepts.',
        'Check whether the generic parameters were inferred from a weaker argument than intended.',
      ],
      possibleFix: {
        explanation:
          'Make the call match one overload exactly: fix the argument type, cast the argument to the member the overload expects, or add an overload for the shape your code genuinely needs. Reading the continuation lines first avoids changing the wrong call.',
        whereItMayApply:
          'Apply it to the call at the position in the message; when a package owns the overloads, the change may belong in your wrapper instead.',
        exampleCode: [
          "declare function on(name: 'save'): void",
          "declare function on(name: 'load', cb: () => void): void",
          '',
          "on('load', () => refresh()) // matched second overload",
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the compiler and read whether a different overload is now reported.',
        'Call the function with the same arguments at runtime and confirm the intended branch runs.',
        'Check the other calls of the same function still resolve.',
      ],
      limitations: [
        'This message on its own does not identify the failing argument.',
        'The per-overload reasons are printed in continuation lines that a copied message often loses.',
      ],
      alternativeExplanations: [
        'One argument is a wider type than any overload accepts.',
        'A generic call inferred a weaker type than the argument really has.',
        'The overload list changed in a package update.',
      ],
    }
  }

  return {
    likelyCause: `The compiler reported ${code} with the message "${message}". This engine does not have a specific rule for ${code}, so it names the code and repeats what the compiler said without claiming a cause.`,
    debuggingSteps: [
      'Copy the error code and the first message line; the detail is in the lines printed after it.',
      'Read the indented continuation lines under the message, which name the property, module, or call the compiler compared.',
      'Search the TypeScript documentation for that error code to read what the check means.',
      'Reproduce it with the smallest file that still reports it so the remaining lines point at one place.',
    ],
    possibleFix: {
      explanation:
        `Look ${code} up in the TypeScript documentation and read the indented continuation lines that follow the message; that is where TypeScript explains the comparison it made and names the exact property, module, or signature involved. This engine does not guess a fix for a code it has no rule for.`,
      whereItMayApply:
        'Apply it to the file and position quoted in the message; the code tells you which compiler check failed, which is where the explanation starts.',
      exampleCode: [
        'npx tsc --noEmit',
        '',
        '# Or show the full message with its continuation lines:',
        'npx tsc --pretty false',
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the compiler after one focused change and check whether the code and its continuation lines still appear.',
      'Check whether the error count in the summary changes.',
      'If the message changes, diagnose the new code instead of the old one.',
    ],
    limitations: [
      `There is no specific rule for ${code} here, so nothing beyond the pasted message is inferred.`,
      'The continuation lines that carry the explanation are often left out of a copied error.',
    ],
    alternativeExplanations: [
      'This message may be a follow-on from an earlier error in the same file.',
      'A type from a package may not match the version that is installed.',
      'A compiler setting may have changed how the same code is checked.',
    ],
  }
}

export const javascriptTypeScriptErrorRule: DiagnosticRule = {
  id: 'javascript.typescript-error',
  language: 'javascript',
  category: 'typescript-error',
  firstMatchWins: true,
  contextSymptoms: [
    TS_ERROR_MENTION,
    NPM_LOG_SYMPTOM,
    NPM_LOG_FILE_SYMPTOM,
    STACK_FRAME_SYMPTOM,
  ],
  match(line: string): RuleMatch | null {
    const located = TS_CLASSIC_LOCATION.exec(line) ?? TS_PRETTY_LOCATION.exec(line)
    const bare = located === null ? TS_BARE.exec(line) : null
    const editor =
      located === null && bare === null ? TS_EDITOR.exec(line) : null

    let code: string
    let rawMessage: string
    let location: string | undefined
    let form: 'located' | 'bare' | 'editor'

    if (located) {
      code = located[4]
      rawMessage = located[5]
      location = `${located[1]}, line ${located[2]}, column ${located[3]}`
      form = 'located'
    } else if (bare) {
      code = bare[1]
      rawMessage = bare[2]
      form = 'bare'
    } else if (editor) {
      // The editor marker only means something attached to a readable message.
      if (!/\s/.test(editor[1])) {
        return null
      }
      code = editor[2]
      rawMessage = editor[1]
      form = 'editor'
    } else {
      return null
    }

    const message = /[.?!]$/.test(rawMessage) ? rawMessage : `${rawMessage}.`
    const shape = TYPESCRIPT_SHAPES.find(
      (entry) => entry.code === code && entry.pattern.test(message),
    )
    const captures: Record<string, string> = {
      reason: `TS${code}:${shape === undefined ? 'generic' : shape.shape}`,
      detail: message,
    }
    if (location !== undefined) {
      captures.where = location
    }
    if (shape?.capture !== undefined) {
      const quoted = shape.pattern.exec(message)?.[1]
      if (quoted !== undefined) {
        captures[shape.capture] = quoted
      }
    }

    const specificity: RuleMatch['specificity'] =
      shape === undefined ? 'generic' : 'specific'
    const ruleMatch: RuleMatch = {
      signature:
        shape === undefined ? `error TS${code}: <message>` : shape.signature,
      specificity,
      captures,
    }

    const ceiling =
      form === 'editor'
        ? 'low'
        : form === 'bare'
          ? specificity === 'generic'
            ? 'low'
            : 'medium'
          : specificity === 'generic'
            ? 'medium'
            : undefined

    if (ceiling !== undefined) {
      ruleMatch.confidenceCeiling = ceiling
    }

    return ruleMatch
  },
  explain(match: RuleMatch, context: RuleContext): RuleNarrative {
    const [code, shape] = match.captures.reason.split(':')
    const message = match.captures.detail
    const location = match.captures.where
    const reported =
      location === undefined
        ? `"${message}"`
        : `"${message}" at ${location}`
    const narrative = typeScriptNarrative(code, shape, message, reported)
    const errorLines = countTypeScriptErrorLines(context.errorText)
    const limitations = [...narrative.limitations]

    if (errorLines > 1) {
      limitations.push(
        `The paste contains ${errorLines} TypeScript error lines, so this result covers one of them and the compiler may report further problems once it is resolved.`,
      )
    }
    limitations.push(
      'The engine reads only the text you pasted; it cannot open the file named in the message or run the compiler.',
    )

    return { ...narrative, limitations }
  },
}

function npmNarrative(
  shape: string,
  code: string,
  reported: string,
  errorText: string,
): RuleNarrative {
  if (shape === 'resolve') {
    const peer = NPM_PEER_LINE.exec(errorText)
    const found = NPM_FOUND_LINE.exec(errorText)
    const likelyCause = peer
      ? `npm could not build a single dependency tree: ${reported}. ${peer[3]}@${peer[4]} asks for ${peer[1]} "${peer[2]}", and ${
          found
            ? `${found[1]}@${found[2]} is what the tree already has`
            : 'the version already in the tree does not satisfy that range'
        }. Two packages that need incompatible versions of the same peer dependency stop the install before anything is written.`
      : `npm could not build a single dependency tree: ${reported}. Two packages in the install ask for incompatible versions of the same peer dependency, and npm refuses to choose one silently.`
    const peerName = peer ? peer[1] : '<peer-package>'

    return {
      likelyCause,
      debuggingSteps: [
        'Read the lines between "Could not resolve dependency" and "Conflicting peer dependency": they name the package that wants which version.',
        `Run npm ls ${peerName} to see the version you have and every package that depends on it.`,
        'Check whether a newer release of the package that wants the older peer supports the version you already use.',
        'If it does not, decide which side you can move: the shared dependency, the package that constrains it, or the range in your own package.json.',
      ],
      possibleFix: {
        explanation: `Work out which package owns the conflict first: run npm ls ${peerName}, read the peer range quoted in the message, then upgrade the package that wants the older peer or replace it with one that supports the version you have. npm also offers --legacy-peer-deps and --force; treat those as informed last resorts rather than fixes, because they install a tree the packages declared incompatible, which can fail at runtime and hides the mismatch from every later install.`,
        whereItMayApply:
          'Apply it to the package that declares the incompatible peer range, or to the shared dependency in your own package.json; the block npm prints is a report, not the place to change.',
        exampleCode: [
          `npm ls ${peerName}`,
          'npm view <package> peerDependencies',
          'npm install <package>@<version-that-supports-your-peer>',
          '',
          '# Only as a last resort, and not a fix: accept the tree npm refused',
          'npm install --legacy-peer-deps',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun npm install and check the ERESOLVE block is gone.',
        `Run npm ls ${peerName} again and confirm one version is installed where you expected it.`,
        'Run the app or the test suite, because a forced tree can still break at runtime.',
      ],
      limitations: [
        'The block names one conflict between two packages; a longer install can report several.',
        'The engine cannot see the whole dependency tree, so it cannot say which side is safer to move.',
      ],
      alternativeExplanations: [
        'A lockfile pins the older version while package.json asks for the newer one.',
        'A transitive dependency, not the package you installed, declares the older range.',
        'Two package managers were used in the same folder and left trees that disagree.',
        'The package you want has a newer release that already widened the peer range.',
      ],
    }
  }

  if (shape === 'registry-404') {
    return {
      likelyCause: `The registry did not have what npm asked for: ${reported}. A 404 from the registry means the name, the scope, or the registry the request went to is not the one that holds the package; a missing version is reported as ETARGET instead.`,
      debuggingSteps: [
        'Check the spelling and the letter case of the package name in the command and in package.json.',
        'For a scoped package, check the scope and whether it is a private organisation package.',
        'Ask the registry for the package directly with npm view <package-name>.',
        'Run npm config get registry and compare it with the URL in the failed request.',
        'If the registry is private, check that authentication for it is configured and still valid.',
      ],
      possibleFix: {
        explanation:
          'Give npm the name and the registry that really hold the package: correct the spelling or the scope, and when the package is private point npm at the right registry and configure its authentication in .npmrc or an environment variable. A registry that requires a token can answer 404 rather than 401, so an unauthenticated private registry looks the same as a missing package.',
        whereItMayApply:
          'Apply it to the package name in the command or in package.json, and to the registry settings npm reads; the request quoted in the message is the one that failed.',
        exampleCode: [
          '# Windows (PowerShell)',
          'npm view <package-name>',
          'npm config get registry',
          'Get-Content .npmrc',
          '',
          '# macOS or Linux',
          'npm view <package-name>',
          'npm config get registry',
          'cat .npmrc',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the install and check the request returns package metadata instead of 404.',
        'Confirm npm config get registry still shows the registry you meant.',
        'If you added credentials, check a plain install of another public package still works.',
      ],
      limitations: [
        'The message shows the request the registry rejected, not why the name is missing there.',
        'A private registry can answer 404 for a package you are not allowed to see.',
      ],
      alternativeExplanations: [
        'The package was unpublished or renamed.',
        'The scope belongs to an organisation whose registry you are not logged into.',
        'A mirror or cache has not synced the package yet.',
        'The name is correct but the project has a different registry configured.',
      ],
    }
  }

  if (shape === 'no-target') {
    return {
      likelyCause: `npm asked for a version of a package that the registry does not publish: ${reported}. The name resolved but the version or range after it matched nothing, so the version is the part to check rather than the package.`,
      debuggingSteps: [
        'Run npm view <package-name> versions and compare the list with the version in the message.',
        'Check the version string for a typo, a trailing tag, or a pre-release that is not published.',
        'Run npm view <package-name> dist-tags if the install asked for a tag such as latest or next.',
        'Check whether the registry you use mirrors every version of that package.',
      ],
      possibleFix: {
        explanation:
          'Install a version the registry really publishes, or correct the range in package.json. A pre-release needs the exact version, or a tag that points at one; a caret range such as ^2.9.9 only resolves when a 2.x version exists.',
        whereItMayApply:
          'Apply it to the version or range in the command or in package.json; when a dependency asks for the impossible version, the change belongs to the package that declares it.',
        exampleCode: [
          '# Windows (PowerShell) and macOS or Linux, same commands',
          'npm view <package-name> versions',
          'npm view <package-name> dist-tags',
          'npm install <package-name>@<published-version>',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the install and check ETARGET is gone.',
        'Confirm package.json now records a version that the registry lists.',
        'Run npm ls <package-name> to see the version that ended up installed.',
      ],
      limitations: [
        'The message names the request, not the versions the registry offers.',
        'The impossible range may come from a dependency rather than from your own package.json.',
      ],
      alternativeExplanations: [
        'The version was never published, or was unpublished again.',
        'A pre-release version exists but ranges do not match pre-releases unless asked.',
        'The registry mirror is behind the public registry.',
        'A tag such as next was removed after the version was requested.',
      ],
    }
  }

  if (shape === 'missing-path') {
    const wantsPackageJson = /package\.json/i.test(errorText)

    return {
      likelyCause: wantsPackageJson
        ? `npm could not find package.json where it looked: ${reported}. npm reads that file in the current folder and then walks up, so the usual cause is running the command outside the project root rather than a broken install.`
        : `npm could not find a file or folder it expected: ${reported}. The path was not there when npm tried to open it, so the current folder, the path in your command, or the folder npm wanted is what needs checking.`,
      debuggingSteps: wantsPackageJson
        ? [
            'Check the folder you ran the command from and compare it with the folder that holds package.json.',
            'Run the command from the project root, the folder that contains package.json.',
            'Look for a nested copy: a repository root without package.json beside a project folder that has it.',
            'Use npm init only when you are starting a new project; it does not restore the file of an existing one.',
          ]
        : [
            'Check the folder you ran the command from and compare it with the path in the message.',
            'Confirm the path npm named exists and is readable.',
            'Check the command for a path that no longer matches the folder layout.',
            'Look for a deleted or moved folder, or a checkout that never fetched the file.',
          ],
      possibleFix: {
        explanation: wantsPackageJson
          ? 'Change into the folder that holds package.json and run npm from there, because npm looks in the current folder and its parents. A working copy opened one folder too deep, or a clone that put the project inside another folder, produces exactly this error.'
          : 'Point npm at the folder or file it asked for: check the current directory, the path in the command, and whether the path exists at all. The line npm prints quotes the path it tried to open.',
        whereItMayApply:
          'Apply it to where you run the command and to the path npm quoted; the package itself is not involved in this failure.',
        exampleCode: wantsPackageJson
          ? [
              '# Windows (PowerShell)',
              'cd <path-to-your-project>',
              'Get-ChildItem package.json',
              '',
              '# macOS or Linux',
              'cd <path/to/your/project>',
              'ls package.json',
            ].join('\n')
          : [
              '# Windows (PowerShell)',
              'cd <folder-that-holds-the-file>',
              'Get-ChildItem',
              '',
              '# macOS or Linux',
              'cd <folder-that-holds-the-file>',
              'ls',
            ].join('\n'),
      },
      verificationSteps: wantsPackageJson
        ? [
            'Rerun the command from the folder that holds package.json and check ENOENT is gone.',
            'Confirm the file is listed by the command above before installing again.',
            'Check package.json is still the one your project expects rather than a new empty file.',
          ]
        : [
            'Rerun the command with the corrected path and check ENOENT is gone.',
            'Confirm the file or folder now appears where npm expected it.',
            'Repeat the original install or script to see whether a different line follows.',
          ],
      limitations: [
        'The message quotes the path npm tried to open, not the folder you were in or the reason it is missing.',
        'The same code covers any missing path, so the wording stays general.',
      ],
      alternativeExplanations: [
        'The command was run from a parent or sibling folder of the project.',
        'The repository was cloned without that file, or it was deleted.',
        'A script changes the working directory before calling npm.',
        'The path names a file a previous failed install removed.',
      ],
    }
  }

  if (shape === 'permissions') {
    const isLocked = code === 'EPERM'

    return {
      likelyCause: isLocked
        ? `npm could not change a file it needed to replace: ${reported}. On Windows that usually means another program still holds the file, for example a running dev server, an editor, or a scanner looking at the folder, and it can also mean the folder is one your account is not allowed to write to.`
        : `npm could not write to the folder it targeted: ${reported}. The path is a location your user is not allowed to modify, which is what happens when npm installs into a system-wide folder.`,
      debuggingSteps: [
        'Note the path in the message and check whether it belongs to your user or to a system-wide folder.',
        isLocked
          ? 'Close anything that holds the folder open: a dev server, an editor, a test watcher, or a terminal sitting inside it.'
          : 'Run npm config get prefix and check that the folder npm writes to belongs to your account.',
        'Check the folder ownership and permissions rather than the package you were installing.',
        'Do not reach for elevated rights: npm writes files that your ordinary user then cannot update, and the next install fails in a new place.',
      ],
      possibleFix: {
        explanation:
          'Stop writing to a folder your user does not own: set a user-level prefix with npm config set prefix, or install Node through a version manager so the global folder belongs to you, or have the ownership of that folder corrected so your account can write to it. On Windows, release the locked file by closing the program that holds it and run the install again.',
        whereItMayApply:
          'Apply it to the folder named in the message and to how Node and npm are installed for your user; the package being installed is usually not the problem.',
        exampleCode: [
          '# Windows (PowerShell): install into a folder your account owns',
          'npm config get prefix',
          'npm config set prefix %USERPROFILE%\\AppData\\Roaming\\npm',
          '',
          '# macOS or Linux: use a version manager so the global folder is yours',
          'nvm install --lts',
          'npm config get prefix',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the install and check the EACCES or EPERM line is gone.',
        'Run npm config get prefix and confirm the folder is one your account owns.',
        'Start the app or the script again, since a file that was locked may have been released by a different change.',
      ],
      limitations: [
        'The message names the path npm could not write, not who owns it or which program holds it.',
        'Windows reports a locked file and a permission problem with the same shape, so the two look alike here.',
      ],
      alternativeExplanations: [
        'The folder was created earlier by another user or an elevated run, so ownership does not match.',
        'A running dev server, editor, backup, or scanner still has the file open.',
        'The install targets a protected system location.',
        'The disk or folder settings block writes for this account.',
      ],
    }
  }

  if (shape === 'network') {
    return {
      likelyCause: `npm could not reach the registry for this request: ${reported}. The request never completed, so the failure is in the connection, the address, or the proxy in front of npm rather than in the package it was fetching.`,
      debuggingSteps: [
        'Read the reason at the end of the line: ENOTFOUND is a host that did not resolve, ETIMEDOUT and ECONNRESET are connections that stalled or dropped.',
        'Run npm config get registry and compare it with the URL in the failed request.',
        'Check whether a proxy or VPN is in the path, including HTTP_PROXY, HTTPS_PROXY, and npm config get proxy.',
        'Retry the same command on a connection you know works to see whether the failure is intermittent.',
      ],
      possibleFix: {
        explanation:
          'Give npm a route it can actually use: confirm the registry URL, configure the proxy your network requires in npm settings, or retry when the failure comes and goes. A browser working does not prove npm can connect, because npm does not read the browser proxy settings; it uses its own configuration.',
        whereItMayApply:
          'Apply it to the network and npm configuration of the machine running the install, not to the code of the package being installed.',
        exampleCode: [
          'npm config get registry',
          'npm config get proxy',
          'npm config get https-proxy',
          'npm install <package-name> --fetch-retries 3',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the install and check the request completes instead of failing.',
        'Compare npm config get registry with the host in the message.',
        'If you set a proxy, confirm a plain install still works when you are off that network.',
      ],
      limitations: [
        'The message shows one failed request, not whether the rest of the install can reach the registry.',
        'npm wraps the operating system error in its own code, so the reason text is the useful part.',
      ],
      alternativeExplanations: [
        'DNS does not resolve the registry host on this network.',
        'A proxy or firewall terminates the connection.',
        'The registry URL was changed in .npmrc or by an environment variable.',
        'The registry itself was temporarily unavailable.',
      ],
    }
  }

  if (shape === 'lifecycle') {
    const script = NPM_SCRIPT_LINE.exec(errorText)?.[1]
    const scriptName = script ?? '<script-name>'

    return {
      likelyCause: `${
        script
          ? `The npm script "${script}" exited with an error`
          : 'A script that npm ran exited with an error'
      }: ${reported}. This line is a trailer, so the message that explains the failure is printed above these lines and the exit code alone does not say what went wrong.`,
      debuggingSteps: [
        'Scroll above these lines and read the first error the script itself printed.',
        `Run the script on its own with npm run ${scriptName} and watch its output without the install noise around it.`,
        'If the script wraps a compiler or a test command, run that command directly to get the same failure in one place.',
        'Check the folder and the Node version the script is expected to run with.',
      ],
      possibleFix: {
        explanation: `Run the script on its own and read what it prints: npm run ${scriptName}. The lifecycle line only says the child command exited with a non-zero code, so the real error is the first message above it, and fixing that message is what makes this trailer disappear.`,
        whereItMayApply:
          'Apply it to the script named in the message and to the command it runs; changing how npm is invoked only changes the wrapper around the failure.',
        exampleCode: [
          '# Windows (PowerShell) and macOS or Linux, same commands',
          `npm run ${scriptName}`,
          '',
          '# Or run the command the script wraps, without npm adding its trailer',
          '<command-from-the-script>',
        ].join('\n'),
      },
      verificationSteps: [
        `Rerun npm run ${scriptName} and read the first error before changing anything else.`,
        'After one focused change, check the script exits without a lifecycle failure.',
        'Rerun the full command that failed, such as npm install, to confirm nothing else was hiding behind it.',
      ],
      limitations: [
        'This line is a trailer; the reason for the failure sits above it and may not be in the paste.',
        'The exit code says the script failed but not where, and every script reports the same code.',
      ],
      alternativeExplanations: [
        'The script runs a compiler or test command that reported its own error above these lines.',
        'A command or dependency the script calls is missing on this machine.',
        'The script runs in a different folder than the one npm was started from.',
        'A permission or network failure inside the script is reported separately above.',
      ],
    }
  }

  return {
    likelyCause: `npm reported the error code ${code}: ${reported}. This engine does not have a specific rule for ${code}, so it repeats the line npm printed rather than guessing a cause.`,
    debuggingSteps: [
      'Read the lines npm printed above and below this one; the detail of the failure is normally there.',
      'Look the code up in the npm error documentation to read what npm means by it.',
      'Open the log file npm names at the end of the block for the full output of the run.',
      'Note the npm and Node versions, since the same failure is reported under different codes across major versions.',
    ],
    possibleFix: {
      explanation:
        `Rerun the same command with the full output kept, then read the npm documentation entry for ${code}. This engine has no rule for that code, so it does not suggest a change; the lines npm printed beside it are where the fix starts.`,
      whereItMayApply:
        'Apply it to the command that produced the line and to the log file npm points at; the package being installed is named in the output, not by this engine.',
      exampleCode: [
        '# Windows (PowerShell) and macOS or Linux, same commands',
        'npm <your-command> --loglevel verbose',
        '',
        '# npm names the log file at the end of the error block',
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the command and check whether a more specific npm line appears.',
      'Compare the new output with the code in the message before changing anything.',
      'If the code repeats, read that code in the npm documentation rather than retrying.',
    ],
    limitations: [
      `There is no specific rule for ${code} here, so nothing beyond the pasted line is inferred.`,
      'npm reuses some codes for several different failures.',
    ],
    alternativeExplanations: [
      'The real failure is printed above the code line.',
      'The code comes from the operating system rather than from npm itself.',
      'A different npm version would report the same problem under another code.',
    ],
  }
}

export const javascriptNpmErrorRule: DiagnosticRule = {
  id: 'javascript.npm-error',
  language: 'javascript',
  category: 'npm-error',
  firstMatchWins: true,
  contextSymptoms: [NPM_LOG_SYMPTOM, NPM_LOG_FILE_SYMPTOM],
  match(line: string): RuleMatch | null {
    const entry = NPM_LOG_LINE.exec(line)
    if (entry === null) {
      return null
    }

    const prefix = entry[1] === 'ERR!' ? 'npm ERR!' : 'npm error'
    const rest = entry[2].trimEnd()

    let shape = ''
    let signature = ''
    let code = ''
    let specificity: RuleMatch['specificity'] = 'specific'
    let ceiling: RuleMatch['confidenceCeiling']
    let packageName: string | undefined

    const codeLine = NPM_CODE_LINE.exec(rest)
    const conflictingPeer = /^Conflicting peer dependency: (\S+?)@(\S+)$/.exec(
      rest,
    )
    const notFound = /^404 Not Found - GET (\S+)/.exec(rest)
    const notInRegistry = /^404\s+'([^']*)' is not in this registry\.$/.exec(rest)
    const noVersion =
      /^notarget No matching version found for (\S+?)@(\S+?)\.?$/.exec(rest)
    const readPackageJson =
      /^(?:enoent\b.*)?Could not read package\.json/.exec(rest)
    const networkRequest =
      /^network request to (\S+) failed, reason: (.+)$/.exec(rest)
    const lifecycleScript =
      /^Failed at the (?:\S+@\S+\s+)?(\S+) script\.$/.exec(rest)
    const errnoLine = /^errno\s+(-?\d+)$/.exec(rest)

    if (codeLine) {
      code = codeLine[1]
      shape = 'unknown-code'
      signature = `${prefix} code <error code>`
      specificity = 'generic'
      ceiling = 'low'

      if (code === 'ERESOLVE') {
        shape = 'resolve'
        signature = `${prefix} code ERESOLVE`
        specificity = 'specific'
        ceiling = undefined
      } else if (code === 'E404') {
        shape = 'registry-404'
        signature = `${prefix} code E404`
        specificity = 'specific'
        ceiling = undefined
      } else if (code === 'ETARGET') {
        shape = 'no-target'
        signature = `${prefix} code ETARGET`
        specificity = 'specific'
        ceiling = undefined
      } else if (code === 'ENOENT') {
        shape = 'missing-path'
        signature = `${prefix} code ENOENT`
        specificity = 'specific'
        ceiling = undefined
      } else if (code === 'EACCES' || code === 'EPERM') {
        shape = 'permissions'
        signature = `${prefix} code ${code}`
        specificity = 'specific'
        ceiling = undefined
      } else if (code === 'ELIFECYCLE') {
        shape = 'lifecycle'
        signature = `${prefix} code ELIFECYCLE`
        specificity = 'generic'
        ceiling = 'medium'
      } else if (NPM_NETWORK_CODES.has(code)) {
        shape = 'network'
        signature = `${prefix} code <network error code>`
        specificity = 'specific'
        ceiling = undefined
      }
    } else if (conflictingPeer) {
      shape = 'resolve'
      signature = `${prefix} Conflicting peer dependency: <package>@<version>`
      packageName = conflictingPeer[1]
    } else if (/^ERESOLVE unable to resolve dependency tree$/.test(rest)) {
      shape = 'resolve'
      signature = `${prefix} ERESOLVE unable to resolve dependency tree`
    } else if (/^Could not resolve dependency:?$/.test(rest)) {
      shape = 'resolve'
      signature = `${prefix} Could not resolve dependency:`
    } else if (notFound) {
      shape = 'registry-404'
      signature = `${prefix} 404 Not Found - GET <url>`
    } else if (notInRegistry) {
      shape = 'registry-404'
      signature = `${prefix} 404 '<package>' is not in this registry.`
      packageName = notInRegistry[1].split('@')[0]
    } else if (noVersion) {
      shape = 'no-target'
      signature = `${prefix} No matching version found for <package>@<version>.`
      packageName = noVersion[1]
    } else if (readPackageJson) {
      shape = 'missing-path'
      signature = `${prefix} Could not read package.json`
    } else if (networkRequest) {
      shape = 'network'
      signature = `${prefix} network request to <url> failed, reason: <reason>`
    } else if (lifecycleScript) {
      shape = 'lifecycle'
      signature = `${prefix} Failed at the <script> script.`
      specificity = 'generic'
      ceiling = 'medium'
    } else if (errnoLine) {
      shape = 'lifecycle'
      signature = `${prefix} errno <exit code>`
      specificity = 'generic'
      ceiling = 'low'
    } else {
      return null
    }

    const captures: Record<string, string> = {
      reason: `${shape}:${code}`,
      detail: rest,
    }
    if (packageName !== undefined && packageName.length >= 3) {
      captures.package = packageName
    }

    const ruleMatch: RuleMatch = { signature, specificity, captures }
    if (ceiling !== undefined) {
      ruleMatch.confidenceCeiling = ceiling
    }

    return ruleMatch
  },
  explain(match: RuleMatch, context: RuleContext): RuleNarrative {
    const [shape, code] = match.captures.reason.split(':')
    const narrative = npmNarrative(
      shape,
      code,
      `"${match.captures.detail}"`,
      context.errorText,
    )

    return {
      ...narrative,
      limitations: [
        ...narrative.limitations,
        'The engine reads only the lines you pasted; it cannot see the full npm log, package.json, or the installed tree.',
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
  javascriptTypeScriptErrorRule,
  javascriptNpmErrorRule,
]
