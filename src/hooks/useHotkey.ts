import { useEffect, useRef } from 'react'

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)

/** 平台对应的主修饰键显示：⌘ 或 Ctrl */
export const modKey = isMac ? '⌘' : 'Ctrl'

/**
 * 监听快捷键，combo 形如 "mod+k"、"mod+enter"、"/"、"escape"。
 * mod 在 macOS 上是 ⌘，其它平台是 Ctrl。
 */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts: { enabled?: boolean; allowInInput?: boolean } = {},
) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  const { enabled = true, allowInInput = true } = opts
  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+')
    const key = parts[parts.length - 1]
    const needMod = parts.includes('mod')
    const needShift = parts.includes('shift')
    const needAlt = parts.includes('alt')
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (needMod !== mod) return
      if (needShift !== e.shiftKey) return
      if (needAlt !== e.altKey) return
      if (e.key.toLowerCase() !== key) return
      if (!allowInInput && !needMod) {
        const t = e.target as HTMLElement | null
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      }
      ref.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, enabled, allowInInput])
}
