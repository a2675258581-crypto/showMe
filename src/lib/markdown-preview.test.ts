import { describe, expect, it } from 'vitest'
import {
  buildStandaloneHtml,
  documentTitle,
  escapeHtml,
  exportFileName,
  headingLines,
  htmlToText,
  markdownStats,
  renderMarkdown,
  slugify,
  stripMarkdown,
} from './markdown-preview'
import { MARKDOWN_SAMPLE } from './markdown-preview-sample'

describe('slugify', () => {
  it('follows GitHub rules and keeps Chinese', () => {
    expect(slugify('Hello World!')).toBe('hello-world')
    expect(slugify('  API 调试 (v2)  ')).toBe('api-调试-v2')
    expect(slugify('C++ & Rust_2024')).toBe('c--rust_2024')
    expect(slugify('😀')).toBe('')
  })
})

describe('htmlToText / escapeHtml', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToText('A <em>b</em> &amp; &lt;c&gt; &#20013; &#x6587; &quot;')).toBe(
      'A b & <c> 中 文 "',
    )
  })
  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})

describe('renderMarkdown', () => {
  it('renders headings with anchors and a TOC', () => {
    const r = renderMarkdown('# 标题 **一**\n\n## Intro\n\n## Intro\n\n### C & D')
    expect(r.error).toBeNull()
    expect(r.toc).toEqual([
      { level: 1, text: '标题 一', id: '标题-一' },
      { level: 2, text: 'Intro', id: 'intro' },
      { level: 2, text: 'Intro', id: 'intro-1' },
      { level: 3, text: 'C & D', id: 'c--d' },
    ])
    expect(r.html).toContain('<h1 id="标题-一"><a class="md-anchor" href="#标题-一"')
    expect(r.html).toContain('<strong>一</strong></h1>')
  })

  it('dedupes slugs like github-slugger', () => {
    const r = renderMarkdown('# a\n# a\n# a-1\n# a')
    expect(r.toc.map((t) => t.id)).toEqual(['a', 'a-1', 'a-1-1', 'a-2'])
  })

  it('falls back to "section" for empty slugs', () => {
    expect(renderMarkdown('## 😀').toc[0].id).toBe('section')
  })

  it('renders fenced code with a language label and escaping', () => {
    const r = renderMarkdown('```js title\nconst a = 1 < 2\n```')
    expect(r.html).toContain('<span class="md-code-lang">js</span>')
    expect(r.html).toContain('<code class="language-js">const a = 1 &lt; 2\n</code>')
    expect(r.html).not.toContain('md-copy')
    expect(renderMarkdown('```\nx\n```', { copyButtons: true }).html).toContain('data-md-copy')
    expect(renderMarkdown('```\nx\n```').html).toContain('<span class="md-code-lang">text</span>')
  })

  it('renders GFM task lists, tables, strikethrough and autolinks', () => {
    const r = renderMarkdown(
      '- [ ] todo\n- [x] done\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n~~del~~ https://example.com',
    )
    expect(r.html).toContain('<ul class="contains-task-list">')
    expect(r.html).toContain(
      '<li class="task-list-item"><input disabled="" type="checkbox"> todo</li>',
    )
    expect(r.html).toContain('<input checked="" disabled="" type="checkbox">')
    expect(r.html).toContain('<div class="md-table"><table>')
    expect(r.html).toContain('</table></div>')
    expect(r.html).toContain('<th align="center">b</th>')
    expect(r.html).toContain('<del>del</del>')
    expect(r.html).toContain('<a href="https://example.com">https://example.com</a>')
  })

  it('keeps normal lists untouched', () => {
    expect(renderMarkdown('- a\n- b').html).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n')
    expect(renderMarkdown('3. a\n4. b').html).toContain('<ol start="3">')
  })

  it('renders blockquotes, images, hr and inline code', () => {
    const r = renderMarkdown('> 引用\n\n![alt](a.png "t")\n\n---\n\n`x<y`')
    expect(r.html).toContain('<blockquote>')
    expect(r.html).toContain('<img src="a.png" alt="alt" title="t">')
    expect(r.html).toContain('<hr>')
    expect(r.html).toContain('<code>x&lt;y</code>')
  })

  it('handles empty, huge and odd inputs without throwing', () => {
    expect(renderMarkdown('')).toEqual({ html: '', toc: [], error: null })
    const big = '## 标题\n\n段落 **加粗** 文本。\n\n'.repeat(3000)
    const t0 = Date.now()
    const r = renderMarkdown(big)
    expect(Date.now() - t0).toBeLessThan(4000)
    expect(r.toc).toHaveLength(3000)
    expect(r.toc[2999].id).toBe('标题-2999')
    expect(renderMarkdown('\u0000<>&*_[]()').error).toBeNull()
  })

  it('renders the sample document', () => {
    const r = renderMarkdown(MARKDOWN_SAMPLE)
    expect(r.error).toBeNull()
    expect(r.toc.length).toBeGreaterThan(5)
    expect(r.html).toContain('data:image/svg+xml;base64,')
  })
})

describe('headingLines', () => {
  it('finds ATX and setext headings, skipping code fences', () => {
    const md = [
      '# One', // 1
      '',
      'text',
      '```md',
      '# not a heading',
      '```',
      'Two', // 7
      '===',
      '',
      '> ## Quoted', // 10
      '    # indented code',
      '#no-space',
      '~~~',
      '## hidden',
      '~~~',
      '### Three ###', // 16
      '- item',
      '---',
      'para',
      'Four', // 20 (两行段落的 setext)
      '----',
    ].join('\n')
    expect(headingLines(md)).toEqual([1, 7, 10, 16, 20])
  })
  it('matches the TOC of the sample document', () => {
    expect(headingLines(MARKDOWN_SAMPLE)).toHaveLength(renderMarkdown(MARKDOWN_SAMPLE).toc.length)
  })
  it('handles empty input', () => {
    expect(headingLines('')).toEqual([])
  })
})

describe('markdownStats', () => {
  it('counts Chinese characters and English words, ignoring URLs', () => {
    const s = markdownStats('# 你好 World\n\n[链接](https://example.com/very/long/path) and more')
    expect(s.chinese).toBe(4)
    expect(s.english).toBe(3)
    expect(s.words).toBe(7)
    expect(s.lines).toBe(3)
    expect(s.readingText).toBe('不到 1 分钟')
  })
  it('handles empty input', () => {
    expect(markdownStats('')).toMatchObject({ words: 0, lines: 0, chars: 0, readingText: '0 秒' })
  })
  it('estimates long reading time', () => {
    expect(markdownStats('字'.repeat(900)).readingText).toBe('约 3 分钟')
  })
  it('strips markdown link targets', () => {
    expect(stripMarkdown('![图](x.png) [文](y) <b>z</b>')).toBe('图 文 z')
  })
})

describe('export helpers', () => {
  it('builds a standalone document with inline CSS', () => {
    const html = buildStandaloneHtml('<h1>Hi</h1>', '标题 <x>')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>标题 &lt;x&gt;</title>')
    expect(html).toContain('<style>')
    expect(html).toContain('.markdown-body{')
    expect(html).toContain('<article class="markdown-body">\n<h1>Hi</h1>')
    expect(html).not.toMatch(/<link|<script/)
  })
  it('picks a title and file name', () => {
    expect(
      documentTitle([
        { level: 2, text: 'B', id: 'b' },
        { level: 1, text: 'A', id: 'a' },
      ]),
    ).toBe('A')
    expect(documentTitle([])).toBe('文档')
    expect(exportFileName('我的 文档: v1/2', 'md')).toBe('我的-文档-v1-2.md')
    expect(exportFileName('***', 'html')).toBe('document.html')
  })
})
