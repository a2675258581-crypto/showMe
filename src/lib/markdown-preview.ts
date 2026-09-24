/** Markdown 渲染（marked + GFM）、目录、统计与独立 HTML 导出（纯函数，无 DOM 依赖） */
import { Marked, type Tokens } from 'marked'
import {
  countChinese,
  countEnglishWords,
  countLines,
  formatReadingTime,
  readingSeconds,
} from './text-toolkit'

export interface TocItem {
  level: number
  text: string
  id: string
}

export interface MarkdownRender {
  /** 未经净化的 HTML（界面里再用 DOMPurify 处理） */
  html: string
  toc: TocItem[]
  error: string | null
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 去掉标签并解码常见实体，得到纯文本 */
export function htmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : all
    }
    return ENTITIES[e.toLowerCase()] ?? all
  })
}

/** GitHub 风格的锚点：小写、去标点、空白转 -，保留中文 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

export interface RenderOptions {
  /** 代码块右上角的「复制」按钮（导出时不需要） */
  copyButtons?: boolean
}

export function renderMarkdown(md: string, opts: RenderOptions = {}): MarkdownRender {
  const toc: TocItem[] = []
  // 与 github-slugger 相同的去重规则：foo、foo-1、foo-2…
  const occurrences = new Map<string, number>()
  const uniqueId = (base: string) => {
    let id = base
    while (occurrences.has(id)) {
      const n = (occurrences.get(base) ?? 0) + 1
      occurrences.set(base, n)
      id = `${base}-${n}`
    }
    occurrences.set(id, 0)
    return id
  }

  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens)
        const text = htmlToText(inner).trim()
        const id = uniqueId(slugify(text) || 'section')
        toc.push({ level: depth, text, id })
        return `<h${depth} id="${id}"><a class="md-anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? '').match(/^\S*/)?.[0] ?? ''
        const cls = language ? ` class="language-${escapeHtml(language)}"` : ''
        const label = `<span class="md-code-lang">${escapeHtml(language || 'text')}</span>`
        const copy = opts.copyButtons
          ? '<button type="button" class="md-copy" data-md-copy="">复制</button>'
          : ''
        const body = escapeHtml(text.replace(/\n$/, ''))
        return `<div class="md-code"><div class="md-code-head">${label}${copy}</div><pre><code${cls}>${body}\n</code></pre></div>\n`
      },
      list(token: Tokens.List) {
        if (!token.items.some((it) => it.task)) return false
        const tag = token.ordered ? 'ol' : 'ul'
        const start = token.ordered && token.start !== 1 ? ` start="${token.start}"` : ''
        const body = token.items.map((it) => this.listitem(it)).join('')
        return `<${tag}${start} class="contains-task-list">\n${body}</${tag}>\n`
      },
      listitem(item: Tokens.ListItem) {
        if (!item.task) return false
        return `<li class="task-list-item">${this.parser.parse(item.tokens)}</li>\n`
      },
    },
    hooks: {
      postprocess(html: string) {
        return html
          .replace(/<table>/g, '<div class="md-table"><table>')
          .replace(/<\/table>/g, '</table></div>')
      },
    },
  })

  try {
    const html = marked.parse(md, { async: false })
    return { html, toc, error: null }
  } catch (e) {
    return {
      html: `<pre>${escapeHtml(md)}</pre>`,
      toc: [],
      error: `渲染失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * 找出标题所在的行号（从 1 开始，顺序与 renderMarkdown 的 toc 一致），
 * 用于点击目录时把编辑器滚动到对应行。跳过代码块，支持 ATX（# 标题）与 Setext（下划线）标题。
 */
export function headingLines(md: string): number[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: number[] = []
  let fence: { ch: string; len: number } | null = null
  let prevText = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/^(?: {0,3}>)+ ?/, '')
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (
        f &&
        f[1][0] === fence.ch &&
        f[1].length >= fence.len &&
        !line.slice(f[0].length).trim()
      ) {
        fence = null
      }
      prevText = false
      continue
    }
    if (f) {
      fence = { ch: f[1][0], len: f[1].length }
      prevText = false
      continue
    }
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) {
      out.push(i + 1)
      prevText = false
      continue
    }
    if (prevText && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) {
      out.push(i)
      prevText = false
      continue
    }
    const blank = line.trim() === ''
    const blockStart = /^ {0,3}(?:[-*+]\s|\d+[.)]\s|<|\||(?:[-*_][ \t]*){3,}$)/.test(line)
    // Setext 标题的上一行必须是普通段落文本（段落的续行同样可以）
    prevText = !blank && (!blockStart || prevText) && !/^ {4}/.test(line)
  }
  return out
}

// ───────────── 统计 ─────────────

export interface MarkdownStats {
  /** 字数：汉字 + 英文单词 */
  words: number
  chinese: number
  english: number
  lines: number
  chars: number
  readingSeconds: number
  readingText: string
}

/** 统计时去掉 Markdown 标记里的链接地址、HTML 标签等，避免把 URL 算成单词 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*```.*$/gm, '')
}

export function markdownStats(md: string): MarkdownStats {
  const plain = stripMarkdown(md)
  const chinese = countChinese(plain)
  const english = countEnglishWords(plain)
  const seconds = readingSeconds(chinese, english)
  return {
    words: chinese + english,
    chinese,
    english,
    lines: countLines(md),
    chars: [...md].length,
    readingSeconds: seconds,
    readingText: seconds < 60 && seconds > 0 ? '不到 1 分钟' : formatReadingTime(seconds),
  }
}

// ───────────── 导出 ─────────────

/** 文档标题：第一个一级标题，其次任意标题 */
export function documentTitle(toc: TocItem[], fallback = '文档'): string {
  return (toc.find((t) => t.level === 1) ?? toc[0])?.text || fallback
}

/** 独立 HTML 使用的浅色 GitHub 风格样式 */
export const STANDALONE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#f5f5f7;color:#1d1d1f;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.markdown-body{max-width:860px;margin:40px auto;padding:48px 56px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:24px;box-shadow:0 2px 12px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.06);word-wrap:break-word}
@media (max-width:720px){.markdown-body{margin:0;padding:24px 18px;border-radius:0;border:0}}
.markdown-body>*:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{position:relative;margin:1.6em 0 .6em;font-weight:700;line-height:1.3;letter-spacing:-.01em}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid rgba(0,0,0,.08)}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid rgba(0,0,0,.08)}
h3{font-size:1.25em}h4{font-size:1.05em}h5{font-size:.95em}h6{font-size:.9em;color:#6e6e73}
.md-anchor{position:absolute;left:-1em;padding-right:.25em;color:#0071e3;text-decoration:none;opacity:0}
h1:hover .md-anchor,h2:hover .md-anchor,h3:hover .md-anchor,h4:hover .md-anchor,h5:hover .md-anchor,h6:hover .md-anchor{opacity:1}
p,ul,ol,blockquote,table,.md-code,.md-table{margin:0 0 1em}
a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}
strong{font-weight:650}
ul,ol{padding-left:1.6em}li+li{margin-top:.25em}li>ul,li>ol{margin:.25em 0 0}
.contains-task-list{list-style:none;padding-left:.4em}
.task-list-item input{margin:0 .5em 0 0;vertical-align:middle;accent-color:#0071e3}
blockquote{padding:.25em 1em;color:#6e6e73;border-left:4px solid #0071e3;background:rgba(0,113,227,.06);border-radius:0 12px 12px 0}
blockquote>:last-child{margin-bottom:0}
code{font-family:"SF Mono",ui-monospace,Menlo,Consolas,"Liberation Mono",monospace;font-size:.875em}
:not(pre)>code{padding:.15em .4em;background:rgba(120,120,128,.12);border-radius:6px}
.md-code{border:1px solid rgba(0,0,0,.08);border-radius:14px;overflow:hidden;background:#fbfbfd}
.md-code-head{display:flex;justify-content:space-between;align-items:center;padding:6px 14px;border-bottom:1px solid rgba(0,0,0,.06);font:600 11px/1.6 -apple-system,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#86868b}
.md-copy{display:none}
pre{margin:0;padding:14px 16px;overflow:auto;line-height:1.6}
pre code{font-size:13px}
.md-table{overflow-x:auto}
table{border-collapse:collapse;width:max-content;max-width:100%;margin:0}
th,td{padding:8px 14px;border:1px solid rgba(0,0,0,.1)}
th{background:rgba(120,120,128,.08);font-weight:600}
tr:nth-child(2n) td{background:rgba(120,120,128,.04)}
hr{height:1px;margin:2em 0;border:0;background:rgba(0,0,0,.1)}
img{max-width:100%;border-radius:12px}
del{color:#86868b}
kbd{padding:.1em .45em;border:1px solid rgba(0,0,0,.14);border-bottom-width:2px;border-radius:6px;font-size:.85em;background:#fff}
`.trim()

/** 生成可以单独打开的 HTML 文件（内联 CSS，浅色主题） */
export function buildStandaloneHtml(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="showMe Markdown 预览">
<title>${escapeHtml(title)}</title>
<style>
${STANDALONE_CSS}
</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>
`
}

/** 导出文件名：取标题里的安全字符 */
export function exportFileName(title: string, ext: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${base || 'document'}.${ext}`
}
