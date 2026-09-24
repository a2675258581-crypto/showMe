import { describe, expect, it } from 'vitest'
import { maskTemplateVars, reindentJson } from './api-client-json'

describe('maskTemplateVars', () => {
  it('replaces variables with same-length number placeholders', () => {
    expect(maskTemplateVars('{"a": {{x}}}')).toBe('{"a": 0    }')
    expect(maskTemplateVars('"{{ name }}"')).toBe('"0         "')
    expect(maskTemplateVars('no vars')).toBe('no vars')
    // {{}} 与 {{ }} 不是变量
    expect(maskTemplateVars('{{}} {{ }}')).toBe('{{}} {{ }}')
  })
  it('keeps line breaks so error positions do not move', () => {
    const src = '{{a\nb}}'
    const masked = maskTemplateVars(src)
    expect(masked).toHaveLength(src.length)
    expect(masked.indexOf('\n')).toBe(src.indexOf('\n'))
  })
})

describe('reindentJson', () => {
  it('pretty prints nested structures', () => {
    expect(reindentJson('{"a":{"b":[1,{"c":null}]},"d":true}')).toBe(
      '{\n  "a": {\n    "b": [\n      1,\n      {\n        "c": null\n      }\n    ]\n  },\n  "d": true\n}',
    )
  })
  it('matches JSON.stringify for ordinary input', () => {
    const value = {
      name: '张三',
      emoji: '😀',
      list: [1, -2.5, 3e21, true, false, null, [], {}],
      nested: { deep: { deeper: ['x'] } },
    }
    const minified = JSON.stringify(value)
    expect(reindentJson(minified)).toBe(JSON.stringify(value, null, 2))
    expect(reindentJson(minified, 4)).toBe(JSON.stringify(value, null, 4))
    expect(reindentJson(JSON.stringify(value, null, 2), 0)).toBe(minified)
  })
  it('keeps literals exactly as written', () => {
    expect(reindentJson('[12345678901234567890, 1.0, 1e-7, -0]', 0)).toBe(
      '[12345678901234567890,1.0,1e-7,-0]',
    )
    expect(reindentJson('{"k":"a\\"b\\\\","u":"\\u4e2d"}', 0)).toBe(
      '{"k":"a\\"b\\\\","u":"\\u4e2d"}',
    )
  })
  it('collapses empty containers with inner whitespace', () => {
    expect(reindentJson('{ "a" : [ ] , "b" : {\n} }')).toBe('{\n  "a": [],\n  "b": {}\n}')
  })
  it('handles top-level scalars and surrounding whitespace', () => {
    expect(reindentJson('  "x"  ')).toBe('"x"')
    expect(reindentJson('\n42\n')).toBe('42')
  })
  it('returns null for broken structure', () => {
    expect(reindentJson('')).toBeNull()
    expect(reindentJson('   ')).toBeNull()
    expect(reindentJson('{"a":1')).toBeNull()
    expect(reindentJson('[1]]')).toBeNull()
    expect(reindentJson('{"a":1]')).toBeNull()
    expect(reindentJson('"unterminated')).toBeNull()
  })
  it('treats {{variables}} as values only when allowed', () => {
    expect(reindentJson('{"a":{{x}}}', 2, true)).toBe('{\n  "a": {{x}}\n}')
    expect(reindentJson('[{{ a }},{{b}}]', 0, true)).toBe('[{{ a }},{{b}}]')
    expect(reindentJson('{"a":"{{x}}"}', 0, true)).toBe('{"a":"{{x}}"}')
    // 不允许变量时 {{ 按两个左括号处理，结构不完整
    expect(reindentJson('{"a":{{x}}}', 2, false)).not.toBe('{\n  "a": {{x}}\n}')
  })
  it('is fast enough for multi-megabyte bodies', () => {
    const big = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ i, s: 'x'.repeat(20) })))
    const t = performance.now()
    const out = reindentJson(big)
    expect(performance.now() - t).toBeLessThan(2000)
    expect(JSON.parse(out!)).toEqual(JSON.parse(big))
  })
})
