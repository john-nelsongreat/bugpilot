import { describe, expect, it } from 'vitest'
import { makeBug } from '../../test/factories'
import { BUGS_STORAGE_KEY, saveBugs, type StorageLike } from './storage'
import type { Bug } from './types'
import {
  EXPORT_APP,
  EXPORT_SCHEMA_VERSION,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_REPORTS,
  PREIMPORT_STORAGE_KEY,
  applyBugImport,
  buildBugExport,
  countExistingBugIds,
  getExportFileName,
  parseBugImport,
  serializeBugExport,
  type ImportParseResult,
  type ImportParseSuccess,
} from './exportImport'

const EXPORTED_AT = new Date('2026-10-24T12:34:56.000Z')

function expectParseOk(result: ImportParseResult): ImportParseSuccess {
  if (!result.ok) throw new Error(`Expected parse success: ${result.message}`)
  return result
}

function expectParseFailure(result: ImportParseResult): string {
  if (result.ok) throw new Error('Expected parse failure')
  return result.message
}

function envelopeWith(bugs: unknown[]): string {
  return JSON.stringify({
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: EXPORTED_AT.toISOString(),
    bugs,
  })
}

function recordFor(bug: Bug): Record<string, unknown> {
  return JSON.parse(JSON.stringify(bug)) as Record<string, unknown>
}

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

function seedStorage(storage: StorageLike, bugs: Bug[]): string {
  const result = saveBugs(bugs, storage)
  expect(result.ok).toBe(true)
  const raw = storage.getItem(BUGS_STORAGE_KEY)
  expect(raw).not.toBeNull()
  return raw as string
}

describe('export payload', () => {
  it('builds the documented envelope with every report field', () => {
    const bug = makeBug({
      id: 'export-one',
      title: 'Export preserves every field',
      severity: 'Critical',
      status: 'Resolved',
      fixStatus: 'Verified',
      proposedFix: 'Guard the null value.',
      verificationNotes: 'Checked in a fresh profile.',
      notes: 'Keep this note.',
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
    })

    const payload = buildBugExport([bug], EXPORTED_AT)

    expect(payload).toEqual({
      app: 'bugpilot',
      schemaVersion: 1,
      exportedAt: EXPORTED_AT.toISOString(),
      bugs: [bug],
    })
    expect(Object.keys(payload.bugs[0])).toEqual([
      'id',
      'title',
      'description',
      'projectName',
      'language',
      'errorMessage',
      'stepsToReproduce',
      'expectedBehavior',
      'actualBehavior',
      'severity',
      'status',
      'notes',
      'proposedFix',
      'fixStatus',
      'verificationNotes',
      'createdAt',
      'updatedAt',
    ])
  })

  it('drops properties that are not part of the report format', () => {
    const bug = makeBug({ id: 'extra-fields' }) as Bug & {
      theme: string
      assistantText: string
    }
    bug.theme = 'dark'
    bug.assistantText = 'private pasted text'

    const payload = buildBugExport([bug], EXPORTED_AT)

    expect(payload.bugs[0]).not.toHaveProperty('theme')
    expect(payload.bugs[0]).not.toHaveProperty('assistantText')
  })

  it('pretty-prints the JSON and names the file with the ISO date', () => {
    const bug = makeBug({ id: 'pretty-export' })
    const text = serializeBugExport([bug], EXPORTED_AT)

    expect(text).toContain('\n  "app": "bugpilot"')
    expect(JSON.parse(text)).toEqual(buildBugExport([bug], EXPORTED_AT))
    expect(getExportFileName(EXPORTED_AT)).toBe(
      'bugpilot-export-2026-10-24.json',
    )
  })

  it('round-trips exported reports without changing any field', () => {
    const bugs = [
      makeBug({
        id: 'round-trip-a',
        status: 'In Progress',
        fixStatus: 'Accepted',
        proposedFix: 'Use a fallback.',
      }),
      makeBug({
        id: 'round-trip-b',
        status: 'Closed',
        fixStatus: 'Rejected',
        proposedFix: 'Skip validation.',
        verificationNotes: '',
      }),
    ]

    const result = expectParseOk(
      parseBugImport(serializeBugExport(bugs, EXPORTED_AT)),
    )

    expect(result.bugs).toEqual(bugs)
    expect(result.invalidCount).toBe(0)
    expect(result.issues).toEqual([])
  })
})

describe('import envelope validation', () => {
  it('rejects empty and whitespace-only files', () => {
    expect(expectParseFailure(parseBugImport(''))).toMatch(/file is empty/i)
    expect(expectParseFailure(parseBugImport('\uFEFF'))).toMatch(
      /file is empty/i,
    )
    expect(expectParseFailure(parseBugImport('  \n\t '))).toMatch(
      /file is empty/i,
    )
  })

  it('rejects malformed JSON', () => {
    expect(expectParseFailure(parseBugImport('{not json'))).toMatch(
      /not valid JSON/i,
    )
  })

  it('rejects a file from another app', () => {
    const text = JSON.stringify({
      app: 'another-app',
      schemaVersion: 1,
      bugs: [],
    })
    expect(expectParseFailure(parseBugImport(text))).toMatch(
      /not a BugPilot export/i,
    )
  })

  it('gives a specific message for a newer schema version', () => {
    const text = JSON.stringify({
      app: 'bugpilot',
      schemaVersion: 2,
      bugs: [],
    })
    expect(expectParseFailure(parseBugImport(text))).toMatch(/newer version/i)
  })

  it('rejects unsupported schema versions', () => {
    const text = JSON.stringify({
      app: 'bugpilot',
      schemaVersion: 0,
      bugs: [],
    })
    expect(expectParseFailure(parseBugImport(text))).toMatch(
      /unsupported schema version/i,
    )
  })

  it('rejects a missing or non-array bugs value', () => {
    expect(
      expectParseFailure(
        parseBugImport(JSON.stringify({ app: 'bugpilot', schemaVersion: 1 })),
      ),
    ).toMatch(/bugs array/i)
    expect(
      expectParseFailure(
        parseBugImport(
          JSON.stringify({ app: 'bugpilot', schemaVersion: 1, bugs: {} }),
        ),
      ),
    ).toMatch(/bugs array/i)
  })

  it('rejects more than 5,000 reports', () => {
    const text = envelopeWith(
      Array.from({ length: MAX_IMPORT_REPORTS + 1 }, () => ({})),
    )
    expect(expectParseFailure(parseBugImport(text))).toMatch(/more than 5,000/i)
  })

  it('rejects files larger than 5 MB', () => {
    const text = 'x'.repeat(MAX_IMPORT_FILE_BYTES + 1)
    expect(expectParseFailure(parseBugImport(text))).toMatch(/larger than 5 MB/i)
  })

  it('strips a UTF-8 BOM before parsing', () => {
    const bug = makeBug({ id: 'bom-bug' })
    const text = `\uFEFF${serializeBugExport([bug], EXPORTED_AT)}`

    const result = expectParseOk(parseBugImport(text))

    expect(result.bugs).toEqual([bug])
  })
})

describe('import record validation', () => {
  it('keeps valid records and reports invalid ones with positions', () => {
    const valid = makeBug({ id: 'mixed-valid', title: 'Valid report' })
    const invalid = { ...recordFor(makeBug({ id: 'mixed-invalid' })), title: '' }
    const text = envelopeWith([valid, invalid])

    const result = expectParseOk(parseBugImport(text))

    expect(result.bugs).toEqual([valid])
    expect(result.invalidCount).toBe(1)
    expect(result.issues).toEqual([
      { position: 2, reason: 'Enter a title.' },
    ])
  })

  it('treats duplicate ids inside the file as invalid', () => {
    const first = makeBug({ id: 'duplicate-id', title: 'First copy' })
    const second = makeBug({ id: 'duplicate-id', title: 'Second copy' })

    const result = expectParseOk(
      parseBugImport(envelopeWith([first, second])),
    )

    expect(result.bugs).toEqual([first])
    expect(result.invalidCount).toBe(1)
    expect(result.issues[0].position).toBe(2)
    expect(result.issues[0].reason).toMatch(/duplicate id/i)
  })

  it('rejects a Verified fix without verification notes', () => {
    const bug = makeBug({
      id: 'verified-without-notes',
      fixStatus: 'Verified',
      proposedFix: 'Use the tested path.',
      verificationNotes: '   ',
    })

    const result = expectParseOk(parseBugImport(envelopeWith([bug])))

    expect(result.bugs).toEqual([])
    expect(result.invalidCount).toBe(1)
    expect(result.issues[0].reason).toMatch(
      /record how the fix was verified/i,
    )
  })

  it.each([
    ['missing title', { title: '' }, /enter a title/i],
    ['invalid severity', { severity: 'Urgent' }, /valid severity/i],
    ['invalid status', { status: 'Waiting' }, /valid status/i],
    ['invalid fix status', { fixStatus: 'Done' }, /valid fix status/i],
    ['invalid created date', { createdAt: 'not-a-date' }, /created date/i],
    ['invalid updated date', { updatedAt: 'not-a-date' }, /updated date/i],
    [
      'overlong title',
      { title: 'x'.repeat(141) },
      /title to 140 characters/i,
    ],
    [
      'missing proposed fix with a fix status',
      { fixStatus: 'Accepted', proposedFix: '' },
      /proposed fix/i,
    ],
  ])('rejects %s', (_label, overrides, reason) => {
    const bug = {
      ...recordFor(makeBug({ id: `invalid-${_label}` })),
      ...(overrides as Record<string, unknown>),
    }

    const result = expectParseOk(parseBugImport(envelopeWith([bug])))

    expect(result.bugs).toEqual([])
    expect(result.invalidCount).toBe(1)
    expect(result.issues[0].reason).toMatch(reason)
  })

  it('ignores dangerous extra keys and unknown fields', () => {
    const base = recordFor(makeBug({ id: 'dangerous-keys' }))
    Object.defineProperty(base, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    })
    Object.defineProperty(base, 'constructor', {
      value: { polluted: true },
      enumerable: true,
    })
    base.prototype = { polluted: true }
    base.theme = 'dark'
    base.assistantText = 'private text'

    const result = expectParseOk(parseBugImport(envelopeWith([base])))

    expect(result.bugs).toHaveLength(1)
    expect(result.bugs[0]).not.toHaveProperty('constructor')
    expect(result.bugs[0]).not.toHaveProperty('prototype')
    expect(result.bugs[0]).not.toHaveProperty('theme')
    expect(result.bugs[0]).not.toHaveProperty('assistantText')
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})

describe('counting current ids', () => {
  it('counts imported ids that already exist', () => {
    const imported = [
      makeBug({ id: 'existing-a' }),
      makeBug({ id: 'existing-b' }),
      makeBug({ id: 'new-c' }),
    ]
    const current = [
      makeBug({ id: 'existing-b' }),
      makeBug({ id: 'existing-a' }),
      makeBug({ id: 'unrelated-d' }),
    ]

    expect(countExistingBugIds(imported, current)).toBe(2)
  })
})

describe('applying an import', () => {
  it('merges new reports, skips existing ids, and preserves imported timestamps', () => {
    const existing = makeBug({
      id: 'merge-existing',
      title: 'Existing report',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    })
    const duplicate = makeBug({ id: 'merge-existing', title: 'Duplicate' })
    const added = makeBug({
      id: 'merge-added',
      title: 'Imported report',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    })
    const storage = memoryStorage()
    const rawBefore = seedStorage(storage, [existing])

    const result = applyBugImport({
      currentBugs: [existing],
      importedBugs: [duplicate, added],
      invalidCount: 1,
      mode: 'merge',
      storage,
    })

    if (!result.ok) throw new Error(result.message)
    expect(result.bugs).toEqual([existing, added])
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(2)
    expect(result.replaced).toBe(0)
    expect(result.bugs[1].createdAt).toBe(added.createdAt)
    expect(result.bugs[1].updatedAt).toBe(added.updatedAt)
    expect(storage.getItem(BUGS_STORAGE_KEY)).not.toBe(rawBefore)
    expect(storage.getItem(PREIMPORT_STORAGE_KEY)).toBe(rawBefore)
    expect(JSON.parse(storage.getItem(BUGS_STORAGE_KEY) as string).bugs).toEqual(
      [existing, added],
    )
  })

  it('replaces all current reports and reports replaced counts', () => {
    const oldA = makeBug({ id: 'replace-old-a' })
    const oldB = makeBug({ id: 'replace-old-b' })
    const imported = makeBug({ id: 'replace-new' })
    const storage = memoryStorage()
    const rawBefore = seedStorage(storage, [oldA, oldB])

    const result = applyBugImport({
      currentBugs: [oldA, oldB],
      importedBugs: [imported],
      invalidCount: 1,
      mode: 'replace',
      storage,
    })

    if (!result.ok) throw new Error(result.message)
    expect(result.bugs).toEqual([imported])
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.replaced).toBe(2)
    expect(storage.getItem(PREIMPORT_STORAGE_KEY)).toBe(rawBefore)
    expect(JSON.parse(storage.getItem(BUGS_STORAGE_KEY) as string).bugs).toEqual(
      [imported],
    )
  })

  it('overwrites an earlier pre-import backup with the latest raw value', () => {
    const existing = makeBug({ id: 'backup-existing' })
    const imported = makeBug({ id: 'backup-imported' })
    const storage = memoryStorage()
    const rawBefore = seedStorage(storage, [existing])
    storage.setItem(PREIMPORT_STORAGE_KEY, 'older backup')

    const result = applyBugImport({
      currentBugs: [existing],
      importedBugs: [imported],
      invalidCount: 0,
      mode: 'merge',
      storage,
    })

    expect(result.ok).toBe(true)
    expect(storage.getItem(PREIMPORT_STORAGE_KEY)).toBe(rawBefore)
    expect(storage.getItem(PREIMPORT_STORAGE_KEY)).not.toBe('older backup')
  })

  it('refuses to apply when there are no valid reports', () => {
    const existing = makeBug({ id: 'empty-import-existing' })
    const storage = memoryStorage()
    const rawBefore = seedStorage(storage, [existing])

    const result = applyBugImport({
      currentBugs: [existing],
      importedBugs: [],
      invalidCount: 3,
      mode: 'merge',
      storage,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/no valid reports/i)
    expect(storage.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)
    expect(storage.getItem(PREIMPORT_STORAGE_KEY)).toBeNull()
  })

  it('leaves data unchanged when the backup write fails', () => {
    const existing = makeBug({ id: 'backup-failure-existing' })
    const imported = makeBug({ id: 'backup-failure-imported' })
    const base = memoryStorage()
    const rawBefore = seedStorage(base, [existing])
    const storage: StorageLike = {
      getItem: base.getItem,
      removeItem: base.removeItem,
      setItem: (key, value) => {
        if (key === PREIMPORT_STORAGE_KEY) throw new Error('quota exceeded')
        base.setItem(key, value)
      },
    }

    const result = applyBugImport({
      currentBugs: [existing],
      importedBugs: [imported],
      invalidCount: 0,
      mode: 'merge',
      storage,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/unchanged/i)
    expect(base.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)
    expect(base.getItem(PREIMPORT_STORAGE_KEY)).toBeNull()
  })

  it('leaves the main data unchanged when the report write fails', () => {
    const existing = makeBug({ id: 'main-failure-existing' })
    const imported = makeBug({ id: 'main-failure-imported' })
    const base = memoryStorage()
    const rawBefore = seedStorage(base, [existing])
    const storage: StorageLike = {
      getItem: base.getItem,
      removeItem: base.removeItem,
      setItem: (key, value) => {
        if (key === BUGS_STORAGE_KEY) throw new Error('quota exceeded')
        base.setItem(key, value)
      },
    }

    const result = applyBugImport({
      currentBugs: [existing],
      importedBugs: [imported],
      invalidCount: 0,
      mode: 'merge',
      storage,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/unchanged/i)
    expect(base.getItem(BUGS_STORAGE_KEY)).toBe(rawBefore)
    expect(base.getItem(PREIMPORT_STORAGE_KEY)).toBe(rawBefore)
  })

  it('refuses to apply when current storage cannot be read', () => {
    const existing = makeBug({ id: 'read-failure-existing' })
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    }

    const result = applyBugImport({
      currentBugs: [existing],
      importedBugs: [makeBug({ id: 'read-failure-imported' })],
      invalidCount: 0,
      mode: 'merge',
      storage,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/unchanged/i)
  })
})
