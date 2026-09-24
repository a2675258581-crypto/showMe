export type Base64Mode = 'text' | 'file'
export type Direction = 'encode' | 'decode'

export interface Base64Prefs {
  mode: Base64Mode
  direction: Direction
  urlSafe: boolean
  padding: boolean
  /** 文本编码：每 76 字符换行（MIME） */
  wrap: boolean
  /** 文本解码结果的显示方式 */
  view: 'text' | 'hex'
  /** 文件编码：带 data: 前缀 */
  dataUrl: boolean
  /** 文件编码：每 76 字符换行 */
  fileWrap: boolean
}

export const DEFAULT_PREFS: Base64Prefs = {
  mode: 'text',
  direction: 'encode',
  urlSafe: false,
  padding: true,
  wrap: false,
  view: 'text',
  dataUrl: false,
  fileWrap: false,
}

export function sanitizePrefs(p: Partial<Base64Prefs> | null | undefined): Base64Prefs {
  const v = { ...DEFAULT_PREFS, ...(p ?? {}) }
  return {
    mode: v.mode === 'file' ? 'file' : 'text',
    direction: v.direction === 'decode' ? 'decode' : 'encode',
    urlSafe: v.urlSafe === true,
    padding: v.padding !== false,
    wrap: v.wrap === true,
    view: v.view === 'hex' ? 'hex' : 'text',
    dataUrl: v.dataUrl === true,
    fileWrap: v.fileWrap === true,
  }
}

/** 32×32 的 PNG 示例（带透明圆角） */
export const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB1ElEQVR42sXX/4dUURjH8c/PERGxrCUiYolluUQiIiKWZXdnd7apaWramb07s81+m93Z2S8kIiInIiIiEZGJ6O+Yf2PvzNx77rlzPznc4erHNe7zF7ye4zyH88aFE+LiMXHpmLh8FONKO3Ym2rGaPIy7U63YXG0Nee1gyOv7Q97YH3K6GfHmXsSZvYizuxGdnYi3tg1vbxve2TK82zC81zC8/zLkg82QDzdDM1cPu/O1UC3UtJPb0Mi7GgVXo7iu8T+uJtoxJw9jTrVijgHnXD3kfC3kQk0zt6GZd7Ua4aVqgDTeyQBnwdUsruuOxct2gAxPPsJZqgYsVwNVqQQY3XnWOCuVgO5a4CBZOAmc9TVfIdl2CZyNF34XY3pq58G5U/YNBHE2yz4hibee+4QkfvRsQEjip3YASfxVaUBI4q+fDghJ/I0dQBJ/W+wTkvi7J31CEn//uE9I4h/sAJL4x0KfkMQ/PeoRkvhnO4Ak/mW1R0jiX/M9Ivm3i+Df8p5BEg0SOL+veF0kxSKB88eyp5DkkgTOn8ueg6TVlACufuU8pEOxkyHesfjvpTMgHYpJLmVycov/sQOkcNhWs7lki8VGg/23j+Op2W23C2fvPI3/XTzDPwcy9dPPcpRQAAAAAElFTkSuQmCC'
