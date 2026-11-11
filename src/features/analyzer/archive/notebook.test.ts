import { describe, expect, it } from 'vitest'
import {
  NOTEBOOK_MAX_BYTES,
  NOTEBOOK_MAX_CELLS,
  NOTEBOOK_MAX_DEPTH,
  expandNotebooks,
  isNotebookCellName,
  isNotebookName,
  isNotebookOutputName,
  readNotebook,
} from './notebook'
import { DEFAULT_ARCHIVE_LIMITS } from './limits'

/**
 * Every fixture is assembled at runtime: a notebook is exactly the kind of file that stores real
 * credentials, so no committed test may contain a credential-shaped literal, even inside a string.
 */
function notebook(cells: unknown[], metadata: unknown = { kernelspec: { name: 'python' } }): string {
  return JSON.stringify({ cells, metadata, nbformat: 4, nbformat_minor: 5 })
}

function codeCell(source: string[], outputs: unknown[] = []): unknown {
  return { cell_type: 'code', execution_count: 1, metadata: {}, source, outputs }
}

function markdownCell(source: string[]): unknown {
  return { cell_type: 'markdown', metadata: {}, source }
}

function streamOutput(text: string[]): unknown {
  return { output_type: 'stream', name: 'stdout', text }
}

function resultOutput(text: string): unknown {
  return { output_type: 'execute_result', data: { 'text/plain': text }, metadata: {}, execution_count: 1 }
}

describe('reading a Jupyter notebook', () => {
  it('splits a notebook into one entry per code cell, numbered as in the notebook, and ignores markdown', () => {
    const read = readNotebook(
      'nb.ipynb',
      notebook([codeCell(['a = 1\n', 'b = 2\n']), markdownCell(['# Title\n']), codeCell(['c = 3\n'])]),
    )

    expect(read.ok).toBe(true)
    if (read.ok === false) return
    expect(read.cells.map((cell) => cell.name)).toEqual(['nb.ipynb#cell-1', 'nb.ipynb#cell-3'])
    expect(read.cells[0]?.text).toBe('a = 1\nb = 2\n')
    expect(read.cells[1]?.text).toBe('c = 3\n')
  })

  it('takes the language from the kernel metadata, not from the file name', () => {
    const python = readNotebook('nb.ipynb', notebook([codeCell(['a = 1\n'])]))
    const js = readNotebook('nb.ipynb', notebook([codeCell(['const a = 1\n'])], { kernelspec: { name: 'JavaScript (Node)' } }))
    const julia = readNotebook('nb.ipynb', notebook([codeCell(['x = 1\n'])], { kernelspec: { name: 'julia' } }))

    expect(python.ok && python.cells[0]?.language).toBe('python')
    expect(js.ok && js.cells[0]?.language).toBe('javascript')
    expect(julia.ok && julia.cells[0]?.language).toBe('text')
    if (python.ok === false) return
    expect(python.cells[0]?.languageSource).toBe('content')
    expect(python.cells[0]?.encoding).toBe('utf-8')
  })

  it('ignores a notebook that holds only markdown cells', () => {
    const read = readNotebook('nb.ipynb', notebook([markdownCell(['- [ ] a task\n'])]))

    expect(read.ok).toBe(false)
    if (read.ok === true) return
    expect(read.kind).toBe('empty')
    expect(read.refusal).toMatch(/no code cell/i)
  })

  it('collects each stored output as its own entry so the finding names the cell and the output', () => {
    const read = readNotebook(
      'nb.ipynb',
      notebook([codeCell(['print(1)\n'], [streamOutput(['hello\n', 'world\n']), resultOutput('  1')])]),
    )

    expect(read.ok).toBe(true)
    if (read.ok === false) return
    expect(read.outputs.map((output) => output.name)).toEqual([
      'nb.ipynb#cell-1.output-1',
      'nb.ipynb#cell-1.output-2',
    ])
    expect(read.outputs[0]?.text).toContain('hello')
    expect(read.outputs[1]?.text).toContain('1')
    expect(read.cells[0]?.text).toBe('print(1)\n')
  })

  it('names cells and outputs so the pipeline can tell them apart', () => {
    expect(isNotebookName('project/nb.ipynb')).toBe(true)
    expect(isNotebookName('project/nb.py')).toBe(false)
    expect(isNotebookCellName('nb.ipynb#cell-2')).toBe(true)
    expect(isNotebookCellName('nb.ipynb#cell-2.output-1')).toBe(false)
    expect(isNotebookOutputName('nb.ipynb#cell-2.output-1')).toBe(true)
    expect(isNotebookOutputName('nb.ipynb#cell-2.output')).toBe(false)
    expect(isNotebookOutputName('nb.ipynb.output')).toBe(false)
  })

  it('refuses a notebook deeper than the JSON ceiling without parsing it', () => {
    const deep = `${'['.repeat(NOTEBOOK_MAX_DEPTH + 4)}${']'.repeat(NOTEBOOK_MAX_DEPTH + 4)}`
    const read = readNotebook('nb.ipynb', deep)

    expect(read.ok).toBe(false)
    if (read.ok === true) return
    expect(read.refusal).toMatch(/levels deep|depth/i)
    expect(read.refusal).toMatch(NOTEBOOK_MAX_DEPTH.toString())
  })

  it('refuses a notebook over the JSON size ceiling', () => {
    const read = readNotebook('nb.ipynb', `{"cells": ["${'x'.repeat(NOTEBOOK_MAX_BYTES + 1)}"]}`)

    expect(read.ok).toBe(false)
    if (read.ok === true) return
    expect(read.refusal).toMatch(/2 MiB|2,097,152/)
  })

  it('refuses a notebook with more cells than the ceiling', () => {
    const cells = Array.from({ length: NOTEBOOK_MAX_CELLS + 1 }, () => codeCell(['a = 1\n']))
    const read = readNotebook('nb.ipynb', notebook(cells))

    expect(read.ok).toBe(false)
    if (read.ok === true) return
    expect(read.refusal).toMatch(/cell/i)
    expect(read.refusal).toMatch(NOTEBOOK_MAX_CELLS.toString())
  })

  it('says so when the file is not JSON or has no cell list, and distinguishes a syntax error', () => {
    const broken = readNotebook('nb.ipynb', '{"cells": [')
    const shapeless = readNotebook('nb.ipynb', JSON.stringify({ nbformat: 4 }))
    const notObject = readNotebook('nb.ipynb', '[1,2,3]')

    expect(broken.ok === false && broken.refusal).toMatch(/JSON/i)
    expect(broken.ok === false && broken.kind).toBe('json')
    expect(shapeless.ok === false && shapeless.refusal).toMatch(/cell/i)
    expect(shapeless.ok === false && shapeless.kind).toBe('shape')
    expect(notObject.ok === false && notObject.refusal).toMatch(/cell/i)
  })

  it('hands a malformed notebook to the JSON rule instead of dropping it', () => {
    const broken = '{"cells": ['
    const expanded = expandNotebooks([
      { name: 'broken.ipynb', text: broken, language: 'unknown', languageSource: 'fallback', encoding: 'utf-8', bytes: broken.length },
    ])

    expect(expanded.entries.map((entry) => [entry.name, entry.language])).toEqual([['broken.ipynb', 'json']])
    expect(expanded.skipped).toEqual([])
  })

  it('treats a cell whose source is one string as that string', () => {
    const read = readNotebook('nb.ipynb', notebook([{ cell_type: 'code', metadata: {}, source: 'a = 1\n', outputs: [] }]))

    expect(read.ok && read.cells[0]?.text).toBe('a = 1\n')
  })

  it('counts expanded cells against the run ceiling instead of multiplying entries without bound', () => {
    const big = notebook(Array.from({ length: 40 }, () => codeCell(['a = 1\n'])))
    const entries = [
      { name: 'one.ipynb', text: big, language: 'text' as const, languageSource: 'fallback' as const, encoding: 'utf-8' as const, bytes: big.length },
      { name: 'two.ipynb', text: big, language: 'text' as const, languageSource: 'fallback' as const, encoding: 'utf-8' as const, bytes: big.length },
    ]

    const expanded = expandNotebooks(entries, { ...DEFAULT_ARCHIVE_LIMITS, maxEntryCount: 50 })

    expect(expanded.entries.length).toBe(40)
    expect(expanded.skipped.map((row) => [row.name, row.code])).toEqual([['two.ipynb', 'notebook_unreadable']])
    expect(expanded.skipped[0]?.message).toMatch(/50-entry ceiling/)
  })
})

describe('collecting every text-bearing output form', () => {
  function outputsOf(outputs: unknown[]): string[] {
    const read = readNotebook('nb.ipynb', notebook([codeCell(['print(1)\n'], outputs)]))
    expect(read.ok).toBe(true)
    if (read.ok === false) return []
    return read.outputs.map((output) => output.text)
  }

  it('collects stream text given as a single string', () => {
    expect(outputsOf([{ output_type: 'stream', name: 'stdout', text: 'one line\n' }])).toEqual(['one line\n'])
  })

  it('collects text from every display-data mime type a credential rule reads', () => {
    expect(
      outputsOf([
        { output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/html': ['<b>ok</b>'] } },
        { output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'application/json': ['{"a":1}'] } },
        { output_type: 'display_data', metadata: {}, data: { 'application/javascript': 'const x = 1;' } },
      ]),
    ).toEqual(['<b>ok</b>', '{"a":1}', 'const x = 1;'])
  })

  it('collects error name, value and traceback', () => {
    expect(
      outputsOf([
        {
          output_type: 'error',
          ename: 'ValueError',
          evalue: 'bad value',
          traceback: ['\u001b[31mTraceback line one\n', 'Traceback line two\n'],
        },
      ]),
    ).toEqual(['Traceback line one\nTraceback line two\n\nValueError\nbad value'])
  })

  it('strips ANSI control sequences so a coloured value is still scanned', () => {
    expect(outputsOf([{ output_type: 'stream', name: 'stdout', text: ['\u001b[31mvalue\u001b[0m\n'] }])).toEqual(['value\n'])
  })

  it('ignores binary payloads such as images', () => {
    expect(
      outputsOf([
        { output_type: 'display_data', metadata: {}, data: { 'image/png': 'iVBORw0KGgoAAAANSUhEUg==' } },
        { output_type: 'execute_result', execution_count: 1, metadata: {}, data: { 'text/plain': '7' } },
      ]),
    ).toEqual(['7'])
  })
})
