import { describe, expect, it } from 'vitest'
import {
  buildSnippets,
  bytesToDataUrl,
  extractDataUrl,
  growth,
  imageSize,
  looksLikeSvg,
  parseImageInput,
  svgSize,
  svgToDataUrl,
} from './image-base64'

/** 32×32 的真实 PNG（带透明通道） */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB1ElEQVR42sXX/4dUURjH8c/PERGxrCUiYolluUQiIiKWZXdnd7apaWramb07s81+m93Z2S8kIiInIiIiEZGJ6O+Yf2PvzNx77rlzPznc4erHNe7zF7ye4zyH88aFE+LiMXHpmLh8FONKO3Ym2rGaPIy7U63YXG0Nee1gyOv7Q97YH3K6GfHmXsSZvYizuxGdnYi3tg1vbxve2TK82zC81zC8/zLkg82QDzdDM1cPu/O1UC3UtJPb0Mi7GgVXo7iu8T+uJtoxJw9jTrVijgHnXD3kfC3kQk0zt6GZd7Ua4aVqgDTeyQBnwdUsruuOxct2gAxPPsJZqgYsVwNVqQQY3XnWOCuVgO5a4CBZOAmc9TVfIdl2CZyNF34XY3pq58G5U/YNBHE2yz4hibee+4QkfvRsQEjip3YASfxVaUBI4q+fDghJ/I0dQBJ/W+wTkvi7J31CEn//uE9I4h/sAJL4x0KfkMQ/PeoRkvhnO4Ak/mW1R0jiX/M9Ivm3i+Df8p5BEg0SOL+veF0kxSKB88eyp5DkkgTOn8ueg6TVlACufuU8pEOxkyHesfjvpTMgHYpJLmVycov/sQOkcNhWs7lki8VGg/23j+Op2W23C2fvPI3/XTzDPwcy9dPPcpRQAAAAAElFTkSuQmCC'
const PNG = Uint8Array.from(Buffer.from(PNG_B64, 'base64'))

const u8 = (...a: number[]) => Uint8Array.from(a)
const zeros = (n: number) => new Array<number>(n).fill(0)
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><path d="M0 0h24v12H0z" fill="#0a84ff"/></svg>'

describe('imageSize', () => {
  it('reads PNG / GIF / JPEG / WebP / BMP / ICO headers', () => {
    expect(imageSize(PNG)).toEqual({ width: 32, height: 32 })
    expect(imageSize(u8(...ascii('GIF89a'), 0x40, 0x01, 0xf0, 0x00, 0, 0))).toEqual({
      width: 320,
      height: 240,
    })
    // JPEG：SOI + APP0（长度 16）+ SOF0（高 480 宽 640）
    const jpeg = u8(
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      ...zeros(14),
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x01,
      0xe0,
      0x02,
      0x80,
      0x03,
      ...zeros(12),
    )
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 480 })
    const vp8x = u8(
      ...ascii('RIFF'),
      0,
      0,
      0,
      0,
      ...ascii('WEBPVP8X'),
      ...zeros(8),
      0x7f,
      0x07,
      0x00,
      0x37,
      0x04,
      0x00,
      0,
      0,
    )
    expect(imageSize(vp8x)).toEqual({ width: 1920, height: 1080 })
    // VP8L：宽 100、高 50 → (w-1) | (h-1) << 14
    const bits = 99 | (49 << 14)
    const vp8l = u8(
      ...ascii('RIFF'),
      0,
      0,
      0,
      0,
      ...ascii('WEBPVP8L'),
      0,
      0,
      0,
      0,
      0x2f,
      bits & 255,
      (bits >> 8) & 255,
      (bits >> 16) & 255,
      (bits >> 24) & 255,
      0,
      0,
      0,
      0,
      0,
    )
    expect(imageSize(vp8l)).toEqual({ width: 100, height: 50 })
    const bmp = u8(
      ...ascii('BM'),
      ...zeros(12),
      40,
      0,
      0,
      0,
      0x10,
      0,
      0,
      0,
      0xf0,
      0xff,
      0xff,
      0xff,
      ...zeros(4),
    )
    expect(imageSize(bmp)).toEqual({ width: 16, height: 16 })
    expect(imageSize(u8(0, 0, 1, 0, 1, 0, 0, 48, ...zeros(8)))).toEqual({ width: 256, height: 48 })
  })

  it('reads SVG size from width/height/viewBox', () => {
    expect(svgSize(SVG)).toEqual({ width: 24, height: 12 })
    expect(svgSize('<svg width="100px" height="50" viewBox="0 0 10 5"></svg>')).toEqual({
      width: 100,
      height: 50,
    })
    expect(svgSize('<svg width="200" viewBox="0 0 100 50"></svg>')).toEqual({
      width: 200,
      height: 100,
    })
    expect(svgSize('<svg width="100%" height="100%"></svg>')).toBeNull()
    expect(imageSize(new TextEncoder().encode(SVG))).toEqual({ width: 24, height: 12 })
  })

  it('returns null for non-images and truncated data', () => {
    expect(imageSize(new TextEncoder().encode('hello'))).toBeNull()
    expect(imageSize(PNG.subarray(0, 12))).toBeNull()
    expect(imageSize(new Uint8Array())).toBeNull()
  })
})

describe('parseImageInput', () => {
  it('parses a base64 data URL', () => {
    const r = parseImageInput(`data:image/png;base64,${PNG_B64}`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.image.mime).toBe('image/png')
      expect(r.image.isImage).toBe(true)
      expect(r.image.source).toBe('data-url')
      expect(r.image.bytes.length).toBe(PNG.length)
      expect(r.image.warnings).toEqual([])
    }
  })

  it('sniffs raw base64 (even wrapped in lines)', () => {
    const wrapped = PNG_B64.replace(/(.{76})/g, '$1\n')
    const r = parseImageInput(wrapped)
    expect(r.ok && r.image.mime).toBe('image/png')
    expect(r.ok && r.image.source).toBe('base64')
    expect(r.ok && r.image.ext).toBe('png')
  })

  it('warns when declared type differs from content', () => {
    const r = parseImageInput(`data:image/jpeg;base64,${PNG_B64}`)
    expect(r.ok && r.image.mime).toBe('image/png')
    expect(r.ok && r.image.warnings[0]).toContain('不一致')
  })

  it('extracts data URLs from CSS, HTML and Markdown', () => {
    const url = `data:image/png;base64,${PNG_B64}`
    expect(extractDataUrl(`background-image: url("${url}");`)).toBe(url)
    expect(extractDataUrl(`<img src='${url}' alt="x">`)).toBe(url)
    expect(extractDataUrl(`![logo](${url})`)).toBe(url)
    expect(extractDataUrl('no data here')).toBeNull()
    expect(parseImageInput(`<img src="${url}" />`).ok).toBe(true)
  })

  it('handles SVG markup, base64 SVG and URL-encoded SVG data URLs', () => {
    const raw = parseImageInput(SVG)
    expect(raw.ok && raw.image.mime).toBe('image/svg+xml')
    expect(raw.ok && raw.image.source).toBe('svg')

    const b64 = parseImageInput(`data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`)
    expect(b64.ok && new TextDecoder().decode(b64.image.bytes)).toBe(SVG)

    const encoded = svgToDataUrl(SVG)
    const r = parseImageInput(encoded)
    expect(r.ok && r.image.mime).toBe('image/svg+xml')
    expect(r.ok && new TextDecoder().decode(r.image.bytes)).toBe(SVG.replace(/"/g, "'"))

    const utf8 = parseImageInput(`data:image/svg+xml;utf8,${SVG}`)
    expect(utf8.ok && utf8.image.isImage).toBe(true)
  })

  it('accepts percent-escaped base64 inside data URLs', () => {
    const escaped = PNG_B64.replace(/\+/g, '%2B').replace(/\//g, '%2F')
    const r = parseImageInput(`data:image/png;base64,${escaped}`)
    expect(r.ok && r.image.bytes.length).toBe(PNG.length)
  })

  it('reports non-images and errors in Chinese', () => {
    const pdf = parseImageInput(Buffer.from('%PDF-1.4\n%âãÏÓ').toString('base64'))
    expect(pdf.ok && pdf.image.isImage).toBe(false)
    expect(pdf.ok && pdf.image.detected?.label).toBe('PDF 文档')
    const bad = parseImageInput('iVBOR*w0K')
    expect(!bad.ok && bad.error).toContain('第 1 行第 6 列')
    expect(parseImageInput('   ').ok).toBe(false)
    const noComma = parseImageInput('data:image/png;base64')
    expect(!noComma.ok && noComma.error).toContain('缺少逗号')
    const badMime = parseImageInput('data:png;base64,AAAA')
    expect(!badMime.ok && badMime.error).toContain('MIME')
  })
})

describe('snippets', () => {
  it('builds data URL, CSS, HTML and Markdown', () => {
    const url = bytesToDataUrl(PNG, 'image/png')
    expect(url).toBe(`data:image/png;base64,${PNG_B64}`)
    const s = buildSnippets(url, { alt: 'Logo "x"', width: 32, height: 32 })
    expect(s.base64).toBe(PNG_B64)
    expect(s.css).toBe(`background-image: url("${url}");`)
    expect(s.html).toBe(`<img src="${url}" alt="Logo &quot;x&quot;" width="32" height="32" />`)
    expect(s.markdown).toBe(`![Logo "x"](${url})`)
  })

  it('wraps URL-encoded SVG in angle brackets for Markdown and derives base64', () => {
    const url = svgToDataUrl(SVG)
    expect(url.startsWith('data:image/svg+xml,%3Csvg ')).toBe(true)
    expect(url).not.toContain('"')
    expect(url).not.toMatch(/[<>#]/)
    const s = buildSnippets(url)
    expect(s.markdown).toBe(`![图片](<${url}>)`)
    expect(Buffer.from(s.base64, 'base64').toString()).toBe(SVG.replace(/"/g, "'"))
  })

  it('encodes non-ASCII SVG text as UTF-8', () => {
    const url = svgToDataUrl('<svg><text>中</text></svg>')
    expect(url).toContain('%E4%B8%AD')
  })

  it('formats growth', () => {
    expect(growth(300, 400)).toBe('+33.3%')
    expect(growth(0, 0)).toBe('0%')
  })
})

describe('regressions', () => {
  it('keeps SVGs that already contain single quotes valid in URL-encoded data URLs', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="'Helvetica', sans-serif">it's "q"</text></svg>`
    const url = svgToDataUrl(svg)
    expect(url).not.toContain('"')
    expect(url).toContain("font-family=%22'Helvetica', sans-serif%22")
    // 解码回来与原文完全一致（引号嵌套没有被破坏）
    const r = parseImageInput(url)
    expect(r.ok && new TextDecoder().decode(r.image.bytes)).toBe(svg)
    // 放进 CSS 双引号 url("…") 里也不会提前结束
    expect(buildSnippets(url).css).toBe(`background-image: url("${url}");`)
  })

  it('detects SVG markup in linear time even with many leading comments', () => {
    expect(
      looksLikeSvg(
        '\ufeff <?xml version="1.0"?>\n<!-- a --><!-- b -->\n<!DOCTYPE svg PUBLIC "x">\n<svg/>',
      ),
    ).toBe(true)
    expect(looksLikeSvg('<svg viewBox="0 0 1 1"></svg>')).toBe(true)
    expect(looksLikeSvg('<svgfoo>')).toBe(false)
    expect(looksLikeSvg('<?xml version="1.0"?><html>')).toBe(false)
    expect(looksLikeSvg('<!-- unterminated <svg>')).toBe(false)
    const hostile = '<!--a-->'.repeat(5000) + 'x'
    const t = performance.now()
    expect(looksLikeSvg(hostile)).toBe(false)
    const r = parseImageInput(hostile)
    expect(r.ok).toBe(false)
    expect(performance.now() - t).toBeLessThan(500)
  })
})
