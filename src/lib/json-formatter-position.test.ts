import { describe, expect, it } from 'vitest'
import {
  LineIndex,
  codeFrame,
  columnToUtf16,
  positionAt,
  utf8Length,
} from './json-formatter-position'

describe('positionAt / LineIndex', () => {
  const text = 'ab\ncd\r\nef\rg😀h'

  it.each([
    [0, 1, 1],
    [2, 1, 3],
    [3, 2, 1],
    [5, 2, 3],
    [7, 3, 1],
    [10, 4, 1],
    [11, 4, 2],
    [13, 4, 3], // 😀 占 2 个 UTF-16 单元，但只算 1 列
    [14, 4, 4],
  ])('offset %i → 第 %i 行第 %i 列', (offset, line, column) => {
    expect(positionAt(text, offset)).toEqual({ line, column, offset })
    expect(new LineIndex(text).position(offset)).toEqual({ line, column, offset })
  })

  it('越界时夹到文本范围内', () => {
    expect(positionAt('abc', 99)).toEqual({ line: 1, column: 4, offset: 3 })
    expect(new LineIndex('abc').position(-5)).toEqual({ line: 1, column: 1, offset: 0 })
  })

  it('空文本', () => {
    expect(positionAt('', 0)).toEqual({ line: 1, column: 1, offset: 0 })
    const idx = new LineIndex('')
    expect(idx.lineCount).toBe(1)
    expect(idx.lineText(1)).toBe('')
  })

  it('lineText 去掉各种换行符', () => {
    const idx = new LineIndex(text)
    expect(idx.lineCount).toBe(4)
    expect([1, 2, 3, 4].map((n) => idx.lineText(n))).toEqual(['ab', 'cd', 'ef', 'g😀h'])
    expect(idx.lineText(9)).toBe('')
  })
})

describe('columnToUtf16', () => {
  it('码点列号换算为 UTF-16 偏移', () => {
    expect(columnToUtf16('a😀b', 1)).toBe(0)
    expect(columnToUtf16('a😀b', 2)).toBe(1)
    expect(columnToUtf16('a😀b', 3)).toBe(3)
    expect(columnToUtf16('a😀b', 99)).toBe(4)
    expect(columnToUtf16('中文', 2)).toBe(1)
  })
})

describe('codeFrame', () => {
  const src = 'line1\nline2\n  "age": 18\nline4\nline5\nline6'

  it('出错行拆成三段，并带上下文', () => {
    const f = codeFrame(src, 3, 3)
    expect(f.before.map((l) => l.number)).toEqual([1, 2])
    expect(f.after.map((l) => l.number)).toEqual([4, 5])
    expect(f.line).toEqual({ number: 3, prefix: '  ', char: '"', suffix: 'age": 18' })
  })

  it('行尾出错时 char 为空', () => {
    const f = codeFrame('abc', 1, 4)
    expect(f.line).toEqual({ number: 1, prefix: 'abc', char: '', suffix: '' })
  })

  it('超长行以出错列为中心截取', () => {
    const long = 'x'.repeat(500) + 'Y' + 'z'.repeat(500)
    const f = codeFrame(long, 1, 501, 2, 40)
    expect(f.line.char).toBe('Y')
    expect(f.line.prefix.startsWith('…')).toBe(true)
    expect(f.line.suffix.endsWith('…')).toBe(true)
    expect(Array.from(f.line.prefix + f.line.char + f.line.suffix).length).toBeLessThanOrEqual(42)
  })

  it('中文与 emoji', () => {
    const f = codeFrame('{"名":"😀", x}', 1, 11)
    expect(f.line).toEqual({ number: 1, prefix: '{"名":"😀", ', char: 'x', suffix: '}' })
  })

  it('行号越界时夹到范围内', () => {
    const f = codeFrame('a\nb', 9, 9)
    expect(f.line.number).toBe(2)
    expect(f.line.prefix).toBe('b')
  })
})

describe('utf8Length', () => {
  it.each(['', 'abc', '中文', '😀', 'é', 'a\u0000b', '\ud800'])('与 TextEncoder 一致：%s', (s) => {
    expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length)
  })
})
