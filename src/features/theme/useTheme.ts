import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyTheme,
  resolveInitialTheme,
  saveTheme,
  type Theme,
} from './theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme())
  const isFirstEffect = useRef(true)

  useEffect(() => {
    applyTheme(theme)
    if (isFirstEffect.current) {
      isFirstEffect.current = false
      return
    }
    saveTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggleTheme }
}
