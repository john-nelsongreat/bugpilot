import type { DiagnosticRule, RuleMatch, RuleNarrative } from '../types'

const MODULE_NOT_FOUND =
  /^ModuleNotFoundError:\s+No module named\s+(['"])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\1/

const IMPORT_ERROR = /^ImportError:\s+(.+)$/
const CANNOT_IMPORT =
  /^ImportError:\s+cannot import name\s+(['"])([A-Za-z_]\w*)\1\s+from\s+(['"])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\3/
const RELATIVE_IMPORT = /^ImportError:\s+attempted relative import with no known parent package/

const NAME_ERROR = /^NameError:\s+(.+)$/
const NAMED_ERROR =
  /^NameError:\s+name\s+(['"])([A-Za-z_]\w*)\1\s+is not defined/

const TYPE_ERROR = /^TypeError:\s+(.+)$/
const JAVASCRIPT_TYPE_ERROR =
  /(?:Cannot read propert|Cannot set propert|is not a function|Assignment to constant variable|Cannot convert undefined or null|Cannot destructure)/i
const PYTHON_TYPE_ERROR =
  /(?:unsupported operand type|can only concatenate|object is not (?:subscriptable|callable|iterable)|required positional argument|takes \d+ positional arguments?|object of type .+ has no len|not supported between instances of|unexpected keyword argument)/i

const ATTRIBUTE_ERROR = /^AttributeError:\s+(.+)$/
const OBJECT_ATTRIBUTE =
  /^AttributeError:\s+'([A-Za-z_][\w.]*)' object has no attribute '([A-Za-z_]\w*)'/
const MODULE_ATTRIBUTE =
  /^AttributeError:\s+module '([A-Za-z_][\w.]*)' has no attribute '([A-Za-z_]\w*)'/

const KEY_ERROR = /^KeyError:\s+(.+)$/
const QUOTED_KEY = /^KeyError:\s+(['"])(.{1,120}?)\1\s*$/

const INDEX_ERROR = /^IndexError:\s+(.+)$/
const KNOWN_INDEX_ERROR =
  /(?:list|string|tuple|range) index out of range|index .+ is out of bounds|too many indices/i

const FILE_NOT_FOUND =
  /^FileNotFoundError:\s+.*No such file or directory\s*:?\s*(['"])([^'"]{1,300})\1/i
const FILE_NOT_FOUND_GENERIC = /^FileNotFoundError:\s+(.+)$/

const PERMISSION_ERROR =
  /^PermissionError:\s+.*Permission denied\s*:?\s*(['"])([^'"]{1,300})\1/i
const PERMISSION_ERROR_GENERIC = /^PermissionError:\s+(.+)$/

const SYNTAX_ERROR = /^SyntaxError:\s+(.+)$/
const JAVASCRIPT_SYNTAX_ERROR =
  /(?:Unexpected token|Unexpected end of JSON input|Invalid or unexpected token|missing \S+ after argument list|Cannot use import statement outside a module|Unexpected identifier|Invalid left-hand side in assignment)/i
const PYTHON_SYNTAX_ERROR =
  /(?:invalid syntax|expected\s+':'|was never closed|unmatched\s+'\)'|unterminated string literal|invalid decimal literal|EOL while scanning string literal|missing parentheses in call)/i

const INDENTATION_ERROR = /^IndentationError:\s+(.+)$/
const KNOWN_INDENTATION_ERROR =
  /(?:unexpected indent|expected an indented block|unindent does not match any outer indentation level|too many levels of indentation)/i

const ZERO_DIVISION_ERROR =
  /^ZeroDivisionError:\s+(division by zero|integer division or modulo by zero|float division by zero|float modulo|integer modulo by zero)$/

const VALUE_ERROR = /^ValueError:\s+(.+)$/
const INVALID_INT_LITERAL =
  /^invalid literal for int\(\) with base (\d+):\s+(['"])(.*)\2$/
const INVALID_FLOAT_LITERAL =
  /^could not convert string to float:\s+(['"])(.*)\1$/
const NOT_ENOUGH_VALUES =
  /^not enough values to unpack \(expected (\d+), got (\d+)\)$/
const TOO_MANY_VALUES = /^too many values to unpack \(expected (\d+)\)$/
const MATH_DOMAIN_ERROR = /^math domain error$/
const VALUE_NOT_IN_LIST = /^(['"])(.+?)\1 is not in list$/

const RECURSION_ERROR =
  /^RecursionError:\s+maximum recursion depth exceeded(?:\s+(while calling a Python object|in comparison))?$/

const UNICODE_ERROR =
  /^Unicode(Decode|Encode)Error:\s+'([^']+)' codec can't (?:decode|encode) (?:byte|bytes|character|characters)\b.*$/

const JSON_DECODE_ERROR =
  /^(?:(?:json(?:\.decoder)?|requests\.exceptions)\.)?JSONDecodeError:\s+(Expecting value|Expecting property name enclosed in double quotes|Extra data|Unterminated string(?: starting at)?|Invalid control character(?: at)?)(?::\s*line \d+ column \d+ \(char \d+\))?\s*$/

export const pythonModuleNotFoundErrorRule: DiagnosticRule = {
  id: 'python.module-not-found',
  language: 'python',
  category: 'missing-module',
  match(line: string): RuleMatch | null {
    const matched = MODULE_NOT_FOUND.exec(line)
    if (!matched) {
      return null
    }

    const moduleName = matched[2]
    return {
      signature: "ModuleNotFoundError: No module named '<module>'",
      specificity: 'specific',
      captures: {
        module: moduleName,
        distribution: moduleName.split('.')[0],
      },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const moduleName = match.captures.module
    const distribution = match.captures.distribution

    return {
      likelyCause: `Python could not locate the module "${moduleName}". It may not be installed in the active interpreter, may be misspelled, or may not be on this environment's import path.`,
      debuggingSteps: [
        'Confirm which Python interpreter and environment run the failing command.',
        `Check that "${moduleName}" is the import name used by the installed package; distribution names can differ.`,
        'Check whether the dependency is present in that same environment before changing application code.',
        'Compare the environments used by your editor, test runner, and deployed app.',
      ],
      possibleFix: {
        explanation: `Install the distribution that provides "${moduleName}" in the failing environment, or correct the import if the module name is wrong.`,
        whereItMayApply:
          'Use this near the failing import only after confirming the package is expected and safe to add to this project.',
        exampleCode: [
          '# Confirm which Python environment runs the failing code.',
          'python -c "import sys; print(sys.executable)"',
          `# Install the package that provides "${moduleName}" (the distribution name may differ).`,
          `python -m pip install ${distribution}`,
          '# Check the exact import used by your code.',
          `python -c "import ${moduleName}"`,
        ].join('\n'),
      },
      verificationSteps: [
        'Run the import inside the same interpreter and environment that produced the error.',
        'Rerun the smallest failing command and check whether the final exception line changes.',
        'If the import works in one environment but not another, compare those environments.',
      ],
      limitations: [
        'A Python import name is not always the same as the package name installed from a registry.',
        'This engine cannot inspect installed packages, virtual environments, or project files.',
      ],
      alternativeExplanations: [
        'The module name in the import statement is misspelled.',
        'The package is installed for a different interpreter or virtual environment.',
        'A local module or configuration on the import path is shadowing the expected dependency.',
      ],
    }
  },
}

export const pythonImportErrorRule: DiagnosticRule = {
  id: 'python.import-error',
  language: 'python',
  category: 'import-failure',
  match(line: string): RuleMatch | null {
    const cannotImport = CANNOT_IMPORT.exec(line)
    if (cannotImport) {
      return {
        signature: "ImportError: cannot import name '<name>' from '<module>'",
        specificity: 'specific',
        captures: {
          name: cannotImport[2],
          module: cannotImport[4],
        },
      }
    }

    if (RELATIVE_IMPORT.test(line)) {
      return {
        signature:
          'ImportError: attempted relative import with no known parent package',
        specificity: 'specific',
        captures: { reason: 'relative-import' },
      }
    }

    const generic = IMPORT_ERROR.exec(line)
    if (!generic) {
      return null
    }

    return {
      signature: 'ImportError: <import failure>',
      specificity: 'generic',
      captures: { detail: generic[1] },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const importName = match.captures.name
    const moduleName = match.captures.module
    const isRelative = match.captures.reason === 'relative-import'
    const hasNamedImport = Boolean(importName && moduleName)

    let likelyCause =
      'Python reached an import statement but could not complete it. The final message does not include enough detail to identify one specific import problem.'
    if (hasNamedImport) {
      likelyCause = `Python found the module "${moduleName}" but could not import the name "${importName}" from it. The installed version may not expose that name, or the project may have a circular import.`
    } else if (isRelative) {
      likelyCause =
        'A relative import was used outside a package context. Python could not determine the package that the relative import belongs to.'
    }

    const exampleCode = hasNamedImport
      ? [
          '# Confirm this name is exported by the installed package version.',
          `from ${moduleName} import ${importName}`,
        ].join('\n')
      : isRelative
        ? [
            '# Run the file as part of its package from the project root.',
            'python -m package.module',
          ].join('\n')
        : [
            '# Compare the failing import with the names documented for the installed version.',
            'from package import expected_name',
          ].join('\n')

    return {
      likelyCause,
      debuggingSteps: [
        'Read the full traceback and identify the import statement that failed.',
        'Check the import name and the module name against the installed package version.',
        'Look for a circular import where two modules import each other at module load time.',
        'Check whether the command was run from a context where the package is discoverable.',
      ],
      possibleFix: {
        explanation: hasNamedImport
          ? `Confirm that "${importName}" actually exists in the installed version of "${moduleName}", then correct the import or update the dependency intentionally.`
          : isRelative
            ? 'Run the module as part of its package, or rewrite the relative import using the package-qualified module path.'
            : 'Adjust the import to match the installed package API, or update the dependency only after checking what the new version provides.',
        whereItMayApply:
          'Use this at the failing import site; do not change installed packages until you have confirmed which name or module path is incorrect.',
        exampleCode,
      },
      verificationSteps: [
        'Run the failing import in the same interpreter and environment.',
        'Rerun the smallest reproduction and check whether the ImportError is replaced by a different result.',
        'Exercise the code path that uses the imported name, not just the import statement.',
      ],
      limitations: [
        'The final message alone may not show the full import chain or the installed package version.',
        'This engine cannot inspect package exports, dependency versions, or circular imports.',
      ],
      alternativeExplanations: [
        'The name was moved or renamed in a newer or older package version.',
        'A circular import prevents the name from being available at that point.',
        'The module was imported from a different package than intended.',
      ],
    }
  },
}

export const pythonNameErrorRule: DiagnosticRule = {
  id: 'python.name-error',
  language: 'python',
  category: 'undefined-name',
  match(line: string): RuleMatch | null {
    const named = NAMED_ERROR.exec(line)
    if (named) {
      return {
        signature: "NameError: name '<name>' is not defined",
        specificity: 'specific',
        captures: { name: named[2] },
      }
    }

    const generic = NAME_ERROR.exec(line)
    if (!generic) {
      return null
    }

    return {
      signature: 'NameError: <undefined name>',
      specificity: 'generic',
      captures: { detail: generic[1] },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const name = match.captures.name
    const namedCause = name
      ? `Python reached a use of "${name}" before that name was defined in the current scope. The name may be misspelled, missing an import, or used before assignment.`
      : 'Python reached a name that is not defined in the current scope. The final message does not identify a single assignment or import to inspect.'

    return {
      likelyCause: namedCause,
      debuggingSteps: [
        'Locate the first line in the traceback that points to your own code.',
        'Check whether the name is assigned, imported, or passed into that scope before it is used.',
        'Look for a spelling mismatch or a name that is only defined in a different function or module.',
        'Check the execution order when the name is created conditionally or after the failing line.',
      ],
      possibleFix: {
        explanation: name
          ? `Define or import "${name}" before the failing use, or correct the name if it was a typo.`
          : 'Define or import the missing name before the code that uses it, or correct the spelling if it was a typo.',
        whereItMayApply:
          'Apply this at the first use of the name in the failing scope; avoid creating an unrelated global as a workaround.',
        exampleCode: [
          '# Define the value, or import the name, before this line runs.',
          `${name ?? 'value'} = 0`,
          `print(${name ?? 'value'})`,
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the failing code path with the same input.',
        'Confirm the NameError is gone and the value has the type the code expects.',
        'Check any other branch that can run before the name is assigned.',
      ],
      limitations: [
        'The exception line alone does not reveal whether the cause is a typo, scope, import, or control-flow problem.',
        'This engine does not inspect the surrounding Python source or its execution order.',
      ],
      alternativeExplanations: [
        'The name is a typo for a nearby variable or function.',
        'The name exists in another module or function but was not imported or passed into this scope.',
        'The assignment is conditional and did not run on this path.',
      ],
    }
  },
}

export const pythonTypeErrorRule: DiagnosticRule = {
  id: 'python.type-error',
  language: 'python',
  category: 'type-mismatch',
  match(line: string): RuleMatch | null {
    const matched = TYPE_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const detail = matched[1]
    if (JAVASCRIPT_TYPE_ERROR.test(detail)) {
      return null
    }

    return {
      signature: PYTHON_TYPE_ERROR.test(detail)
        ? 'TypeError: <Python type mismatch>'
        : 'TypeError: <unclassified type problem>',
      specificity: PYTHON_TYPE_ERROR.test(detail) ? 'specific' : 'generic',
      captures: { detail },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'Python performed an operation with a value whose type does not support that operation, or called a function with an incompatible argument.',
      debuggingSteps: [
        'Read the final TypeError message to identify the operation and the types involved.',
        'Find the operand or argument on the line in your traceback that produced the error.',
        'Check where that value was created; it may be None, text where a number was expected, or a different object than intended.',
        'Reduce the operation to a small example with the same value types before changing the wider code.',
      ],
      possibleFix: {
        explanation:
          'Validate or convert the value before the failing operation, or change the operation to one that supports the value types involved.',
        whereItMayApply:
          'Apply this where the failing value enters the operation; avoid broad type silencing because it can hide the real cause.',
        exampleCode: [
          '# Convert or validate before the operation that failed.',
          'text = "12"',
          'number = int(text)',
          'result = number + 1',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the smallest reproduction with the same values.',
        'Check both the expected case and the boundary value that caused the mismatch.',
        'Confirm no unrelated values are being converted unintentionally.',
      ],
      limitations: [
        'The rule recognises a Python TypeError shape but does not inspect runtime values or the surrounding source.',
        'The example conversion is illustrative; the correct fix depends on the actual expected types.',
      ],
      alternativeExplanations: [
        'A function received positional arguments in the wrong order.',
        'A value that should contain data is None or an unexpected type.',
        'A dependency changed the argument or return shape expected by this code.',
      ],
    }
  },
}

export const pythonAttributeErrorRule: DiagnosticRule = {
  id: 'python.attribute-error',
  language: 'python',
  category: 'missing-attribute',
  match(line: string): RuleMatch | null {
    const objectAttribute = OBJECT_ATTRIBUTE.exec(line)
    if (objectAttribute) {
      return {
        signature: "AttributeError: object has no attribute '<attribute>'",
        specificity: 'specific',
        captures: {
          objectType: objectAttribute[1],
          attribute: objectAttribute[2],
        },
      }
    }

    const moduleAttribute = MODULE_ATTRIBUTE.exec(line)
    if (moduleAttribute) {
      return {
        signature: "AttributeError: module has no attribute '<attribute>'",
        specificity: 'specific',
        captures: {
          module: moduleAttribute[1],
          attribute: moduleAttribute[2],
        },
      }
    }

    const generic = ATTRIBUTE_ERROR.exec(line)
    if (!generic) {
      return null
    }

    return {
      signature: 'AttributeError: <missing attribute>',
      specificity: 'generic',
      captures: { detail: generic[1] },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const attribute = match.captures.attribute
    const objectType = match.captures.objectType
    const moduleName = match.captures.module
    let likelyCause =
      'An object did not have the attribute that the code accessed. The object may be a different type than expected, or the attribute may not exist in this version.'
    if (attribute && objectType) {
      likelyCause = `Python received a value of type "${objectType}" but the code tried to access "${attribute}". The value may be None, the wrong type, or from an API version that does not provide that attribute.`
    } else if (attribute && moduleName) {
      likelyCause = `The module "${moduleName}" does not expose "${attribute}" in the version that was imported. The name may be misspelled, moved, or missing from this dependency version.`
    }

    return {
      likelyCause,
      debuggingSteps: [
        'Find the attribute access in the traceback and identify the object on its left.',
        'Check the object type and whether the attribute is documented for that type.',
        'Look for a value that is None or an object returned by a different API than expected.',
        'Check the dependency version if the attribute recently moved or was renamed.',
      ],
      possibleFix: {
        explanation: attribute
          ? `Check the object's type and provide the expected value, or use an attribute that the installed version actually exposes. If "${attribute}" is optional, guard the access explicitly.`
          : 'Check the object type and the documented attributes for that type, then correct the value or access.',
        whereItMayApply:
          'Apply this at the failing attribute access; do not add a broad fallback that hides a genuinely wrong object type.',
        exampleCode: [
          '# Only use an optional attribute after checking the object and the attribute.',
          'value = get_value()',
          attribute ? `if value is not None and hasattr(value, "${attribute}"):` : 'if value is not None:',
          attribute ? `    print(value.${attribute})` : '    print(value)',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the failing path with the value that caused the error.',
        'Check that the guarded branch behaves correctly when the attribute is present and absent.',
        'Check any other call sites that assume the same object type.',
      ],
      limitations: [
        'The final message does not show how the object was created or whether the attribute exists in another version.',
        'This engine does not inspect the Python object model or installed dependency versions.',
      ],
      alternativeExplanations: [
        'The value is None because an earlier lookup or request returned nothing.',
        'The object is a different type than the surrounding code assumes.',
        'The dependency version no longer exposes the same API.',
      ],
    }
  },
}

export const pythonKeyErrorRule: DiagnosticRule = {
  id: 'python.key-error',
  language: 'python',
  category: 'missing-key',
  match(line: string): RuleMatch | null {
    const quoted = QUOTED_KEY.exec(line)
    if (quoted) {
      return {
        signature: 'KeyError: <missing key>',
        specificity: 'specific',
        captures: { key: quoted[2] },
      }
    }

    const generic = KEY_ERROR.exec(line)
    if (!generic) {
      return null
    }

    return {
      signature: 'KeyError: <missing dictionary key>',
      specificity: 'generic',
      captures: { detail: generic[1] },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const key = match.captures.key
    const cause = key
      ? `A dictionary, mapping, or mapping-like object did not contain the key "${key}" when the code looked it up.`
      : 'A dictionary or mapping lookup used a key that was not present. The final message does not identify the key or mapping.'

    return {
      likelyCause: cause,
      debuggingSteps: [
        'Find the dictionary lookup in the traceback and identify the key being requested.',
        'Inspect which keys are actually present at that point, including whether the mapping came from an API or file.',
        'Check whether the key name is misspelled or uses a different case than the data.',
        'Decide whether a missing key is an expected case that needs a fallback or an unexpected state that should fail clearly.',
      ],
      possibleFix: {
        explanation:
          'Use a checked lookup or an explicit fallback when a missing key is expected; otherwise validate the input and fail with a clearer message instead of masking the missing data.',
        whereItMayApply:
          'Apply this at the mapping lookup; do not use a silent default if the key is required for correct behavior.',
        exampleCode: [
          'settings = {"timeout": 30}',
          'timeout = settings.get("timeout")',
          'if timeout is None:',
          '    raise ValueError("A required setting is missing")',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the failing path with the original data and key.',
        'Check the expected-missing and unexpected-missing cases separately.',
        'Confirm that a fallback value is appropriate for the code that consumes it.',
      ],
      limitations: [
        'The exception line does not show whether the key was absent by design or because upstream data changed.',
        'This engine cannot inspect the mapping contents at runtime.',
      ],
      alternativeExplanations: [
        'The key name is misspelled or has different casing.',
        'The mapping is populated from a different data shape or is still empty.',
        'A required configuration value or upstream field was not provided.',
      ],
    }
  },
}

export const pythonIndexErrorRule: DiagnosticRule = {
  id: 'python.index-error',
  language: 'python',
  category: 'index-out-of-range',
  match(line: string): RuleMatch | null {
    const matched = INDEX_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const detail = matched[1]
    return {
      signature: INDEX_OUT_OF_RANGE_SIGNATURE,
      specificity: KNOWN_INDEX_ERROR.test(detail) ? 'specific' : 'generic',
      captures: { detail },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'Python tried to access a sequence position that does not exist. The sequence may be empty, shorter than expected, or the index may be off by one.',
      debuggingSteps: [
        'Find the indexing or slicing operation in the traceback and identify the sequence.',
        'Check the sequence length and the index value at the point of failure.',
        'Check whether the sequence is empty and whether the index comes from a loop bound, user input, or another calculation.',
        'Review boundary cases such as the first and last valid positions.',
      ],
      possibleFix: {
        explanation:
          'Check the sequence length before indexing, or correct the index calculation so it stays inside the valid range.',
        whereItMayApply:
          'Apply this at the indexing site; choose an explicit empty-input behavior instead of adding an arbitrary fallback.',
        exampleCode: [
          '# Guard the access when the sequence may be empty or short.',
          'items = ["first"]',
          'if items:',
          '    first = items[0]',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the failing path with an empty sequence.',
        'Test the first, last, and just-past-the-end positions.',
        'Confirm the code still behaves correctly when the sequence has more items.',
      ],
      limitations: [
        'The exception message usually does not include the actual index or sequence length.',
        'This engine does not inspect the data or loop bounds that produced the index.',
      ],
      alternativeExplanations: [
        'The sequence is empty because an earlier operation returned no results.',
        'A loop or slice uses an off-by-one index.',
        'The wrong sequence or record was selected.',
      ],
    }
  },
}

const INDEX_OUT_OF_RANGE_SIGNATURE = 'IndexError: sequence index out of range'

export const pythonFileNotFoundErrorRule: DiagnosticRule = {
  id: 'python.file-not-found',
  language: 'python',
  category: 'missing-file',
  match(line: string): RuleMatch | null {
    const matched = FILE_NOT_FOUND.exec(line)
    if (matched) {
      return {
        signature: 'FileNotFoundError: No such file or directory',
        specificity: 'specific',
        captures: { path: matched[2] },
      }
    }

    if (!FILE_NOT_FOUND_GENERIC.test(line)) {
      return null
    }

    return {
      signature: 'FileNotFoundError: <missing file>',
      specificity: 'generic',
      captures: {},
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const path = match.captures.path
    const cause = path
      ? `Python could not find the path "${path}". The path may be relative to a different working directory, misspelled, or absent from this environment.`
      : 'Python could not find a file or directory used by the code. The final message does not expose the path to inspect.'

    return {
      likelyCause: cause,
      debuggingSteps: [
        'Identify the path passed to the file operation in the traceback.',
        'Check the process working directory and resolve the path relative to it.',
        'Confirm the file exists in this environment, including its spelling and letter case.',
        'Check whether the file is generated earlier in the workflow or must be deployed separately.',
      ],
      possibleFix: {
        explanation:
          'Resolve the path from a known base directory and verify it exists before opening it. If the file is input data, correct the source path; if it should be generated, create it before this step.',
        whereItMayApply:
          'Apply this before the file operation; avoid hard-coding a path that only exists on one machine.',
        exampleCode: [
          'from pathlib import Path',
          '',
          'path = Path("data/input.csv")',
          'if not path.is_file():',
          '    raise SystemExit(f"Missing input file: {path.resolve()}")',
          'with path.open() as handle:',
          '    contents = handle.read()',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun from the same working directory as the original command.',
        'Test the case where the file exists and the case where it is absent.',
        'Check that the chosen base directory behaves the same in local and deployed environments.',
      ],
      limitations: [
        'The message may expose only the attempted path, not the working directory or why the file should exist.',
        'This engine cannot check the filesystem or deployment contents.',
      ],
      alternativeExplanations: [
        'A relative path is resolved from an unexpected working directory.',
        'The filename or directory name is misspelled or has different case.',
        'The file exists locally but was not copied into the deployed artifact.',
      ],
    }
  },
}

export const pythonPermissionErrorRule: DiagnosticRule = {
  id: 'python.permission-error',
  language: 'python',
  category: 'permission-denied',
  match(line: string): RuleMatch | null {
    const matched = PERMISSION_ERROR.exec(line)
    if (matched) {
      return {
        signature: 'PermissionError: Permission denied',
        specificity: 'specific',
        captures: { path: matched[2] },
      }
    }

    if (!PERMISSION_ERROR_GENERIC.test(line)) {
      return null
    }

    return {
      signature: 'PermissionError: <permission denied>',
      specificity: 'generic',
      captures: {},
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const path = match.captures.path
    const cause = path
      ? `The operating system denied access to "${path}" for the process running the code. The process may lack the needed permission, the file may be locked or read-only, or the path may require a different owner.`
      : 'The operating system denied an operation requested by the code. The final message does not show the path, operation, or account involved.'

    return {
      likelyCause: cause,
      debuggingSteps: [
        'Identify the path and whether the operation is a read, write, rename, or delete.',
        'Check the account and permissions of the process that runs the code, not just the account in your terminal.',
        'Check whether the file is open in another program or on a read-only volume.',
        'Prefer granting the minimum permission needed, or choose an output directory the process already owns.',
      ],
      possibleFix: {
        explanation:
          'Use a path the process is allowed to access, or grant the minimum required permission to the existing path. Avoid running the whole application with elevated privileges as a workaround.',
        whereItMayApply:
          'Apply this at the file operation and deployment configuration; permissions should be granted to the specific account and path involved.',
        exampleCode: [
          'from pathlib import Path',
          '',
          '# Write to a directory owned by the process when this is an output file.',
          'output_path = Path.home() / "bugpilot-exports" / "report.csv"',
          'output_path.parent.mkdir(parents=True, exist_ok=True)',
          'output_path.write_text("example")',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the operation under the same account and environment that failed.',
        'Check both the file and its parent directory permissions.',
        'Confirm the process can still read its required inputs with the minimum change.',
      ],
      limitations: [
        'The message does not explain which permission or parent directory caused the denial.',
        'This engine cannot inspect operating-system users, ACLs, mounts, or file locks.',
      ],
      alternativeExplanations: [
        'The file or directory is owned by another user or requires elevated access.',
        'The file is read-only, open elsewhere, or on a read-only filesystem.',
        'The process is writing to a path that does not exist or is not writable by its service account.',
      ],
    }
  },
}

export const pythonSyntaxErrorRule: DiagnosticRule = {
  id: 'python.syntax-error',
  language: 'python',
  category: 'syntax-error',
  match(line: string): RuleMatch | null {
    const matched = SYNTAX_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const detail = matched[1]
    if (JAVASCRIPT_SYNTAX_ERROR.test(detail)) {
      return null
    }

    return {
      signature: 'SyntaxError: <Python parser error>',
      specificity: PYTHON_SYNTAX_ERROR.test(detail) ? 'specific' : 'generic',
      captures: { detail },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'Python could not parse the source before running it. The parser message points to a place where the code does not follow Python syntax, often caused by a missing delimiter, quote, colon, or incomplete expression.',
      debuggingSteps: [
        'Open the file and line named in the Python traceback, then inspect the line above it as well.',
        'Check quotes, parentheses, brackets, commas, and colons for a missing or extra delimiter.',
        'Make sure the file is the source you expect and has not been partially saved or generated incorrectly.',
        'Reduce the reported block to a minimal example before changing unrelated code.',
      ],
      possibleFix: {
        explanation:
          'Correct the reported source line so it parses, typically by closing a delimiter, fixing a quote, or completing the expression. A SyntaxError is not usually solved by installing a package.',
        whereItMayApply:
          'Apply this to the reported source file and line; if the error moves after the first fix, re-read the new parser message.',
        exampleCode: [
          '# The reported line and the line above it usually contain the syntax problem.',
          'def greet(name):',
          '    return f"Hello, {name}"',
        ].join('\n'),
      },
      verificationSteps: [
        'Run the file through the same Python interpreter again.',
        'Check that the reported syntax error is gone and the file is imported or executed successfully.',
        'Run the surrounding test or command to catch a second syntax error that was hidden by the first.',
      ],
      limitations: [
        'The parser message alone does not prove which source revision ran or whether generated code was involved.',
        'This engine cannot read the reported file or distinguish a typo from generated or stale source.',
      ],
      alternativeExplanations: [
        'The running file is older or different from the file being edited.',
        'A template or code generator produced incomplete Python source.',
        'The code uses syntax that requires a newer Python version than the interpreter.',
      ],
    }
  },
}

export const pythonIndentationErrorRule: DiagnosticRule = {
  id: 'python.indentation-error',
  language: 'python',
  category: 'indentation-error',
  match(line: string): RuleMatch | null {
    const matched = INDENTATION_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const detail = matched[1]
    return {
      signature: 'IndentationError: <indentation problem>',
      specificity: KNOWN_INDENTATION_ERROR.test(detail) ? 'specific' : 'generic',
      captures: { detail },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'Python could not determine the indentation structure of the source. The reported block may mix tabs and spaces, have an unexpected extra indent, or be missing the indent required by the previous line.',
      debuggingSteps: [
        'Open the reported line and the line before it and inspect the leading whitespace.',
        'Check whether the file mixes tabs and spaces in the same block.',
        'Confirm that a line ending in a colon is followed by an indented block.',
        'Use the editor to visualize whitespace and compare the block with the surrounding scope.',
      ],
      possibleFix: {
        explanation:
          'Make the block indentation consistent with its surrounding scope, using one style of whitespace and one indent level per block.',
        whereItMayApply:
          'Apply this to the reported block; avoid shifting unrelated nested blocks when only one line has the wrong indent.',
        exampleCode: [
          '# Keep the nested block consistently indented.',
          'def process(items):',
          '    for item in items:',
          '        print(item)',
        ].join('\n'),
      },
      verificationSteps: [
        'Run the file again with the same interpreter.',
        'Check the reported block and any adjacent nested block.',
        'Run the surrounding tests to catch an indentation change that altered control flow.',
      ],
      limitations: [
        'The message may not show whether the cause is a tab, extra space, or a missing block.',
        'This engine cannot inspect raw whitespace or reconstruct the intended nested structure.',
      ],
      alternativeExplanations: [
        'The file mixes tabs and spaces, or the editor inserted an unexpected indent.',
        'A conditional or loop body is missing its indented statements.',
        'A copied block was pasted at the wrong nesting level.',
      ],
    }
  },
}

export const pythonZeroDivisionErrorRule: DiagnosticRule = {
  id: 'python.zero-division-error',
  language: 'python',
  category: 'division-by-zero',
  match(line: string): RuleMatch | null {
    const matched = ZERO_DIVISION_ERROR.exec(line)
    if (!matched) {
      return null
    }

    return {
      signature: 'ZeroDivisionError: division by zero',
      specificity: 'specific',
      captures: { reason: matched[1] },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'Python evaluated a division or modulo expression whose divisor was zero or empty at that moment. The divisor may come from user input, a count, or a collection whose length happened to be zero.',
      debuggingSteps: [
        'Find the division or modulo operation in the traceback and identify the divisor.',
        'Print or inspect the divisor and the values that produced it just before the failing line.',
        'Check whether the divisor can be zero or empty for valid input, and decide what the correct result should be for that case.',
        'Guard the zero or empty case explicitly rather than wrapping the whole calculation in a broad exception handler.',
      ],
      possibleFix: {
        explanation:
          'Inspect the divisor before dividing and guard the zero or empty case. Decide what the correct result should be for that input, such as skipping it, returning None, or raising a clear error, rather than using a broad handler to swallow the error.',
        whereItMayApply:
          'Apply this at the division or modulo site; only guard the cases where zero is legitimate and do not hide data problems.',
        exampleCode: [
          'def safe_ratio(total, count):',
          '    if count == 0:',
          '        return None',
          '    return total / count',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same reproduction with the zero or empty input.',
        'Check that the ZeroDivisionError is gone and the chosen zero-case result is the intended one.',
        'Run the normal non-zero case as well to confirm the calculation still works.',
      ],
      limitations: [
        'The final message does not show which expression failed or where the divisor came from.',
        'This engine cannot inspect runtime values, input data, or the surrounding source.',
      ],
      alternativeExplanations: [
        'The divisor came from a collection that was empty on this path.',
        'A loop or aggregation produced zero where the code assumed a positive count.',
        'The wrong variable was used as the divisor or the operands were swapped.',
      ],
    }
  },
}

function valueErrorNarrative(match: RuleMatch): RuleNarrative {
  const reason = match.captures.reason
  const value = match.captures.value ?? 'the supplied text'
  const base = match.captures.base ?? 'the given'
  const expected = match.captures.expected
  const got = match.captures.got

  if (reason === 'invalid-int-literal') {
    return {
      likelyCause: `Python tried to convert "${value}" to an int with base ${base}, but the text is not a valid integer in that base. The text may come from user input, a file, or an API field that uses a different format.`,
      debuggingSteps: [
        'Find the int() conversion in the traceback and identify the raw value passed to it.',
        'Print the value with repr() to see spaces, signs, decimal points, or other characters that are not valid digits.',
        'Check whether the intended base matches the text, for example whether a prefix belongs in the value.',
        'Decide how invalid input should behave before changing the conversion.',
      ],
      possibleFix: {
        explanation:
          'Inspect and validate the raw text before converting it, then convert it deliberately with the intended base or format instead of wrapping the conversion in a broad handler.',
        whereItMayApply:
          'Apply this at the conversion site; confirm whether the input should be rejected, normalized, or read from a different field.',
        exampleCode: [
          'raw = "12.5"',
          'if raw.strip().lstrip("-").isdigit():',
          '    count = int(raw)',
          'else:',
          '    count = None',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same conversion with the value that failed.',
        'Test a valid integer, an empty value, and the invalid format that caused the error.',
        'Check that the chosen invalid-input behavior is explicit and visible to the caller.',
      ],
      limitations: [
        'The message shows the value but not where it came from or what the code intended to accept.',
        'This engine cannot inspect the input source, locale, or surrounding conversion code.',
      ],
      alternativeExplanations: [
        'The text contains a decimal point or thousands separator instead of an integer.',
        'The value was read from the wrong column, field, or line.',
        'The intended numeric base does not match the format of the text.',
      ],
    }
  }

  if (reason === 'invalid-float-literal') {
    return {
      likelyCause: `Python tried to convert "${value}" to a float, but the text is not a valid float literal. A decimal comma, currency symbol, thousands separator, or empty value commonly causes this.`,
      debuggingSteps: [
        'Find the float() conversion in the traceback and identify the raw value passed to it.',
        'Print the value with repr() to see separators, symbols, or whitespace around the number.',
        'Check the expected number format and locale before changing the value.',
        'Decide how invalid input should behave instead of silently defaulting it.',
      ],
      possibleFix: {
        explanation:
          'Inspect the raw text and normalize only the formatting you can justify, then convert it with float() or a deliberate parser for the expected locale.',
        whereItMayApply:
          'Apply this at the conversion boundary; do not strip characters unless you know they are formatting rather than data.',
        exampleCode: [
          'raw = "1,234.5"',
          'cleaned = raw.replace(",", "")',
          'amount = float(cleaned)',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same conversion with the failing text.',
        'Test a plain decimal, an empty value, and the formatted input that caused the error.',
        'Check that the normalization does not change values for other inputs.',
      ],
      limitations: [
        'The message shows the value but not the locale or source that formatted it.',
        'This engine cannot inspect the input data or parse rules used before the conversion.',
      ],
      alternativeExplanations: [
        'The value uses a decimal comma or a thousands separator.',
        'A currency symbol or unit was included in the text.',
        'The field is empty or contains a placeholder rather than a number.',
      ],
    }
  }

  if (reason === 'not-enough-values') {
    return {
      likelyCause: `Python tried to unpack a sequence into ${expected ?? 'the expected number of'} names, but the sequence produced only ${got ?? 'fewer'} values. The data may be shorter or shaped differently than the code assumes.`,
      debuggingSteps: [
        'Find the unpacking assignment in the traceback and count the names on the left.',
        'Print the sequence and its length before the assignment to confirm its actual shape.',
        'Check the query, split, or API response that produced the sequence.',
        'Decide whether a shorter sequence is valid input or an error for this code path.',
      ],
      possibleFix: {
        explanation:
          'Check the sequence length before unpacking, and handle a shorter sequence explicitly rather than assuming the expected shape.',
        whereItMayApply:
          'Apply this where the sequence enters the assignment; choose a clear behavior for missing values instead of padding with arbitrary defaults.',
        exampleCode: [
          'point = (1, 2)',
          'if len(point) == 2:',
          '    x, y = point',
          'else:',
          '    x = y = None',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the unpacks with the sequence that failed.',
        'Test a sequence with exactly the expected number of values.',
        'Check that the shorter-sequence behavior is intentional and visible.',
      ],
      limitations: [
        'The message gives the expected and actual counts but not the sequence contents or source.',
        'This engine cannot inspect the data shape or the code that produced the sequence.',
      ],
      alternativeExplanations: [
        'A query or split returned fewer fields than expected.',
        'A filter or validation step removed values before the assignment.',
        'The unpacking target expects a different data shape than the source provides.',
      ],
    }
  }

  if (reason === 'too-many-values') {
    return {
      likelyCause: `Python tried to unpack a sequence into ${expected ?? 'the expected number of'} names, but the sequence produced more values than expected. The data may contain extra columns or items.`,
      debuggingSteps: [
        'Find the unpacking assignment in the traceback and count the names on the left.',
        'Print the sequence and its length before the assignment to confirm the extra values.',
        'Check whether the source added a column, a separator changed, or the wrong field was selected.',
        'Decide whether the extra values should be ignored deliberately or treated as an error.',
      ],
      possibleFix: {
        explanation:
          'Confirm the expected sequence shape and either unpack the extra values deliberately, such as with a starred target, or select the fields you need before unpacking.',
        whereItMayApply:
          'Apply this at the unpacking site; do not discard extra data unless you have confirmed it is safe to ignore.',
        exampleCode: [
          '# Keep the first value and collect any extra values explicitly.',
          'first, *rest = values',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same unpacking with the sequence that failed.',
        'Test a sequence with exactly the expected number of values.',
        'Check that any extra values are handled intentionally rather than silently dropped.',
      ],
      limitations: [
        'The message gives the expected count but not the extra values or their source.',
        'This engine cannot inspect the sequence contents or the code that produced them.',
      ],
      alternativeExplanations: [
        'The data gained an extra column or item that the code does not expect.',
        'A split or delimiter change produced more parts than before.',
        'The wrong sequence or field was selected for this assignment.',
      ],
    }
  }

  if (reason === 'math-domain') {
    return {
      likelyCause:
        'A math function received a value outside its defined domain. A negative value passed to a square root or logarithm, or zero passed to a logarithm, commonly causes this.',
      debuggingSteps: [
        'Find the math call in the traceback and identify the value passed to it.',
        'Check the function domain and whether the value can legitimately fall outside it.',
        'Trace the value back to its source and decide how out-of-domain input should behave.',
        'Guard the domain explicitly instead of catching the ValueError and continuing with an invalid result.',
      ],
      possibleFix: {
        explanation:
          'Check the input against the function domain before calling it, and handle out-of-domain values explicitly with a documented result or error.',
        whereItMayApply:
          'Apply this at the math call; confirm whether invalid inputs should be rejected, clamped, or handled by a different calculation.',
        exampleCode: [
          'import math',
          '',
          'value = -1',
          'if value >= 0:',
          '    root = math.sqrt(value)',
          'else:',
          '    root = None',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the math call with the value that failed.',
        'Test the boundary value, the valid case, and the out-of-domain case.',
        'Check that the chosen result is meaningful rather than an arbitrary fallback.',
      ],
      limitations: [
        'The message does not name the function or value that fell outside the domain.',
        'This engine cannot inspect runtime values or the mathematical intent of the code.',
      ],
      alternativeExplanations: [
        'The input is negative where the function requires a non-negative value.',
        'The input is zero for a logarithm or another function with a restricted domain.',
        'Earlier rounding or unit conversion produced an invalid value.',
      ],
    }
  }

  if (reason === 'not-in-list') {
    return {
      likelyCause: `The value "${value}" was not found in the list that the code searched. The list may be empty, contain different values, or have been filtered earlier.`,
      debuggingSteps: [
        'Find the list method or search in the traceback and identify the list and target value.',
        'Print the list and the target to compare spelling, case, and formatting.',
        'Check whether an earlier filter, query, or normalization changed the list.',
        'Decide what should happen when the value is absent instead of relying on the exception.',
      ],
      possibleFix: {
        explanation:
          'Check membership before searching, and decide explicitly what should happen when the value is absent instead of relying on a broad handler.',
        whereItMayApply:
          'Apply this at the search or lookup site; choose a clear absent-value result rather than adding the missing item blindly.',
        exampleCode: [
          'fruits = ["pear", "plum"]',
          'target = "apple"',
          'if target in fruits:',
          '    index = fruits.index(target)',
          'else:',
          '    index = -1',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same search with the missing value.',
        'Test a value that is present and a list that is empty.',
        'Check that the absent-value behavior is intentional and visible.',
      ],
      limitations: [
        'The message shows the missing value but not the list contents or how the list was built.',
        'This engine cannot inspect the list data or the earlier filtering steps.',
      ],
      alternativeExplanations: [
        'The list is empty or was filtered before the search.',
        'The value differs by case, whitespace, or type from the list entries.',
        'The wrong list or target variable was used.',
      ],
    }
  }

  return {
    likelyCause:
      'Python raised a ValueError, but the final message does not match one of the supported value-error forms, so the specific cause cannot be narrowed from this line alone.',
    debuggingSteps: [
      'Copy the full ValueError message and the traceback frame that points to your own code.',
      'Identify the operation that raised it: a conversion, unpacking, search, math call, or validation check.',
      'Inspect the value and the expected format at that operation before changing dependencies.',
      'Reproduce the failure with the smallest input that still shows the same message.',
    ],
    possibleFix: {
      explanation:
        'Use the full ValueError message to determine which conversion, lookup, or validation failed, then handle that specific case. The engine cannot suggest a narrower fix without a recognised sub-signature.',
      whereItMayApply:
        'Apply this at the operation named in the full traceback; do not catch ValueError broadly and continue with a guessed value.',
      exampleCode: [
        'try:',
        '    value = int(raw)',
        'except ValueError as error:',
        '    print(f"Invalid value: {raw!r}")',
        '    raise',
      ].join('\n'),
    },
    verificationSteps: [
      'Rerun the same reproduction with the same input.',
      'Check whether the message changes to a recognised form that names the failing value or shape.',
      'Confirm the handled case behaves as intended without hiding other ValueErrors.',
    ],
    limitations: [
      'This generic result uses only the final message and cannot identify the exact operation that raised it.',
      'This engine cannot inspect runtime values or the surrounding source.',
    ],
    alternativeExplanations: [
      'A conversion received text that does not match the expected format.',
      'A lookup or membership test used a missing value.',
      'A validation rule or library function rejected the input for an unsupported reason.',
    ],
  }
}

export const pythonValueErrorRule: DiagnosticRule = {
  id: 'python.value-error',
  language: 'python',
  category: 'invalid-value',
  match(line: string): RuleMatch | null {
    const matched = VALUE_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const detail = matched[1]
    const invalidInt = INVALID_INT_LITERAL.exec(detail)
    if (invalidInt) {
      return {
        signature:
          "ValueError: invalid literal for int() with base <base>: '<value>'",
        specificity: 'specific',
        captures: {
          reason: 'invalid-int-literal',
          base: invalidInt[1],
          value: invalidInt[3],
        },
      }
    }

    const invalidFloat = INVALID_FLOAT_LITERAL.exec(detail)
    if (invalidFloat) {
      return {
        signature: "ValueError: could not convert string to float: '<value>'",
        specificity: 'specific',
        captures: {
          reason: 'invalid-float-literal',
          value: invalidFloat[2],
        },
      }
    }

    const notEnough = NOT_ENOUGH_VALUES.exec(detail)
    if (notEnough) {
      return {
        signature:
          'ValueError: not enough values to unpack (expected <expected>, got <got>)',
        specificity: 'specific',
        captures: {
          reason: 'not-enough-values',
          expected: notEnough[1],
          got: notEnough[2],
        },
      }
    }

    const tooMany = TOO_MANY_VALUES.exec(detail)
    if (tooMany) {
      return {
        signature:
          'ValueError: too many values to unpack (expected <expected>)',
        specificity: 'specific',
        captures: {
          reason: 'too-many-values',
          expected: tooMany[1],
        },
      }
    }

    if (MATH_DOMAIN_ERROR.test(detail)) {
      return {
        signature: 'ValueError: math domain error',
        specificity: 'specific',
        captures: { reason: 'math-domain' },
      }
    }

    const notInList = VALUE_NOT_IN_LIST.exec(detail)
    if (notInList) {
      return {
        signature: "ValueError: '<value>' is not in list",
        specificity: 'specific',
        captures: { reason: 'not-in-list', value: notInList[2] },
      }
    }

    return {
      signature: 'ValueError: <unclassified value error>',
      specificity: 'generic',
      captures: { detail },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    return valueErrorNarrative(match)
  },
}

export const pythonRecursionErrorRule: DiagnosticRule = {
  id: 'python.recursion-error',
  language: 'python',
  category: 'recursion-error',
  match(line: string): RuleMatch | null {
    const matched = RECURSION_ERROR.exec(line)
    if (!matched) {
      return null
    }

    return {
      signature: 'RecursionError: maximum recursion depth exceeded',
      specificity: 'specific',
      captures: { reason: matched[1] ?? 'unspecified' },
    }
  },
  explain(): RuleNarrative {
    return {
      likelyCause:
        'Python exceeded its maximum call depth. A recursive function may be missing a base case, may never reach it with this input, or may use runaway mutual recursion.',
      debuggingSteps: [
        'Find the recursive call in the traceback and identify the argument that should eventually reach the base case.',
        'Print that argument at each call to see whether it approaches the base case or repeats the same value.',
        'Make sure every path through the function can reach the base case before the next recursive call.',
        'If the depth is legitimately large, consider an explicit loop or iterative traversal instead of relying on a raised limit.',
      ],
      possibleFix: {
        explanation:
          'Make the base case reachable for every input, or convert the recursion to an explicit loop when the depth is legitimately large. Verify the new stopping condition with small and boundary inputs before relying on it.',
        whereItMayApply:
          'Apply this to the recursive function; do not treat a raised recursion limit as a fix for a missing base case.',
        exampleCode: [
          'def countdown(n):',
          '    if n <= 0:',
          '        return 0',
          '    return countdown(n - 1)',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same input that triggered the RecursionError.',
        'Check that the function terminates and returns the expected result.',
        'Test the smallest input and an input that previously produced the deepest recursion.',
      ],
      limitations: [
        'Raising sys.setrecursionlimit is usually a workaround; it can trade a RecursionError for a crash and does not fix a missing base case.',
        'This engine cannot inspect the recursive function or the depth of the data that reached it.',
      ],
      alternativeExplanations: [
        'The base case is unreachable because the argument does not change as expected.',
        'Two or more functions call each other without a shared stopping condition.',
        'The recursion depth is legitimate but exceeds the default limit for this runtime.',
      ],
    }
  },
}

export const pythonUnicodeErrorRule: DiagnosticRule = {
  id: 'python.unicode-error',
  language: 'python',
  category: 'unicode-error',
  match(line: string): RuleMatch | null {
    const matched = UNICODE_ERROR.exec(line)
    if (!matched) {
      return null
    }

    const direction = matched[1].toLowerCase()
    const codec = matched[2]
    return {
      signature:
        direction === 'decode'
          ? "UnicodeDecodeError: '<codec>' codec cannot decode the input"
          : "UnicodeEncodeError: '<codec>' codec cannot encode the text",
      specificity: 'specific',
      captures: { reason: 'codec-mismatch', direction, codec },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const codec = match.captures.codec ?? 'the named'
    const isDecode = match.captures.direction === 'decode'
    const likelyCause = isDecode
      ? `Python read bytes and tried to decode them with the "${codec}" codec, but the data contains a byte sequence that codec does not accept. The data may use a different encoding, or the file may be corrupted or truncated.`
      : `Python tried to encode text with the "${codec}" codec, but that codec cannot represent one of the characters. This is common on Windows when the default encoding is not UTF-8.`

    return {
      likelyCause,
      debuggingSteps: [
        'Identify the read or write operation and the codec named in the message.',
        'Inspect the first bytes of the input, or the character that could not be encoded, instead of guessing the encoding.',
        'Open the file or stream with an explicit, known encoding such as encoding="utf-8".',
        'If the data really uses another encoding, name it deliberately; do not add errors="ignore" just to silence the error.',
      ],
      possibleFix: {
        explanation: isDecode
          ? 'Open the text with the encoding the data actually uses, commonly encoding="utf-8", and handle undecodable bytes explicitly.'
          : 'Write the text with an encoding that can represent it, such as UTF-8, or explicitly replace or reject characters that cannot be represented.',
        whereItMayApply:
          'Apply this at the file, stream, or network boundary where text is decoded or encoded; confirm the real encoding before changing it.',
        exampleCode: isDecode
          ? [
              'with open("data.csv", "r", encoding="utf-8") as handle:',
              '    text = handle.read()',
            ].join('\n')
          : [
              'with open("report.txt", "w", encoding="utf-8") as handle:',
              '    handle.write("done")',
            ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same read or write with the same data.',
        'Check that the expected characters appear intact and no replacement characters were introduced.',
        'Test the boundary cases: an empty input and a sample that contains the character or byte that failed.',
      ],
      limitations: [
        'Using errors="ignore" or errors="replace" can silently drop or change data, so it is not a fix for an unknown encoding.',
        'This engine cannot inspect the file bytes, the system locale, or the actual encoding used at runtime.',
      ],
      alternativeExplanations: [
        'The file uses a different single-byte encoding such as Windows-1252 or Latin-1.',
        'The terminal or console encoding differs from the encoding used for the file.',
        'The data mixes encodings or includes a byte-order mark that the reader did not expect.',
      ],
    }
  },
}

export const pythonJsonDecodeErrorRule: DiagnosticRule = {
  id: 'python.json-decode-error',
  language: 'python',
  category: 'json-decode-error',
  match(line: string): RuleMatch | null {
    const matched = JSON_DECODE_ERROR.exec(line)
    if (!matched) {
      return null
    }

    return {
      signature: 'JSONDecodeError: <invalid JSON payload>',
      specificity: 'specific',
      captures: { reason: matched[1] },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const reason = match.captures.reason ?? ''
    let likelyCause =
      'The text passed to the JSON parser is not valid JSON for an unsupported reason.'

    if (reason.startsWith('Expecting value')) {
      likelyCause =
        'The JSON parser found no value where one was required. A common cause is an empty response body or an HTML/error page returned instead of JSON.'
    } else if (reason.startsWith('Expecting property name')) {
      likelyCause =
        'The JSON parser expected an object property name in double quotes but found something else. Single quotes, a trailing comma, or a truncated object commonly causes this.'
    } else if (reason.startsWith('Extra data')) {
      likelyCause =
        'The parser finished one JSON value and then found extra text. The input may contain more than one document or trailing characters.'
    } else if (reason.startsWith('Unterminated string')) {
      likelyCause =
        'A JSON string did not close before the input ended, so the payload may be truncated or contain an unescaped quote.'
    } else if (reason.startsWith('Invalid control character')) {
      likelyCause =
        'The JSON text contains a raw control character that must be escaped inside a string.'
    }

    return {
      likelyCause,
      debuggingSteps: [
        'Print the raw response body, status code, and content type before parsing.',
        'Check whether the body is empty, an HTML error page, or prefixed by a byte-order mark.',
        'Validate the text with a JSON parser and inspect the reported line and column.',
        'Fix the source or the parsing boundary instead of catching the error and silently returning an empty object.',
      ],
      possibleFix: {
        explanation:
          'Inspect the raw response or payload and its status before parsing. Confirm that the source returns JSON rather than an empty body, HTML, or a BOM-prefixed document, and handle that expected case explicitly.',
        whereItMayApply:
          'Apply this at the parsing boundary; do not hide a non-JSON response behind a broad exception handler.',
        exampleCode: [
          'response = client.get(url)',
          'response.raise_for_status()',
          'raw = response.text',
          'if not raw.strip():',
          '    raise ValueError("Expected JSON, but the response body was empty")',
          'data = json.loads(raw.lstrip("\\ufeff"))',
        ].join('\n'),
      },
      verificationSteps: [
        'Rerun the same request and inspect the status and raw body again.',
        'Parse a known-good JSON payload to confirm the parser and content type agree.',
        'Check the empty, HTML, and BOM-prefixed cases that previously failed.',
      ],
      limitations: [
        'The message gives a line and column in the text but does not show the source of that text.',
        'This engine cannot inspect network responses, files, or the parser configuration.',
      ],
      alternativeExplanations: [
        'The endpoint returned an HTML login or error page instead of JSON.',
        'The response body was empty or the request used the wrong URL.',
        'The payload is double-encoded, starts with a BOM, or contains unescaped control characters.',
      ],
    }
  },
}

export const pythonRules: readonly DiagnosticRule[] = [
  pythonModuleNotFoundErrorRule,
  pythonImportErrorRule,
  pythonNameErrorRule,
  pythonTypeErrorRule,
  pythonAttributeErrorRule,
  pythonKeyErrorRule,
  pythonIndexErrorRule,
  pythonFileNotFoundErrorRule,
  pythonPermissionErrorRule,
  pythonSyntaxErrorRule,
  pythonIndentationErrorRule,
  pythonZeroDivisionErrorRule,
  pythonValueErrorRule,
  pythonRecursionErrorRule,
  pythonUnicodeErrorRule,
  pythonJsonDecodeErrorRule,
]
