// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GRAMMAR_URLS } from './assets'

/**
 * `docs/ENGINE-LICENCES.md` is the attribution BugPilot redistributes for the grammars, because the
 * `tree-sitter-wasm` pack ships no per-grammar licence file. LOOP2-L5 added a grammar whose licence is
 * not MIT, which turns that page from a nice-to-have into a legal obligation with a shipped artifact
 * behind it. A hand-maintained table can lose a row, keep a row for a grammar that left the build, or
 * carry an SPDX letter the upstream text does not support — so every number and every set here is
 * compared against `GRAMMAR_URLS` (what the bundle actually publishes) or against the notice file.
 */

const REPO = process.cwd()
const README = readFileSync(resolve(REPO, 'README.md'), 'utf8')
const LICENCES = readFileSync(resolve(REPO, 'docs/ENGINE-LICENCES.md'), 'utf8')

const NOTICE_PATH = 'public/licenses/Apache-2.0-tree-sitter-hcl.txt'
const NOTICE_SHA256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'
const NOTICE_LF_BYTES = 11357
const ALLOWED_SPDX = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense'])
const SHIPPED_ASSETS = Object.keys(GRAMMAR_URLS).sort().map((id) => `tree-sitter-${id}`)

/**
 * The rows of the grammar table, as `asset -> SPDX`. Scoped to the section so the package table above
 * it, whose first column also starts with a `tree-sitter-` name, cannot be read as a grammar.
 */
function grammarRows(): Map<string, string> {
  const heading = /^## The \d+ grammars$/m.exec(LICENCES)
  if (!heading) throw new Error('docs/ENGINE-LICENCES.md has no "## The N grammars" heading')
  const body = LICENCES.slice(heading.index + heading[0].length)
  const table = body.slice(0, body.search(/^## /m))
  const rows = new Map<string, string>()
  for (const line of table.split(/\r?\n/)) {
    if (!line.startsWith('| `tree-sitter-')) continue
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length !== 7) throw new Error(`${line.slice(0, 40)}… — ${cells.length - 2} columns, expected 5`)
    const asset = cells[1].replace(/`/g, '')
    if (rows.has(asset)) throw new Error(`${asset} appears twice in the grammar table`)
    rows.set(asset, cells[4])
  }
  if (rows.size === 0) throw new Error('the grammar heading was found but no grammar row parsed')
  return rows
}

describe('the grammar licence table cannot drift out of the bundle', () => {
  const rows = grammarRows()

  it('has exactly one row per grammar the build publishes', () => {
    expect([...rows.keys()].sort()).toEqual(SHIPPED_ASSETS)
  })

  it('states a permitted licence for every grammar', () => {
    for (const [asset, spdx] of rows) {
      expect(ALLOWED_SPDX.has(spdx), `${asset} states "${spdx}"`).toBe(true)
    }
  })

  it('keeps exactly the one non-MIT grammar that was measured, in both directions', () => {
    expect([...rows].filter(([, spdx]) => spdx !== 'MIT').map(([asset]) => asset)).toEqual([
      'tree-sitter-terraform',
    ])
    expect(rows.get('tree-sitter-terraform')).toBe('Apache-2.0')
  })

  it('ships the Apache-2.0 text the redistribution owes, byte for byte', () => {
    const file = resolve(REPO, NOTICE_PATH)
    expect(existsSync(file), `${NOTICE_PATH} is missing`).toBe(true)
    // `core.autocrlf=true` with no `.gitattributes` means a Windows checkout can carry CRLF; the
    // upstream file is LF, so the digest is taken over normalised bytes.
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    expect(Buffer.byteLength(text, 'utf8'), `${NOTICE_PATH} length`).toBe(NOTICE_LF_BYTES)
    expect(createHash('sha256').update(text, 'utf8').digest('hex'), `${NOTICE_PATH} sha256`).toBe(NOTICE_SHA256)
    expect(text).toContain('Apache License')
    expect(text).toContain('Version 2.0, January 2004')
  })

  it('points the attribution page at the shipped notice', () => {
    expect(LICENCES).toContain(NOTICE_PATH)
  })

  it('retires every sentence that claimed all engine binaries are MIT', () => {
    for (const stale of [/binaries are MIT \(\d+ grammar/, /all MIT, all WebAssembly/, /no `Apache-2\.0`, `BSD`/]) {
      expect(README, `README.md still says ${stale}`).not.toMatch(stale)
      expect(LICENCES, `docs/ENGINE-LICENCES.md still says ${stale}`).not.toMatch(stale)
    }
    expect(README).toMatch(/binaries are MIT or Apache-2\.0 \(\d+ grammar/)
    expect(LICENCES).toMatch(/binaries are MIT or Apache-2\.0 \(\d+ grammars/)
  })
})
