import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, vi } from 'vitest'

configure({ asyncUtilTimeout: 15000 })

// The engine tests that load real WebAssembly grammars run in the plain Node environment,
// where none of the DOM fixtures below exist.
const inDom = typeof window !== 'undefined' && typeof document !== 'undefined'

beforeEach(() => {
  if (!inDom) return
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  if (!inDom) return
  cleanup()
  vi.restoreAllMocks()
})

if (inDom && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}
// With `isolate: false` one worker shares a single module registry across files, so a mocked module
// stays mocked for whoever imports it next — including files that never mock anything and want the
// real thing (AppLayout.announcement.test.tsx renders the real <App/> and inherits useWorkspace's
// stub that way). Leave the registry as this file found it so no file's mocks reach the next file.
afterAll(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
