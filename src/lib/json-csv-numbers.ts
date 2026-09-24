/**
 * 保留数字原文的 JSON 解析（JSON ⇄ CSV、JSON ⇄ XML 共用，纯逻辑）。
 *
 * JSON.parse 会把 1234567890123456789 这类超出 2^53 的整数、超过 15 位有效数字的小数、
 * 1e400 这类溢出值悄悄改掉（变成 1234567890123456800、Infinity）。
 * CSV / XML 输出本身就是文本，所以对这些数字直接保留 JSON 原文，保证导出的值一字不差。
 */

/** 数字字面量的有效数字位数（去掉符号、指数、小数点与前导零） */
export function significantDigits(source: string): number {
  const mantissa = source
    .replace(/^-/, '')
    .replace(/[eE].*$/, '')
    .replace('.', '')
  return mantissa.replace(/^0+/, '').replace(/0+$/, '').length || 1
}

/** 解析后的 number 是否与 JSON 原文不等价（丢失了精度或溢出） */
export function isLossyNumber(source: string, value: number): boolean {
  if (!Number.isFinite(value)) return true
  if (/^-?\d+$/.test(source)) return !Number.isSafeInteger(value)
  // 1e-400 这类下溢成 0 的值
  if (value === 0) return /[1-9]/.test(source.replace(/[eE].*$/, ''))
  return significantDigits(source) > 15 && String(value) !== source
}

/** 只有可能出问题的文本才需要逐值检查：连续 16 位以上的数字，或指数写法 */
const SUSPICIOUS = /(?:\d\.?){16,}|\d[eE][+-]?\d{3}/

interface ReviverContext {
  source?: string
}

export interface ExactParse {
  value: unknown
  /** 保留了原文的数字（去重后的原文） */
  preserved: string[]
  /** 浏览器不支持 JSON.parse 的原文访问时，发现的丢失精度的数字 */
  lossy: string[]
}

/**
 * 解析已知合法的 JSON，把会失真的数字替换成原文字符串。
 * 调用方应先用 `parseJson` 校验并获得带行列号的错误；这里假设文本合法。
 */
export function parseJsonExact(text: string): ExactParse {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const preserved = new Set<string>()
  const lossy = new Set<string>()
  if (!SUSPICIOUS.test(src)) return { value: JSON.parse(src), preserved: [], lossy: [] }
  const value: unknown = JSON.parse(src, function (_key, v: unknown, ctx?: ReviverContext) {
    if (typeof v !== 'number') return v
    const source = ctx?.source
    if (source === undefined) {
      // 旧浏览器拿不到原文：只能提示
      if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))
        lossy.add(String(v))
      return v
    }
    if (!isLossyNumber(source, v)) return v
    preserved.add(source)
    return source
  })
  return { value, preserved: [...preserved], lossy: [...lossy] }
}

/**
 * 提示文案；没有问题时返回 null。
 * 能保留原文时结果本身就是对的，不打扰用户；只有确实丢了精度（旧浏览器）才提示。
 */
export function numberWarning(r: ExactParse): string | null {
  if (!r.lossy.length) return null
  const shown =
    r.lossy.slice(0, 3).join('、') + (r.lossy.length > 3 ? ` 等 ${r.lossy.length} 个` : '')
  return `有数字超出 JavaScript 的精度范围，结果可能与原文不同：${shown}（可以在 JSON 里把它们写成字符串）`
}
