/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as gate from './gate'

const srcRoot = resolve(process.cwd(), 'src')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

function relative(file: string): string {
  return file.replace(/\\/g, '/').split('/src/')[1]
}

const sourceFiles = walk(srcRoot).filter(
  (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file),
)

describe('clean export isolation', () => {
  it('exposes exactly one gate and allows the export in this slice', () => {
    expect(Object.keys(gate).sort()).toEqual(['authorizeCleanExport'])
    expect(gate.authorizeCleanExport().allowed).toBe(true)
  })

  it('is called from the UI entry point only', () => {
    const callers = sourceFiles
      .filter((file) => !file.endsWith(join('cleanExport', 'gate.ts')))
      .filter((file) => /authorizeCleanExport/.test(readFileSync(file, 'utf8')))
      .map(relative)
    expect(callers).toEqual(['features/analyzer/ui/CleanExportPanel.tsx'])
  })

  it('keeps the exporter independent of UI code', () => {
    const exporterFiles = sourceFiles.filter((file) => relative(file)?.includes('/cleanExport/'))
    expect(exporterFiles.length).toBeGreaterThanOrEqual(2)
    for (const file of exporterFiles) {
      const text = readFileSync(file, 'utf8')
      expect(text, relative(file)).not.toMatch(/from\s+'[^']*(\/ui\/|\.\.\/ui|\/pages\/|\.\.\/pages)/)
      expect(text, relative(file)).not.toMatch(/from\s+'react'/)
    }
  })
})
