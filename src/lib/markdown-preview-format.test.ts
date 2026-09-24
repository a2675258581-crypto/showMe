import { describe, expect, it } from 'vitest'
import { applyEdit, applyFormat, type FormatAction } from './markdown-preview-format'

/** 选区用 « » 标记，光标用 ‸：'a«bc»d' → doc 'abcd', from 1, to 3 */
function run(marked: string, action: FormatAction) {
  let from: number
  let to: number
  let doc: string
  if (marked.includes('‸')) {
    from = to = marked.indexOf('‸')
    doc = marked.replace('‸', '')
  } else {
    from = marked.indexOf('«')
    to = marked.indexOf('»') - 1
    doc = marked.replace('«', '').replace('»', '')
  }
  const e = applyFormat(doc, from, to, action)
  const out = applyEdit(doc, e)
  // 用同样的记号回显新选区
  return e.selFrom === e.selTo
    ? out.slice(0, e.selFrom) + '‸' + out.slice(e.selFrom)
    : out.slice(0, e.selFrom) + '«' + out.slice(e.selFrom, e.selTo) + '»' + out.slice(e.selTo)
}

describe('inline wrapping', () => {
  it('wraps selection and toggles off', () => {
    expect(run('a «bold» b', 'bold')).toBe('a **«bold»** b')
    expect(run('a **«bold»** b', 'bold')).toBe('a «bold» b')
    expect(run('a «**bold**» b', 'bold')).toBe('a «bold» b')
  })
  it('inserts placeholders at the cursor', () => {
    expect(run('x‸', 'bold')).toBe('x**«粗体文本»**')
    expect(run('‸', 'italic')).toBe('*«斜体文本»*')
    expect(run('‸', 'strike')).toBe('~~«删除线文本»~~')
  })
  it('keeps surrounding spaces outside markers', () => {
    expect(run('a« word »b', 'bold')).toBe('a **«word»** b')
  })
  it('italic does not unwrap bold', () => {
    expect(run('**«x»**', 'italic')).toBe('***«x»***')
    expect(run('*«x»*', 'italic')).toBe('«x»')
  })
  it('handles Chinese and emoji', () => {
    expect(run('你好«世界😀»', 'bold')).toBe('你好**«世界😀»**')
  })
})

describe('code', () => {
  it('inline code for a single-line selection', () => {
    expect(run('run «npm i» now', 'code')).toBe('run `«npm i»` now')
    expect(run('text‸', 'code')).toBe('text`«代码»`')
  })
  it('fenced block for multi-line selection or an empty line', () => {
    expect(run('intro\n«a\nb»\nend', 'code')).toBe('intro\n\n```\n«a\nb»\n```\n\nend')
    expect(run('‸', 'code')).toBe('```\n«代码»\n```\n')
  })
})

describe('links and images', () => {
  it('wraps text as link text and selects the URL', () => {
    expect(run('see «docs»', 'link')).toBe('see [docs](«https://»)')
    expect(run('‸', 'link')).toBe('[链接文本](«https://»)')
  })
  it('uses a selected URL as the target', () => {
    expect(run('«https://a.com»', 'link')).toBe('[«链接文本»](https://a.com)')
    expect(run('«https://a.com/x.png»', 'image')).toBe('![«图片描述»](https://a.com/x.png)')
    expect(run('‸', 'image')).toBe('![图片描述](«https://»)')
  })
})

describe('headings', () => {
  it('cycles ## → ### → none', () => {
    expect(run('Title‸', 'heading')).toBe('## Title‸')
    expect(run('## Title‸', 'heading')).toBe('### Title‸')
    expect(run('### Title‸', 'heading')).toBe('Title‸')
    expect(run('# Title‸', 'heading')).toBe('## Title‸')
    expect(run('‸', 'heading')).toBe('## ‸')
  })
})

describe('line prefixes', () => {
  it('adds and removes bullet lists over multiple lines, skipping blanks', () => {
    expect(run('«a\n\nb»', 'ul')).toBe('«- a\n\n- b»')
    expect(run('«- a\n- b»', 'ul')).toBe('«a\nb»')
  })
  it('numbers ordered lists and converts from bullets', () => {
    expect(run('«- a\n- b\nc»', 'ol')).toBe('«1. a\n2. b\n3. c»')
    expect(run('«1. a\n2. b»', 'ol')).toBe('«a\nb»')
  })
  it('creates task lists preserving indentation', () => {
    expect(run('«a\n  - b»', 'task')).toBe('«- [ ] a\n  - [ ] b»')
    expect(run('«- [ ] a\n- [x] b»', 'task')).toBe('«a\nb»')
  })
  it('quotes including blank lines', () => {
    expect(run('«a\n\nb»', 'quote')).toBe('«> a\n>\n> b»')
    expect(run('«> a\n>\n> b»', 'quote')).toBe('«a\n\nb»')
  })
  it('moves the cursor with the prefix on a single line', () => {
    expect(run('he‸llo', 'ul')).toBe('- he‸llo')
    expect(run('- he‸llo', 'ul')).toBe('he‸llo')
  })
  it('does not include the next line when the selection ends at its start', () => {
    expect(run('«a\n»b', 'quote')).toBe('«> a»\nb')
  })
})

describe('blocks', () => {
  it('inserts a table template with blank lines around', () => {
    expect(run('text‸', 'table')).toBe(
      'text\n\n| «列 1» | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n',
    )
  })
  it('converts CSV / TSV selection into a table', () => {
    expect(run('«name,age\nTom,3\n小明»', 'table')).toBe(
      '«| name | age |\n| --- | --- |\n| Tom | 3 |\n| 小明 |  |»\n',
    )
    expect(run('«a\tb|c»', 'table')).toBe('«| a | b\\|c |\n| --- | --- |»\n')
  })
  it('inserts a horizontal rule', () => {
    expect(run('a\n‸\nb', 'hr')).toBe('a\n\n---‸\n\nb')
  })
  it('never overwrites text when inserting block templates', () => {
    expect(run('hel‸lo\nnext', 'hr')).toBe('hello\n\n---‸\n\nnext')
    expect(run('keep «this» text', 'table')).toBe(
      'keep this text\n\n| «列 1» | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |\n',
    )
  })
  it('clamps out-of-range selections', () => {
    const e = applyFormat('abc', 10, -5, 'bold')
    expect(applyEdit('abc', e)).toBe('**abc**')
  })
})
