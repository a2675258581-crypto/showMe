import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'

export function useFavorites() {
  const [ids, setIds] = useLocalStorage<string[]>('favorites.v1', [])
  const toggle = useCallback(
    (id: string) => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev])),
    [setIds],
  )
  const has = useCallback((id: string) => ids.includes(id), [ids])
  return { ids, toggle, has }
}

const RECENT_MAX = 8

export function useRecent() {
  const [ids, setIds] = useLocalStorage<string[]>('recent.v1', [])
  const push = useCallback(
    (id: string) => setIds((prev) => [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX)),
    [setIds],
  )
  const clear = useCallback(() => setIds([]), [setIds])
  return { ids, push, clear }
}
