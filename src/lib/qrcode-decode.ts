/**
 * 二维码识别（纯逻辑）：在 RGBA 像素上多次尝试 jsQR（原图 / 缩小 / 放大 / 补白边 / 反色），
 * 并把识别出的内容解析成网址、Wi-Fi、名片等结构化信息。
 */

import jsQR from 'jsqr'

export interface Point {
  x: number
  y: number
}

export interface DecodeResult {
  text: string
  version: number
  /** 四个角（原图像素坐标）：左上、右上、右下、左下 */
  corners: [Point, Point, Point, Point]
}

export interface Rgba {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 按比例缩放（缩小用区域平均，放大用最近邻） */
export function resizeRgba(src: Rgba, scale: number): Rgba {
  const width = Math.max(1, Math.round(src.width * scale))
  const height = Math.max(1, Math.round(src.height * scale))
  const out = new Uint8ClampedArray(width * height * 4)
  const sx = src.width / width
  const sy = src.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4
          r += src.data[i]
          g += src.data[i + 1]
          b += src.data[i + 2]
          a += src.data[i + 3]
          n++
        }
      }
      const o = (y * width + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { data: out, width, height }
}

/** 四周补白边（紧贴裁剪、没有留白的二维码 jsQR 常识别不了） */
export function padRgba(src: Rgba, pad: number, fill = 255): Rgba {
  const width = src.width + pad * 2
  const height = src.height + pad * 2
  const out = new Uint8ClampedArray(width * height * 4).fill(fill)
  for (let y = 0; y < src.height; y++) {
    out.set(
      src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4),
      ((y + pad) * width + pad) * 4,
    )
  }
  return { data: out, width, height }
}

/** 透明像素按白色处理（透明背景的 PNG 二维码） */
export function flattenAlpha(src: Rgba): Rgba {
  const d = src.data
  let hasAlpha = false
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 255) {
      hasAlpha = true
      break
    }
  }
  if (!hasAlpha) return src
  const out = new Uint8ClampedArray(d.length)
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    out[i] = d[i] * a + 255 * (1 - a)
    out[i + 1] = d[i + 1] * a + 255 * (1 - a)
    out[i + 2] = d[i + 2] * a + 255 * (1 - a)
    out[i + 3] = 255
  }
  return { data: out, width: src.width, height: src.height }
}

interface Attempt {
  scale: number
  pad: number
}

/**
 * 生成尝试序列：原图（过大时先缩到 1000）→ 逐级缩小（缩小相当于模糊，圆点风格的码更容易识别）
 * → 小图放大 → 最后补白边重试。
 */
export function decodeAttempts(width: number, height: number): Attempt[] {
  const maxSide = Math.max(width, height)
  const sides: number[] = [Math.min(maxSide, 1000)]
  for (const t of [700, 450, 320]) if (t < sides[sides.length - 1] * 0.85) sides.push(t)
  if (maxSide < 300) sides.push(Math.min(maxSide * 4, 600))
  const scales = sides.map((side) => side / maxSide)
  const attempts: Attempt[] = scales.map((scale) => ({ scale, pad: 0 }))
  for (const scale of scales) {
    attempts.push({ scale, pad: Math.round(maxSide * scale * 0.1) + 8 })
  }
  return attempts
}

/** 摄像头逐帧扫描用的轻量尝试：原帧 + 缩小一档 */
function fastAttempts(width: number, height: number): Attempt[] {
  const maxSide = Math.max(width, height)
  return maxSide > 500
    ? [
        { scale: 1, pad: 0 },
        { scale: 400 / maxSide, pad: 0 },
      ]
    : [{ scale: 1, pad: 0 }]
}

/**
 * 识别 RGBA 图像里的二维码。fast = true 时只做少量尝试（摄像头逐帧扫描用）。
 */
export function decodeRgba(input: Rgba, opts: { fast?: boolean } = {}): DecodeResult | null {
  if (input.width < 8 || input.height < 8) return null
  const src = opts.fast ? input : flattenAlpha(input)
  const attempts = opts.fast
    ? fastAttempts(src.width, src.height)
    : decodeAttempts(src.width, src.height)
  for (const { scale, pad } of attempts) {
    let img = scale === 1 ? src : resizeRgba(src, scale)
    if (pad) img = padRgba(img, pad)
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
    if (r && r.data) {
      const sx = img.width - pad * 2
      const kx = src.width / sx
      const ky = src.height / (img.height - pad * 2)
      const map = (p: Point): Point => ({ x: (p.x - pad) * kx, y: (p.y - pad) * ky })
      const l = r.location
      return {
        text: r.data,
        version: r.version,
        corners: [
          map(l.topLeftCorner),
          map(l.topRightCorner),
          map(l.bottomRightCorner),
          map(l.bottomLeftCorner),
        ],
      }
    }
  }
  return null
}

/* ───────────────────────── 内容解析 ───────────────────────── */

export type PayloadKind = 'url' | 'wifi' | 'vcard' | 'email' | 'sms' | 'tel' | 'geo' | 'text'

export interface ParsedPayload {
  kind: PayloadKind
  label: string
  fields: [string, string][]
  /** 可安全打开的 http(s) 链接 */
  href?: string
}

/** 按未转义的分隔符切分（支持反斜杠转义） */
function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < s.length) {
      cur += s[++i]
    } else if (ch === sep) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

export function parseWifi(text: string): Record<string, string> | null {
  if (!/^WIFI:/i.test(text)) return null
  const out: Record<string, string> = {}
  // 先按未转义的 ; 切分但保留转义，才能区分 "abc"（引号包裹）与 \"abc\"（字面引号）
  const raw: string[] = []
  let cur = ''
  const body = text.slice(5)
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && i + 1 < body.length) cur += ch + body[++i]
    else if (ch === ';') {
      raw.push(cur)
      cur = ''
    } else cur += ch
  }
  raw.push(cur)
  for (const part of raw) {
    const i = part.indexOf(':')
    if (i <= 0) continue
    let value = part.slice(i + 1)
    // 部分生成器把 SSID / 密码写成 "..."（避免被当成十六进制），显示时去掉
    const quoted = /^"(.*)"$/s.exec(value)
    if (quoted && !quoted[1].endsWith('\\')) value = quoted[1]
    out[part.slice(0, i).toUpperCase()] = value.replace(/\\(.)/gs, '$1')
  }
  return out
}

function unescapeVCard(s: string): string {
  return s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** vCard 2.1 常见的 Quoted-Printable 编码（安卓导出的中文名片）：=E5=BC=A0 → 张 */
function decodeQuotedPrintable(s: string): string {
  return s.replace(/(?:=[\da-f]{2})+/gi, (run) => {
    const bytes = new Uint8Array(run.length / 3)
    for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(run.slice(k * 3 + 1, k * 3 + 3), 16)
    return new TextDecoder().decode(bytes)
  })
}

export function parseVCard(text: string): [string, string][] {
  let normalized = text.replace(/\r\n|\r/g, '\n')
  // Quoted-Printable 的软换行：行尾 = 表示下一行接续
  if (/QUOTED-PRINTABLE/i.test(normalized)) normalized = normalized.replace(/=\n/g, '')
  // 折行：以空格或制表符开头的行接到上一行
  const lines = normalized.replace(/\n[ \t]/g, '').split('\n')
  const labels: Record<string, string> = {
    FN: '姓名',
    ORG: '公司',
    TITLE: '职位',
    TEL: '电话',
    EMAIL: '邮箱',
    URL: '网址',
    ADR: '地址',
    NOTE: '备注',
  }
  const out: [string, string][] = []
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const [name, ...params] = line.slice(0, i).split(';')
    // 去掉分组前缀（item1.TEL，iOS / 安卓导出常见）
    const key = name.replace(/^[\w-]+\./, '').toUpperCase()
    const label = labels[key]
    if (!label) continue
    let value = line.slice(i + 1)
    if (params.some((p) => /^(ENCODING=)?QUOTED-PRINTABLE$/i.test(p.trim()))) {
      value = decodeQuotedPrintable(value)
    }
    if (key === 'ADR' || key === 'ORG') {
      value = splitEscaped(value, ';').filter(Boolean).join(' ')
    }
    value = unescapeVCard(value).trim()
    if (value) out.push([label, value])
  }
  return out
}

/**
 * 百分号解码。plusAsSpace 只用于表单编码风格的查询参数（sms:?body=）；
 * mailto 按 RFC 6068，+ 是普通字符（如 user+tag@example.com），不能当空格。
 */
function safeDecode(s: string, plusAsSpace = false): string {
  try {
    return decodeURIComponent(plusAsSpace ? s.replace(/\+/g, '%20') : s)
  } catch {
    return s
  }
}

export function parsePayload(text: string): ParsedPayload {
  const t = text.trim()
  if (/^https?:\/\/\S+$/i.test(t)) {
    try {
      const u = new URL(t)
      return { kind: 'url', label: '网址', fields: [['域名', u.host]], href: u.href }
    } catch {
      // 不是合法 URL，按文本处理
    }
  }
  const wifi = parseWifi(t)
  if (wifi) {
    const sec = (wifi.T || 'nopass').toUpperCase()
    const fields: [string, string][] = [['网络名称', wifi.S ?? '']]
    fields.push(['加密', sec === 'NOPASS' ? '无密码' : sec])
    if (wifi.P) fields.push(['密码', wifi.P])
    if (wifi.H?.toLowerCase() === 'true') fields.push(['隐藏网络', '是'])
    return { kind: 'wifi', label: 'Wi-Fi', fields }
  }
  if (/^BEGIN:VCARD/i.test(t)) return { kind: 'vcard', label: '名片', fields: parseVCard(t) }
  if (/^MECARD:/i.test(t)) {
    const fields: [string, string][] = []
    const map: Record<string, string> = {
      N: '姓名',
      TEL: '电话',
      EMAIL: '邮箱',
      ADR: '地址',
      ORG: '公司',
      URL: '网址',
    }
    for (const part of splitEscaped(t.slice(7), ';')) {
      const i = part.indexOf(':')
      const key = part.slice(0, i).toUpperCase()
      if (i > 0 && map[key]) fields.push([map[key], part.slice(i + 1).replace(/,/g, ' ')])
    }
    return { kind: 'vcard', label: '名片', fields }
  }
  if (/^mailto:/i.test(t)) {
    // 只按第一个 ? / = 切分：正文里未编码的 ? 和 = 也要保留
    const rest = t.slice(7)
    const q = rest.indexOf('?')
    const addr = q < 0 ? rest : rest.slice(0, q)
    const fields: [string, string][] = [['收件人', safeDecode(addr)]]
    for (const kv of q < 0 ? [] : rest.slice(q + 1).split('&')) {
      const e = kv.indexOf('=')
      const k = (e < 0 ? kv : kv.slice(0, e)).toLowerCase()
      const v = e < 0 ? '' : kv.slice(e + 1)
      if (k === 'subject') fields.push(['主题', safeDecode(v)])
      if (k === 'body') fields.push(['正文', safeDecode(v)])
    }
    return { kind: 'email', label: '邮件', fields }
  }
  if (/^smsto:/i.test(t)) {
    const rest = t.slice(6)
    const i = rest.indexOf(':')
    const phone = i < 0 ? rest : rest.slice(0, i)
    const fields: [string, string][] = [['号码', phone]]
    if (i >= 0 && rest.slice(i + 1)) fields.push(['内容', rest.slice(i + 1)])
    return { kind: 'sms', label: '短信', fields }
  }
  if (/^sms:/i.test(t)) {
    const [phone, query = ''] = t.slice(4).split('?')
    const fields: [string, string][] = [['号码', phone]]
    const body = /(?:^|&)body=([^&]*)/i.exec(query)
    if (body) fields.push(['内容', safeDecode(body[1], true)])
    return { kind: 'sms', label: '短信', fields }
  }
  if (/^tel:/i.test(t)) return { kind: 'tel', label: '电话', fields: [['号码', t.slice(4)]] }
  if (/^geo:/i.test(t)) {
    const [lat, lng] = t.slice(4).split(/[,;?]/)
    return {
      kind: 'geo',
      label: '位置',
      fields: [
        ['纬度', lat ?? ''],
        ['经度', lng ?? ''],
      ],
    }
  }
  return { kind: 'text', label: '文本', fields: [] }
}
