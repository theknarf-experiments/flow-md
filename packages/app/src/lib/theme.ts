// Dark/light theme. The palette lives in index.css keyed off
// `<html data-theme>`; this module owns the attribute. No stored choice →
// follow the OS. An explicit toggle persists to localStorage and wins from
// then on.

const THEME_KEY = 'flow-md-theme'

export type Theme = 'dark' | 'light'

/** Runs in <head> before first paint so the prerendered shell can't flash
 *  the wrong palette. Must stay dependency-free (it's serialized inline). */
export const themeInitScript = `(() => {
  try {
    var t = localStorage.getItem('${THEME_KEY}')
    if (t !== 'dark' && t !== 'light')
      t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', t)
  } catch (e) {}
})()`

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light'
    : 'dark'
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // storage full/blocked — the attribute still applies for this session
  }
  return next
}
