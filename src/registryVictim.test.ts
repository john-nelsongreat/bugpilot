/// <reference types="node" />
// The consumer side of the pair: this file mocks nothing and imports the production CONSUMER the polluter
// evaluated under its mock, which is what a page test doing `import App from '../App'` actually does. If the
// central afterAll reset in src/test/setup.ts stops working, the stub is what this file inherits — through the
// cached consumer instance, never through a direct import of the mocked specifier. Measured: the leaf path
// delivered the real module in both states (../handoff-audit/evidence/m1i-probe/probe.log arm 2), the consumer
// path delivered the stub in one (../handoff-audit/evidence/m1i/v6probe-20261116T200552Z.log arm 2). Only the
// second can report the hazard.
//
// RegistryOrderSequencer in vite.config.ts runs this file after src/registryPolluter.test.ts so the hazard
// is actually exercised; it stays smaller than the polluter because the byte assertion there is the
// backstop if that pin is ever removed.
// toBeTruthy is load-bearing, not stylistic. Both obvious alternatives are vacuous in a direction this round
// measured: toBeDefined() passes for the stub's null, and typeof null === 'object' so a type test passes for it
// too. A React context object is truthy; the stub's null is not.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as consumer from './test/registryConsumerFixture'

const polluterMark = join(tmpdir(), 'bugpilot-registry-polluter.txt')
const victimMark = join(tmpdir(), 'bugpilot-registry-victim.txt')

function gotRealModule(): boolean {
  return Boolean(consumer.WorkspaceContext)
}

describe('registry victim', () => {
  it('gets the real useWorkspace through the cached consumer', () => {
    expect(consumer.WorkspaceContext).toBeTruthy()
    expect(() => consumer.useWorkspace()).toThrow()
  })

  it('records what it saw, for the census file to adjudicate', () => {
    const stubMark = `STUB-${process.pid}`
    const precededByPolluter = existsSync(polluterMark) && readFileSync(polluterMark, 'utf8') === stubMark
    let verdict: string
    if (!gotRealModule()) verdict = 'STUB_LEAKED'
    else if (precededByPolluter) verdict = 'REAL_AFTER_STUB'
    else verdict = 'REAL_WITHOUT_POLLUTER'
    writeFileSync(victimMark, `${verdict}-${process.pid}`, 'utf8')
  })
})
