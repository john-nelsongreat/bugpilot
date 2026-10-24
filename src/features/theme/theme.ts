export const THEME_STORAGE_KEY = 'bugpilot.theme.v1'

export type Theme = 'light' | 'dark'

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function getDefaultStorage(): ThemeStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function resolveInitialTheme(
  storage?: ThemeStorage | null,
  prefersDark: boolean = systemPrefersDark(),
): Theme {
  const target = storage ?? getDefaultStorage()
  if (target) {
    try {
      const saved = target.getItem(THEME_STORAGE_KEY)
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      // Fall through to the system preference.
    }
  }

  return prefersDark ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function saveTheme(
  theme: Theme,
  storage?: ThemeStorage | null,
): boolean {
  const target = storage ?? getDefaultStorage()
  if (!target) return false
  try {
    target.setItem(THEME_STORAGE_KEY, theme)
    return true
  } catch {
    return false
  }
}
