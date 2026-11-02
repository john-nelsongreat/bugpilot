import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { buildLineStarts } from './context'
import { ruleById } from './registry'
import type { RuleFile } from './types'

function makeFile(path: string, text: string): RuleFile {
  const detection = detectLanguage(path, text)
  return {
    file: path,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    text,
    lines: text.split('\n'),
    lineStarts: buildLineStarts(text),
  }
}

function hits(ruleId: string, path: string, text: string) {
  const rule = ruleById(ruleId)
  if (!rule) throw new Error(`missing rule ${ruleId}`)
  return rule.check(makeFile(path, text))
}

describe('generic rule: merge-conflict markers', () => {
  const id = 'bugpilot/generic/merge-conflict-markers'

  it('reports one finding for a complete conflict block', () => {
    const text = [
      'const a = 1',
      '<<<<<<< HEAD',
      'const b = 2',
      '=======',
      'const b = 3',
      '>>>>>>> feature',
      'const c = 4',
    ].join('\n')
    const [hit] = hits(id, 'src/app.js', text)

    expect(hit.message).toMatch(/conflict/i)
    expect(hit.severity ?? 'High').toBe('High')
    expect(hit.range.startLine).toBe(2)
    expect(hit.range.endLine).toBe(6)
    expect(hit.evidence).toHaveLength(2)
  })

  it('reports an opening marker even when the closing marker is missing', () => {
    const [hit] = hits(id, 'README.md', 'Intro\n<<<<<<< HEAD\nleft side only\n')
    expect(hit.range.startLine).toBe(2)
    expect(hit.explanation).toMatch(/closing marker/i)
  })

  it('does not fire on a Markdown underline made of equals signs', () => {
    expect(hits(id, 'README.md', 'A heading\n=======\n\nText.\n')).toHaveLength(0)
  })

  it('does not fire on prose that mentions the markers inline', () => {
    expect(hits(id, 'README.md', 'Git writes <<<<<<< and >>>>>>> around conflicted lines.\n')).toHaveLength(0)
  })
})

describe('generic rule: TODO marker', () => {
  const id = 'bugpilot/generic/todo-marker'

  it('finds TODO, FIXME and HACK markers with low severity', () => {
    const found = hits(id, 'src/app.js', '// TODO: handle empty input\n// FIXME: race\n// HACK: remove later\n')
    expect(found.map((hit) => hit.message)).toEqual([
      'TODO marker in this file.',
      'FIXME marker in this file.',
      'HACK marker in this file.',
    ])
    expect(found.every((hit) => (hit.severity ?? 'Low') === 'Low')).toBe(true)
  })

  it('does not fire on lowercase prose or a longer identifier', () => {
    expect(hits(id, 'README.md', 'This todo list is informal and has no fixme notes.\n')).toHaveLength(0)
    expect(hits(id, 'src/app.js', 'const TODOLIST_SIZE = 10\n')).toHaveLength(0)
  })

  it('reports once per line when a marker repeats', () => {
    expect(hits(id, 'src/app.js', '// TODO TODO revisit this\n')).toHaveLength(1)
  })
})

describe('generic rule: mixed indentation', () => {
  const id = 'bugpilot/generic/mixed-indentation'

  it('reports the first line that uses the other style', () => {
    const text = ['function a() {', '\treturn 1', '}', 'function b() {', '  return 2', '}'].join('\n')
    const [hit] = hits(id, 'src/app.js', text)

    expect(hit.message).toMatch(/tabs and spaces/)
    expect(hit.range.startLine).toBe(5)
    expect(hit.confidence.level).toBe('low')
  })

  it('does not fire when the file uses one style throughout', () => {
    expect(hits(id, 'src/spaces.js', 'function a() {\n  return 1\n}\n')).toHaveLength(0)
    expect(hits(id, 'src/tabs.js', 'function a() {\n\treturn 1\n}\n')).toHaveLength(0)
  })

  it('does not fire on a prose paragraph about tabs and spaces', () => {
    expect(hits(id, 'README.md', 'Tabs and spaces should not be mixed inside one file.\n')).toHaveLength(0)
  })
})

describe('generic rule: long lines and large files', () => {
  it('reports a line over the character threshold', () => {
    const line = `const blob = "${'a'.repeat(1_001)}"`
    const [hit] = hits('bugpilot/generic/long-line', 'src/blob.js', line)

    expect(hit.message).toMatch(/longer than 1,000/)
    expect(hit.confidence.level).toBe('high')
  })

  it('does not report a line exactly at the threshold', () => {
    expect(hits('bugpilot/generic/long-line', 'src/blob.js', 'a'.repeat(1_000))).toHaveLength(0)
  })

  it('reports a file over the line count but not one at it', () => {
    const big = Array.from({ length: 4_001 }, () => 'const a = 1').join('\n')
    const limit = Array.from({ length: 4_000 }, () => 'const a = 1').join('\n')

    expect(hits('bugpilot/generic/large-file', 'src/big.js', big)).toHaveLength(1)
    expect(hits('bugpilot/generic/large-file', 'src/limit.js', limit)).toHaveLength(0)
  })

  it('does not fire on ordinary short files', () => {
    expect(hits('bugpilot/generic/long-line', 'README.md', 'A short sentence.\n')).toHaveLength(0)
    expect(hits('bugpilot/generic/large-file', 'src/small.js', 'const a = 1\n')).toHaveLength(0)
  })
})

describe('generic rule: empty error handler', () => {
  const id = 'bugpilot/generic/empty-catch'

  it.each([
    ['src/app.js', 'try { run() } catch (error) {}\n'],
    ['src/app.ts', 'try { run() } catch {}\n'],
    ['src/App.java', 'try { run(); } catch (Exception e) { }\n'],
    ['src/App.cs', 'try { Run(); } catch (Exception e) { }\n'],
    ['src/app.php', 'try { run(); } catch (Exception $e) { }\n'],
  ])('finds an empty catch block in %s', (path, text) => {
    const [hit] = hits(id, path, text)
    expect(hit.message).toMatch(/Empty catch block/)
    expect(hit.confidence.level).toBe('low')
  })

  it('finds an empty except body in Python', () => {
    const text = 'try:\n    run()\nexcept ValueError:\n    pass\n'
    const [hit] = hits(id, 'src/app.py', text)
    expect(hit.message).toMatch(/Empty except block/)
    expect(hit.range.startLine).toBe(3)
  })

  it('finds an inline pass and skips a handled except', () => {
    expect(hits(id, 'src/app.py', 'try:\n    run()\nexcept ValueError: pass\n')).toHaveLength(1)
    expect(hits(id, 'src/app.py', 'try:\n    run()\nexcept ValueError:\n    raise\n')).toHaveLength(0)
  })

  it('finds an empty rescue in Ruby but not one with a body', () => {
    expect(hits(id, 'src/app.rb', 'begin\n  work\nrescue\nend\n')).toHaveLength(1)
    expect(hits(id, 'src/app.rb', 'begin\n  work\nrescue\n  retry\nend\n')).toHaveLength(0)
  })

  it('finds an empty error check in Go', () => {
    expect(hits(id, 'src/main.go', 'if err != nil {\n}\n')).toHaveLength(1)
    expect(hits(id, 'src/main.go', 'if err != nil {\n\treturn err\n}\n')).toHaveLength(0)
  })

  it('does not fire on a handled error, a commented body or prose', () => {
    expect(hits(id, 'src/app.js', 'try { run() } catch (error) { log(error) }\n')).toHaveLength(0)
    expect(hits(id, 'src/app.js', 'try { run() } catch (error) { /* ignored on purpose */ }\n')).toHaveLength(0)
    expect(hits(id, 'src/app.js', 'The catch block should never be empty.\n')).toHaveLength(0)
  })
})

describe('generic rule: http URL', () => {
  const id = 'bugpilot/generic/insecure-http-url'

  it('reports a non-local http URL with medium confidence', () => {
    const [hit] = hits(id, 'src/api.js', "fetch('http://api.acme-tools.dev/data')\n")

    expect(hit.message).toMatch(/http scheme/)
    expect(hit.confidence.level).toBe('medium')
    expect(hit.evidence[0].quote).toContain('acme-tools.dev')
  })

  it('does not fire on https, local hosts, documentation namespaces or prose', () => {
    expect(hits(id, 'src/api.js', "fetch('https://api.acme-tools.dev/data')\n")).toHaveLength(0)
    expect(hits(id, 'src/api.js', "fetch('http://localhost:3000/data')\n")).toHaveLength(0)
    expect(hits(id, 'src/api.js', "fetch('http://127.0.0.1:8080/data')\n")).toHaveLength(0)
    expect(hits(id, 'src/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n')).toHaveLength(0)
    expect(hits(id, 'README.md', 'Use HTTPS for all API traffic.\n')).toHaveLength(0)
  })

  it('caps the number of reported URLs', () => {
    const text = Array.from({ length: 12 }, (_, i) => `const u${i} = "http://api${i}.acme-tools.dev/x"`).join('\n')
    expect(hits(id, 'src/urls.js', text)).toHaveLength(10)
  })
})
