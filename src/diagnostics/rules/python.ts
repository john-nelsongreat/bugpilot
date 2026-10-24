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
]
