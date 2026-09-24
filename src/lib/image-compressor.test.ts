import { describe, expect, it } from 'vitest'
import {
  dedupeNames,
  downscaleSteps,
  extForMime,
  formatLabel,
  formatSavings,
  mimeFromName,
  normalizeMime,
  parseDimension,
  qualityApplies,
  resolveOutputFormat,
  rewriteFilename,
  savings,
  shouldKeepOriginal,
  targetSize,
} from './image-compressor'

const ALL = ['image/jpeg', 'image/webp', 'image/png', 'image/avif']
const NO_AVIF = ['image/jpeg', 'image/webp', 'image/png']
const SAFARI_OLD = ['image/jpeg', 'image/png']

describe('mime helpers', () => {
  it('infers mime from file names', () => {
    expect(mimeFromName('a.JPG')).toBe('image/jpeg')
    expect(mimeFromName('photo.final.webp')).toBe('image/webp')
    expect(mimeFromName('IMG_0001.HEIC')).toBe('image/heic')
    expect(mimeFromName('noext')).toBeNull()
    expect(mimeFromName('archive.zip')).toBeNull()
  })

  it('normalises odd mime types', () => {
    expect(normalizeMime('image/jpg')).toBe('image/jpeg')
    expect(normalizeMime('IMAGE/PNG')).toBe('image/png')
    expect(normalizeMime('', '截图.png')).toBe('image/png')
    expect(normalizeMime('', 'x')).toBe('')
  })

  it('maps mime to extension and label', () => {
    expect(extForMime('image/jpeg')).toBe('jpg')
    expect(extForMime('image/svg+xml')).toBe('svg')
    expect(extForMime('image/x-foo')).toBe('x')
    expect(formatLabel('image/webp')).toBe('WebP')
    expect(formatLabel('image/jxl')).toBe('JXL')
    expect(qualityApplies('image/png')).toBe(false)
    expect(qualityApplies('image/avif')).toBe(true)
  })
})

describe('rewriteFilename', () => {
  it.each([
    ['photo.PNG', 'image/webp', 'photo.webp'],
    ['a.b.c.jpg', 'image/png', 'a.b.c.png'],
    ['noext', 'image/jpeg', 'noext.jpg'],
    ['截图 2024-01-01.png', 'image/jpeg', '截图 2024-01-01.jpg'],
    ['😀.jpeg', 'image/avif', '😀.avif'],
    ['.png', 'image/webp', 'image.webp'],
    ['', 'image/png', 'image.png'],
    ['version 1.2 final', 'image/png', 'version 1.2 final.png'],
  ])('%s → %s = %s', (name, mime, expected) => {
    expect(rewriteFilename(name, mime)).toBe(expected)
  })
})

describe('resolveOutputFormat', () => {
  it('keeps encodable formats', () => {
    expect(resolveOutputFormat('image/jpeg', 'keep', ALL)).toEqual({
      mime: 'image/jpeg',
      explicit: false,
    })
    expect(resolveOutputFormat('image/webp', 'keep', ALL).mime).toBe('image/webp')
  })

  it('falls back when the browser cannot encode the original format', () => {
    const r = resolveOutputFormat('image/webp', 'keep', SAFARI_OLD)
    expect(r.mime).toBe('image/jpeg')
    expect(r.note).toContain('WebP')
    expect(resolveOutputFormat('image/avif', 'keep', NO_AVIF).mime).toBe('image/webp')
  })

  it('converts non-encodable inputs', () => {
    expect(resolveOutputFormat('image/gif', 'keep', ALL)).toMatchObject({
      mime: 'image/png',
      note: expect.stringContaining('第一帧'),
    })
    expect(resolveOutputFormat('image/bmp', 'keep', ALL).mime).toBe('image/png')
    expect(resolveOutputFormat('image/heic', 'keep', ALL).mime).toBe('image/jpeg')
    expect(resolveOutputFormat('', 'keep', ALL).mime).toBe('image/png')
  })

  it('honours explicit choices and flags format changes', () => {
    expect(resolveOutputFormat('image/png', 'image/webp', ALL)).toEqual({
      mime: 'image/webp',
      explicit: true,
    })
    expect(resolveOutputFormat('image/webp', 'image/webp', ALL).explicit).toBe(false)
    const avif = resolveOutputFormat('image/png', 'image/avif', NO_AVIF)
    expect(avif).toMatchObject({ mime: 'image/webp', explicit: true })
    expect(avif.note).toContain('AVIF')
    expect(resolveOutputFormat('image/png', 'image/webp', SAFARI_OLD).mime).toBe('image/jpeg')
    // PNG 总是可用
    expect(resolveOutputFormat('image/jpeg', 'image/png', []).mime).toBe('image/png')
  })
})

describe('targetSize', () => {
  it('never upscales', () => {
    expect(targetSize(800, 600, 1920, 1080)).toEqual({ width: 800, height: 600, resized: false })
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600, resized: false })
  })

  it('keeps aspect ratio within both limits', () => {
    expect(targetSize(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440, resized: true })
    expect(targetSize(4000, 3000, undefined, 1000)).toEqual({
      width: 1333,
      height: 1000,
      resized: true,
    })
    expect(targetSize(3000, 4000, 1920, 1920)).toEqual({ width: 1440, height: 1920, resized: true })
  })

  it('clamps each side independently without aspect lock', () => {
    expect(targetSize(4000, 3000, 1000, 1000, false)).toEqual({
      width: 1000,
      height: 1000,
      resized: true,
    })
    expect(targetSize(4000, 300, 1000, 1000, false)).toEqual({
      width: 1000,
      height: 300,
      resized: true,
    })
  })

  it('handles extreme ratios and zero / negative limits', () => {
    expect(targetSize(10000, 10, 100)).toEqual({ width: 100, height: 1, resized: true })
    expect(targetSize(500, 500, 0, -5)).toEqual({ width: 500, height: 500, resized: false })
  })
})

describe('downscaleSteps', () => {
  it('halves until close to the target, ending at the target', () => {
    expect(downscaleSteps(4000, 3000, 500, 375)).toEqual([
      { width: 2000, height: 1500 },
      { width: 1000, height: 750 },
      { width: 500, height: 375 },
    ])
    expect(downscaleSteps(1000, 800, 900, 720)).toEqual([{ width: 900, height: 720 }])
    expect(downscaleSteps(100, 100, 100, 100)).toEqual([{ width: 100, height: 100 }])
  })

  it('is bounded for huge reductions', () => {
    const steps = downscaleSteps(1_000_000, 1_000_000, 1, 1)
    expect(steps.length).toBeLessThanOrEqual(13)
    expect(steps.at(-1)).toEqual({ width: 1, height: 1 })
  })
})

describe('savings', () => {
  it('computes ratio and percent', () => {
    expect(savings(1000, 150)).toEqual({ saved: 850, ratio: 0.15, percent: 85 })
    expect(savings(1000, 1200).percent).toBeCloseTo(-20)
    expect(savings(0, 10)).toEqual({ saved: 0, ratio: 1, percent: 0 })
  })

  it('formats savings labels', () => {
    expect(formatSavings(85.4)).toBe('-85%')
    expect(formatSavings(-12.2)).toBe('+12%')
    expect(formatSavings(3.14)).toBe('-3.1%')
    expect(formatSavings(0.01)).toBe('0%')
    expect(formatSavings(5)).toBe('-5%')
  })

  it('keeps the original only when larger and no explicit conversion', () => {
    expect(shouldKeepOriginal({ originalSize: 100, resultSize: 120, explicitFormat: false })).toBe(
      true,
    )
    expect(shouldKeepOriginal({ originalSize: 100, resultSize: 100, explicitFormat: false })).toBe(
      true,
    )
    expect(shouldKeepOriginal({ originalSize: 100, resultSize: 80, explicitFormat: false })).toBe(
      false,
    )
    expect(shouldKeepOriginal({ originalSize: 100, resultSize: 120, explicitFormat: true })).toBe(
      false,
    )
  })

  it('never keeps an original that violates the requested max size (regression)', () => {
    expect(
      shouldKeepOriginal({
        originalSize: 100,
        resultSize: 120,
        explicitFormat: false,
        resized: true,
      }),
    ).toBe(false)
    expect(
      shouldKeepOriginal({
        originalSize: 100,
        resultSize: 120,
        explicitFormat: false,
        resized: false,
      }),
    ).toBe(true)
  })
})

describe('parseDimension / dedupeNames', () => {
  it('parses max size inputs', () => {
    expect(parseDimension('')).toBeUndefined()
    expect(parseDimension('  ')).toBeUndefined()
    expect(parseDimension('abc')).toBeUndefined()
    expect(parseDimension('-5')).toBeUndefined()
    expect(parseDimension('1920')).toBe(1920)
    expect(parseDimension('1080.6')).toBe(1081)
    expect(parseDimension('99999')).toBe(16384)
  })

  it('dedupes download names case-insensitively', () => {
    expect(dedupeNames(['a.jpg', 'b.jpg', 'A.jpg', 'a.jpg', 'noext', 'noext'])).toEqual([
      'a.jpg',
      'b.jpg',
      'A (2).jpg',
      'a (3).jpg',
      'noext',
      'noext (2)',
    ])
  })

  it('never produces a name that is already taken (regression)', () => {
    const out = dedupeNames(['photo.jpg', 'photo (2).jpg', 'photo.jpg', 'PHOTO.JPG', '照片.webp'])
    expect(out).toEqual([
      'photo.jpg',
      'photo (2).jpg',
      'photo (3).jpg',
      'PHOTO (4).JPG',
      '照片.webp',
    ])
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(out.length)
    expect(dedupeNames([])).toEqual([])
  })
})
