import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useLocalStorage } from './useLocalStorage'

export type ThemePref = 'system' | 'light' | 'dark'

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function subscribeSystem(cb: () => void) {
  media?.addEventListener('change', cb)
  return () => media?.removeEventListener('change', cb)
}

export function useSystemDark() {
  return useSyncExternalStore(subscribeSystem, () => !!media?.matches, () => false)
}

/** 主题偏好：跟随系统 / 浅色 / 深色，写在 localStorage `theme.v1` */
export function useTheme() {
  const [pref, setPref] = useLocalStorage<ThemePref>('theme.v1', 'system')
  const systemDark = useSystemDark()
  const isDark = pref === 'dark' || (pref === 'system' && systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', isDark ? '#000000' : '#f5f5f7'))
  }, [isDark])

  const cycle = useCallback(() => {
    setPref((p) => (p === 'system' ? (systemDark ? 'light' : 'dark') : p === 'light' ? 'dark' : 'light'))
  }, [setPref, systemDark])

  return { pref, setPref, isDark, cycle }
}

function subscribeClass(cb: () => void) {
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
}

/** 只读：当前是否为深色（观察 <html class="dark">），不写任何东西 */
export function useIsDark() {
  return useSyncExternalStore(
    subscribeClass,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )
}
