import { describe, expect, it } from 'vitest'
import {
  addLineNumbers,
  addPrefixSuffix,
  changeCase,
  collapseSpaces,
  countEnglishWords,
  countLines,
  countParagraphs,
  dedupeLines,
  extract,
  findReplace,
  formatReadingTime,
  graphemes,
  linesToList,
  listToLines,
  readingSeconds,
  removeEmptyLines,
  removeLineNumbers,
  reverseLines,
  seededRng,
  sortLines,
  splitLines,
  textStats,
  toFullWidth,
  toHalfWidth,
  trimLines,
  utf8Bytes,
} from './text-toolkit'

describe('textStats', () => {
  it('counts an empty string as all zeros', () => {
    expect(textStats('')).toEqual({
      chars: 0,
      charsNoSpace: 0,
      chinese: 0,
      words: 0,
      lines: 0,
      paragraphs: 0,
      bytes: 0,
      readingSeconds: 0,
    })
  })

  it('counts mixed Chinese / English / emoji text', () => {
    const s = textStats('你好，world! 👨‍👩‍👧\n\nSecond paragraph 第二段')
    expect(s.chinese).toBe(5)
    expect(s.words).toBe(3)
    expect(s.lines).toBe(3)
    expect(s.paragraphs).toBe(2)
    // 家庭 emoji 是一个字素簇
    expect(s.chars).toBe(
      [...new Intl.Segmenter().segment('你好，world! 👨‍👩‍👧\n\nSecond paragraph 第二段')].length,
    )
    expect(s.chars).toBeLessThan('你好，world! 👨‍👩‍👧\n\nSecond paragraph 第二段'.length)
    expect(s.charsNoSpace).toBe(s.chars - 5)
  })

  it('computes UTF-8 bytes like TextEncoder', () => {
    for (const t of ['abc', '中文', 'é', '😀', 'á', '\ud800x', 'mixed 中 😀 text']) {
      expect(utf8Bytes(t)).toBe(new TextEncoder().encode(t).length)
    }
  })

  it('counts English words with apostrophes and hyphens as one', () => {
    expect(countEnglishWords("don't stop well-known 42 things")).toBe(4)
  })

  it('counts lines and paragraphs', () => {
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb\n')).toBe(3)
    expect(countParagraphs('a\nb\n\n\nc\n  \nd')).toBe(3)
    expect(countParagraphs('\n\n')).toBe(0)
  })

  it('estimates reading time', () => {
    expect(readingSeconds(300, 0)).toBe(60)
    expect(readingSeconds(0, 100)).toBe(30)
    expect(formatReadingTime(0)).toBe('0 秒')
    expect(formatReadingTime(42)).toBe('42 秒')
    expect(formatReadingTime(150)).toBe('约 3 分钟')
    expect(formatReadingTime(3600 + 600)).toBe('约 1 小时 10 分钟')
  })

  it('handles large input quickly', () => {
    const big = '中文 English 😀\n'.repeat(50_000)
    const t0 = Date.now()
    const s = textStats(big)
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(s.chinese).toBe(100_000)
    expect(s.words).toBe(50_000)
    expect(s.lines).toBe(50_001)
  })

  it('fast path (no combining characters) matches Intl.Segmenter exactly', () => {
    // 纯中英文 + 单码点 emoji 走快速路径，结果必须与逐个字素簇计数一致
    const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' })
    const reference = (t: string) => {
      let all = 0
      let noSpace = 0
      for (const x of seg.segment(t)) {
        all++
        if (!/^\s+$/u.test(x.segment)) noSpace++
      }
      return { all, noSpace }
    }
    const samples = [
      '',
      'hello world',
      '中文　全角空格\t制表\n换行',
      '😀🎉 emoji 𠮷野家',
      '\u00a0\u2003\u3000\ufeff\u2028x',
      '👨‍👩‍👧 家庭', // 含 ZWJ：走 Segmenter
      'e\u0301 组合重音',
      'a\r\nb', // CRLF 算一个
      '🇨🇳🇺🇸 国旗',
      '👍🏽 肤色',
      'กำลัง ไทย', // 泰文 SARA AM 属于 SpacingMark
    ]
    for (const t of samples) {
      const s = textStats(t)
      expect({ all: s.chars, noSpace: s.charsNoSpace }).toEqual(reference(t))
    }
  })
  it('counts a large plain text quickly', () => {
    // 回归：之前 1MB 文本每次统计都要走 Intl.Segmenter，主线程卡 0.6 秒以上
    const big = '中文 English words 😀 123\n'.repeat(50_000)
    const t0 = Date.now()
    const s = textStats(big)
    expect(Date.now() - t0).toBeLessThan(400)
    expect(s.chars).toBe(23 * 50_000)
  })
  it('splits graphemes', () => {
    expect(graphemes('a👍🏽é')).toHaveLength(3)
  })
})

describe('splitLines', () => {
  it('normalizes CRLF / CR and returns [] for empty', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('dedupeLines', () => {
  it('keeps first occurrence order', () => {
    expect(dedupeLines('b\na\nb\nc\na').output).toBe('b\na\nc')
    expect(dedupeLines('b\na\nb\nc\na').info).toBe('删除了 2 行重复')
  })
  it('supports case-insensitive and trimmed comparison', () => {
    expect(dedupeLines('Apple\napple\nAPPLE ', { ignoreCase: true }).output).toBe('Apple\nAPPLE ')
    expect(dedupeLines('Apple\napple\nAPPLE ', { ignoreCase: true, trim: true }).output).toBe(
      'Apple',
    )
  })
  it('can keep blank lines', () => {
    expect(dedupeLines('a\n\na\n\nb', { keepEmpty: true }).output).toBe('a\n\n\nb')
    expect(dedupeLines('a\n\na\n\nb').output).toBe('a\n\nb')
  })
  it('handles emoji and 中文', () => {
    expect(dedupeLines('你好\n😀\n你好\n😀').output).toBe('你好\n😀')
    expect(dedupeLines('').output).toBe('')
  })
})

describe('sortLines', () => {
  it('sorts ascending / descending with locale awareness', () => {
    expect(sortLines('banana\napple\ncherry', 'asc').output).toBe('apple\nbanana\ncherry')
    expect(sortLines('banana\napple\ncherry', 'desc').output).toBe('cherry\nbanana\napple')
  })
  it('sorts Chinese by pinyin', () => {
    expect(sortLines('张三\n李四\n王五\n阿明', 'asc').output).toBe('阿明\n李四\n王五\n张三')
  })
  it('natural sort handles embedded numbers', () => {
    expect(sortLines('item10\nitem2\nitem1', 'asc').output).toBe('item1\nitem10\nitem2')
    expect(sortLines('item10\nitem2\nitem1', 'natural').output).toBe('item1\nitem2\nitem10')
    expect(sortLines('file 20.txt\nfile 3.txt\nFile 1.txt', 'natural').output).toBe(
      'File 1.txt\nfile 3.txt\nfile 20.txt',
    )
  })
  it('sorts by length (stable, grapheme aware)', () => {
    expect(sortLines('ccc\na\nbb\nx\n👨‍👩‍👧👨‍👩‍👧', 'length').output).toBe('a\nx\nbb\n👨‍👩‍👧👨‍👩‍👧\nccc')
  })
  it('shuffles deterministically with a seeded rng and keeps all lines', () => {
    const input = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const a = sortLines(input, 'shuffle', seededRng(42)).output
    const b = sortLines(input, 'shuffle', seededRng(42)).output
    expect(a).toBe(b)
    expect(a).not.toBe(input)
    expect(a.split('\n').sort()).toEqual(input.split('\n').sort())
  })
})

describe('reverse / empty / trim / collapse', () => {
  it('reverses lines', () => {
    expect(reverseLines('1\n2\n3').output).toBe('3\n2\n1')
  })
  it('removes empty and whitespace-only lines', () => {
    const r = removeEmptyLines('a\n\n  \n\tb\n　\nc')
    expect(r.output).toBe('a\n\tb\nc')
    expect(r.info).toBe('删除了 3 个空行')
  })
  it('trims each line including full-width spaces', () => {
    expect(trimLines('  a  \n　中文　\nb').output).toBe('a\n中文\nb')
  })
  it('collapses runs of spaces / tabs but keeps newlines', () => {
    expect(collapseSpaces('a   b\t\tc\n  d　　e').output).toBe('a b c\n d e')
    expect(collapseSpaces('a b').info).toBe('没有连续空白')
  })
})

describe('line numbers', () => {
  it('adds numbers with separator and padding', () => {
    const text = Array.from({ length: 10 }, (_, i) => String.fromCharCode(97 + i)).join('\n')
    expect(addLineNumbers('a\nb', {}).output).toBe('1. a\n2. b')
    expect(addLineNumbers(text, { pad: true, separator: ' | ' }).output.split('\n')[0]).toBe(
      ' 1 | a',
    )
    expect(addLineNumbers('a\n\nb', { numberEmpty: false, start: 5 }).output).toBe('5. a\n\n6. b')
  })
  it('removes common number formats', () => {
    expect(
      removeLineNumbers('1. a\n2) b\n3、c\n(4) d\n[5] e\n  6\tf\n7: g\n10 - h\nplain').output,
    ).toBe('a\nb\nc\nd\ne\nf\ng\nh\nplain')
  })
  it('round-trips every separator offered by addLineNumbers', () => {
    // 回归：之前「1 | a」去掉行号后剩下「| a」
    const src = 'alpha\nbeta\n中文 😀'
    for (const separator of ['. ', '、', ') ', ': ', ' | ', '\t', ' ']) {
      for (const pad of [false, true]) {
        const numbered = addLineNumbers(src, { separator, pad, start: 9 }).output
        expect(removeLineNumbers(numbered).output).toBe(src)
      }
    }
  })
  it('keeps numbers that are content, not line numbers', () => {
    // 回归：之前 3.14 → 14、12:30 → 30、2024-01-01 → 01-01
    const src = '3.14 是圆周率\n12:30 开会\n2024-01-01 元旦\n42\n1.2.3 版本'
    const r = removeLineNumbers(src)
    expect(r.output).toBe(src)
    expect(r.info).toBe('没有识别到行号')
    expect(removeLineNumbers('（1）全角括号\n1．全角点').output).toBe('全角括号\n全角点')
  })
  it('round-trips', () => {
    const src = 'alpha\nbeta\n中文'
    expect(removeLineNumbers(addLineNumbers(src).output).output).toBe(src)
  })
})

describe('addPrefixSuffix', () => {
  it('wraps lines and skips empty ones by default', () => {
    expect(addPrefixSuffix('a\n\nb', { prefix: '- ', suffix: ';' }).output).toBe('- a;\n\n- b;')
    expect(addPrefixSuffix('a\n\nb', { prefix: '>', skipEmpty: false }).output).toBe('>a\n>\n>b')
  })
})

describe('full / half width', () => {
  it('converts full-width ASCII to half-width', () => {
    expect(toHalfWidth('ＡＢＣ１２３！＠　ｘ').output).toBe('ABC123!@ x')
    // "，" 是全角逗号 U+FF0C 会被转换；"。" 是中文句号 U+3002，保持不变
    expect(toHalfWidth('你好，世界。').output).toBe('你好,世界。')
  })
  it('converts half-width to full-width and round-trips', () => {
    expect(toFullWidth('Hi 1!').output).toBe('Ｈｉ　１！')
    const s = 'Hello, World! 123 ~'
    expect(toHalfWidth(toFullWidth(s).output).output).toBe(s)
  })
})

describe('changeCase', () => {
  it('upper / lower / title / sentence', () => {
    expect(changeCase('Hello wORLD', 'upper').output).toBe('HELLO WORLD')
    expect(changeCase('Hello wORLD', 'lower').output).toBe('hello world')
    expect(changeCase("hello wORLD, don't panic 中文", 'title').output).toBe(
      "Hello World, Don't Panic 中文",
    )
    expect(changeCase('HELLO. how ARE you? fine', 'sentence').output).toBe(
      'Hello. How are you? Fine',
    )
  })
})

describe('extract', () => {
  const text = `联系 alice@example.com 或 Bob.Smith+tag@mail.co.uk，重复 alice@example.com。
网址 https://example.com/path?q=1&x=2，以及 http://中文.cn/页面 (http://foo.org/bar)。
价格 -12.5 元，数量 1,000，编号 A42，科学计数 6.02e23
电话 13800138000、+86 139-1234-5678、12345678901、1380013800012
IP 192.168.1.1、10.0.0.255，无效 256.1.1.1、1.2.3.4.5；IPv6 2001:db8::1 和 ::1，std::vector 不是`

  it('extracts unique emails', () => {
    expect(extract(text, 'email').output).toBe('alice@example.com\nBob.Smith+tag@mail.co.uk')
    expect(extract(text, 'email', false).output.split('\n')).toHaveLength(3)
  })
  it('extracts URLs without trailing punctuation', () => {
    expect(extract(text, 'url').output.split('\n')).toEqual([
      'https://example.com/path?q=1&x=2',
      'http://中文.cn/页面',
      'http://foo.org/bar',
    ])
  })
  it('extracts numbers', () => {
    const nums = extract(text, 'number', false).output.split('\n')
    expect(nums).toContain('-12.5')
    expect(nums).toContain('1,000')
    expect(nums).toContain('42')
    expect(nums).toContain('6.02e23')
  })
  it('does not split IP addresses or version strings into fake decimals', () => {
    // 回归：之前 192.168.1.10 提取出 192.168，版本号 1.2.3 提取出 1.2
    const nums = extract('服务器 192.168.1.10 版本 v1.2.3，价格 3.5 元，结尾 7.', 'number').output
    expect(nums.split('\n')).toEqual(['3.5', '7'])
  })
  it('extracts mainland phone numbers normalized to 11 digits', () => {
    expect(extract(text, 'phone').output).toBe('13800138000\n13912345678')
  })
  it('extracts valid IPv4 / IPv6 only', () => {
    expect(extract(text, 'ip').output.split('\n')).toEqual([
      '192.168.1.1',
      '10.0.0.255',
      '2001:db8::1',
      '::1',
    ])
  })
  it('reports nothing found', () => {
    expect(extract('', 'email')).toEqual({ output: '', info: '没有找到邮箱' })
  })
})

describe('findReplace', () => {
  it('replaces plain text literally and case-insensitively by default', () => {
    const r = findReplace('a.b A.B a+b', 'a.b', 'X')
    expect(r.output).toBe('X X a+b')
    expect(r.info).toBe('替换了 2 处')
    expect(findReplace('a.b A.B', 'a.b', 'X', { caseSensitive: true }).output).toBe('X A.B')
  })
  it('does not interpret $ in plain mode', () => {
    expect(findReplace('cost', 'cost', '$1 $&').output).toBe('$1 $&')
  })
  it('supports regex with groups and named groups', () => {
    expect(
      findReplace('2024-01-31', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', { regex: true }).output,
    ).toBe('31/01/2024')
    expect(
      findReplace('2024-01-31', '(?<y>\\d+)-(?<m>\\d+)', '$<m>.$<y> [$&] $$', { regex: true })
        .output,
    ).toBe('01.2024 [2024-01] $-31')
  })
  it('matches native replace semantics for templates', () => {
    const src = 'foo bar baz'
    for (const tpl of ['[$`]', "[$']", '$0', '$10', '$01', '$<x>', '$$&']) {
      expect(findReplace(src, '(b)(a)', tpl, { regex: true, caseSensitive: true }).output).toBe(
        src.replace(/(b)(a)/gu, tpl),
      )
    }
  })
  it('uses multiline anchors in regex mode', () => {
    expect(findReplace('a\nb', '^', '> ', { regex: true }).output).toBe('> a\n> b')
  })
  it('reports invalid regex in Chinese', () => {
    const r = findReplace('abc', '(', 'x', { regex: true })
    expect(r.error).toMatch(/^正则表达式无效：分组没有闭合/)
    expect(r.output).toBe('abc')
    // u 模式先报「无效的转义」，真正的问题是分组没闭合
    expect(findReplace('a-b', '\\-(', 'x', { regex: true }).error).toMatch(/分组没有闭合/)
  })
  it('handles empty find and unicode', () => {
    expect(findReplace('abc', '', 'x').info).toBe('请输入要查找的内容')
    expect(findReplace('我爱😀我爱', '😀', '🎉').output).toBe('我爱🎉我爱')
  })
})

describe('list conversion', () => {
  it('joins lines into SQL IN list', () => {
    expect(
      linesToList(" a \nb\n\nO'Neil", { quote: 'single', wrap: 'paren', separator: ', ' }).output,
    ).toBe("('a', 'b', 'O''Neil')")
  })
  it('joins with double quotes, brackets and dedupe', () => {
    expect(
      linesToList('x\ny\nx\nsay "hi"', { quote: 'double', wrap: 'bracket', unique: true }).output,
    ).toBe('["x", "y", "say \\"hi\\""]')
    expect(linesToList('a\nb', { separator: ',' }).output).toBe('a,b')
  })
  it('splits comma lists back to lines respecting quotes', () => {
    expect(listToLines("('a', 'b, c', 'O''Neil')").output).toBe("a\nb, c\nO'Neil")
    expect(listToLines('["x", "y\\"z"]').output).toBe('x\ny"z')
    expect(listToLines('苹果，香蕉, 橘子').output).toBe('苹果\n香蕉\n橘子')
    expect(listToLines('a|b|c', '|').output).toBe('a\nb\nc')
    expect(listToLines('  ').output).toBe('')
  })
  it('round-trips', () => {
    const src = "alpha\nbe'ta\n中文 😀"
    const joined = linesToList(src, { quote: 'single' }).output
    expect(listToLines(joined).output).toBe(src)
  })
})
