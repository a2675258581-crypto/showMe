/** Markdown 工具栏：在光标 / 选区处插入或切换格式（纯函数，返回一次文本替换） */

export type FormatAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'heading'
  | 'link'
  | 'image'
  | 'code'
  | 'ul'
  | 'ol'
  | 'task'
  | 'quote'
  | 'table'
  | 'hr'

/** 把 doc[from, to) 替换为 insert；selFrom / selTo 是替换后新文档中的选区 */
export interface FormatEdit {
  from: number
  to: number
  insert: string
  selFrom: number
  selTo: number
}

export function applyEdit(doc: string, e: FormatEdit): string {
  return doc.slice(0, e.from) + e.insert + doc.slice(e.to)
}

// ───────────── 行内包裹 ─────────────

function isWrapped(doc: string, from: number, to: number, marker: string): boolean {
  const ml = marker.length
  if (doc.slice(from - ml, from) !== marker || doc.slice(to, to + ml) !== marker) return false
  // 单个 * 时排除 **粗体** 的情况
  if (marker === '*') return doc[from - ml - 1] !== '*' && doc[to + ml] !== '*'
  return true
}

function wrap(
  doc: string,
  from: number,
  to: number,
  marker: string,
  placeholder: string,
): FormatEdit {
  const ml = marker.length
  const sel = doc.slice(from, to)
  // 选区外侧已有标记 → 去掉
  if (isWrapped(doc, from, to, marker)) {
    return { from: from - ml, to: to + ml, insert: sel, selFrom: from - ml, selTo: to - ml }
  }
  // 选区本身带着标记 → 去掉
  if (
    sel.length >= ml * 2 &&
    sel.startsWith(marker) &&
    sel.endsWith(marker) &&
    (marker !== '*' || !sel.startsWith('**') || sel.startsWith('***'))
  ) {
    const inner = sel.slice(ml, sel.length - ml)
    return { from, to, insert: inner, selFrom: from, selTo: from + inner.length }
  }
  const text = sel || placeholder
  // 首尾空白放到标记外面，否则 Markdown 不认
  const lead = /^\s*/.exec(text)![0]
  const trail = text.length > lead.length ? /\s*$/.exec(text)![0] : ''
  const core = text.slice(lead.length, text.length - trail.length)
  const insert = lead + marker + core + marker + trail
  const start = from + lead.length + ml
  return { from, to, insert, selFrom: start, selTo: start + core.length }
}

// ───────────── 行前缀 ─────────────

function lineRange(doc: string, from: number, to: number) {
  const start = doc.lastIndexOf('\n', from - 1) + 1
  // 选区恰好结束在下一行行首时，不包含那一行
  const endFrom = to > from && doc[to - 1] === '\n' ? to - 1 : to
  let end = doc.indexOf('\n', endFrom)
  if (end < 0) end = doc.length
  return { start, end }
}

const LIST_MARKER = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/
const IS_UL = /^\s*[-*+]\s+(?!\[[ xX]\]\s)/
const IS_OL = /^\s*\d+[.)]\s+/
const IS_TASK = /^\s*[-*+]\s+\[[ xX]\]\s+/
const IS_QUOTE = /^\s*>/

interface PrefixSpec {
  isOn: (line: string) => boolean
  /** 去掉本格式 */
  remove: (line: string) => string
  /** 加上本格式（i 为第几个非空行） */
  add: (line: string, i: number) => string
  /** 空行是否也处理 */
  includeEmpty?: boolean
}

function prefixLines(doc: string, from: number, to: number, spec: PrefixSpec): FormatEdit {
  const { start, end } = lineRange(doc, from, to)
  const lines = doc.slice(start, end).split('\n')
  const relevant = lines.filter((l) => spec.includeEmpty || l.trim() !== '')
  const allOn = relevant.length > 0 && relevant.every(spec.isOn)
  let k = 0
  const out = lines.map((l) => {
    if (allOn) return spec.isOn(l) ? spec.remove(l) : l
    if (!spec.includeEmpty && l.trim() === '' && lines.length > 1) return l
    return spec.isOn(l) ? l : spec.add(l, k++)
  })
  const insert = out.join('\n')
  if (from === to && lines.length === 1) {
    // 光标跟着内容走
    const pos = Math.max(
      start,
      Math.min(start + insert.length, from + insert.length - (end - start)),
    )
    return { from: start, to: end, insert, selFrom: pos, selTo: pos }
  }
  return { from: start, to: end, insert, selFrom: start, selTo: start + insert.length }
}

const withIndent = (line: string, prefix: string) => {
  const m = LIST_MARKER.exec(line)
  const indent = m ? m[1] : (/^\s*/.exec(line)?.[0] ?? '')
  const rest = m ? line.slice(m[0].length) : line.slice(indent.length)
  return indent + prefix + rest
}

const listSpec = (isOn: RegExp, prefix: (i: number) => string): PrefixSpec => ({
  isOn: (l) => isOn.test(l),
  remove: (l) => l.replace(LIST_MARKER, '$1'),
  add: (l, i) => withIndent(l, prefix(i)),
})

// ───────────── 块级插入 ─────────────

/** 让插入的块前后各有一个空行 */
function blockInsert(
  doc: string,
  from: number,
  to: number,
  block: string,
  selIn: [number, number],
) {
  const before = doc.slice(0, from)
  const after = doc.slice(to)
  const pre = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const post =
    after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const insert = pre + block + post
  const base = from + pre.length
  return { from, to, insert, selFrom: base + selIn[0], selTo: base + selIn[1] }
}

/** 块级模板的插入位置：光标在空行时就地插入，否则插在当前行之后，不覆盖已有文字 */
function insertionPoint(doc: string, from: number, to: number): { from: number; to: number } {
  const { start, end } = lineRange(doc, from, to)
  if (doc.slice(start, end).trim() === '') return { from: start, to: end }
  return { from: end, to: end }
}

/** 把选中的「逗号 / 制表符分隔」文本转成表格；否则插入模板 */
function tableFrom(sel: string): {
  block: string
  select: [number, number]
  fromSelection: boolean
} {
  const rows = sel
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      l.split(l.includes('\t') ? '\t' : /\s*[,，]\s*/).map((c) => c.trim().replace(/\|/g, '\\|')),
    )
  if (rows.length >= 1 && rows.some((r) => r.length > 1)) {
    const cols = Math.max(...rows.map((r) => r.length))
    const norm = rows.map((r) => [...r, ...new Array(cols - r.length).fill('')])
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`
    const block = [
      line(norm[0]),
      line(new Array(cols).fill('---')),
      ...norm.slice(1).map(line),
    ].join('\n')
    return { block, select: [0, block.length], fromSelection: true }
  }
  const block = [
    '| 列 1 | 列 2 | 列 3 |',
    '| --- | --- | --- |',
    '| 内容 | 内容 | 内容 |',
    '| 内容 | 内容 | 内容 |',
  ].join('\n')
  return { block, select: [2, 5], fromSelection: false }
}

const URL_RE = /^(?:https?:\/\/|www\.|mailto:)\S+$/i

export function applyFormat(
  doc: string,
  from: number,
  to: number,
  action: FormatAction,
): FormatEdit {
  if (from > to) [from, to] = [to, from]
  from = Math.max(0, Math.min(from, doc.length))
  to = Math.max(0, Math.min(to, doc.length))
  const sel = doc.slice(from, to)

  switch (action) {
    case 'bold':
      return wrap(doc, from, to, '**', '粗体文本')
    case 'italic':
      return wrap(doc, from, to, '*', '斜体文本')
    case 'strike':
      return wrap(doc, from, to, '~~', '删除线文本')

    case 'code': {
      if (sel.includes('\n')) {
        const body = sel.replace(/\n$/, '')
        const block = '```\n' + body + '\n```'
        return blockInsert(doc, from, to, block, [4, 4 + body.length])
      }
      const { start, end } = lineRange(doc, from, to)
      if (!sel && doc.slice(start, end).trim() === '') {
        return blockInsert(doc, start, end, '```\n代码\n```', [4, 6])
      }
      return wrap(doc, from, to, '`', '代码')
    }

    case 'link':
    case 'image': {
      const bang = action === 'image' ? '!' : ''
      const label = action === 'image' ? '图片描述' : '链接文本'
      if (URL_RE.test(sel)) {
        const insert = `${bang}[${label}](${sel})`
        const s = from + bang.length + 1
        return { from, to, insert, selFrom: s, selTo: s + label.length }
      }
      const text = sel.replace(/\n/g, ' ') || label
      const insert = `${bang}[${text}](https://)`
      const s = from + bang.length + text.length + 3
      return { from, to, insert, selFrom: s, selTo: s + 'https://'.length }
    }

    case 'heading':
      return prefixLines(doc, from, to, {
        isOn: () => false,
        remove: (l) => l,
        add: (l) => {
          const m = /^(#{1,6})\s+/.exec(l)
          const level = m ? m[1].length : 0
          const rest = m ? l.slice(m[0].length) : l
          const next = level === 0 || level === 1 ? 2 : level === 2 ? 3 : 0
          return next ? '#'.repeat(next) + ' ' + rest : rest
        },
      })

    case 'ul':
      return prefixLines(
        doc,
        from,
        to,
        listSpec(IS_UL, () => '- '),
      )
    case 'ol':
      return prefixLines(
        doc,
        from,
        to,
        listSpec(IS_OL, (i) => `${i + 1}. `),
      )
    case 'task':
      return prefixLines(
        doc,
        from,
        to,
        listSpec(IS_TASK, () => '- [ ] '),
      )
    case 'quote':
      return prefixLines(doc, from, to, {
        isOn: (l) => IS_QUOTE.test(l),
        remove: (l) => l.replace(/^(\s*)>\s?/, '$1'),
        add: (l) => (l.trim() ? '> ' + l : '>'),
        includeEmpty: true,
      })

    case 'table': {
      const t = tableFrom(sel)
      if (t.fromSelection) return blockInsert(doc, from, to, t.block, t.select)
      const at = insertionPoint(doc, from, to)
      return blockInsert(doc, at.from, at.to, t.block, t.select)
    }

    case 'hr': {
      const at = insertionPoint(doc, from, to)
      return blockInsert(doc, at.from, at.to, '---', [3, 3])
    }
  }
}
