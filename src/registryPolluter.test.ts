/// <reference types="node" />
// This file exists to be the thing that leaks. It hoists a mock of ./app/useWorkspace, the shape that made
// AppLayout.announcement.test.tsx and AssistantPrefill.test.tsx fail under `isolate: false`. The mechanism is
// measured, not assumed (../handoff-audit/evidence/m1i/v6probe-20261116T200552Z.log, both arms): a file that
// imports the MOCKED SPECIFIER DIRECTLY gets the real module either way. What carries a mock forward is a
// production module that was already evaluated while the mock was registered — its instance is cached in the
// shared registry, so every later importer receives the binding that instance captured. That cached consumer is
// exactly what src/test/setup.ts's afterAll reset has to clear, and src/test/registryConsumerFixture.ts is this
// guard's.
//
// This file has to run before src/registryVictim.test.ts, and RegistryOrderSequencer in vite.config.ts is
// what makes that true. The older mechanism was size: with no cached result for a file, BaseSequencer.sort
// orders by size, largest first, and a cold CI checkout (`npm ci` deletes
// node_modules/.vite/**/results.json) has no cached results at all. The byte assertion below is kept as
// the backstop for a run where that pin is gone, so it still fails loudly if someone edits the victim into
// being bigger. Do not restore ordering by padding this file with filler; if the sizes drift, say so in
// your report instead.
//
// The tmpdir handshake, not an assertion, is what carries state between the three files: globals are
// per worker thread, so a file is the only channel that survives a worker change.
// The stamp on each mark makes that channel run-scoped, not merely per-worker: pool 'threads' plus
// fileParallelism false gives every file in one run the same process.pid, so a mark left by a
// previous run now fails the comparison instead of quietly satisfying the census.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The stub now carries the leaf's whole public surface on purpose. A partial factory would make the
// fixture's named re-export of WorkspaceContext a link problem rather than a captured binding, and this
// guard is about which module the binding came from, not about how a missing export is reported.
vi.mock('./app/useWorkspace', () => ({
  useWorkspace: () => ({ marker: 'POLLUTER-STUB' }),
  WorkspaceContext: null,
}))

// Importing the fixture here is the reason this file exists: the mock above is registered, so the binding
// the fixture captures is the stub's, and that instance is what a later file inherits unless the central
// reset clears it.
import * as consumer from './test/registryConsumerFixture'

const polluterMark = join(tmpdir(), 'bugpilot-registry-polluter.txt')
const victimMark = join(tmpdir(), 'bugpilot-registry-victim.txt')
const ownPath = resolve(process.cwd(), 'src/registryPolluter.test.ts')
const victimPath = resolve(process.cwd(), 'src/registryVictim.test.ts')

describe('registry polluter', () => {
  it('clears markers an aborted earlier run may have left behind', () => {
    if (existsSync(polluterMark)) rmSync(polluterMark)
    if (existsSync(victimMark)) rmSync(victimMark)
    expect(existsSync(victimMark)).toBe(false)
  })

  it('is sequenced ahead of the victim by the size rule a cold checkout uses', () => {
    expect(statSync(victimPath).size).toBeLessThan(statSync(ownPath).size)
  })

  it('pins its own stub, which is the hazard later files inherit', async () => {
    const mod = await import('./app/useWorkspace')
    expect(mod.useWorkspace()).toEqual({ marker: 'POLLUTER-STUB' })
    // The hazard has to be live in THIS run or the victim's green means nothing. The fixture is a module that
    // evaluated while the mock above was registered, so its own WorkspaceContext is the stub's null. If this
    // line goes red, the leak has stopped happening and the guard is testing an absent hazard — report it as
    // such rather than deleting the assertion.
    expect(consumer.WorkspaceContext).toBeNull()
    writeFileSync(polluterMark, `STUB-${process.pid}`, 'utf8')
    expect(readFileSync(polluterMark, 'utf8')).toBe(`STUB-${process.pid}`)
  })
})
