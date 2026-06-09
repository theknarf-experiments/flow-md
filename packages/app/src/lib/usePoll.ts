// Tiny fetch-and-poll hook: load once, refresh on an interval (the vault can
// change underneath us — other editors, the watcher, query updates), and
// expose a manual refresh for after mutations. Deliberately not a data
//-fetching framework; the app's needs are small.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface Polled<T> {
  data: T | null
  error: string | null
  refresh: () => Promise<void>
}

export function usePoll<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
  intervalMs = 3000,
): Polled<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const refresh = useCallback(async () => {
    try {
      setData(await fnRef.current())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    setData(null)
    setError(null)
    void refresh()
    if (intervalMs <= 0) return
    const t = setInterval(() => void refresh(), intervalMs)
    return () => clearInterval(t)
  }, [refresh, intervalMs])

  return { data, error, refresh }
}
