// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Language, Parser, Query } from 'web-tree-sitter'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SourceLanguage } from '../archive/classify'
import { makeRuleFile } from '../rules/context'
import type { RuleFile } from '../rules/types'
import type { GrammarId } from './assets'
import { AST_RULES } from './astQueries'
import { evaluateAstRule, type AstMatchLike, type AstRuleDefinition } from './astRules'
import { scanSyntax } from './syntax'

/**
 * The comment in `astQueries.ts` claims every query was run against the grammar it ships for.
 * This file is that evidence: it compiles each query with the real WebAssembly grammar and
 * replays one positive and at least one lookalike negative per rule. `astRules.test.ts` proves
 * the evaluator with a fake `runQuery`; only this proves the table.
 *
 * Fixtures are matched to rules by index and re-checked against each rule's own query text, so
 * an edit to a query cannot silently reuse the old fixture.
 */

const NODE_MODULES = resolve(process.cwd(), 'node_modules')
const CORE_WASM = resolve(NODE_MODULES, 'web-tree-sitter/web-tree-sitter.wasm')
const grammarPath = (grammar: GrammarId): string =>
  resolve(NODE_MODULES, `tree-sitter-wasm/out/${grammar}/tree-sitter-${grammar}.wasm`)

interface Fixture {
  /** Must equal the query of the rule at the same index. */
  query: string
  positive: string
  negatives: readonly string[]
}

const GRAMMAR_LANGUAGE: Record<GrammarId, SourceLanguage> = {
  python: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  c_sharp: 'csharp',
  php: 'php',
  go: 'go',
  ruby: 'ruby',
  bash: 'shell',
  css: 'css',
  html: 'html',
  kotlin: 'kotlin',
  rust: 'rust',
  sql: 'sql',
  swift: 'swift',
  yaml: 'yaml',
}

const FILE_NAME: Partial<Record<GrammarId, string>> = {
  python: 'sample.py',
  java: 'Sample.java',
  c: 'sample.c',
  cpp: 'sample.cpp',
  c_sharp: 'Sample.cs',
  php: 'sample.php',
  go: 'sample.go',
  ruby: 'sample.rb',
}

/** One entry per rule in `AST_RULES`, in the same order. */
const FIXTURES: readonly Fixture[] = [
  // 0 — Python handler whose whole body is `pass`.
  {
    query: '(except_clause (block . (pass_statement) .)) @ex',
    positive: 'try:\n    call()\nexcept ValueError:\n    pass\n',
    negatives: ['try:\n    call()\nexcept ValueError:\n    log.exception("call failed")\n'],
  },
  // 1 — Python handler whose body is an ellipsis.
  {
    query: '(except_clause (block . (expression_statement (ellipsis)) .)) @ex',
    positive: 'try:\n    call()\nexcept ValueError:\n    ...\n',
    negatives: ['try:\n    call()\nexcept ValueError:\n    raise\n'],
  },
  // 2 — Java.
  {
    query: '(catch_clause body: (block) @body)',
    positive: 'class A {\n    void m() {\n        try { read(); } catch (Exception e) { }\n    }\n}\n',
    negatives: ['class A {\n    void m() {\n        try { read(); } catch (Exception e) { log(e); }\n    }\n}\n',
      'class A {\n    void m() {\n        try { read(); } catch (Exception e) { /* ignored on purpose for now */ }\n    }\n}\n',
    ],
  },
  // 3 — C#.
  {
    query: '(catch_clause (block) @body)',
    positive: 'class A {\n    void M() {\n        try { Read(); } catch (Exception e) { }\n    }\n}\n',
    negatives: ['class A {\n    void M() {\n        try { Read(); } catch (Exception e) { Console.WriteLine(e); }\n    }\n}\n',
    ],
  },
  // 4 — PHP.
  {
    query: '(catch_clause body: (compound_statement) @body)',
    positive: '<?php\ntry {\n    fetch();\n} catch (Exception $e) {\n}\n',
    negatives: ['<?php\ntry {\n    fetch();\n} catch (Exception $e) {\n    error_log($e->getMessage());\n}\n',
    ],
  },
  // 5 — Ruby `rescue` with no body.
  {
    query: '(rescue) @ex',
    positive: 'begin\n  fetch\nrescue\nend\n',
    negatives: ['begin\n  fetch\nrescue\n  log(error)\nend\n'],
  },
  // 6 — Ruby handler that returns only nil.
  {
    query: '(rescue body: (then (nil)) @body)',
    positive: 'begin\n  fetch\nrescue\n  nil\nend\n',
    negatives: ['begin\n  fetch\nrescue\n  log(error)\nend\n'],
  },
  // 7 — bare `except:`.
  {
    query: '(except_clause) @ex',
    positive: 'try:\n    call()\nexcept:\n    log("failed")\n',
    negatives: [
      'try:\n    call()\nexcept ValueError:\n    log("failed")\n',
      'try:\n    call()\nexcept Exception:\n    log("failed")\n',
      'try:\n    call()\nexcept (ValueError, KeyError):\n    log("failed")\n',
    ],
  },
  // 8 — Python statement after a jump.
  {
    query: '(block [(return_statement) (raise_statement) (break_statement) (continue_statement)] (_) @after)',
    positive: 'def f():\n    return 1\n    print("never runs")\n',
    negatives: [
      'def f():\n    return 1\n    # a note, not a statement\n',
      'def f():\n    return 1\n    def inner():\n        pass\n',
      'def f(x):\n    if x:\n        return 1\n    print("runs")\n',
    ],
  },
  // 9 — Java.
  {
    query: '(block [(return_statement) (throw_statement) (break_statement) (continue_statement)] (_) @after)',
    positive: 'class A {\n    int m() {\n        return 1;\n        finish();\n    }\n}\n',
    negatives: ['class A {\n    int m() {\n        if (x) { return 1; }\n        finish();\n    }\n}\n'],
  },
  // 10 — C.
  {
    query: '(compound_statement [(return_statement) (break_statement) (continue_statement) (goto_statement)] (_) @after)',
    positive: 'int m(void) {\n    return 1;\n    free(p);\n}\n',
    negatives: ['void loop(void) {\n    for (;;) {\n        if (done) {\n            break;\n        }\n        step();\n    }\n}\n'],
  },
  // 11 — C++.
  {
    query:
      '(compound_statement [(return_statement) (break_statement) (continue_statement) (goto_statement) (throw_statement)] (_) @after)',
    positive: 'void f() {\n    throw 1;\n    g();\n}\n',
    negatives: ['void f(int n) {\n    switch (n) {\n    case 1:\n        a();\n        break;\n    }\n    g();\n}\n'],
  },
  // 12 — C#.
  {
    query: '(block [(return_statement) (throw_statement) (break_statement) (continue_statement)] (_) @after)',
    positive: 'class A {\n    int M() {\n        return 1;\n        Finish();\n    }\n}\n',
    negatives: ['class A {\n    int M() {\n        if (x) {\n            return 1;\n        }\n        Finish();\n    }\n}\n'],
  },
  // 13 — Go.
  {
    query:
      '(statement_list [(return_statement) (break_statement) (continue_statement) (goto_statement) (fallthrough_statement)] (_) @after)',
    positive: 'package main\n\nfunc m() int {\n\treturn 1\n\tprintln("never")\n\treturn 2\n}\n',
    negatives: ['package main\n\nfunc m() int {\n\tif x {\n\t\treturn 1\n\t}\n\treturn 2\n}\n'],
  },
  // 14 — PHP.
  {
    query:
      '(compound_statement [(return_statement) (break_statement) (continue_statement) (expression_statement (throw_expression))] (_) @after)',
    positive: '<?php\nfunction m() {\n    return 1;\n    do_thing();\n}\n',
    negatives: ['<?php\nfunction m() {\n    if ($x) {\n        return 1;\n    }\n    do_thing();\n}\n'],
  },
  // 15 — Ruby.
  {
    query: '(body_statement (return) (_) @after)',
    positive: 'def m\n  return 1\n  puts "never"\nend\n',
    negatives: ['def m(x)\n  if x\n    return 1\n  end\n  puts "runs"\nend\n'],
  },
  // 16 — C assignment in a condition.
  {
    query:
      '((if_statement) (while_statement) (for_statement) (do_statement)) condition: (parenthesized_expression (_) @cond)',
    positive: 'int f(void) {\n    int n;\n    if (n = count()) {\n        return n;\n    }\n    return 0;\n}\n',
    negatives: [
      'int f(int a, int b) {\n    if (a == b) {\n        return 1;\n    }\n    return 0;\n}\n',
      'int f(int a, int b) {\n    if (a >= b) {\n        return 1;\n    }\n    return 0;\n}\n',
      'int f(int n) {\n    for (int i = 0; i < n; i++) {\n        use(i);\n    }\n    return 0;\n}\n',
    ],
  },
  // 17 — C++ assignment in a condition.
  {
    query: '((if_statement) (while_statement) (do_statement) (for_statement)) condition: (_ (_) @cond)',
    positive: 'bool f() {\n    int n;\n    if (n = count()) {\n        return true;\n    }\n    return false;\n}\n',
    negatives: ['bool f(int a, int b) {\n    if (a == b) {\n        return true;\n    }\n    return false;\n}\n'],
  },
  // 18 — PHP assignment in a condition.
  {
    query: '((if_statement) (while_statement) (for_statement)) condition: (parenthesized_expression (_) @cond)',
    positive: '<?php\nfunction f($a) {\n    if ($x = count($a)) {\n        return $x;\n    }\n    return 0;\n}\n',
    negatives: ['<?php\nfunction f($a, $b) {\n    if ($a === $b) {\n        return 1;\n    }\n    return 0;\n}\n'],
  },
  // 19 — Python query text built from parts.
  {
    query: '(call function: (attribute attribute: (identifier) @method) arguments: (argument_list (_) @arg))',
    positive: 'cursor.execute("SELECT * FROM t WHERE id = " + user_id)\n',
    negatives: ['cursor.execute("SELECT id FROM t WHERE id = %s", (user_id,))\n'],
  },
  // 20 — PHP.
  {
    query: '(member_call_expression name: (name) @method arguments: (arguments (argument (_) @arg)))',
    positive: '<?php\n$rows = $pdo->query("SELECT * FROM t WHERE id = " . $id);\n',
    negatives: ['<?php\n$rows = $pdo->query("SELECT id FROM t");\n'],
  },
  // 21 — Java.
  {
    query: '(method_invocation name: (identifier) @method arguments: (argument_list (_) @arg))',
    positive:
      'class A {\n    void m(java.sql.Statement s, String u) throws Exception {\n        s.executeQuery("SELECT * FROM t WHERE id = " + u);\n    }\n}\n',
    negatives: ['class A {\n    void m(java.sql.Statement s) throws Exception {\n        s.executeQuery("SELECT id FROM t");\n    }\n}\n'],
  },
  // 22 — C# command object.
  {
    query: '(object_creation_expression type: (_) @type arguments: (argument_list (_) @arg))',
    positive: 'class A {\n    void M(string id) {\n        var cmd = new SqlCommand("SELECT * FROM t WHERE id = " + id);\n    }\n}\n',
    negatives: ['class A {\n    void M() {\n        var cmd = new SqlCommand("SELECT id FROM t");\n    }\n}\n'],
  },
  // 23 — C# micro-ORM call.
  {
    query:
      '(invocation_expression function: (member_access_expression name: (identifier) @method) arguments: (argument_list (_) @arg))',
    positive: 'class A {\n    void M(string id) {\n        var rows = conn.Query("SELECT * FROM t WHERE id = " + id);\n    }\n}\n',
    negatives: ['class A {\n    void M() {\n        var rows = conn.Query("SELECT id FROM t");\n    }\n}\n'],
  },
  // 24 — Go database/sql.
  {
    query:
      '(call_expression function: (selector_expression field: (field_identifier) @method) arguments: (argument_list (_) @arg))',
    positive: 'package main\n\nfunc m(db *sql.DB, id string) {\n\trows, _ := db.Query("SELECT * FROM t WHERE id = " + id)\n\t_ = rows\n}\n',
    negatives: ['package main\n\nfunc m(db *sql.DB) {\n\trows, _ := db.Query("SELECT id FROM t")\n\t_ = rows\n}\n'],
  },
  // 25 — Ruby driver.
  {
    query: '(call method: (identifier) @method arguments: (argument_list (_) @arg))',
    positive: 'rows = conn.query("SELECT * FROM t WHERE id = " + id)\n',
    negatives: ['rows = conn.query("SELECT id FROM t")\n'],
  },
  // 26 — Java query builder.
  {
    query: '(method_declaration name: (identifier) @name body: (block (return_statement (_) @val)))',
    positive: 'class A {\n    public static String buildQueryCurrency(String ledgerName) {\n        return "SELECT * FROM ledger WHERE name = " + ledgerName;\n    }\n}\n',
    negatives: [
      'class A {\n    public static String buildQueryCategory(String ledgerName) {\n        return "SELECT * FROM ledger WHERE name = ?";\n    }\n}\n',
      'class A {\n    public static String buildQueryLabel(String ledgerName) {\n        return "Ledger for " + ledgerName;\n    }\n}\n',
    ],
  },
  // 27 — C# query builder.
  {
    query: '(method_declaration name: (identifier) @name body: (block (return_statement (_) @val)))',
    positive: 'class A {\n    public static string BuildQueryCurrency(string ledgerName) {\n        return "SELECT * FROM ledger WHERE name = " + ledgerName;\n    }\n}\n',
    negatives: [
      'class A {\n    public static string BuildQueryCategory(string ledgerName) {\n        return "SELECT * FROM ledger WHERE name = ?";\n    }\n}\n',
      'class A {\n    public static string BuildQueryLabel(string ledgerName) {\n        return "Ledger for " + ledgerName;\n    }\n}\n',
    ],
  },
  // 28 — PHP query builder.
  {
    query: '(function_definition name: (name) @name body: (compound_statement (return_statement (_) @val)))',
    positive: '<?php\nfunction build_query_currency(string $ledgerName): string {\n    return "SELECT * FROM ledger WHERE name = " . $ledgerName;\n}\n',
    negatives: [
      '<?php\nfunction build_query_category(string $ledgerName): string {\n    return "SELECT * FROM ledger WHERE name = ?";\n}\n',
      '<?php\nfunction build_query_label(string $ledgerName): string {\n    return "Ledger for " . $ledgerName;\n}\n',
    ],
  },
  // 29 — Go query builder.
  {
    query: '(function_declaration name: (identifier) @name body: (block (statement_list (return_statement (expression_list (_) @val)))))',
    positive: 'func BuildQueryCurrency(ledgerName string) string {\n\treturn "SELECT * FROM ledger WHERE name = " + ledgerName\n}\n',
    negatives: [
      'func BuildQueryCategory(ledgerName string) string {\n\treturn "SELECT * FROM ledger WHERE name = ?"\n}\n',
      'func BuildQueryLabel(ledgerName string) string {\n\treturn "Ledger for " + ledgerName\n}\n',
    ],
  },
  // 30 — Ruby query builder: the last expression of the method is the query text.
  {
    query: '(method name: (identifier) @name body: (_) @val)',
    positive: 'def build_query_currency(ledger_name)\n  "SELECT * FROM ledger WHERE name = #{ledger_name}"\nend\n',
    negatives: [
      'def build_query_category(ledger_name)\n  "SELECT * FROM ledger WHERE name = ?"\nend\n',
      'def build_query_label(ledger_name)\n  "Ledger for " + ledger_name\nend\n',
    ],
  },
  // 31 — C++ empty handler.
  {
    query: '(catch_clause body: (compound_statement) @body)',
    positive: 'class A {\n    void m() {\n        try { read(); } catch (const std::exception& e) { }\n    }\n}\n',
    negatives: [
      'class A {\n    void m() {\n        try { read(); } catch (const std::exception& e) { log(e.what()); }\n    }\n}\n',
      'class A {\n    void m() {\n        try { read(); } catch (const std::exception& e) { /* ignored on purpose */ }\n    }\n}\n',
    ],
  },
]

const grammars = new Map<GrammarId, Language>()

function ruleFileFor(grammar: GrammarId, text: string): RuleFile {
  return makeRuleFile({
    name: FILE_NAME[grammar] ?? `sample.${grammar}`,
    text,
    language: GRAMMAR_LANGUAGE[grammar],
    languageSource: 'extension',
    encoding: 'utf-8',
  })
}

/** Parses `code` and runs exactly one rule over it, the way the worker does. */
function analyse(rule: AstRuleDefinition, code: string): { hits: ReturnType<typeof evaluateAstRule>; sexp: string } {
  const language = grammars.get(rule.grammar)
  if (!language) throw new Error(`Grammar ${rule.grammar} was not loaded.`)
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(code)
  if (!tree) throw new Error(`The ${rule.grammar} parser returned no tree.`)
  try {
    const hits = evaluateAstRule(rule, {
      file: ruleFileFor(rule.grammar, code),
      grammar: rule.grammar,
      runQuery: (source: string) => {
        const query = new Query(language, source)
        try {
          return query.matches(tree.rootNode as never) as unknown as AstMatchLike[]
        } finally {
          query.delete()
        }
      },
      maxHits: 50,
    })
    // Printed only when an assertion below fails: it is the fastest way to see what the
    // grammar actually built.
    return { hits, sexp: tree.rootNode.toString().slice(0, 700) }
  } finally {
    tree.delete()
    parser.delete()
  }
}

describe('AST queries against the shipped grammars', () => {
  beforeAll(async () => {
    await Parser.init({ locateFile: () => CORE_WASM })
    const needed = new Set<GrammarId>(AST_RULES.map((rule) => rule.grammar))
    for (const grammar of needed) {
      const bytes = new Uint8Array(readFileSync(grammarPath(grammar)))
      grammars.set(grammar, await Language.load(bytes))
    }
  }, 120_000)

  it('loads every grammar the rule table is written for', () => {
    const needed = new Set<GrammarId>(AST_RULES.map((rule) => rule.grammar))
    expect(grammars.size).toBe(needed.size)
    expect([...needed].sort()).toEqual(['c', 'c_sharp', 'cpp', 'go', 'java', 'php', 'python', 'ruby'])
  })

  it('compiles every query with its own grammar', () => {
    for (const rule of AST_RULES) {
      const language = grammars.get(rule.grammar)
      expect(language, `${rule.id} needs grammar ${rule.grammar}`).toBeDefined()
      // A node name the grammar does not have makes `new Query` throw, and the evaluator
      // swallows that into zero hits, so the throw is asserted here instead.
      const build = () => new Query(language as never, rule.query).delete()
      expect(build, `${rule.id} :: ${rule.query}`).not.toThrow()
    }
  })

  it('keeps one fixture per rule, wired to that rule query', () => {
    expect(FIXTURES).toHaveLength(AST_RULES.length)
    AST_RULES.forEach((rule, index) => {
      expect(FIXTURES[index].query, `fixture ${index} for ${rule.id}`).toBe(rule.query)
    })
  })

  it('finds the bug in every positive fixture and nothing in its lookalike', () => {
    AST_RULES.forEach((rule, index) => {
      const fixture = FIXTURES[index]
      const key = `${index} ${rule.id} (${rule.grammar})`

      const positive = analyse(rule, fixture.positive)
      expect(positive.hits.length, `${key} found nothing in\n${fixture.positive}\n${positive.sexp}`).toBeGreaterThan(0)
      expect(positive.hits[0].ruleId, key).toBe(rule.id)

      for (const code of fixture.negatives) {
        const result = analyse(rule, code)
        expect(result.hits, `${key} reported on\n${code}\n${result.sexp}`).toEqual([])
      }
    })
  })

  it('reports extra positive shapes the same rule is meant to catch', () => {
    const pythonSql = AST_RULES[19]
    for (const code of [
      'cursor.execute(f"SELECT * FROM t WHERE id = {user_id}")\n',
      'cursor.execute("SELECT * FROM t WHERE id = %s" % (user_id,))\n',
      'cursor.execute("SELECT * FROM {}".format(table))\n',
    ]) {
      const result = analyse(pythonSql, code)
      expect(result.hits.length, code).toBeGreaterThan(0)
    }

    const cSharpSql = AST_RULES[23]
    const interpolated = analyse(cSharpSql, 'class A {\n    void M(int id) {\n        var rows = conn.Query($"SELECT * FROM t WHERE id = {id}");\n    }\n}\n')
    expect(interpolated.hits.length).toBeGreaterThan(0)

    const goSql = AST_RULES[24]
    const formatted = analyse(
      goSql,
      'package main\n\nfunc m(db *sql.DB, id int) {\n\trows, _ := db.Query(fmt.Sprintf("SELECT * FROM t WHERE id = %d", id))\n\t_ = rows\n}\n',
    )
    expect(formatted.hits.length).toBeGreaterThan(0)

    // C++ also catches everything, and the empty body may be written across lines.
    const cppEmpty = AST_RULES.find(
      (candidate) => candidate.id === 'bugpilot/ast/empty-catch' && candidate.grammar === 'cpp',
    )
    if (!cppEmpty) throw new Error('The C++ empty-handler rule is missing.')
    const catchAll = analyse(
      cppEmpty,
      'class A {\n    void m() {\n        try {\n            read();\n        } catch (...) {\n        }\n    }\n}\n',
    )
    expect(catchAll.hits.length).toBeGreaterThan(0)
  })

  it('writes a finding that quotes the tree and offers no automatic edit', () => {
    const { hits } = analyse(AST_RULES[0], 'try:\n    call()\nexcept ValueError:\n    pass\n')
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    expect(hit.engine).toBe('tree-sitter')
    expect(hit.tier).toBe('pattern')
    expect(hit.range.startLine).toBe(3)
    expect(hit.message).toContain('except ValueError:')
    expect(hit.evidence[0].quote).toContain('except ValueError:')
    expect(hit.fix?.riskClass).toBe('manual-only')
    expect(hit.fix?.exampleCode).toBe('')
    expect(hit.limitations.length).toBeGreaterThan(0)
    expect(hit.verificationSteps.length).toBeGreaterThan(0)
  })

  it('keeps the syntax finding and drops the unreachable-code cascade after a missing brace in C', () => {
    const cGrammar: GrammarId = 'c'
    const language = grammars.get(cGrammar)
    if (!language) throw new Error('C grammar must be loaded')

    const code = [
      'int broken(void) {',
      '    return 1;',
      '    int n = 2;',
      '    return n;',
      'int fine(void) {',
      '    return 0;',
      '    cleanup();',
      '}',
      '',
    ].join('\n')

    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(code)
    const file = ruleFileFor(cGrammar, code)
    const rule = AST_RULES.find((candidate) => candidate.id === 'bugpilot/ast/unreachable-code' && candidate.grammar === cGrammar)
    if (!rule || !tree) throw new Error('The C rule or the parse tree is missing.')

    const runQuery = (source: string) => {
      const query = new Query(language, source)
      try {
        return query.matches(tree.rootNode as never) as unknown as AstMatchLike[]
      } finally {
        query.delete()
      }
    }

    try {
      // Without the guard the broken tree cascades the jump statement into the next
      // function, so this proves the fixture really has a damaged tree to distrust.
      const unfiltered = evaluateAstRule(rule, { file, grammar: cGrammar, runQuery, maxHits: 50 })
      expect(unfiltered.length, `the fixture must cascade before filtering:\n${tree.rootNode.toString().slice(0, 900)}`).toBeGreaterThan(0)

      const syntax = scanSyntax({ file, root: tree.rootNode as never, grammar: cGrammar })
      expect(syntax.hits.length, 'the syntax finding must survive').toBeGreaterThan(0)
      expect(syntax.firstErrorIndex).not.toBeNull()

      const filtered = evaluateAstRule(rule, {
        file,
        grammar: cGrammar,
        runQuery,
        maxHits: 50,
        firstErrorIndex: syntax.firstErrorIndex,
      })
      expect(filtered, tree.rootNode.toString().slice(0, 900)).toEqual([])
    } finally {
      tree.delete()
      parser.delete()
    }
  })
})
