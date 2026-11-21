import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBug } from '../../test/factories'
import {
  BUG_RECOVERY_STORAGE_KEY,
  BUGS_STORAGE_KEY,
  loadBugState,
  saveBugs,
} from '../bugs/storage'
import { PREIMPORT_STORAGE_KEY } from '../bugs/exportImport'
import { FOOTER_JOKE_STORAGE_PREFIX } from '../footer/footerJoke'
import { THEME_STORAGE_KEY, saveTheme } from '../theme/theme'
import {
  APP_STORAGE_ENTRIES,
  SESSION_ONLY_STORAGE_KEY,
  clearAllBugPilotData,
  getEphemeralStorage,
  isSessionOnly,
  resolvePersistentStorage,
  setSessionOnly,
} from './storageCore'

const RECOVERY_VALUE = '{ definitely not valid JSON'
const PREIMPORT_VALUE = '{"schemaVersion":1,"bugs":[]}'
const FOREIGN_APP_KEY = 'unrelated-app.v1'
const FOREIGN_BUGPILOT_KEY = 'bugpilot.notinregistry'
const PLANTED_JOKE_KEY = `${FOOTER_JOKE_STORAGE_PREFIX}about`

interface StoreSpy {
  localWrites: string[]
  localRemoves: string[]
  localClears: string[]
  sessionWrites: string[]
}

// jsdom hands out `window.localStorage` as a Proxy: a spy defined on the instance is never reached
// by the property lookup, so it records nothing while the write still lands
// (../handoff-audit/evidence/loop2l9/worker/probe-storage-identity.cjs). The prototype spy does intercept, and
// `window.localStorage === window.localStorage` holds, so `this` separates the two media.
function spyStoragePrototype(): StoreSpy {
  const spy: StoreSpy = { localWrites: [], localRemoves: [], localClears: [], sessionWrites: [] }
  const originals = {
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
  }
  const medium = (self: Storage): 'local' | 'session' | 'other' => {
    if (self === window.localStorage) return 'local'
    if (self === window.sessionStorage) return 'session'
    return 'other'
  }

  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
    function recording(this: Storage, key: string, value: string) {
      if (medium(this) === 'local') spy.localWrites.push(key)
      if (medium(this) === 'session') spy.sessionWrites.push(key)
      originals.setItem.call(this, key, value)
    },
  )
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(
    function recording(this: Storage, key: string) {
      if (medium(this) === 'local') spy.localRemoves.push(key)
      originals.removeItem.call(this, key)
    },
  )
  vi.spyOn(Storage.prototype, 'clear').mockImplementation(
    function recording(this: Storage) {
      if (medium(this) === 'local') spy.localClears.push('clear')
      originals.clear.call(this)
    },
  )

  return spy
}

beforeEach(() => {
  clearAllBugPilotData()
  setSessionOnly(false)
})

afterEach(() => {
  setSessionOnly(false)
  clearAllBugPilotData()
  getEphemeralStorage().removeItem(FOREIGN_APP_KEY)
  getEphemeralStorage().removeItem(FOREIGN_BUGPILOT_KEY)
  window.sessionStorage.removeItem(PLANTED_JOKE_KEY)
})

describe('the storage registry', () => {
  it('lists the six entries in the documented order, medium, kind and prefix', () => {
    expect(APP_STORAGE_ENTRIES.map((entry) => entry.key)).toEqual([
      BUGS_STORAGE_KEY,
      BUG_RECOVERY_STORAGE_KEY,
      PREIMPORT_STORAGE_KEY,
      THEME_STORAGE_KEY,
      FOOTER_JOKE_STORAGE_PREFIX,
      SESSION_ONLY_STORAGE_KEY,
    ])
    expect(APP_STORAGE_ENTRIES.map((entry) => `${entry.medium}:${entry.kind}:${entry.prefix}`))
      .toEqual([
        'local:report-data:false',
        'local:report-data:false',
        'local:report-data:false',
        'local:preference:false',
        'session:app-noise:true',
        'session:mode:false',
      ])
  })

  it('hands the persistent resolver the ephemeral store while session-only is on', () => {
    setSessionOnly(true)
    expect(resolvePersistentStorage()).toBe(getEphemeralStorage())
    setSessionOnly(false)
    expect(resolvePersistentStorage()).not.toBe(getEphemeralStorage())
  })
})

describe('session-only routing', () => {
  it('keeps every report and theme write out of localStorage while session-only is on (media separated by spying Storage.prototype and filtering on this)', () => {
    const spy = spyStoragePrototype()
    const bug = makeBug({ id: 'session-only-bug' })

    setSessionOnly(true)
    expect(saveBugs([bug]).ok).toBe(true)
    expect(loadBugState().bugs).toEqual([bug])
    expect(saveTheme('dark')).toBe(true)

    expect(spy.localWrites).toEqual([])
    expect(spy.localRemoves).toEqual([])
    expect(spy.localClears).toEqual([])
    expect(spy.sessionWrites).toEqual([SESSION_ONLY_STORAGE_KEY])
    expect(getEphemeralStorage().getItem(BUGS_STORAGE_KEY)).not.toBeNull()
    expect(getEphemeralStorage().getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('sends the same flow to localStorage when session-only is off, which is the control arm above', () => {
    const spy = spyStoragePrototype()
    const bug = makeBug({ id: 'persisted-bug' })

    setSessionOnly(false)
    expect(saveBugs([bug]).ok).toBe(true)
    expect(loadBugState().bugs).toEqual([bug])
    expect(saveTheme('dark')).toBe(true)

    expect(spy.localWrites).toEqual([BUGS_STORAGE_KEY, THEME_STORAGE_KEY])
    expect(spy.sessionWrites).toEqual([])
  })
})

describe('clearAllBugPilotData', () => {
  it('leaves the recovery and preimport copies standing after deleting every report, then clears them', () => {
    const store = getEphemeralStorage()
    setSessionOnly(true)
    expect(saveBugs([makeBug({ id: 'copy-leak' })]).ok).toBe(true)
    store.setItem(BUG_RECOVERY_STORAGE_KEY, RECOVERY_VALUE)
    store.setItem(PREIMPORT_STORAGE_KEY, PREIMPORT_VALUE)

    expect(saveBugs([]).ok).toBe(true)
    expect(store.getItem(BUG_RECOVERY_STORAGE_KEY)).toBe(RECOVERY_VALUE)
    expect(store.getItem(PREIMPORT_STORAGE_KEY)).toBe(PREIMPORT_VALUE)

    const result = clearAllBugPilotData()

    expect(store.getItem(BUG_RECOVERY_STORAGE_KEY)).toBeNull()
    expect(store.getItem(PREIMPORT_STORAGE_KEY)).toBeNull()
    expect(result.removed).toContain(BUG_RECOVERY_STORAGE_KEY)
    expect(result.removed).toContain(PREIMPORT_STORAGE_KEY)
  })

  it('re-seeds the five samples when a clear is not followed by a write, and the shipped composition prevents that', () => {
    const store = getEphemeralStorage()
    setSessionOnly(true)
    expect(saveBugs([makeBug({ id: 'about-to-vanish' })]).ok).toBe(true)

    clearAllBugPilotData()
    const reseeded = loadBugState()
    expect(reseeded.seeded).toBe(true)
    expect(reseeded.bugs).toHaveLength(5)

    clearAllBugPilotData()
    expect(saveBugs([]).ok).toBe(true)
    const second = loadBugState()
    expect(second.seeded).toBe(false)
    expect(second.bugs).toEqual([])
    expect(store.getItem(BUGS_STORAGE_KEY)).not.toBeNull()
  })

  it('spares foreign keys, the preference and the mode flag, and removes planted footer jokes', () => {
    const store = getEphemeralStorage()
    setSessionOnly(true)
    const baseline = clearAllBugPilotData().foreignKeys
    store.setItem(FOREIGN_APP_KEY, 'someone else')
    store.setItem(FOREIGN_BUGPILOT_KEY, 'almost ours')
    window.sessionStorage.setItem(PLANTED_JOKE_KEY, '2')
    expect(saveTheme('dark')).toBe(true)

    const result = clearAllBugPilotData()

    expect(store.getItem(FOREIGN_APP_KEY)).toBe('someone else')
    expect(store.getItem(FOREIGN_BUGPILOT_KEY)).toBe('almost ours')
    // §4.1 defines `foreignKeys` as the `bugpilot.`-prefixed keys no registry entry owns, so the
    // other application's key survives without being counted. §4.5's "counts them" is the looser
    // wording; the spec clause wins and the difference is asserted here rather than left implied.
    expect(result.foreignKeys).toBe(baseline + 1)
    expect(result.removed).toContain(PLANTED_JOKE_KEY)
    expect(window.sessionStorage.getItem(PLANTED_JOKE_KEY)).toBeNull()
    expect(store.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(result.removed).not.toContain(THEME_STORAGE_KEY)
    expect(result.absent).not.toContain(THEME_STORAGE_KEY)
    expect(isSessionOnly()).toBe(true)
    expect(window.sessionStorage.getItem(SESSION_ONLY_STORAGE_KEY)).toBe('1')
  })
})

// The shape of src/engineBoundary.test.ts, kept to the one direction this domain owes: privacy/
// must not import a sibling domain at runtime. `features/bugs` imports this module, so a runtime
// edge back would be a cycle that can initialise to undefined.
const privacyRoot = resolve(process.cwd(), 'src/features/privacy')
const OUT_OF_DOMAIN = ['../bugs', '../theme', '../footer', '../analyzer']

type SpecifierForm = 'import-type' | 'import-value' | 'export-from' | 'bare-import' | 'dynamic'
type Crossing = { spec: string; form: SpecifierForm; line: number }

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function lineAt(code: string, index: number): number {
  return code.slice(0, index).split('\n').length
}

function specifiersIn(code: string): Crossing[] {
  const text = stripComments(code)
  const found: Crossing[] = []
  // The clause cannot span a semicolon, a quote or a second module keyword, but it does span the
  // braces of a named import and the newlines of a multi-line one. `import { type Bug } from`
  // stays a runtime import, matching src/engineBoundary.test.ts:317.
  const statements =
    /(^|\n)[ \t]*(import|export)((?:(?!['"`]|\bimport\b|\bexport\b)[^;])*?)\bfrom[ \t]*['"]([^'"]+)['"]/g
  for (const match of text.matchAll(statements)) {
    const at = (match.index ?? 0) + match[1].length
    const form: SpecifierForm =
      match[2] === 'export'
        ? 'export-from'
        : /^\s*type\b/.test(match[3])
          ? 'import-type'
          : 'import-value'
    found.push({ spec: match[4], form, line: lineAt(text, at) })
  }
  for (const match of text.matchAll(/(^|\n)[ \t]*import[ \t]+['"]([^'"]+)['"]/g)) {
    const at = (match.index ?? 0) + match[1].length
    found.push({ spec: match[2], form: 'bare-import', line: lineAt(text, at) })
  }
  for (const match of text.matchAll(/\bimport[ \t]*\([ \t]*['"]([^'"]+)['"]/g)) {
    const at = match.index ?? 0
    found.push({ spec: match[1], form: 'dynamic', line: lineAt(text, at) })
  }
  return found.sort((left, right) => left.line - right.line)
}

function isOutOfDomain(spec: string): boolean {
  return OUT_OF_DOMAIN.some((prefix) => spec.startsWith(prefix))
}

function describeCrossing(crossing: Crossing): string {
  return `${crossing.line}:${crossing.form}:${crossing.spec}`
}

function privacySourceFiles(): string[] {
  return readdirSync(privacyRoot)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort()
}

function crossingsIn(file: string): Crossing[] {
  return specifiersIn(readFileSync(join(privacyRoot, file), 'utf8')).filter((crossing) =>
    isOutOfDomain(crossing.spec),
  )
}

describe('module boundaries', () => {
  // The complete legal list, asserted with toEqual and never as "no violations": a matcher that
  // silently stopped matching would drop entries from this list instead of reporting a clean run
  // it never earned.
  const LEGAL_TYPE_ONLY_IMPORTS: string[] = []

  it('classifies every module specifier shape and ignores comments', () => {
    const snippet = [
      "import { saveBugs } from '../bugs/storage'",
      "import type { Bug } from '../bugs/types'",
      "import { type Bug } from '../bugs/types'",
      "import '../theme/theme'",
      "export { THEME_STORAGE_KEY } from '../theme/theme'",
      "const mod = await import('../analyzer/engine')",
      "// import { saveBugs } from '../bugs/storage'",
      "/* import type { Bug } from '../bugs/types' */",
      "const key = 'bugpilot.bugs.v1'",
    ].join('\n')
    expect(specifiersIn(snippet).map(describeCrossing)).toEqual([
      "1:import-value:../bugs/storage",
      "2:import-type:../bugs/types",
      "3:import-value:../bugs/types",
      "4:bare-import:../theme/theme",
      "5:export-from:../theme/theme",
      "6:dynamic:../analyzer/engine",
    ])
  })

  it('refuses every runtime crossing out of the privacy domain', () => {
    const files = privacySourceFiles()
    expect(files).toEqual(['storageCore.ts'])
    const crossings = files.flatMap((file) =>
      crossingsIn(file).map((crossing) => ({ file, crossing })),
    )
    const legal = crossings
      .filter((entry) => entry.crossing.form === 'import-type')
      .map((entry) => `${entry.file}:${entry.crossing.line}`)
      .sort()
    const violations = crossings
      .filter((entry) => entry.crossing.form !== 'import-type')
      .map((entry) => `${entry.file}:${describeCrossing(entry.crossing)}`)
      .sort()
    expect(legal).toEqual(LEGAL_TYPE_ONLY_IMPORTS)
    expect(violations).toEqual([])
  })
})
