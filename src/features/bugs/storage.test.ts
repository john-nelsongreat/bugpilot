import { describe, expect, it, vi } from 'vitest'
import {
  BUG_RECOVERY_STORAGE_KEY,
  BUGS_STORAGE_KEY,
  loadBugState,
  saveBugs,
  type StorageLike,
} from './storage'
import { FIELD_LIMITS, validateBugDraft } from './validation'
import { makeBug, makeSavedDiagnosis } from '../../test/factories'

function createMemoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))

  const storage: StorageLike & { entries: Map<string, string> } = {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }

  return storage
}

describe('loadBugState', () => {
  it('seeds fictional samples exactly once when no saved data exists', () => {
    const storage = createMemoryStorage()
    const now = new Date('2026-10-23T12:00:00.000Z')
    const first = loadBugState(storage, now)
    const second = loadBugState(storage, now)

    expect(first.seeded).toBe(true)
    expect(first.issue).toBeNull()
    expect(first.bugs.length).toBeGreaterThan(0)
    expect(second.seeded).toBe(false)
    expect(second.bugs).toEqual(first.bugs)
    expect(storage.entries.has(BUGS_STORAGE_KEY)).toBe(true)
  })

  it('does not restore samples when an empty workspace was saved intentionally', () => {
    const storage = createMemoryStorage()
    expect(saveBugs([], storage).ok).toBe(true)

    const loaded = loadBugState(storage)

    expect(loaded.seeded).toBe(false)
    expect(loaded.bugs).toEqual([])
  })

  it('round-trips valid reports', () => {
    const storage = createMemoryStorage()
    const bugs = [makeBug({ id: 'saved-bug', title: 'Saved report' })]
    expect(saveBugs(bugs, storage).ok).toBe(true)

    const loaded = loadBugState(storage)

    expect(loaded.bugs).toEqual(bugs)
    expect(loaded.issue).toBeNull()
  })

  it('preserves corrupt raw JSON, copies it to recovery storage, and never seeds over it', () => {
    const raw = '{ definitely not valid JSON'
    const storage = createMemoryStorage({ [BUGS_STORAGE_KEY]: raw })

    const loaded = loadBugState(storage)

    expect(loaded.bugs).toEqual([])
    expect(loaded.seeded).toBe(false)
    expect(loaded.issue?.code).toBe('corrupt')
    expect(storage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(BUG_RECOVERY_STORAGE_KEY)).toBe(raw)
  })

  it('salvages valid records, reports skipped ones, and leaves the original payload untouched', () => {
    const good = makeBug({ id: 'good-bug', title: 'Good report' })
    const raw = JSON.stringify({
      schemaVersion: 1,
      bugs: [good, { id: 'broken-bug', title: 42 }],
    })
    const storage = createMemoryStorage({ [BUGS_STORAGE_KEY]: raw })

    const loaded = loadBugState(storage)

    expect(loaded.bugs).toEqual([good])
    expect(loaded.issue?.code).toBe('partial')
    expect(loaded.issue?.skippedRecords).toBe(1)
    expect(storage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(BUG_RECOVERY_STORAGE_KEY)).toBe(raw)
  })

  it('treats an unexpected top-level shape as corrupt data', () => {
    const raw = JSON.stringify({ schemaVersion: 1, bugs: 'not-an-array' })
    const storage = createMemoryStorage({ [BUGS_STORAGE_KEY]: raw })

    const loaded = loadBugState(storage)

    expect(loaded.issue?.code).toBe('corrupt')
    expect(loaded.bugs).toEqual([])
    expect(storage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
  })

  it('accepts a long but valid error message at the documented limit', () => {
    const bug = makeBug({
      id: 'long-error',
      errorMessage: 'E'.repeat(FIELD_LIMITS.errorMessage),
    })
    const storage = createMemoryStorage()
    expect(saveBugs([bug], storage).ok).toBe(true)

    expect(loadBugState(storage).bugs[0]).toEqual(bug)
  })

  it('reports unreadable storage without attempting to seed', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('Storage blocked')
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }

    const loaded = loadBugState(storage)

    expect(loaded.bugs).toEqual([])
    expect(loaded.seeded).toBe(false)
    expect(loaded.issue?.code).toBe('unreadable')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('creates sample records that all pass the public validator', () => {
    const { bugs } = loadBugState(createMemoryStorage())

    expect(new Set(bugs.map((bug) => bug.id)).size).toBe(bugs.length)
    for (const bug of bugs) {
      expect(validateBugDraft(bug)).toEqual({})
      expect(Number.isNaN(Date.parse(bug.createdAt))).toBe(false)
      expect(Number.isNaN(Date.parse(bug.updatedAt))).toBe(false)
    }
    expect(new Set(bugs.map((bug) => bug.status)).size).toBeGreaterThan(1)
    expect(new Set(bugs.map((bug) => bug.severity)).size).toBeGreaterThan(1)
  })
})

describe('saved diagnosis persistence', () => {
  it('round-trips a saved diagnosis through the real loader', () => {
    const diagnosis = makeSavedDiagnosis()
    const bug = makeBug({ id: 'diagnosed-bug', diagnosis })
    const storage = createMemoryStorage()
    expect(saveBugs([bug], storage).ok).toBe(true)

    const loaded = loadBugState(storage)

    expect(loaded.issue).toBeNull()
    expect(loaded.bugs).toEqual([bug])
    expect(loaded.bugs[0].diagnosis).toEqual(diagnosis)
  })

  it('does not add a diagnosis key to a report that has none', () => {
    const bug = makeBug({ id: 'plain-bug' })
    const storage = createMemoryStorage()
    expect(saveBugs([bug], storage).ok).toBe(true)

    const raw = storage.getItem(BUGS_STORAGE_KEY) as string
    const loaded = loadBugState(storage)

    expect(raw).not.toContain('diagnosis')
    expect('diagnosis' in loaded.bugs[0]).toBe(false)
    expect(loaded.bugs).toEqual([bug])
  })

  it.each([
    [
      'an invalid confidence',
      { ...makeSavedDiagnosis(), confidence: 'certain' },
    ],
    ['a null diagnosis', null],
    ['a non-object diagnosis', 'missing-module'],
  ])(
    'drops only %s from a stored record and keeps the report',
    (_label, diagnosis) => {
      const bug = makeBug({ id: 'malformed-diagnosis' })
      const raw = JSON.stringify({
        schemaVersion: 1,
        bugs: [{ ...bug, diagnosis }],
      })
      const storage = createMemoryStorage({ [BUGS_STORAGE_KEY]: raw })

      const loaded = loadBugState(storage)

      expect(loaded.issue).toBeNull()
      expect(loaded.bugs).toHaveLength(1)
      expect(loaded.bugs[0].id).toBe('malformed-diagnosis')
      expect('diagnosis' in loaded.bugs[0]).toBe(false)
      expect(storage.getItem(BUGS_STORAGE_KEY)).toBe(raw)
    },
  )

  it('drops unknown and dangerous diagnosis fields while loading', () => {
    const bug = makeBug({ id: 'dangerous-diagnosis' })
    const diagnosis = JSON.parse(`{
      "category": "missing-module",
      "ruleId": "python.missing-module",
      "matchedSignature": null,
      "confidence": "high",
      "evidence": [
        {
          "label": "Error text",
          "quote": "ModuleNotFoundError: No module named 'pandas'",
          "__proto__": { "polluted": true },
          "constructor": { "polluted": true },
          "prototype": { "polluted": true },
          "lineNumber": 2
        }
      ],
      "savedAt": "2026-10-24T09:30:00.000Z",
      "__proto__": { "polluted": true },
      "constructor": { "polluted": true },
      "prototype": { "polluted": true },
      "rawErrorText": "private paste",
      "codeSnippet": "private code"
    }`)
    const raw = JSON.stringify({
      schemaVersion: 1,
      bugs: [{ ...bug, diagnosis }],
    })
    const storage = createMemoryStorage({ [BUGS_STORAGE_KEY]: raw })

    const loaded = loadBugState(storage)
    const saved = loaded.bugs[0].diagnosis
    if (!saved) throw new Error('Expected the diagnosis to load')

    expect(loaded.issue).toBeNull()
    expect(Object.keys(saved)).toEqual([
      'category',
      'ruleId',
      'matchedSignature',
      'confidence',
      'evidence',
      'savedAt',
    ])
    expect(Object.keys(saved.evidence[0])).toEqual(['label', 'quote'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(JSON.stringify(loaded.bugs)).not.toContain('private paste')
    expect(JSON.stringify(loaded.bugs)).not.toContain('private code')
  })
})

describe('saveBugs', () => {
  it('reports a write failure instead of throwing', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota exceeded')
      },
      removeItem: vi.fn(),
    }

    const result = saveBugs([makeBug()], storage)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/save|storage|quota/i)
    }
  })
})
