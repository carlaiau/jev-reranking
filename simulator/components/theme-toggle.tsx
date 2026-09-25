'use client'

import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon } from '@heroicons/react/20/solid'

type Theme = 'light' | 'dark'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  }, [])

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    document.documentElement.classList.toggle('dark', next === 'dark')
    try { localStorage.setItem('rerank-theme', next) } catch { /* Theme still works for this visit. */ }
    setTheme(next)
  }

  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
    {theme === 'light' ? <MoonIcon aria-hidden="true" /> : <SunIcon aria-hidden="true" />}
  </button>
}
