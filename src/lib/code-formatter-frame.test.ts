import { describe, expect, it } from 'vitest'
import { buildFrame, frameToText, offsetToPosition, positionToOffset } from './code-formatter-frame'

describe('offsetToPosition / positionToOffset', () => {
  it('handles \\n, \\r\\n and \\r line breaks', () => {
    const s = 'ab\ncd\r\nef\rgh'
    expect(offsetToPosition(s, 0)).toEqual({ line: 1, column: 1 })
    expect(offsetToPosition(s, 3)).toEqual({ line: 2, column: 1 })
    expect(offsetToPosition(s, 5)).toEqual({ line: 2, column: 3 })
    expect(offsetToPosition(s, 7)).toEqual({ line: 3, column: 1 })
    expect(offsetToPosition(s, 10)).toEqual({ line: 4, column: 1 })
    expect(positionToOffset(s, 3, 2)).toBe(8)
    expect(positionToOffset(s, 4, 2)).toBe(11)
  })

  it('counts emoji / 中文 as one column each', () => {
    const s = '😀中x'
    expect(offsetToPosition(s, 2)).toEqual({ line: 1, column: 2 })
    expect(offsetToPosition(s, 4)).toEqual({ line: 1, column: 4 })
    expect(positionToOffset(s, 1, 3)).toBe(3)
  })

  it('clamps out-of-range values', () => {
    expect(offsetToPosition('abc', 99)).toEqual({ line: 1, column: 4 })
    expect(offsetToPosition('abc', -5)).toEqual({ line: 1, column: 1 })
    expect(positionToOffset('a\nb', 9, 9)).toBe(3)
    expect(offsetToPosition('', 0)).toEqual({ line: 1, column: 1 })
  })
})

describe('buildFrame', () => {
  const src = ['line 1', 'line 2', 'const 名字 = "😀" +', 'line 4', 'line 5', 'line 6'].join('\n')

  it('shows context lines around the error', () => {
    const f = buildFrame(src, 3, 16)
    expect(f.lines.map((l) => l.no)).toEqual([1, 2, 3, 4, 5])
    expect(f.lines.filter((l) => l.error).map((l) => l.no)).toEqual([3])
    expect(f.caretPrefix).toBe('const 名字 = "😀" ')
    expect(f.caretWidth).toBe(1)
  })

  it('renders a text frame', () => {
    expect(frameToText(buildFrame('a\nbc d\ne', 2, 4, { context: 1, width: 2 }))).toBe(
      ['  1 | a', '> 2 | bc d', '    |    ^', '  3 | e'].join('\n'),
    )
  })

  it('clamps line / column into range', () => {
    const f = buildFrame('abc', 10, 99)
    expect([f.line, f.column]).toEqual([1, 4])
    expect(buildFrame('', 1, 1).lines).toEqual([{ no: 1, text: '', error: true }])
  })

  it('clips very long lines around the column', () => {
    const long = 'x'.repeat(500) + 'ERR' + 'y'.repeat(500)
    const f = buildFrame(long, 1, 501, { maxChars: 40, width: 3 })
    const text = f.lines[0].text
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(text).toContain('ERR')
    expect(f.caretPrefix.startsWith('…')).toBe(true)
    // 箭头恰好落在 ERR 上
    expect(text.slice(f.caretPrefix.length, f.caretPrefix.length + 3)).toBe('ERR')
    expect(f.caretWidth).toBe(3)
  })

  it('expands tabs consistently in text and caret prefix', () => {
    const f = buildFrame('\tfoo bar', 1, 6)
    expect(f.lines[0].text).toBe('  foo bar')
    expect(f.caretPrefix).toBe('  foo ')
  })
})
