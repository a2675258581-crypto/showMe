import { useCallback, useSyncExternalStore } from 'react'

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()
const cache = new Map<string, { raw: string | null; value: unknown }>()

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function emit(key: string) {
  listeners.get(key)?.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key) emit(e.key)
  })
}

/**
 * 持久化到 localStorage 的 state（JSON 序列化）。
 * 同一 key 在多个组件 / 多个标签页之间自动同步；读写失败（隐私模式等）时退化为内存值。
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (l: Listener) => {
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(l)
      return () => set!.delete(l)
    },
    [key],
  )

  const getSnapshot = useCallback((): T => {
    const raw = readRaw(key)
    const hit = cache.get(key)
    if (hit && hit.raw === raw) return hit.value as T
    let value: T = initial
    if (raw !== null) {
      try {
        value = JSON.parse(raw) as T
      } catch {
        value = initial
      }
    } else if (hit && hit.raw === null) {
      // 写入失败时保存在内存里的值
      return hit.value as T
    }
    cache.set(key, { raw, value })
    return value
    // initial 只作为缺省值使用，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const value = useSyncExternalStore(subscribe, getSnapshot, () => initial)

  const setValue = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prev = getSnapshot()
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      let raw: string | null
      try {
        raw = JSON.stringify(next)
        localStorage.setItem(key, raw)
      } catch {
        raw = null
      }
      cache.set(key, { raw, value: next })
      emit(key)
    },
    [key, getSnapshot],
  )

  return [value, setValue]
}
