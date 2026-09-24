import type { UrlCodecMode } from '@/lib/url-codec'

export type Tab = 'codec' | 'parse'
export type Direction = 'encode' | 'decode'

export interface UrlPrefs {
  tab: Tab
  direction: Direction
  mode: UrlCodecMode
  perLine: boolean
  strict: boolean
  keepEscapes: boolean
  /** 参数表重建 URL 时空格写成 + */
  spaceAsPlus: boolean
  /** 参数表下方显示编码后的写法 */
  showEncoded: boolean
}

export const DEFAULT_PREFS: UrlPrefs = {
  tab: 'codec',
  direction: 'encode',
  mode: 'component',
  perLine: false,
  strict: false,
  keepEscapes: false,
  spaceAsPlus: false,
  showEncoded: false,
}

export function sanitizePrefs(p: Partial<UrlPrefs> | null | undefined): UrlPrefs {
  const v = { ...DEFAULT_PREFS, ...(p ?? {}) }
  return {
    tab: v.tab === 'parse' ? 'parse' : 'codec',
    direction: v.direction === 'decode' ? 'decode' : 'encode',
    mode: v.mode === 'uri' || v.mode === 'form' ? v.mode : 'component',
    perLine: v.perLine === true,
    strict: v.strict === true,
    keepEscapes: v.keepEscapes === true,
    spaceAsPlus: v.spaceAsPlus === true,
    showEncoded: v.showEncoded === true,
  }
}

export type SetPref = <K extends keyof UrlPrefs>(k: K, v: UrlPrefs[K]) => void
