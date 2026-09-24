import { describe, expect, it } from 'vitest'
import {
  EMPTY_TEMPLATE_DATA,
  alignmentCenters,
  alignmentCoords,
  LOGO_MAX_AREA,
  LOGO_MIN_VERSION,
  buildGeometry,
  buildMailto,
  buildPayload,
  buildSms,
  buildTel,
  buildVCard,
  buildWifi,
  colorWarning,
  contrastRatio,
  createMatrix,
  drawnModules,
  escapeVCard,
  escapeWifi,
  inFinder,
  logoBox,
  normalizeHex,
  parseHex,
  renderSvg,
  vcardFullName,
  type EyeStyle,
  type ModuleStyle,
  type QrMatrix,
  type TemplateData,
} from './qrcode'
import { decodeRgba, parsePayload, parseWifi, type Rgba } from './qrcode-decode'

/* 把矩阵按样式光栅化成 RGBA（模拟浏览器渲染），用于 jsQR 回读测试 */
function rasterize(
  m: QrMatrix,
  opts: {
    scale?: number
    margin?: number
    moduleStyle?: ModuleStyle
    eyeStyle?: EyeStyle
    logoArea?: number
    fg?: [number, number, number]
    bg?: [number, number, number]
  } = {},
): Rgba {
  const {
    scale = 6,
    margin = 4,
    moduleStyle = 'square',
    eyeStyle = 'square',
    logoArea,
    fg = [0, 0, 0],
    bg = [255, 255, 255],
  } = opts
  const box = logoArea ? logoBox(m.size, logoArea) : undefined
  const solidAlign = moduleStyle === 'dots'
  const draw = drawnModules(m, box, solidAlign)
  const centers = solidAlign ? alignmentCenters(m.version) : []
  const alignDark = (mx: number, my: number): boolean | null => {
    for (const [cr, cc] of centers) {
      const dx = mx - (cc + 0.5)
      const dy = my - (cr + 0.5)
      if (Math.abs(dx) > 2.5 || Math.abs(dy) > 2.5) continue
      if (eyeStyle === 'circle') {
        const d = Math.hypot(dx, dy)
        return d <= 0.5 || (d >= 1.5 && d <= 2.5)
      }
      const k = Math.max(Math.abs(dx), Math.abs(dy))
      return k <= 0.5 || k >= 1.5
    }
    return null
  }
  const dim = m.size + margin * 2
  const W = dim * scale
  const data = new Uint8ClampedArray(W * W * 4)
  const eyeDark = (x: number, y: number): boolean => {
    // x, y：相对码眼左上角的模块坐标（0–7）
    if (eyeStyle === 'circle') {
      const d = Math.hypot(x - 3.5, y - 3.5)
      return d <= 1.5 || (d >= 2.5 && d <= 3.5)
    }
    const ring = x < 1 || y < 1 || x >= 6 || y >= 6
    const core = x >= 2 && y >= 2 && x < 5 && y < 5
    return ring || core
  }
  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      const mx = (px + 0.5) / scale - margin
      const my = (py + 0.5) / scale - margin
      const c = Math.floor(mx)
      const r = Math.floor(my)
      let dark = false
      if (r >= 0 && c >= 0 && r < m.size && c < m.size) {
        if (inFinder(r, c, m.size)) {
          const ox = c < 7 ? 0 : m.size - 7
          const oy = r < 7 ? 0 : m.size - 7
          dark = eyeDark(mx - ox, my - oy)
        } else if (draw[r * m.size + c]) {
          dark = moduleStyle === 'dots' ? Math.hypot(mx - c - 0.5, my - r - 0.5) <= 0.45 : true
        } else {
          dark = alignDark(mx, my) ?? false
        }
        // Logo：中间画一个深色方块（最坏情况）
        if (box && box.size > 2) {
          const s = box.start + 1
          const e = box.start + box.size - 1
          if (mx >= s && mx < e && my >= s && my < e)
            dark = (Math.floor(mx) + Math.floor(my)) % 3 === 0
        }
      }
      const col = dark ? fg : bg
      const i = (py * W + px) * 4
      data[i] = col[0]
      data[i + 1] = col[1]
      data[i + 2] = col[2]
      data[i + 3] = 255
    }
  }
  return { data, width: W, height: W }
}

function roundTrip(text: string, ecl: 'L' | 'M' | 'Q' | 'H' = 'M', opts = {}) {
  const res = createMatrix(text, ecl)
  if (!res.ok) throw new Error(res.error)
  return decodeRgba(rasterize(res.matrix, opts))?.text
}

describe('content templates', () => {
  it('escapes Wi-Fi special characters', () => {
    expect(escapeWifi('a;b,c:d"e\\f')).toBe('a\\;b\\,c\\:d\\"e\\\\f')
    expect(
      buildWifi({ ssid: 'My;Net', password: 'p@ss:"word"', security: 'WPA', hidden: false }),
    ).toBe('WIFI:T:WPA;S:My\\;Net;P:p@ss\\:\\"word\\";H:false;;')
    expect(buildWifi({ ssid: '咖啡店', password: 'x', security: 'nopass', hidden: true })).toBe(
      'WIFI:T:nopass;S:咖啡店;H:true;;',
    )
  })

  it('Wi-Fi payload round-trips through the parser', () => {
    const w = { ssid: 'a\\b;c', password: 'x,y:z', security: 'WEP' as const, hidden: true }
    expect(parseWifi(buildWifi(w))).toEqual({ T: 'WEP', S: 'a\\b;c', P: 'x,y:z', H: 'true' })
    // 带引号的密码（原样字面引号）也能往返
    const q = { ssid: '"Lobby"', password: 'p"w', security: 'WPA' as const, hidden: false }
    expect(parseWifi(buildWifi(q))).toMatchObject({ S: '"Lobby"', P: 'p"w' })
  })

  it('unwraps quoted Wi-Fi values from other generators', () => {
    expect(parseWifi('WIFI:S:"Cafe 5G";T:WPA;P:"12345678";;')).toEqual({
      S: 'Cafe 5G',
      T: 'WPA',
      P: '12345678',
    })
    expect(parseWifi('wifi:S:x\\;y;;')).toEqual({ S: 'x;y' })
    expect(parseWifi('not wifi')).toBeNull()
  })

  it('builds vCard 3.0 with escaping and CJK name order', () => {
    expect(escapeVCard('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
    expect(vcardFullName({ lastName: '张', firstName: '三' })).toBe('张三')
    expect(vcardFullName({ lastName: 'Doe', firstName: 'John' })).toBe('John Doe')
    const v = buildVCard({
      ...EMPTY_TEMPLATE_DATA.vcard,
      lastName: '张',
      firstName: '三',
      org: '示例科技, Inc.',
      mobile: '138 0013 8000',
      email: 'z@example.com',
      note: '第一行\n第二行',
    })
    expect(v.split('\r\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:张;三;;;',
      'FN:张三',
      'ORG:示例科技\\, Inc.',
      'TEL;TYPE=CELL:138 0013 8000',
      'EMAIL;TYPE=INTERNET:z@example.com',
      'NOTE:第一行\\n第二行',
      'END:VCARD',
    ])
  })

  it('builds mailto with RFC 6068 encoding', () => {
    expect(buildMailto({ to: 'a@x.com, b@y.com', subject: '你好 & hi', body: 'l1\nl2' })).toBe(
      'mailto:a@x.com,b@y.com?subject=%E4%BD%A0%E5%A5%BD%20%26%20hi&body=l1%0D%0Al2',
    )
    expect(buildMailto({ to: 'a@x.com', subject: '', body: '' })).toBe('mailto:a@x.com')
  })

  it('builds SMS / tel and strips formatting from phone numbers', () => {
    expect(buildSms({ phone: '+86 138-0013-8000', message: '到了: 门口' })).toBe(
      'SMSTO:+8613800138000:到了: 门口',
    )
    expect(buildTel('(010) 8888-6666')).toBe('tel:01088886666')
  })

  it('buildPayload validates each template', () => {
    const d: TemplateData = structuredClone(EMPTY_TEMPLATE_DATA)
    expect(buildPayload('text', d)).toEqual({ text: '', warnings: [] })
    d.text = 'example.com/path'
    expect(buildPayload('text', d).warnings[0]).toContain('https://')
    d.text = 'https://example.com'
    expect(buildPayload('text', d).warnings).toEqual([])
    expect(buildPayload('wifi', d).error).toContain('SSID')
    d.wifi = { ssid: 'x', password: 'short', security: 'WPA', hidden: false }
    expect(buildPayload('wifi', d).warnings[0]).toContain('8–63')
    expect(buildPayload('vcard', d).error).toContain('姓名')
    d.vcard.org = 'ACME'
    expect(buildPayload('vcard', d).text).toContain('FN:ACME')
    expect(buildPayload('email', d).error).toBeTruthy()
    d.email.to = 'bad-address'
    expect(buildPayload('email', d).warnings[0]).toContain('bad-address')
    expect(buildPayload('sms', d).error).toContain('手机号')
    expect(buildPayload('tel', d).error).toContain('电话')
    d.tel.phone = '12'
    expect(buildPayload('tel', d).warnings[0]).toContain('不对')
  })
})

describe('matrix', () => {
  it('creates matrices for text, 中文 and emoji', () => {
    for (const t of ['hello', '你好，世界', '😀🎉', 'https://example.com/?q=1&x=2']) {
      const r = createMatrix(t, 'M')
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.matrix.size).toBe(17 + 4 * r.matrix.version)
        expect(r.matrix.dark).toHaveLength(r.matrix.size ** 2)
      }
    }
  })

  it('rejects empty and oversized input with helpful messages', () => {
    expect(createMatrix('', 'M').ok).toBe(false)
    const big = createMatrix('a'.repeat(1300), 'H')
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.error).toMatch(/1,300 字节.*1,273/)
    const zh = createMatrix('中'.repeat(1000), 'L') // 3000 字节
    expect(zh.ok).toBe(false)
    if (!zh.ok) expect(zh.error).toContain('缩短内容')
    expect(createMatrix('a'.repeat(2900), 'L').ok).toBe(true)
  })

  it('honours minVersion (used when a logo is placed)', () => {
    const r = createMatrix('hi', 'H', LOGO_MIN_VERSION)
    expect(r.ok && r.matrix.version).toBe(LOGO_MIN_VERSION)
  })
})

describe('logo box', () => {
  it('is centered, grid-aligned and never exceeds 20% of the area', () => {
    for (let v = 1; v <= 40; v++) {
      const size = 17 + 4 * v
      for (const area of [0.01, 0.05, 0.1, 0.2, 0.5, 1]) {
        const b = logoBox(size, area)
        expect(b.size * b.size).toBeLessThanOrEqual(LOGO_MAX_AREA * size * size)
        expect(Number.isInteger(b.start)).toBe(true)
        expect(b.start * 2 + b.size).toBe(size)
      }
    }
  })

  it('does not overlap finder patterns from the minimum logo version on', () => {
    for (let v = LOGO_MIN_VERSION; v <= 40; v++) {
      const size = 17 + 4 * v
      const b = logoBox(size, LOGO_MAX_AREA)
      expect(b.start).toBeGreaterThan(7)
    }
  })
})

describe('geometry & svg', () => {
  const res = createMatrix('https://example.com', 'M')
  if (!res.ok) throw new Error(res.error)
  const m = res.matrix

  it('draws every dark non-finder module exactly once', () => {
    let expected = 0
    let inAlignment = 0
    const align = alignmentCenters(m.version)
    for (let r = 0; r < m.size; r++)
      for (let c = 0; c < m.size; c++) {
        if (!m.dark[r * m.size + c] || inFinder(r, c, m.size)) continue
        expected++
        if (align.some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2)) inAlignment++
      }
    for (const moduleStyle of ['square', 'rounded'] as const) {
      const g = buildGeometry(m, { margin: 2, moduleStyle, eyeStyle: 'square' })
      expect(g.drawn).toBe(expected)
      expect(g.dim).toBe(m.size + 4)
    }
    // 圆点风格：校正图形整体绘制成小码眼
    const dots = buildGeometry(m, { margin: 0, moduleStyle: 'dots', eyeStyle: 'circle' })
    expect(inAlignment).toBeGreaterThan(0)
    expect(dots.drawn).toBe(expected - inAlignment)
    expect(dots.modules.match(/M/g)).toHaveLength(expected - inAlignment)
    expect(dots.eyeOuter.match(/M/g)).toHaveLength(6 + align.length * 2)
  })

  it('computes alignment pattern positions per the spec table', () => {
    expect(alignmentCoords(1)).toEqual([])
    expect(alignmentCoords(2)).toEqual([6, 18])
    expect(alignmentCoords(7)).toEqual([6, 22, 38])
    expect(alignmentCoords(14)).toEqual([6, 26, 46, 66])
    expect(alignmentCoords(32)).toEqual([6, 34, 60, 86, 112, 138])
    expect(alignmentCoords(40)).toEqual([6, 30, 58, 86, 114, 142, 170])
    expect(alignmentCenters(7)).toHaveLength(6)
    // 与 qrcode 库的功能图形标记一致
    for (const v of [2, 7, 20, 40]) {
      const r = createMatrix('x', 'L', v)
      if (!r.ok) throw new Error(r.error)
      for (const [cr, cc] of alignmentCenters(v)) {
        for (let dr = -2; dr <= 2; dr++)
          for (let dc = -2; dc <= 2; dc++) {
            expect(r.matrix.reserved[(cr + dr) * r.matrix.size + cc + dc]).toBe(1)
          }
        expect(r.matrix.dark[cr * r.matrix.size + cc]).toBe(1)
      }
    }
  })

  it('draws three eyes in every style', () => {
    for (const eyeStyle of ['square', 'rounded', 'circle'] as const) {
      const g = buildGeometry(m, { margin: 1, moduleStyle: 'square', eyeStyle })
      expect(g.eyeOuter.match(/M/g)).toHaveLength(6)
      expect(g.eyeInner.match(/M/g)).toHaveLength(3)
    }
  })

  it('excavates the logo area', () => {
    const plain = buildGeometry(m, { margin: 2, moduleStyle: 'square', eyeStyle: 'square' })
    const withLogo = buildGeometry(m, {
      margin: 2,
      moduleStyle: 'square',
      eyeStyle: 'square',
      logoArea: 0.1,
    })
    expect(withLogo.drawn).toBeLessThan(plain.drawn)
    expect(withLogo.logo).toBeDefined()
    expect(withLogo.logo!.x + withLogo.logo!.size / 2).toBeCloseTo(withLogo.dim / 2)
  })

  it('renders a standalone SVG with escaped attributes', () => {
    const g = buildGeometry(m, {
      margin: 2,
      moduleStyle: 'rounded',
      eyeStyle: 'rounded',
      logoArea: 0.08,
    })
    const svg = renderSvg(g, {
      fg: '#112233',
      bg: '#ffffff',
      size: 512,
      logoHref: 'data:image/png;base64,AA"<&',
      moduleStyle: 'rounded',
    })
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+" width="512" height="512">/,
    )
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).toContain('href="data:image/png;base64,AA&quot;&lt;&amp;"')
    expect(svg.trim().endsWith('</svg>')).toBe(true)
  })
})

describe('encode → rasterize → jsQR decode', () => {
  it.each(['Hello, showMe!', '你好，二维码 👋', 'https://example.com/a?b=c&d=%20'])(
    'round-trips %s',
    (text) => {
      expect(roundTrip(text)).toBe(text)
    },
  )

  it('round-trips every module and eye style', () => {
    const text = 'WIFI:T:WPA;S:Office;P:12345678;H:false;;'
    for (const moduleStyle of ['square', 'dots', 'rounded'] as const)
      for (const eyeStyle of ['square', 'rounded', 'circle'] as const)
        expect(roundTrip(text, 'Q', { moduleStyle, eyeStyle, scale: 8 })).toBe(text)
  })

  it('decodes dot-style codes at large pixel sizes (downloaded PNGs)', () => {
    const text = 'WIFI:T:WPA;S:Office-5G;P:showme2024!;H:false;;'
    for (const [ecl, minV] of [
      ['M', 4],
      ['H', 5],
      ['M', 10],
    ] as const) {
      const res = createMatrix(text, ecl, minV)
      if (!res.ok) throw new Error(res.error)
      for (const eyeStyle of ['square', 'circle'] as const) {
        for (const scale of [12, 25, 40]) {
          const img = rasterize(res.matrix, { moduleStyle: 'dots', eyeStyle, scale, margin: 2 })
          expect(decodeRgba(img)?.text, `v${minV} ${eyeStyle} s=${scale}`).toBe(text)
        }
      }
    }
    // 18 次光栅化 + 多轮 jsQR，单独跑约 5 秒，和其它测试并行时更慢
  }, 60_000)

  it('still decodes with a centered logo at H level', () => {
    const text = 'https://example.com/with-logo'
    const res = createMatrix(text, 'H', LOGO_MIN_VERSION)
    if (!res.ok) throw new Error(res.error)
    expect(decodeRgba(rasterize(res.matrix, { logoArea: 0.08, scale: 8 }))?.text).toBe(text)
  })

  it('decodes inverted colors, colored codes and codes without a quiet zone', () => {
    expect(roundTrip('inverted', 'M', { fg: [255, 255, 255], bg: [0, 0, 0] })).toBe('inverted')
    expect(roundTrip('colored', 'M', { fg: [0, 60, 140], bg: [250, 240, 200] })).toBe('colored')
    expect(roundTrip('no margin', 'M', { margin: 0 })).toBe('no margin')
  })

  it('decodes large images via downscaling and tiny images via upscaling', () => {
    const res = createMatrix('big picture', 'M')
    if (!res.ok) throw new Error(res.error)
    const big = decodeRgba(rasterize(res.matrix, { scale: 60 }))
    expect(big?.text).toBe('big picture')
    // 角点映射回原图坐标
    expect(big!.corners[0].x).toBeGreaterThan(200)
    expect(big!.corners[2].x).toBeLessThan(big!.corners[0].x + 60 * res.matrix.size + 60)
    expect(decodeRgba(rasterize(res.matrix, { scale: 2 }))?.text).toBe('big picture')
  })

  it('returns null for images without a QR code', () => {
    const W = 200
    const noise = new Uint8ClampedArray(W * W * 4)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256
    expect(decodeRgba({ data: noise, width: W, height: W })).toBeNull()
    expect(decodeRgba({ data: new Uint8ClampedArray(16), width: 2, height: 2 })).toBeNull()
  })
})

describe('parsePayload', () => {
  it('recognises the common payload kinds', () => {
    expect(parsePayload('https://example.com/x')).toMatchObject({
      kind: 'url',
      href: 'https://example.com/x',
    })
    expect(parsePayload('javascript:alert(1)')).toMatchObject({ kind: 'text' })
    expect(parsePayload('javascript:alert(1)').href).toBeUndefined()
    expect(parsePayload('WIFI:T:WPA;S:Cafe\\;1;P:pw;H:true;;')).toEqual({
      kind: 'wifi',
      label: 'Wi-Fi',
      fields: [
        ['网络名称', 'Cafe;1'],
        ['加密', 'WPA'],
        ['密码', 'pw'],
        ['隐藏网络', '是'],
      ],
    })
    const v = parsePayload(
      buildVCard({
        ...EMPTY_TEMPLATE_DATA.vcard,
        lastName: '李',
        firstName: '四',
        org: 'A;B',
        note: 'x\ny',
      }),
    )
    expect(v.kind).toBe('vcard')
    expect(v.fields).toEqual([
      ['姓名', '李四'],
      ['公司', 'A;B'],
      ['备注', 'x\ny'],
    ])
    expect(
      parsePayload(buildMailto({ to: 'a@b.c', subject: '主题', body: 'l1\nl2' })).fields,
    ).toEqual([
      ['收件人', 'a@b.c'],
      ['主题', '主题'],
      ['正文', 'l1\r\nl2'],
    ])
    expect(parsePayload('SMSTO:10086:查询话费').fields).toEqual([
      ['号码', '10086'],
      ['内容', '查询话费'],
    ])
    expect(parsePayload('sms:10086?body=hi%20there').fields[1]).toEqual(['内容', 'hi there'])
    expect(parsePayload('tel:+8613800138000').kind).toBe('tel')
    expect(parsePayload('geo:39.9,116.4').fields).toEqual([
      ['纬度', '39.9'],
      ['经度', '116.4'],
    ])
    expect(parsePayload('MECARD:N:王五;TEL:123;;').fields).toEqual([
      ['姓名', '王五'],
      ['电话', '123'],
    ])
    expect(parsePayload('随便一段文字').kind).toBe('text')
    expect(parsePayload('').kind).toBe('text')
  })

  it('keeps + in mailto addresses and unencoded ? / = in the body (regression)', () => {
    expect(parsePayload('mailto:user+tag@example.com?subject=a+b&body=x=1?y').fields).toEqual([
      ['收件人', 'user+tag@example.com'],
      ['主题', 'a+b'],
      ['正文', 'x=1?y'],
    ])
    expect(parsePayload('mailto:a@b.c').fields).toEqual([['收件人', 'a@b.c']])
    // 短信的 body 按表单编码，+ 仍当空格
    expect(parsePayload('sms:10086?body=hi+there').fields[1]).toEqual(['内容', 'hi there'])
  })

  it('reads grouped and quoted-printable vCard properties (regression)', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0;=E4=B8=89;;;',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=E4=B8=89',
      'ORG;CHARSET=UTF-8;QUOTED-PRINTABLE:=E7=A4=BA=E4=BE=8B=E5=85=AC=E5=8F=B8 =',
      'Ltd',
      'item1.TEL;TYPE=CELL:+86 138 0013 8000',
      'item2.EMAIL;TYPE=INTERNET:zs@example.com',
      'NOTE:50=50 split',
      'END:VCARD',
    ].join('\r\n')
    expect(parsePayload(card).fields).toEqual([
      ['姓名', '张三'],
      ['公司', '示例公司 Ltd'],
      ['电话', '+86 138 0013 8000'],
      ['邮箱', 'zs@example.com'],
      ['备注', '50=50 split'],
    ])
  })
})

describe('capacity (regression)', () => {
  it('accepts long numeric content that only fits in numeric mode', () => {
    const digits = '7'.repeat(3000)
    const r = createMatrix(digits, 'L')
    expect(r.ok).toBe(true)
    expect(createMatrix('7'.repeat(7089), 'L').ok).toBe(true)
    const tooMany = createMatrix('7'.repeat(7090), 'L')
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) expect(tooMany.error).toMatch(/^内容过长：7,090 字节/)
  })

  it('reports byte counts for long unicode text', () => {
    const r = createMatrix('中'.repeat(1200), 'M')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('3,600 字节')
      expect(r.error).toContain('可以降低容错级别')
    }
  })
})

describe('colors', () => {
  it('parses and normalises hex colors', () => {
    expect(parseHex('#abc')).toEqual([170, 187, 204])
    expect(parseHex('0071E3')).toEqual([0, 113, 227])
    expect(parseHex('#12345')).toBeNull()
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('red')).toBeNull()
  })

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777', '#fff')).toBeCloseTo(4.48, 1)
    expect(contrastRatio('bad', '#fff')).toBeCloseTo(2.12, 1) // #bbaadd 也是合法颜色
    expect(contrastRatio('nope', '#fff')).toBeNull()
  })

  it('warns about low contrast and inverted codes', () => {
    expect(colorWarning('#000000', '#ffffff')).toBeNull()
    expect(colorWarning('#cccccc', '#ffffff')).toContain('对比度')
    expect(colorWarning('#ffffff', '#000000')).toContain('反色')
    expect(colorWarning('#808080', '#ffffff')).toContain('偏低')
    expect(colorWarning('nope', '#ffffff')).toContain('无效')
  })
})

describe('decode attempts', () => {
  it('fast mode makes a single attempt', () => {
    const res = createMatrix('fast', 'M')
    if (!res.ok) throw new Error(res.error)
    expect(decodeRgba(rasterize(res.matrix), { fast: true })?.text).toBe('fast')
  })

  it('treats transparent pixels as white', () => {
    const res = createMatrix('alpha', 'M')
    if (!res.ok) throw new Error(res.error)
    const img = rasterize(res.matrix)
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i] === 255) img.data[i + 3] = 0 // 背景透明
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0
    }
    expect(decodeRgba(img)?.text).toBe('alpha')
  })
})
