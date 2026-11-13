import type { AstRuleCheck, AstRuleDefinition, Confidence } from './astRules'
import type { GrammarId } from './assets'

/**
 * Part 3: the AST rules. Every query and every guard here was run against the shipped
 * grammar with positive and negative fixtures before it landed; a rule that could not be
 * made to miss its lookalike was dropped instead of shipped with a caveat.
 *
 * The queries are deliberately broad and the `checks` guards do the precise work: a
 * tree-sitter query cannot say "this condition assigns rather than compares", so the query
 * takes the condition and the guard reads it.
 */

const COMMENT_TYPES = ['comment', 'line_comment', 'block_comment']

const GRAMMAR_LABEL: Partial<Record<GrammarId, string>> = {
  python: 'Python',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  c_sharp: 'C#',
  php: 'PHP',
  go: 'Go',
  ruby: 'Ruby',
}

interface FamilyProse {
  id: string
  title: string
  severity: AstRuleDefinition['severity']
  confidence: Confidence
  message: string
  explanation: string
  limitations: readonly string[]
  verificationSteps: readonly string[]
  fixExplanation: string
  fixWhereItMayApply: string
}

interface RuleShape {
  grammar: GrammarId
  query: string
  require: readonly string[]
  anchor?: string
  checks?: readonly AstRuleCheck[]
  rejectAnchorTypes?: readonly string[]
  message?: string
  explanation?: string
  limitations?: readonly string[]
}

function define(family: FamilyProse, shape: RuleShape): AstRuleDefinition {
  const language = GRAMMAR_LABEL[shape.grammar] ?? shape.grammar
  return {
    id: family.id,
    title: family.title,
    severity: family.severity,
    confidence: family.confidence,
    grammar: shape.grammar,
    query: shape.query,
    require: shape.require,
    anchor: shape.anchor,
    checks: shape.checks,
    rejectAnchorTypes: shape.rejectAnchorTypes,
    message: (shape.message ?? family.message).replace(/\{language\}/g, language),
    explanation: (shape.explanation ?? family.explanation).replace(/\{language\}/g, language),
    limitations: [...(shape.limitations ?? family.limitations)],
    verificationSteps: [...family.verificationSteps],
    fixExplanation: family.fixExplanation,
    fixWhereItMayApply: family.fixWhereItMayApply,
  }
}

const EMPTY_CATCH: FamilyProse = {
  id: 'bugpilot/ast/empty-catch',
  title: 'Exception handler discards the error',
  severity: 'Medium',
  confidence: 'high',
  message: 'This {language} exception handler has an empty body, so anything it catches is discarded.',
  explanation:
    'The parse tree shows a handler whose body contains no statement. When that handler matches a thrown value, execution continues as if nothing happened.',
  limitations: [
    'The tree does not say why the body is empty: a deliberate "ignore this error" looks identical to a forgotten handler.',
    'A handler that contains only a comment is not reported, because BugPilot cannot tell a note-to-self from a swallowed error.',
    'Ruff reports the same construct for Python files; the two are merged into one finding per line.',
  ],
  verificationSteps: [
    'Read the code around the handler and decide whether the error is meant to be ignored.',
    'If it is ignored on purpose, say so in a comment or catch the narrowest exception that can occur.',
    'Add logging or a rethrow where a failure would otherwise be invisible, then re-run the analysis.',
  ],
  fixExplanation:
    'Either handle the error (log it, wrap it, rethrow it) or make the deliberate choice visible in a comment next to the handler.',
  fixWhereItMayApply:
    'Any handler whose body is empty. If the file already logs errors centrally, the empty handler may still need an explicit comment.',
}

const BARE_EXCEPT: FamilyProse = {
  id: 'bugpilot/ast/python-bare-except',
  title: 'Bare except catches everything',
  severity: 'Medium',
  confidence: 'high',
  message: 'This Python `except:` has no exception type, so it also catches KeyboardInterrupt, SystemExit and real bugs.',
  explanation:
    'The parse tree shows an `except` clause with no expression between the keyword and the colon, which is the bare form. A bare handler matches every exception, including the ones that mean "stop the program".',
  limitations: [
    '`except Exception:` is not reported; it is the narrower form and is often the right choice.',
    'The tree cannot show whether the handler is the outermost safety net in a loop or a CLI entry point, where a bare except is sometimes intended.',
  ],
  verificationSteps: [
    'Check whether a typo or a missing import could be hidden by this handler.',
    'Replace the bare `except:` with the exception types the call can actually raise.',
    'Re-run the analysis and confirm the handler still covers the failure you care about.',
  ],
  fixExplanation:
    'Name the exception types you want to handle, or keep the bare form only where the program genuinely must continue on any error.',
  fixWhereItMayApply: 'Every `except:` without a type in a Python file.',
}

const UNREACHABLE: FamilyProse = {
  id: 'bugpilot/ast/unreachable-code',
  title: 'Statement after an unconditional jump',
  severity: 'Low',
  confidence: 'medium',
  message: 'The statement "@after@" follows a return, throw, break, continue or goto in the same block.',
  explanation:
    'The parse tree puts this statement after a jump statement at the same block level, so the normal control flow of the block never reaches it.',
  limitations: [
    'BugPilot reads the block, not the whole function: a label or a computed jump elsewhere in the file can still reach this line.',
    'In a loop, only the code after the jump inside that iteration is affected; the loop body itself still runs.',
    'Dead code is not a crash. It usually means a condition changed and the statement was left behind.',
  ],
  verificationSteps: [
    'Look at the jump statement above the line and ask whether the code after it was meant to run first.',
    'Check for a label, goto or exception handler that could still reach this statement.',
    'Delete or move the statement, then re-run the analysis and the language compiler.',
  ],
  fixExplanation:
    'Move the statement above the jump, or delete it if the jump really is the end of the block.',
  fixWhereItMayApply:
    'A block where the jump is the last intended action. If the jump was added by mistake, removing the jump is the fix instead.',
}

const ASSIGN_IN_CONDITION: FamilyProse = {
  id: 'bugpilot/ast/assignment-in-condition',
  title: 'Assignment inside a controlling expression',
  severity: 'High',
  confidence: 'medium',
  message: 'The controlling expression "@cond@" assigns instead of comparing.',
  explanation:
    'The parse tree shows an assignment node inside the parenthesised condition of if, while, for or do. In these languages `=` yields the assigned value, so the branch is taken on that value rather than on a comparison.',
  limitations: [
    'This is sometimes intended: `while ((line = read()) != NULL)` and `if ($x = count())` are established idioms. The tree cannot tell intent.',
    'Only the condition text is read, so BugPilot cannot know whether the assigned variable was already used or logged.',
    'A comparison written as `==` is not reported; the guard requires a single `=` that is not part of `==`, `!=`, `<=`, `>=` or a compound assignment.',
  ],
  verificationSteps: [
    'Decide whether the branch value or the comparison was meant.',
    'If an assignment is intended, wrap it in extra parentheses or split it onto its own line so the next reader sees the choice.',
    'Enable the compiler warning for assignments in conditions (`-Wparentheses`, `/W4`, PHP Notice) and recompile.',
  ],
  fixExplanation:
    'Use `==` or `===` when a comparison was meant; keep the assignment but make it explicit when the value really is needed in the condition.',
  fixWhereItMayApply:
    'Plain `if`, `while`, `for` and `do` conditions. Conditions that already wrap the assignment in parentheses are the documented idiom and may be left as they are.',
}

const SQL_BUILD: FamilyProse = {
  id: 'bugpilot/ast/sql-built-by-concatenation',
  title: 'Query text assembled with string operations',
  severity: 'High',
  confidence: 'low',
  message: 'The query passed to @method@ is built by concatenation, interpolation or formatting: @arg@',
  explanation:
    'The parse tree shows a call to a query method whose first argument is not a plain literal but a string expression: `+`, `.`, `%`, `.format()`, an f-string or an interpolated string. That shape is how SQL injection normally arrives, and it is also how a legitimate dynamic table or column name is built.',
  limitations: [
    'One file is analysed at a time, so BugPilot cannot see whether the value is user input or a constant.',
    'The query only matches a string expression passed directly in the call. SQL assembled into a variable earlier in the function, or in another file, is not detected.',
    'Column, table and ORDER BY names cannot be bound as parameters, so some of these uses are correct and only need review.',
    'This is a review prompt, not a proven vulnerability. Use placeholders for values and validate identifiers.',
  ],
  verificationSteps: [
    'Trace the interpolated part back to its source and confirm whether an external caller can influence it.',
    'Move every value into a bound parameter; keep only identifiers in the built string.',
    'Validate identifier fragments against an allow-list instead of quoting them.',
    'Re-run the analysis after the change to confirm the call no longer builds its own text.',
  ],
  fixExplanation:
    'Pass the query text as a literal with placeholders and bind the values, so the database never parses user-supplied text as SQL.',
  fixWhereItMayApply:
    'Call sites that take the full statement as their first argument. Statements assembled from an allow-list of identifiers are lower risk than those assembled from request data.',
}

export const AST_RULES: readonly AstRuleDefinition[] = [
  // --- empty handler ---
  define(EMPTY_CATCH, {
    grammar: 'python',
    query: '(except_clause (block . (pass_statement) .)) @ex',
    require: ['ex'],
    anchor: 'ex',
    message: 'This Python handler is "@ex@": it catches and discards.',
  }),
  define(EMPTY_CATCH, {
    grammar: 'python',
    query: '(except_clause (block . (expression_statement (ellipsis)) .)) @ex',
    require: ['ex'],
    anchor: 'ex',
    message: 'This Python handler is "@ex@": the body is only an ellipsis.',
  }),
  define(EMPTY_CATCH, {
    grammar: 'java',
    query: '(catch_clause body: (block) @body)',
    require: ['body'],
    anchor: 'body',
    checks: [{ capture: 'body', pattern: '^\\{\\s*\\}$', when: 'must' }],
  }),
  define(EMPTY_CATCH, {
    grammar: 'c_sharp',
    query: '(catch_clause (block) @body)',
    require: ['body'],
    anchor: 'body',
    checks: [{ capture: 'body', pattern: '^\\{\\s*\\}$', when: 'must' }],
  }),
  define(EMPTY_CATCH, {
    grammar: 'php',
    query: '(catch_clause body: (compound_statement) @body)',
    require: ['body'],
    anchor: 'body',
    checks: [{ capture: 'body', pattern: '^\\{\\s*\\}$', when: 'must' }],
  }),
  define(EMPTY_CATCH, {
    grammar: 'ruby',
    query: '(rescue) @ex',
    require: ['ex'],
    anchor: 'ex',
    checks: [{ capture: 'ex', pattern: '^rescue[^:\\n]*$', when: 'must' }],
    message: 'This Ruby handler is "@ex@": it catches and discards.',
  }),
  define(EMPTY_CATCH, {
    grammar: 'ruby',
    query: '(rescue body: (then (nil)) @body)',
    require: ['body'],
    anchor: 'body',
    checks: [{ capture: 'body', pattern: '^\\s*nil\\s*$', when: 'must' }],
    message: 'This Ruby handler returns only `nil`, so the exception is discarded.',
  }),

  // --- bare except ---
  define(BARE_EXCEPT, {
    grammar: 'python',
    query: '(except_clause) @ex',
    require: ['ex'],
    anchor: 'ex',
    checks: [{ capture: 'ex', pattern: '^except[ \\t]*:', when: 'must' }],
  }),

  // --- unreachable code ---
  define(UNREACHABLE, {
    grammar: 'python',
    query: '(block [(return_statement) (raise_statement) (break_statement) (continue_statement)] (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
    checks: [{ capture: 'after', pattern: '^def |^class ', when: 'mustNot' }],
    limitations: [
      'A definition after a jump is not reported: Python binds `def` and `class` names when the block runs, so their absence changes behaviour and is a different question.',
      'BugPilot reads the block, not the whole function: a label or an outer loop can still reach the line.',
      'Dead code is not a crash. It usually means a condition changed and the statement was left behind.',
    ],
  }),
  define(UNREACHABLE, {
    grammar: 'java',
    query: '(block [(return_statement) (throw_statement) (break_statement) (continue_statement)] (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
  }),
  define(UNREACHABLE, {
    grammar: 'c',
    query: '(compound_statement [(return_statement) (break_statement) (continue_statement) (goto_statement)] (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
  }),
  define(UNREACHABLE, {
    grammar: 'cpp',
    query: '(compound_statement [(return_statement) (break_statement) (continue_statement) (goto_statement) (throw_statement)] (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
  }),
  define(UNREACHABLE, {
    grammar: 'c_sharp',
    query: '(block [(return_statement) (throw_statement) (break_statement) (continue_statement)] (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
  }),
  define(UNREACHABLE, {
    grammar: 'go',
    query: '(statement_list [(return_statement) (break_statement) (continue_statement) (goto_statement) (fallthrough_statement)] (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
  }),
  define(UNREACHABLE, {
    grammar: 'php',
    query: '(compound_statement [(return_statement) (break_statement) (continue_statement) (expression_statement (throw_expression))] (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
  }),
  define(UNREACHABLE, {
    grammar: 'ruby',
    query: '(body_statement (return) (_) @after)',
    require: ['after'],
    anchor: 'after',
    rejectAnchorTypes: COMMENT_TYPES,
    explanation:
      'The parse tree puts this statement after a `return` in the same method body. Ruby also allows `return` inside a conditional, which is a different node, so only the straight-line form is reported.',
  }),

  // --- assignment in a controlling expression ---
  define(ASSIGN_IN_CONDITION, {
    grammar: 'c',
    query: '((if_statement) (while_statement) (for_statement) (do_statement)) condition: (parenthesized_expression (_) @cond)',
    require: ['cond'],
    anchor: 'cond',
    checks: [{ capture: 'cond', pattern: '(^|[^=<>!+\\-*/%&|^])=([^=]|$)', when: 'must' }],
  }),
  define(ASSIGN_IN_CONDITION, {
    grammar: 'cpp',
    // C++ wraps an if condition in `condition_clause`, so the inner expression is taken
    // through the field itself instead of a parenthesised expression node.
    query: '((if_statement) (while_statement) (do_statement) (for_statement)) condition: (_ (_) @cond)',
    require: ['cond'],
    anchor: 'cond',
    checks: [{ capture: 'cond', pattern: '(^|[^=<>!+\\-*/%&|^])=([^=]|$)', when: 'must' }],
  }),
  define(ASSIGN_IN_CONDITION, {
    grammar: 'php',
    query: '((if_statement) (while_statement) (for_statement)) condition: (parenthesized_expression (_) @cond)',
    require: ['cond'],
    anchor: 'cond',
    checks: [{ capture: 'cond', pattern: '(^|[^=<>!+\\-*/%&|^])=([^=]|$)', when: 'must' }],
    limitations: [
      'PHP also allows `=$x` to mean "assign and test the value", and that is a used idiom; the tree cannot tell it from a typo.',
      '`==`, `===`, `!=`, `<=`, `>=` and compound assignments such as `+=` are not reported.',
      'Only the condition text is read, so the origin of the assigned value is unknown.',
    ],
  }),

  // --- query text built with string operations ---
  define(SQL_BUILD, {
    grammar: 'python',
    query: '(call function: (attribute attribute: (identifier) @method) arguments: (argument_list (_) @arg))',
    require: ['method', 'arg'],
    anchor: 'method',
    checks: [
      { capture: 'method', pattern: '^(execute|executemany|executescript|query|cursor|raw)$', when: 'must' },
      {
        capture: 'arg',
        pattern:
          '["\'][^"\']*["\']\\s*\\+|\\+\\s*["\']|["\']\\s*%\\s*[\\w(]|%s["\']?\\s*%|\\.format\\(|\\bf["\'].*\\{',
        when: 'must',
      },
    ],
  }),
  define(SQL_BUILD, {
    grammar: 'php',
    query: '(member_call_expression name: (name) @method arguments: (arguments (argument (_) @arg)))',
    require: ['method', 'arg'],
    anchor: 'method',
    checks: [
      { capture: 'method', pattern: '^(query|prepare|exec|execute)$', when: 'must' },
      { capture: 'arg', pattern: '["\'][^"\']*["\']\\s*\\.|\\.\\s*["\']|\\$\\{', when: 'must' },
    ],
  }),
  define(SQL_BUILD, {
    grammar: 'java',
    query: '(method_invocation name: (identifier) @method arguments: (argument_list (_) @arg))',
    require: ['method', 'arg'],
    anchor: 'method',
    checks: [
      {
        capture: 'method',
        pattern: '^(executeQuery|executeUpdate|execute|prepareStatement|createQuery|nativeQuery|jql)$',
        when: 'must',
      },
      { capture: 'arg', pattern: '"[^"]*"\\s*\\+|\\+\\s*"|"\\s*\\.format\\(|%s"\\s*%|\\+\\s*[A-Za-z_$]', when: 'must' },
    ],
  }),
  define(SQL_BUILD, {
    grammar: 'c_sharp',
    query: '(object_creation_expression type: (_) @type arguments: (argument_list (_) @arg))',
    require: ['type', 'arg'],
    anchor: 'type',
    checks: [
      {
        capture: 'type',
        pattern: '^(SqlCommand|OleDbCommand|MySqlCommand|NpgsqlCommand|SQLiteCommand|DbCommand)$',
        when: 'must',
      },
      { capture: 'arg', pattern: '"[^"]*"\\s*\\+|\\+\\s*"|\\$"[^"]*\\{|"\\s*\\.Format\\(', when: 'must' },
    ],
    message: 'The query text for @type@ is built by string operations: @arg@',
  }),
  define(SQL_BUILD, {
    grammar: 'c_sharp',
    query: '(invocation_expression function: (member_access_expression name: (identifier) @method) arguments: (argument_list (_) @arg))',
    require: ['method', 'arg'],
    anchor: 'method',
    checks: [
      {
        capture: 'method',
        pattern: '^(Query|QueryFirst|QuerySingle|Execute|ExecuteAsync|QueryAsync|FromSqlRaw|FromSqlInterpolated)$',
        when: 'must',
      },
      { capture: 'arg', pattern: '"[^"]*"\\s*\\+|\\+\\s*"|\\$"[^"]*\\{|"\\s*\\.Format\\(', when: 'must' },
    ],
  }),
  define(SQL_BUILD, {
    grammar: 'go',
    query: '(call_expression function: (selector_expression field: (field_identifier) @method) arguments: (argument_list (_) @arg))',
    require: ['method', 'arg'],
    anchor: 'method',
    checks: [
      { capture: 'method', pattern: '^(Query|QueryRow|QueryContext|Exec|ExecContext)$', when: 'must' },
      { capture: 'arg', pattern: '"[^"]*"\\s*\\+|\\+\\s*"|fmt\\.Sprintf\\(', when: 'must' },
    ],
  }),
  define(SQL_BUILD, {
    grammar: 'ruby',
    query: '(call method: (identifier) @method arguments: (argument_list (_) @arg))',
    require: ['method', 'arg'],
    anchor: 'method',
    checks: [
      { capture: 'method', pattern: '^(query|exec|execute|find_by_sql|select_all)$', when: 'must' },
      {
        capture: 'arg',
        pattern: '["\'][^"\']*["\']\\s*\\+|\\+\\s*["\']|"\\{.*\\}"|%\\{|\\.format\\(',
        when: 'must',
      },
    ],
  }),
  // 26 — Java: a method whose own name says query builds its text instead of receiving it.
  define(SQL_BUILD, {
    grammar: 'java',
    query: '(method_declaration name: (identifier) @name body: (block (return_statement (_) @val)))',
    require: ['name', 'val'],
    anchor: 'val',
    checks: [
      { capture: 'name', pattern: '[Qq]uery|[Ss][Qq][Ll]', when: 'must' },
      {
        capture: 'val',
        pattern:
          '[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]',
        when: 'must',
      },
      {
        capture: 'val',
        pattern: '"[^"]*"\\s*\\+|\\+\\s*"|"\\s*\\.format\\(|%s"\\s*%|\\+\\s*[A-Za-z_$]',
        when: 'must',
      },
    ],
    message: 'The query returned by @name@ is built by concatenation or interpolation: @val@',
    explanation:
      'The parse tree shows a function whose own name presents it as a query builder, returning a string expression rather than a plain literal: `+`, `.format()` or a `%s` template. That shape is how SQL injection normally arrives, and it is also how a legitimate dynamic table or column name is built.',
    limitations: [
      'Only a function whose name contains `query` or `sql` is considered, so a builder named something else is invisible to this rule.',
      'The returned expression is read as written: SQL assembled into a variable earlier in the function, or in another file, is not detected.',
      'One file is analysed at a time, so BugPilot cannot see whether the interpolated part is user input or a constant.',
      'Column, table and ORDER BY names cannot be bound as parameters, so some of these uses are correct and only need review.',
      'Only a `return` written directly inside the method body is read; text assembled inside an `if` or loop body is not reported.',
    ],
  }),
  // 27 — C#: same builder shape as Java, with C# interpolation and .Format.
  define(SQL_BUILD, {
    grammar: 'c_sharp',
    query: '(method_declaration name: (identifier) @name body: (block (return_statement (_) @val)))',
    require: ['name', 'val'],
    anchor: 'val',
    checks: [
      { capture: 'name', pattern: '[Qq]uery|[Ss][Qq][Ll]', when: 'must' },
      {
        capture: 'val',
        pattern:
          '[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]',
        when: 'must',
      },
      {
        capture: 'val',
        pattern: '"[^"]*"\\s*\\+|\\+\\s*"|\\$"[^"]*\\{|"\\s*\\.Format\\(',
        when: 'must',
      },
    ],
    message: 'The query returned by @name@ is built by concatenation or interpolation: @val@',
    explanation:
      'The parse tree shows a function whose own name presents it as a query builder, returning a string expression rather than a plain literal: `+`, `$"…{…}"` interpolation or `.Format()`. That shape is how SQL injection normally arrives, and it is also how a legitimate dynamic table or column name is built.',
    limitations: [
      'Only a function whose name contains `query` or `sql` is considered, so a builder named something else is invisible to this rule.',
      'The returned expression is read as written: SQL assembled into a variable earlier in the function, or in another file, is not detected.',
      'One file is analysed at a time, so BugPilot cannot see whether the interpolated part is user input or a constant.',
      'Column, table and ORDER BY names cannot be bound as parameters, so some of these uses are correct and only need review.',
      'Only a `return` written directly inside the method body is read; text assembled inside an `if` or loop body is not reported.',
    ],
  }),
  // 28 — PHP: a user function returning a dotted-together query.
  define(SQL_BUILD, {
    grammar: 'php',
    query: '(function_definition name: (name) @name body: (compound_statement (return_statement (_) @val)))',
    require: ['name', 'val'],
    anchor: 'val',
    checks: [
      { capture: 'name', pattern: '[Qq]uery|[Ss][Qq][Ll]', when: 'must' },
      {
        capture: 'val',
        pattern:
          '[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]',
        when: 'must',
      },
      { capture: 'val', pattern: '["\'][^"\']*["\']\\s*\\.|\\.\\s*["\']|\\$\\{', when: 'must' },
    ],
    message: 'The query returned by @name@ is built by concatenation or interpolation: @val@',
    explanation:
      'The parse tree shows a function whose own name presents it as a query builder, returning a string expression rather than a plain literal: the `.` concatenating operator or `"…${…}"` interpolation. That shape is how SQL injection normally arrives, and it is also how a legitimate dynamic table or column name is built.',
    limitations: [
      'Only a function whose name contains `query` or `sql` is considered, so a builder named something else is invisible to this rule.',
      'The returned expression is read as written: SQL assembled into a variable earlier in the function, or in another file, is not detected.',
      'One file is analysed at a time, so BugPilot cannot see whether the interpolated part is user input or a constant.',
      'Column, table and ORDER BY names cannot be bound as parameters, so some of these uses are correct and only need review.',
      'Only a `return` written directly inside the function body is read; text assembled inside a branch or loop is not reported.',
    ],
  }),
  // 29 — Go: a function returning a concatenated query. The statements of a Go block sit inside
  // statement_list, and a return's value inside expression_list; both levels are part of the query.
  define(SQL_BUILD, {
    grammar: 'go',
    query:
      '(function_declaration name: (identifier) @name body: (block (statement_list (return_statement (expression_list (_) @val)))))',
    require: ['name', 'val'],
    anchor: 'val',
    checks: [
      { capture: 'name', pattern: '[Qq]uery|[Ss][Qq][Ll]', when: 'must' },
      {
        capture: 'val',
        pattern:
          '[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]',
        when: 'must',
      },
      { capture: 'val', pattern: '"[^"]*"\\s*\\+|\\+\\s*"|fmt\\.Sprintf\\(', when: 'must' },
    ],
    message: 'The query returned by @name@ is built by concatenation or interpolation: @val@',
    explanation:
      'The parse tree shows a function whose own name presents it as a query builder, returning a string expression rather than a plain literal: `+` or `fmt.Sprintf`. That shape is how SQL injection normally arrives, and it is also how a legitimate dynamic table or column name is built.',
    limitations: [
      'Only a function whose name contains `query` or `sql` is considered, so a builder named something else is invisible to this rule.',
      'The returned expression is read as written: SQL assembled into a variable earlier in the function, or in another file, is not detected.',
      'One file is analysed at a time, so BugPilot cannot see whether the interpolated part is user input or a constant.',
      'Column, table and ORDER BY names cannot be bound as parameters, so some of these uses are correct and only need review.',
      'Go nests statements in a block, so only a `return` written directly in the function body is read.',
    ],
  }),
  // 30 — Ruby: the last expression of a method is its return value, so the body itself is read.
  define(SQL_BUILD, {
    grammar: 'ruby',
    query: '(method name: (identifier) @name body: (_) @val)',
    require: ['name', 'val'],
    anchor: 'val',
    checks: [
      { capture: 'name', pattern: '[Qq]uery|[Ss][Qq][Ll]', when: 'must' },
      {
        capture: 'val',
        pattern:
          '[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Uu][Pp][Dd][Aa][Tt][Ee]|[Dd][Ee][Ll][Ee][Tt][Ee]',
        when: 'must',
      },
      {
        capture: 'val',
        pattern: '["\'][^"\']*["\']\\s*\\+|\\+\\s*["\']|"[^"]*#\\{[^}]*\\}|%\\{|\\.format\\(',
        when: 'must',
      },
    ],
    message: 'The query returned by @name@ is built by concatenation or interpolation: @val@',
    explanation:
      'The parse tree shows a method whose own name presents it as a query builder, whose body evaluates to a string expression rather than a plain literal: `+`, `"…#{…}"` interpolation or `%{…}`. That shape is how SQL injection normally arrives, and it is also how a legitimate dynamic table or column name is built.',
    limitations: [
      'Only a method whose name contains `query` or `sql` is considered, so a builder named something else is invisible to this rule.',
      'The returned expression is read as written: SQL assembled into a variable earlier in the function, or in another file, is not detected.',
      'One file is analysed at a time, so BugPilot cannot see whether the interpolated part is user input or a constant.',
      'Column, table and ORDER BY names cannot be bound as parameters, so some of these uses are correct and only need review.',
      'The whole method body is read as one text, so a multi-statement Ruby builder is reported at its `def` line.',
    ],
  }),
]
