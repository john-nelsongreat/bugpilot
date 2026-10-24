import { describe, expect, it, vi } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  resolveInitialTheme,
  saveTheme,
  type ThemeStorage,
} from './theme'

function createThemeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))
  const storage: ThemeStorage & { entries: Map<string, string> } = {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }

  return storage
}

describe('resolveInitialTheme', () => {
  it('uses a saved preference', () => {
    expect(
      resolveInitialTheme(
        createThemeStorage({ [THEME_STORAGE_KEY]: 'dark' }),
        false,
      ),
    ).toBe('dark')
    expect(
      resolveInitialTheme(
        createThemeStorage({ [THEME_STORAGE_KEY]: 'light' }),
        true,
      ),
    ).toBe('light')
  })

  it('falls back to the system preference when no valid preference exists', () => {
    expect(resolveInitialTheme(createThemeStorage(), true)).toBe('dark')
    expect(resolveInitialTheme(createThemeStorage(), false)).toBe('light')
    expect(
      resolveInitialTheme(
        createThemeStorage({ [THEME_STORAGE_KEY]: 'midnight' }),
        true,
      ),
    ).toBe('dark')
  })

  it('falls back safely when storage cannot be read', () => {
    const storage: ThemeStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: vi.fn(),
    }

    expect(resolveInitialTheme(storage, true)).toBe('dark')
  })
})

describe('applyTheme and saveTheme', () => {
  it('applies the theme to the document root and persists it', () => {
    const storage = createThemeStorage()

    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(saveTheme('dark', storage)).toBe(true)
    expect(storage.entries.get(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('reports a preference write failure without throwing', () => {
    const storage: ThemeStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked')
      },
    }

    expect(saveTheme('light', storage)).toBe(false)
  })
})
