import {
  FOOTER_JOKES,
  type FooterPageKey,
} from '../../content/footerJokes'

export const FOOTER_JOKE_INTERVAL_MS = 60_000
export const FOOTER_JOKE_STORAGE_PREFIX = 'bugpilot.footerJoke.'

const fallbackLastIndex = new Map<FooterPageKey, number>()

export function getFooterPageKey(pathname: string): FooterPageKey {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  if (normalized === '/') return 'overview'
  if (normalized === '/bugs') return 'bug-log'
  if (normalized === '/bugs/new') return 'bug-form'
  if (/^\/bugs\/[^/]+\/edit$/.test(normalized)) return 'bug-form'
  if (/^\/bugs\/[^/]+$/.test(normalized)) return 'bug-detail'
  if (normalized === '/assistant') return 'assistant'
  return 'not-found'
}

export function chooseJokeIndex(
  previousIndex: number | null,
  random: () => number,
  jokeCount = 4,
): number {
  const count = Math.max(1, Math.floor(jokeCount))
  const randomValue = random()
  const normalizedRandom = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 0.999999999)
    : 0

  if (
    previousIndex === null ||
    !Number.isInteger(previousIndex) ||
    previousIndex < 0 ||
    previousIndex >= count
  ) {
    return Math.min(count - 1, Math.floor(normalizedRandom * count))
  }

  const offset = Math.floor(normalizedRandom * (count - 1))
  return offset >= previousIndex ? offset + 1 : offset
}

export function readLastJokeIndex(pageKey: FooterPageKey): number | null {
  try {
    const raw = window.sessionStorage.getItem(
      `${FOOTER_JOKE_STORAGE_PREFIX}${pageKey}`,
    )
    if (raw === null) return null

    const index = Number(raw)
    return Number.isInteger(index) &&
      index >= 0 &&
      index < FOOTER_JOKES[pageKey].length
      ? index
      : null
  } catch {
    return fallbackLastIndex.get(pageKey) ?? null
  }
}

export function writeLastJokeIndex(
  pageKey: FooterPageKey,
  index: number,
): void {
  fallbackLastIndex.set(pageKey, index)

  try {
    window.sessionStorage.setItem(
      `${FOOTER_JOKE_STORAGE_PREFIX}${pageKey}`,
      String(index),
    )
  } catch {
    // The in-memory fallback keeps rotation working when storage is blocked.
  }
}
