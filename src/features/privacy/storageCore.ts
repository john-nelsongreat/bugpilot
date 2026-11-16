export type StorageMedium = 'local' | 'session'

export type StorageEntryKind = 'report-data' | 'preference' | 'app-noise' | 'mode'

export interface StorageEntry {
  readonly key: string
  readonly medium: StorageMedium
  readonly kind: StorageEntryKind
  readonly prefix: boolean
}

export const SESSION_ONLY_STORAGE_KEY = 'bugpilot.sessionOnly.v1'

const APP_KEY_PREFIX = 'bugpilot.'

// The key names are written literally here on purpose. Importing them from the domains that own
// them would make this module import `features/bugs`, which imports this module back: a cycle
// whose constants can still be uninitialised when this array is built. `storageCore.test.ts` pins
// every literal against the constant its writer actually uses, so the copy cannot drift silently.
export const APP_STORAGE_ENTRIES: readonly StorageEntry[] = [
  { key: 'bugpilot.bugs.v1', medium: 'local', kind: 'report-data', prefix: false },
  { key: 'bugpilot.bugs.recovery.v1', medium: 'local', kind: 'report-data', prefix: false },
  { key: 'bugpilot.bugs.preimport.v1', medium: 'local', kind: 'report-data', prefix: false },
  { key: 'bugpilot.theme.v1', medium: 'local', kind: 'preference', prefix: false },
  { key: 'bugpilot.footerJoke.', medium: 'session', kind: 'app-noise', prefix: true },
  { key: SESSION_ONLY_STORAGE_KEY, medium: 'session', kind: 'mode', prefix: false },
]

export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  keys(): string[]
}

export interface ClearAllResult {
  readonly removed: readonly string[]
  readonly absent: readonly string[]
  readonly foreignKeys: number
}

type KeyStore = Map<string, string>

const ephemeralLocalStore: KeyStore = new Map()
const ephemeralSessionStore: KeyStore = new Map()

function asMemoryPort(store: KeyStore): StoragePort {
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
    keys: () => [...store.keys()],
  }
}

const ephemeralLocal = asMemoryPort(ephemeralLocalStore)
const ephemeralSession = asMemoryPort(ephemeralSessionStore)

// `Array.from({ length, … })` cannot yield a partial result: the first throw discards the whole
// list. The loop keeps the keys gathered before it, which is what a bulk clear needs.
function asRealPort(real: Storage): StoragePort {
  return {
    getItem: (key) => real.getItem(key),
    setItem: (key, value) => {
      real.setItem(key, value)
    },
    removeItem: (key) => {
      real.removeItem(key)
    },
    keys: () => {
      const gathered: string[] = []
      try {
        for (let index = 0; index < real.length; index += 1) {
          const key = real.key(index)
          if (key !== null) gathered.push(key)
        }
      } catch {
        // Keep the keys read before the store refused to enumerate.
      }
      return gathered
    },
  }
}

function realStore(medium: StorageMedium): StoragePort | null {
  try {
    if (typeof window === 'undefined') return null
    return asRealPort(medium === 'local' ? window.localStorage : window.sessionStorage)
  } catch {
    return null
  }
}

function storesFor(medium: StorageMedium): StoragePort[] {
  const ephemeral = medium === 'local' ? ephemeralLocal : ephemeralSession
  const real = realStore(medium)
  return real === null ? [ephemeral] : [ephemeral, real]
}

export function getEphemeralStorage(): StoragePort {
  return ephemeralLocal
}

export function isSessionOnly(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(SESSION_ONLY_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSessionOnly(enabled: boolean): void {
  try {
    if (typeof window === 'undefined') return
    if (enabled) {
      window.sessionStorage.setItem(SESSION_ONLY_STORAGE_KEY, '1')
    } else {
      window.sessionStorage.removeItem(SESSION_ONLY_STORAGE_KEY)
    }
  } catch {
    // Without sessionStorage the app keeps writing where it always did.
  }
}

// The single place that decides which store the app writes to. Every default path in the feature
// domains resolves through here, so session-only cannot be bypassed by one store's helper.
export function resolvePersistentStorage(): StoragePort | null {
  if (isSessionOnly()) return ephemeralLocal
  return realStore('local')
}

function isOwnedKey(key: string): boolean {
  return APP_STORAGE_ENTRIES.some((entry) =>
    entry.prefix ? key.startsWith(entry.key) : key === entry.key,
  )
}

// A registry walk, never `localStorage.clear()`: other applications can share this origin, and a
// bulk clear would delete their data too.
export function clearAllBugPilotData(): ClearAllResult {
  const removed: string[] = []
  const absent: string[] = []
  const foreign = new Set<string>()
  const cleared = APP_STORAGE_ENTRIES.filter((entry) =>
    entry.kind === 'report-data' || entry.kind === 'app-noise',
  )

  for (const medium of ['local', 'session'] as const) {
    const stores = storesFor(medium)
    const seen = new Set<string>()
    for (const store of stores) {
      for (const key of store.keys()) {
        seen.add(key)
      }
    }
    for (const key of seen) {
      if (key.startsWith(APP_KEY_PREFIX) && !isOwnedKey(key)) foreign.add(key)
    }

    for (const entry of cleared) {
      if (entry.medium !== medium) continue
      if (entry.prefix) {
        const matching = [...seen].filter((key) => key.startsWith(entry.key)).sort()
        if (matching.length === 0) continue
        for (const key of matching) {
          for (const store of stores) store.removeItem(key)
          removed.push(key)
        }
        continue
      }
      const present = stores.some((store) => store.getItem(entry.key) !== null)
      if (present) {
        for (const store of stores) store.removeItem(entry.key)
        removed.push(entry.key)
      } else {
        absent.push(entry.key)
      }
    }
  }

  return { removed, absent, foreignKeys: foreign.size }
}
