import { describe, expect, it } from 'vitest'
import { applyPatch } from 'diff'
import {
  alignLines,
  computeDiff,
  createUnifiedPatch,
  DEFAULT_DIFF_OPTIONS,
  diffLineKeys,
  foldUnchanged,
  intraLineDiff,
  splitTextLines,
  tokenize,
  type DiffOptions,
  type Segment,
} from './text-diff'

const opts = (p: Partial<DiffOptions> = {}): DiffOptions => ({ ...DEFAULT_DIFF_OPTIONS, ...p })
const changedText = (segs: Segment[]) =>
  segs
    .filter((s) => s.changed)
    .map((s) => s.text)
    .join('|')

function ok(r: ReturnType<typeof computeDiff>) {
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('splitTextLines', () => {
  it('ignores a single trailing newline and normalizes CRLF', () => {
    expect(splitTextLines('')).toEqual([])
    expect(splitTextLines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(splitTextLines('a\n\n')).toEqual(['a', ''])
  })
})

describe('tokenize', () => {
  it('splits words, whitespace and punctuation; CJK per character', () => {
    expect(tokenize('foo_bar(1, x)', 'word').map((t) => t.text)).toEqual([
      'foo_bar',
      '(',
      '1',
      ',',
      ' ',
      'x',
      ')',
    ])
    expect(tokenize('abc中文def', 'word').map((t) => t.text)).toEqual(['abc', '中', '文', 'def'])
  })
  it('char granularity splits by code point (emoji safe)', () => {
    expect(tokenize('a😀b', 'char').map((t) => t.text)).toEqual(['a', '😀', 'b'])
  })
})

describe('intraLineDiff', () => {
  it('highlights changed words', () => {
    const d = intraLineDiff('const foo = bar(1, 2);', 'const foo = baz(1, 3);', opts())
    expect(changedText(d.left)).toBe('bar|2')
    expect(changedText(d.right)).toBe('baz|3')
    // 片段拼起来仍是原文
    expect(d.left.map((s) => s.text).join('')).toBe('const foo = bar(1, 2);')
    expect(d.right.map((s) => s.text).join('')).toBe('const foo = baz(1, 3);')
  })
  it('highlights changed characters', () => {
    const d = intraLineDiff('colour', 'color', opts({ granularity: 'char' }))
    expect(changedText(d.left)).toBe('u')
    expect(d.right.every((s) => !s.changed)).toBe(true)
    expect(d.removed).toBe(1)
    expect(d.added).toBe(0)
  })
  it('handles Chinese and emoji', () => {
    const d = intraLineDiff('今天天气很好😀', '今天天气不错😀', opts())
    expect(changedText(d.left)).toBe('很好')
    expect(changedText(d.right)).toBe('不错')
  })
  it('respects ignoreCase and ignoreWhitespace', () => {
    const d = intraLineDiff('Hello World foo', 'hello world bar', opts({ ignoreCase: true }))
    expect(changedText(d.left)).toBe('foo')
    const w = intraLineDiff('a  b c', 'a b d', opts({ ignoreWhitespace: true }))
    expect(changedText(w.left)).toBe('c')
    expect(changedText(w.right)).toBe('d')
  })
  it('bridges whitespace between two changed words', () => {
    const d = intraLineDiff('keep old words end', 'keep new stuff end', opts())
    expect(changedText(d.left)).toBe('old words')
  })
})

describe('computeDiff', () => {
  const A = 'line one\nline two\nline three\nline four\n'
  const B = 'line one\nline 2\nline three\nline four\nline five\n'

  it('aligns side-by-side rows with line numbers', () => {
    const r = ok(computeDiff(A, B, opts()))
    expect(r.split.map((row) => row.kind)).toEqual(['equal', 'changed', 'equal', 'equal', 'added'])
    expect(r.split[1].left?.no).toBe(2)
    expect(r.split[1].right?.no).toBe(2)
    expect(changedText(r.split[1].left!.segments)).toBe('two')
    expect(changedText(r.split[1].right!.segments)).toBe('2')
    expect(r.split[4].left).toBeNull()
    expect(r.split[4].right?.no).toBe(5)
    expect(r.blocks).toHaveLength(2)
    expect(r.blocks[0]).toMatchObject({ splitStart: 1, splitEnd: 2, oldStart: 2, newStart: 2 })
  })

  it('builds a unified view: removed lines before added lines', () => {
    const r = ok(computeDiff('a\nb\nc', 'a\nx\ny\nc', opts({ granularity: 'line' })))
    expect(r.unified.map((u) => [u.kind, u.oldNo, u.newNo, u.text])).toEqual([
      ['equal', 1, 1, 'a'],
      ['removed', 2, null, 'b'],
      ['added', null, 2, 'x'],
      ['added', null, 3, 'y'],
      ['equal', 3, 4, 'c'],
    ])
    expect(r.split.map((s) => s.kind)).toEqual(['equal', 'changed', 'added', 'equal'])
  })

  it('computes line stats and similarity', () => {
    const r = ok(computeDiff('a\nb\nc\nd', 'a\nb\nc\ne', opts({ granularity: 'line' })))
    expect(r.stats).toMatchObject({ added: 1, removed: 1, linesAdded: 1, linesRemoved: 1 })
    expect(r.stats.similarity).toBeCloseTo(0.75)
    expect(r.stats.unit).toBe('行')
  })

  it('computes word stats', () => {
    const r = ok(computeDiff('the quick brown fox', 'the quick red fox', opts()))
    expect(r.stats).toMatchObject({ added: 1, removed: 1, unit: '词' })
    expect(r.stats.similarity).toBeCloseTo(6 / 8)
  })

  it('reports identical texts', () => {
    const r = ok(computeDiff('same\ntext', 'same\ntext\n', opts()))
    expect(r.stats.identical).toBe(true)
    expect(r.stats.similarity).toBe(1)
    expect(r.blocks).toEqual([])
  })

  it('treats both empty as identical and one empty as all changes', () => {
    expect(ok(computeDiff('', '', opts())).stats.identical).toBe(true)
    const r = ok(computeDiff('', 'a\nb', opts({ granularity: 'line' })))
    expect(r.stats).toMatchObject({ added: 2, removed: 0, similarity: 0 })
    expect(r.split.every((s) => s.kind === 'added')).toBe(true)
  })

  it('ignores case and whitespace at line level, showing original text', () => {
    const r = ok(
      computeDiff('Hello World\n  indented', 'hello   world\nindented', {
        granularity: 'word',
        ignoreCase: true,
        ignoreWhitespace: true,
      }),
    )
    expect(r.stats.identical).toBe(true)
    expect(r.split[0].left?.text).toBe('Hello World')
    expect(r.split[0].right?.text).toBe('hello   world')
    expect(ok(computeDiff('Hello', 'hello', opts())).stats.identical).toBe(false)
  })

  it('does not show intra-line highlights for completely different lines', () => {
    const r = ok(computeDiff('alpha beta gamma', 'totally new sentence', opts()))
    expect(r.split[0].kind).toBe('changed')
    expect(r.split[0].left?.segments.every((s) => !s.changed)).toBe(true)
  })

  it('handles CRLF vs LF as equal', () => {
    expect(ok(computeDiff('a\r\nb\r\n', 'a\nb\n', opts())).stats.identical).toBe(true)
  })

  it('handles large inputs', () => {
    const big = Array.from({ length: 20_000 }, (_, k) => `line ${k} 中文 😀`)
    const changed = [...big]
    changed[100] = 'changed'
    changed.splice(15_000, 1)
    const t0 = Date.now()
    const r = ok(computeDiff(big.join('\n'), changed.join('\n'), opts()))
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(r.blocks).toHaveLength(2)
    expect(r.stats.linesRemoved).toBe(2)
    expect(r.stats.linesAdded).toBe(1)
  })

  it('returns an error instead of throwing when the diff times out', () => {
    // 两侧行相同但顺序完全颠倒：无法靠剔除单侧行加速，只能等 Myers 超时
    const lines = Array.from({ length: 30_000 }, (_, k) => `line ${k}`)
    const a = lines.join('\n')
    const b = [...lines].reverse().join('\n')
    const r = computeDiff(a, b, opts(), 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/超时/)
  })
})

describe('alignLines', () => {
  it('pairs the most similar lines in order', () => {
    const ops = alignLines(
      ['  const data = await request(`/api/users/${id}`)'],
      ["  logger.debug('fetch user', id)", '  const data = await request(`/api/v2/users/${id}`)'],
      opts(),
    )
    expect(ops).toEqual([
      { left: null, right: 0 },
      { left: 0, right: 1 },
    ])
  })
  it('does not pair unrelated lines', () => {
    expect(alignLines(['alpha beta'], ['12345 xyz'], opts())).toEqual([
      { left: 0, right: null },
      { left: null, right: 0 },
    ])
  })
  it('falls back to in-order pairing for huge blocks', () => {
    const big = Array.from({ length: 300 }, (_, k) => `line ${k}`)
    const ops = alignLines(big, big.slice(0, 200), opts())
    expect(ops).toHaveLength(300)
    expect(ops[0]).toEqual({ left: 0, right: 0 })
    expect(ops[250]).toEqual({ left: 250, right: null })
  })
  it('handles empty sides', () => {
    expect(alignLines([], ['a'], opts())).toEqual([{ left: null, right: 0 }])
    expect(alignLines(['a'], [], opts())).toEqual([{ left: 0, right: null }])
  })
})

describe('computeDiff pairing', () => {
  it('shows an inserted line separately and pairs the modified one', () => {
    const r = ok(
      computeDiff(
        'a\n  const data = await request(`/api/users/${id}`)\nz',
        "a\n  logger.debug('fetch user', id)\n  const data = await request(`/api/v2/users/${id}`)\nz",
        opts(),
      ),
    )
    expect(r.split.map((x) => x.kind)).toEqual(['equal', 'added', 'changed', 'equal'])
    expect(changedText(r.split[2].right!.segments)).toBe('v2/')
    expect(r.unified.map((u) => u.kind)).toEqual(['equal', 'removed', 'added', 'added', 'equal'])
  })
})

describe('foldUnchanged', () => {
  it('keeps context around changes and folds long unchanged runs', () => {
    const changed = Array.from({ length: 20 }, (_, k) => k === 10)
    const items = foldUnchanged(changed, 2, 3)
    expect(items[0]).toEqual({ type: 'fold', start: 0, end: 8 })
    expect(
      items.filter((x) => x.type === 'row').map((x) => (x.type === 'row' ? x.index : -1)),
    ).toEqual([8, 9, 10, 11, 12])
    expect(items[items.length - 1]).toEqual({ type: 'fold', start: 13, end: 20 })
  })
  it('does not fold short runs', () => {
    const changed = [true, false, false, false, false, true]
    expect(foldUnchanged(changed, 1, 3).every((x) => x.type === 'row')).toBe(true)
  })
  it('folds everything when nothing changed', () => {
    expect(foldUnchanged(new Array(10).fill(false))).toEqual([{ type: 'fold', start: 0, end: 10 }])
    expect(foldUnchanged([])).toEqual([])
  })
})

describe('createUnifiedPatch', () => {
  it('creates a patch that applies back to the new text', () => {
    const a = 'one\ntwo\nthree\n中文\n'
    const b = 'one\n2\nthree\n中文 😀\nfour\n'
    const patch = createUnifiedPatch(a, b)
    expect(patch).toContain('--- original.txt')
    expect(patch).toContain('+++ modified.txt')
    expect(patch).toContain('-two')
    expect(patch).toContain('+2')
    expect(applyPatch(a, patch)).toBe(b)
  })
  it('uses custom file names', () => {
    expect(createUnifiedPatch('a', 'b', ['x.md', 'y.md'])).toContain('--- x.md')
  })
  it('always produces an exact patch that applies, even for whitespace-only changes', () => {
    // 回归：之前「忽略空白」时上下文行取自新文本，补丁无法应用回原文
    const a = 'a\n  b\nc\nd\n'
    const b = 'a\nb\nc\nX\n'
    const patch = createUnifiedPatch(a, b)
    expect(patch).toContain('-  b')
    expect(applyPatch(a, patch)).toBe(b)
    const crlf = createUnifiedPatch('x\r\ny\r\n', 'x\r\nz\r\n')
    expect(applyPatch('x\r\ny\r\n', crlf)).toBe('x\r\nz\r\n')
  })
})

describe('diffLineKeys', () => {
  const expand = (a: string[], b: string[], ch: NonNullable<ReturnType<typeof diffLineKeys>>) => {
    // 按变更序列重建两侧，校验计数与内容都对得上
    const left: string[] = []
    const right: string[] = []
    let i = 0
    let j = 0
    let common = 0
    for (const c of ch) {
      for (let k = 0; k < c.count; k++) {
        if (c.kind === 'removed') left.push(a[i++])
        else if (c.kind === 'added') right.push(b[j++])
        else {
          expect(a[i]).toBe(b[j])
          left.push(a[i++])
          right.push(b[j++])
          common++
        }
      }
    }
    expect(left).toEqual(a)
    expect(right).toEqual(b)
    return common
  }

  it('finds the longest common subsequence while discarding one-sided lines', () => {
    const a = ['x1', 'a', 'x2', 'b', 'c', 'x3']
    const b = ['a', 'y1', 'b', 'y2', 'c']
    const ch = diffLineKeys(a, b, 1000)!
    expect(expand(a, b, ch)).toBe(3)
  })

  it('handles empty sides and duplicates', () => {
    expect(diffLineKeys([], [], 1000)).toEqual([])
    expect(diffLineKeys(['a'], [], 1000)).toEqual([{ kind: 'removed', count: 1 }])
    expect(diffLineKeys([], ['a', 'b'], 1000)).toEqual([{ kind: 'added', count: 2 }])
    const a = ['a', 'a', 'b', 'a']
    const b = ['a', 'b', 'a', 'a', 'a']
    // LCS 为 a b a 或 a a a，长度 3
    expect(expand(a, b, diffLineKeys(a, b, 1000)!)).toBe(3)
  })

  it('is fast for two completely different large texts', () => {
    // 回归：之前 3000 行完全不同的文本要在主线程上跑 2 秒以上
    const a = Array.from({ length: 5000 }, (_, k) => `old line ${k} 中文`)
    const b = Array.from({ length: 5000 }, (_, k) => `new line ${k} 😀`)
    const t0 = Date.now()
    const r = ok(computeDiff(a.join('\n'), b.join('\n'), opts()))
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(r.blocks).toHaveLength(1)
    expect(r.stats.linesRemoved).toBe(5000)
    expect(r.stats.linesAdded).toBe(5000)
  })
})
