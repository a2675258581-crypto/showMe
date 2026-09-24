/**
 * 「API 调试」的 JSON 文本工具（纯函数，无依赖）：
 * - 按词法重新缩进 / 压缩：字面量原样保留，不经过 JSON.parse，所以大整数（如雪花 ID）不会丢精度、1.0 不会变成 1
 * - 模板 JSON：把 {{变量}} 当作一个值，便于校验和格式化 {"id": {{userId}}} 这样的请求体
 */

/** 与 api-client.ts 的 VAR_PATTERN 相同，只是锚定在当前位置（sticky） */
const VAR_AT = /\{\{\s*[^{}\s][^{}]*?\s*\}\}/y
const VAR_ALL = /\{\{\s*[^{}\s][^{}]*?\s*\}\}/g

/**
 * 把 {{变量}} 换成等长的占位数字（0 后面补空格，换行保留），
 * 替换后的文本可以直接交给 JSON 校验器，报错的行列与原文一致。
 */
export function maskTemplateVars(text: string): string {
  if (!text.includes('{{')) return text
  return text.replace(VAR_ALL, (m) => '0' + m.slice(1).replace(/[^\n]/g, ' '))
}

const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
const isPunct = (c: string) =>
  c === '{' || c === '}' || c === '[' || c === ']' || c === ',' || c === ':'

/**
 * 按词法重新缩进 JSON。indent 为 0 时输出压缩后的单行文本。
 * 字符串、数字、true/false/null 以及（allowVars 时的）{{变量}} 都原样输出。
 * 调用方应先确认内容是合法 JSON（或模板 JSON）；括号不配对等结构错误时返回 null。
 */
export function reindentJson(text: string, indent = 2, allowVars = false): string | null {
  const out: string[] = []
  const n = text.length
  const pad = indent > 0 ? ' '.repeat(indent) : ''
  const stack: string[] = []
  const newline = () => {
    if (indent > 0) out.push('\n' + pad.repeat(stack.length))
  }
  let i = 0
  let tokens = 0

  /** 跳过空白后看下一个字符 */
  const peek = (): string | undefined => {
    let j = i
    while (j < n && isWs(text[j])) j++
    return text[j]
  }

  while (i < n) {
    const c = text[i]
    if (isWs(c)) {
      i++
      continue
    }
    tokens++
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      if (j >= n) return null
      out.push(text.slice(i, j + 1))
      i = j + 1
      continue
    }
    if (allowVars && c === '{' && text[i + 1] === '{') {
      VAR_AT.lastIndex = i
      const m = VAR_AT.exec(text)
      if (m) {
        out.push(m[0])
        i += m[0].length
        continue
      }
    }
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']'
      i++
      if (peek() === close) {
        out.push(c + close)
        while (text[i] !== close) i++
        i++
        continue
      }
      out.push(c)
      stack.push(close)
      newline()
      continue
    }
    if (c === '}' || c === ']') {
      if (stack.pop() !== c) return null
      newline()
      out.push(c)
      i++
      continue
    }
    if (c === ',') {
      if (!stack.length) return null
      out.push(',')
      newline()
      i++
      continue
    }
    if (c === ':') {
      out.push(indent > 0 ? ': ' : ':')
      i++
      continue
    }
    // 数字 / true / false / null：读到空白、标点或引号为止
    let j = i
    while (j < n && !isWs(text[j]) && !isPunct(text[j]) && text[j] !== '"') j++
    out.push(text.slice(i, j))
    i = j
  }
  if (stack.length || !tokens) return null
  return out.join('')
}
