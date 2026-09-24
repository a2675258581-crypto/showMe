import { describe, expect, it } from 'vitest'
import { detectFileType, extFromMime, resolveFileType } from './base64-filetype'

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)),
  )
const text = (s: string) => new TextEncoder().encode(s)
const pad = (n: number) => new Array(n).fill(0)

describe('detectFileType', () => {
  it.each([
    ['png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pad(8)), 'image/png'],
    ['jpg', bytes([0xff, 0xd8, 0xff, 0xe0], pad(8)), 'image/jpeg'],
    ['gif', bytes('GIF89a', pad(6)), 'image/gif'],
    ['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
    ['ico', bytes([0, 0, 1, 0, 1, 0], pad(10)), 'image/x-icon'],
    ['bmp', bytes('BM', pad(12), [40, 0, 0, 0], pad(10)), 'image/bmp'],
    ['tiff', bytes([0x49, 0x49, 0x2a, 0x00]), 'image/tiff'],
    ['avif', bytes([0, 0, 0, 0x1c], 'ftypavif'), 'image/avif'],
    ['heic', bytes([0, 0, 0, 0x18], 'ftypheic'), 'image/heic'],
    ['pdf', bytes('%PDF-1.7\n'), 'application/pdf'],
    ['zip', bytes([0x50, 0x4b, 0x03, 0x04], pad(26), 'hello.txt'), 'application/zip'],
    ['gz', bytes([0x1f, 0x8b, 0x08]), 'application/gzip'],
    ['7z', bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), 'application/x-7z-compressed'],
    ['rar', bytes('Rar!\x1a\x07\x01\x00'), 'application/vnd.rar'],
    ['tar', bytes(pad(257), 'ustar\0'), 'application/x-tar'],
    ['wav', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 'audio/wav'],
    ['mp3', bytes('ID3', [4, 0]), 'audio/mpeg'],
    ['mp3 帧', bytes([0xff, 0xfb, 0x90, 0x00]), 'audio/mpeg'],
    ['ogg', bytes('OggS'), 'audio/ogg'],
    ['flac', bytes('fLaC'), 'audio/flac'],
    ['mp4', bytes([0, 0, 0, 0x20], 'ftypisom'), 'video/mp4'],
    ['mov', bytes([0, 0, 0, 0x14], 'ftypqt  '), 'video/quicktime'],
    ['webm', bytes([0x1a, 0x45, 0xdf, 0xa3], pad(20), 'webm'), 'video/webm'],
    ['woff2', bytes('wOF2'), 'font/woff2'],
    ['ttf', bytes([0, 1, 0, 0, 0, 0x10]), 'font/ttf'],
    ['wasm', bytes([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), 'application/wasm'],
    ['elf', bytes([0x7f, 0x45, 0x4c, 0x46]), 'application/x-elf'],
    ['exe', bytes('MZ', [0x90, 0]), 'application/vnd.microsoft.portable-executable'],
    ['sqlite', bytes('SQLite format 3\0'), 'application/vnd.sqlite3'],
  ])('%s', (_name, b, mime) => {
    expect(detectFileType(b)?.mime).toBe(mime)
  })

  it('refines zip containers', () => {
    const docx = bytes(
      [0x50, 0x4b, 0x03, 0x04],
      pad(26),
      '[Content_Types].xml',
      pad(10),
      'word/document.xml',
    )
    expect(detectFileType(docx)?.ext).toBe('docx')
    const xlsx = bytes([0x50, 0x4b, 0x03, 0x04], pad(26), 'xl/workbook.xml')
    expect(detectFileType(xlsx)?.ext).toBe('xlsx')
    const epub = bytes([0x50, 0x4b, 0x03, 0x04], pad(26), 'mimetypeapplication/epub+zip')
    expect(detectFileType(epub)?.ext).toBe('epub')
  })

  it('sniffs SVG, HTML, XML, JSON and plain text', () => {
    expect(detectFileType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.mime).toBe(
      'image/svg+xml',
    )
    expect(
      detectFileType(text('\ufeff<?xml version="1.0"?>\n<!-- c -->\n<svg viewBox="0 0 1 1"/>'))
        ?.ext,
    ).toBe('svg')
    expect(detectFileType(text('<!DOCTYPE html><html></html>'))?.ext).toBe('html')
    expect(detectFileType(text('<?xml version="1.0"?><root/>'))?.ext).toBe('xml')
    expect(detectFileType(text('{"a": [1, "中文"]}'))?.ext).toBe('json')
    expect(detectFileType(text('{not json'))?.ext).toBe('txt')
    expect(detectFileType(text('你好，世界 😀\n'))?.mime).toBe('text/plain')
  })

  it('returns null for unknown binary or empty input', () => {
    expect(detectFileType(new Uint8Array())).toBeNull()
    expect(detectFileType(Uint8Array.from([0x00, 0x13, 0x37, 0xff]))).toBeNull()
    expect(detectFileType(Uint8Array.from([0xc3, 0x28]))).toBeNull() // 非法 UTF-8
  })

  it('does not break on text truncated mid-character', () => {
    const b = text('中'.repeat(3000)) // 9000 字节，4096 处会切开一个汉字
    expect(detectFileType(b)?.ext).toBe('txt')
  })
})

describe('extFromMime', () => {
  it('maps common and generic MIME types', () => {
    expect(extFromMime('image/png')).toBe('png')
    expect(extFromMime('IMAGE/JPEG; charset=binary')).toBe('jpg')
    expect(extFromMime('image/svg+xml')).toBe('svg')
    expect(extFromMime('application/x-foo')).toBe('foo')
    expect(extFromMime('application/vnd.custom.thing')).toBe('thing')
    expect(extFromMime('nonsense')).toBeNull()
  })
})

describe('resolveFileType', () => {
  it('prefers magic bytes, but uses the declared MIME for plain text or unknown data', () => {
    const png = detectFileType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(resolveFileType(png, 'image/gif')?.ext).toBe('png')
    const csv = resolveFileType(detectFileType(text('a,b\n1,2\n')), 'text/csv;charset=utf-8')
    expect(csv).toMatchObject({ mime: 'text/csv', ext: 'csv', kind: 'text' })
    expect(resolveFileType(detectFileType(text('hi')), 'text/plain')?.ext).toBe('txt')
    expect(resolveFileType(detectFileType(text('hi')))?.ext).toBe('txt')
    expect(resolveFileType(null, 'application/x-custom')).toMatchObject({
      ext: 'custom',
      kind: 'binary',
    })
    expect(resolveFileType(null, 'application/octet-stream')).toBeNull()
    expect(resolveFileType(null)).toBeNull()
  })
})
