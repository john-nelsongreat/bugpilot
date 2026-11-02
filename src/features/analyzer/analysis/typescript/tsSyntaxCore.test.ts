import { describe, expect, it } from 'vitest'
import { checkTypeScriptFile } from './tsSyntaxCore'
import { startTsWorker } from './tsWorker'
import type { WorkerScope } from './tsProtocol'

describe('TypeScript syntax core', () => {
  it('reports a real syntax error with severity, range and rule id', () => {
    const [finding] = checkTypeScriptFile('src/app.ts', 'const value = ;\n')

    expect(finding.ruleId).toBe('bugpilot/typescript/syntax')
    expect(finding.analyzer).toBe('typescript')
    expect(finding.tier).toBe('syntax')
    expect(finding.severity).toBe('High')
    expect(finding.message).toMatch(/TS1109/)
    expect(finding.range.startLine).toBe(1)
    expect(finding.range.startColumn).toBeGreaterThan(0)
    expect(finding.evidence[0].quote).toContain('const value')
    expect(finding.fix).toBeNull()
  })

  it('is deterministic for the same file bytes', () => {
    const first = checkTypeScriptFile('src/app.ts', 'const value = ;\n')
    const second = checkTypeScriptFile('src/app.ts', 'const value = ;\n')

    expect(first.map((finding) => finding.id)).toEqual(second.map((finding) => finding.id))
  })

  it('does not report semantic problems or unresolved imports', () => {
    const text = [
      'import { missing } from "./does-not-exist"',
      'const value: MissingType = 1',
      'function run() { return unknownName() }',
    ].join('\n')

    expect(checkTypeScriptFile('src/app.ts', text)).toEqual([])
  })

  it('accepts valid TypeScript, JSX and JavaScript without findings', () => {
    expect(checkTypeScriptFile('src/app.ts', 'export const value: number = 1\n')).toEqual([])
    expect(checkTypeScriptFile('src/App.tsx', 'export const App = () => <div>Hello</div>\n')).toEqual([])
    expect(checkTypeScriptFile('src/app.js', 'export const value = 1\n')).toEqual([])
  })

  it('does not mistake source text inside a string for syntax', () => {
    const text = 'const prose = "const value = ; and { unbalanced"\n'
    expect(checkTypeScriptFile('src/app.ts', text)).toEqual([])
  })

  it('reports JavaScript parser errors too', () => {
    const findings = checkTypeScriptFile('src/app.js', 'const value = ;\n')
    expect(findings).toHaveLength(1)
    expect(findings[0].file).toBe('src/app.js')
  })

  it('limits the finding honestly to syntax', () => {
    const [finding] = checkTypeScriptFile('src/app.ts', 'const value = ;\n')
    expect(finding.limitations.join(' ')).toMatch(/no type checking/i)
  })
})

describe('TypeScript worker protocol', () => {
  it('answers a check request with findings', () => {
    const posted: Array<{ type: string; id: number; findings?: unknown[] }> = []
    let handler: ((event: { data: unknown }) => void) | null = null
    const scope: WorkerScope = {
      postMessage: (message: unknown) => posted.push(message as { type: string; id: number }),
      set onmessage(next: ((event: { data: unknown }) => void) | null) {
        handler = next
      },
      get onmessage() {
        return handler ?? null
      },
    }

    startTsWorker(scope)
    scope.onmessage?.({ data: { type: 'check', id: 4, name: 'src/app.ts', text: 'const value = ;\n' } })

    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('result')
    expect(posted[0].id).toBe(4)
    expect(posted[0].findings).toHaveLength(1)
  })

  it('ignores unknown messages', () => {
    const posted: unknown[] = []
    let handler: ((event: { data: unknown }) => void) | null = null
    const scope: WorkerScope = {
      postMessage: (message: unknown) => posted.push(message),
      set onmessage(next: ((event: { data: unknown }) => void) | null) {
        handler = next
      },
      get onmessage() {
        return handler ?? null
      },
    }

    startTsWorker(scope)
    scope.onmessage?.({ data: { type: 'something-else' } })
    expect(posted).toHaveLength(0)
  })
})
