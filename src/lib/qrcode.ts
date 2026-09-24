/**
 * 二维码生成（纯逻辑，无 DOM 依赖）：
 * - 内容模板：文本 / 网址、Wi-Fi、vCard 3.0 名片、邮件、短信、电话
 * - 用 QRCode.create() 得到模块矩阵，自己拼出 SVG 路径（方块 / 圆点 / 圆角码点，三种码眼）
 * - 中心 Logo 挖空（面积 ≤ 20%），颜色对比度检查
 */

import QRCode from 'qrcode'

/* ───────────────────────── 内容模板 ───────────────────────── */

export type QrTemplate = 'text' | 'wifi' | 'vcard' | 'email' | 'sms' | 'tel'
export type WifiSecurity = 'WPA' | 'WEP' | 'nopass'

export interface WifiData {
  ssid: string
  password: string
  security: WifiSecurity
  hidden: boolean
}

export interface VCardData {
  lastName: string
  firstName: string
  org: string
  title: string
  mobile: string
  phone: string
  email: string
  url: string
  address: string
  note: string
}

export interface EmailData {
  to: string
  subject: string
  body: string
}

export interface SmsData {
  phone: string
  message: string
}

export interface TemplateData {
  text: string
  wifi: WifiData
  vcard: VCardData
  email: EmailData
  sms: SmsData
  tel: { phone: string }
}

export const EMPTY_TEMPLATE_DATA: TemplateData = {
  text: '',
  wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  vcard: {
    lastName: '',
    firstName: '',
    org: '',
    title: '',
    mobile: '',
    phone: '',
    email: '',
    url: '',
    address: '',
    note: '',
  },
  email: { to: '', subject: '', body: '' },
  sms: { phone: '', message: '' },
  tel: { phone: '' },
}

/** Wi-Fi 字段转义：\ ; , : " 前加反斜杠 */
export function escapeWifi(s: string): string {
  return s.replace(/([\\;,:"])/g, '\\$1')
}

export function buildWifi(d: WifiData): string {
  const parts = [`T:${d.security}`, `S:${escapeWifi(d.ssid)}`]
  if (d.security !== 'nopass') parts.push(`P:${escapeWifi(d.password)}`)
  parts.push(`H:${d.hidden ? 'true' : 'false'}`)
  return `WIFI:${parts.join(';')};;`
}

/** vCard 文本值转义（RFC 2426）：\ , ; 换行 */
export function escapeVCard(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const hasCJK = (s: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s)

export function vcardFullName(d: Pick<VCardData, 'lastName' | 'firstName'>): string {
  const last = d.lastName.trim()
  const first = d.firstName.trim()
  if (!last || !first) return last || first
  // 中日韩姓名：姓在前、不加空格；西文：名在前
  return hasCJK(last + first) ? last + first : `${first} ${last}`
}

export function buildVCard(d: VCardData): string {
  const e = (s: string) => escapeVCard(s.trim())
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  const fn = vcardFullName(d) || d.org.trim()
  lines.push(`N:${e(d.lastName)};${e(d.firstName)};;;`)
  lines.push(`FN:${e(fn)}`)
  if (d.org.trim()) lines.push(`ORG:${e(d.org)}`)
  if (d.title.trim()) lines.push(`TITLE:${e(d.title)}`)
  if (d.mobile.trim()) lines.push(`TEL;TYPE=CELL:${e(d.mobile)}`)
  if (d.phone.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${e(d.phone)}`)
  if (d.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${e(d.email)}`)
  if (d.url.trim()) lines.push(`URL:${e(d.url)}`)
  if (d.address.trim()) lines.push(`ADR;TYPE=WORK:;;${e(d.address)};;;;`)
  if (d.note.trim()) lines.push(`NOTE:${e(d.note)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/** RFC 6068：换行编码为 %0D%0A */
function mailtoEncode(s: string): string {
  return encodeURIComponent(s.replace(/\r\n|\r|\n/g, '\r\n'))
}

export function buildMailto(d: EmailData): string {
  const to = d.to
    .split(/[,;，；\s]+/)
    .filter(Boolean)
    .map((a) => encodeURIComponent(a).replace(/%40/g, '@'))
    .join(',')
  const q: string[] = []
  if (d.subject) q.push(`subject=${mailtoEncode(d.subject)}`)
  if (d.body) q.push(`body=${mailtoEncode(d.body)}`)
  return `mailto:${to}${q.length ? '?' + q.join('&') : ''}`
}

/** 电话号码只保留数字、+、*、#（去掉空格、横线、括号） */
export function normalizePhone(s: string): string {
  return s.replace(/[^\d+*#]/g, '')
}

export function buildSms(d: SmsData): string {
  return `SMSTO:${normalizePhone(d.phone)}:${d.message}`
}

export function buildTel(phone: string): string {
  return `tel:${normalizePhone(phone)}`
}

export interface PayloadResult {
  text: string
  /** 无法生成时的原因 */
  error?: string
  /** 能生成但值得提醒的问题 */
  warnings: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d*#]{3,20}$/

/** 按模板拼出二维码内容，附带校验结果 */
export function buildPayload(t: QrTemplate, d: TemplateData): PayloadResult {
  const warnings: string[] = []
  switch (t) {
    case 'text': {
      const text = d.text
      const s = text.trim()
      if (s && !/^[a-z][a-z\d+.-]*:/i.test(s) && /^(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) {
        warnings.push('看起来是网址，建议加上 https:// 前缀，否则部分扫码软件只会把它当作文本。')
      }
      return { text, warnings }
    }
    case 'wifi': {
      const w = d.wifi
      if (!w.ssid) return { text: '', error: '请填写 Wi-Fi 名称（SSID）。', warnings }
      if (w.security === 'WPA' && w.password && (w.password.length < 8 || w.password.length > 63)) {
        warnings.push('WPA/WPA2 密码通常为 8–63 个字符，请确认密码是否正确。')
      }
      if (w.security === 'WPA' && !w.password) {
        warnings.push('加密方式为 WPA 但未填写密码；如果网络没有密码请选择「无密码」。')
      }
      if (w.security === 'WEP' && ![5, 10, 13, 26].includes(w.password.length)) {
        warnings.push('WEP 密码应为 5 / 13 个字符或 10 / 26 位十六进制数。')
      }
      return { text: buildWifi(w), warnings }
    }
    case 'vcard': {
      const v = d.vcard
      if (!vcardFullName(v) && !v.org.trim()) {
        return { text: '', error: '请至少填写姓名或公司。', warnings }
      }
      if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) warnings.push('邮箱格式看起来不对。')
      return { text: buildVCard(v), warnings }
    }
    case 'email': {
      const e = d.email
      const addrs = e.to.split(/[,;，；\s]+/).filter(Boolean)
      if (!addrs.length && !e.subject && !e.body) {
        return { text: '', error: '请填写收件人、主题或正文。', warnings }
      }
      const bad = addrs.filter((a) => !EMAIL_RE.test(a))
      if (bad.length) warnings.push(`邮箱地址格式看起来不对：${bad.join('、')}`)
      if (!addrs.length) warnings.push('未填写收件人，扫码后需要手动输入。')
      return { text: buildMailto(e), warnings }
    }
    case 'sms': {
      const p = normalizePhone(d.sms.phone)
      if (!p) return { text: '', error: '请填写接收短信的手机号。', warnings }
      if (!PHONE_RE.test(p)) warnings.push('手机号格式看起来不对。')
      return { text: buildSms(d.sms), warnings }
    }
    case 'tel': {
      const p = normalizePhone(d.tel.phone)
      if (!p) return { text: '', error: '请填写电话号码。', warnings }
      if (!PHONE_RE.test(p)) warnings.push('电话号码格式看起来不对。')
      return { text: buildTel(d.tel.phone), warnings }
    }
  }
}

/* ───────────────────────── 矩阵 ───────────────────────── */

export type Ecl = 'L' | 'M' | 'Q' | 'H'

/** 版本 40 在字节模式下的最大容量（字节） */
export const QR_CAPACITY_BYTES: Record<Ecl, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 }
/** 版本 40 在纯数字模式下的最大容量（位数） */
export const QR_CAPACITY_NUMERIC: Record<Ecl, number> = { L: 7089, M: 5596, Q: 3993, H: 3057 }

export const ECL_INFO: Record<Ecl, { label: string; recovery: string }> = {
  L: { label: 'L', recovery: '约 7%' },
  M: { label: 'M', recovery: '约 15%' },
  Q: { label: 'Q', recovery: '约 25%' },
  H: { label: 'H', recovery: '约 30%' },
}

export interface QrMatrix {
  size: number
  version: number
  /** 按 [row * size + col] 存放，1 = 深色 */
  dark: Uint8Array
  /** 功能图形（定位、时序、校正、格式信息） */
  reserved: Uint8Array
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length
}

export type MatrixResult = { ok: true; matrix: QrMatrix } | { ok: false; error: string }

/**
 * 生成模块矩阵。minVersion 用于放 Logo 时保证码足够大、Logo 不压到定位图形。
 */
export function createMatrix(text: string, ecl: Ecl, minVersion = 1): MatrixResult {
  if (!text) return { ok: false, error: '内容为空' }
  const tooLong = (): MatrixResult => {
    const bytes = utf8Length(text)
    return {
      ok: false,
      error: `内容过长：${bytes.toLocaleString()} 字节，超出 ${ecl} 级容错的容量（普通文本上限 ${QR_CAPACITY_BYTES[ecl].toLocaleString()} 字节，纯数字可达 ${QR_CAPACITY_NUMERIC[ecl].toLocaleString()} 位）。${
        ecl === 'L' ? '请缩短内容。' : '可以降低容错级别或缩短内容。'
      }`,
    }
  }
  // 纯数字、大写字母数字模式比字节模式能装更多，所以不能只按字节数预判；
  // 超过数字模式的绝对上限时才直接拒绝，其余交给编码器判断
  if (text.length > QR_CAPACITY_NUMERIC[ecl]) return tooLong()
  try {
    let qr = QRCode.create(text, { errorCorrectionLevel: ecl })
    if (qr.version < minVersion) {
      qr = QRCode.create(text, { errorCorrectionLevel: ecl, version: minVersion })
    }
    const m = qr.modules
    return {
      ok: true,
      matrix: {
        size: m.size,
        version: qr.version,
        dark: Uint8Array.from(m.data, (v) => (v ? 1 : 0)),
        reserved: Uint8Array.from(m.reservedBit, (v) => (v ? 1 : 0)),
      },
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/too big/i.test(msg)) return tooLong()
    return { ok: false, error: `生成失败：${msg}` }
  }
}

/* ───────────────────────── Logo ───────────────────────── */

/** Logo 面积上限（占码区面积的比例） */
export const LOGO_MAX_AREA = 0.2
/** 放 Logo 时的最小版本，保证挖空区域不碰到定位图形 */
export const LOGO_MIN_VERSION = 4

export interface LogoBox {
  /** 左上角（模块坐标，不含留白） */
  start: number
  /** 边长（模块数，与码的边长同奇偶，保证居中对齐网格） */
  size: number
}

/** 按面积比例算出居中的挖空区域，面积不超过 LOGO_MAX_AREA */
export function logoBox(qrSize: number, areaRatio: number): LogoBox {
  const ratio = Math.min(LOGO_MAX_AREA, Math.max(0, areaRatio))
  let k = Math.round(Math.sqrt(ratio) * qrSize)
  if ((k - qrSize) % 2 !== 0) k -= 1
  while (k > 0 && k * k > LOGO_MAX_AREA * qrSize * qrSize) k -= 2
  k = Math.max(0, k)
  return { start: (qrSize - k) / 2, size: k }
}

/* ───────────────────────── 几何 / SVG ───────────────────────── */

export type ModuleStyle = 'square' | 'dots' | 'rounded'
export type EyeStyle = 'square' | 'rounded' | 'circle'

export interface GeometryOptions {
  /** 留白（模块数） */
  margin: number
  moduleStyle: ModuleStyle
  eyeStyle: EyeStyle
  /** 有 Logo 时的面积比例 */
  logoArea?: number
}

export interface QrGeometry {
  /** 画布边长（模块数，含两侧留白） */
  dim: number
  modules: string
  /** 码眼外框（需 evenodd 填充） */
  eyeOuter: string
  eyeInner: string
  /** Logo 区域（画布坐标，模块单位） */
  logo?: { x: number; y: number; size: number; radius: number; inset: number }
  /** 实际绘制的深色码点数 */
  drawn: number
}

const f = (n: number) => String(Math.round(n * 1000) / 1000)

function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  if (rr <= 0) return rectPath(x, y, w, h)
  return (
    `M${f(x + rr)} ${f(y)}h${f(w - 2 * rr)}a${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} ${f(rr)}` +
    `v${f(h - 2 * rr)}a${f(rr)} ${f(rr)} 0 0 1 ${f(-rr)} ${f(rr)}` +
    `h${f(-(w - 2 * rr))}a${f(rr)} ${f(rr)} 0 0 1 ${f(-rr)} ${f(-rr)}` +
    `v${f(-(h - 2 * rr))}a${f(rr)} ${f(rr)} 0 0 1 ${f(rr)} ${f(-rr)}z`
  )
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0z`
}

/** 单个码点：四个角分别决定是否圆角 */
function moduleCornerPath(
  x: number,
  y: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
): string {
  let d = `M${f(x + tl)} ${f(y)}h${f(1 - tl - tr)}`
  if (tr) d += `a${f(tr)} ${f(tr)} 0 0 1 ${f(tr)} ${f(tr)}`
  d += `v${f(1 - tr - br)}`
  if (br) d += `a${f(br)} ${f(br)} 0 0 1 ${f(-br)} ${f(br)}`
  d += `h${f(-(1 - br - bl))}`
  if (bl) d += `a${f(bl)} ${f(bl)} 0 0 1 ${f(-bl)} ${f(-bl)}`
  d += `v${f(-(1 - bl - tl))}`
  if (tl) d += `a${f(tl)} ${f(tl)} 0 0 1 ${f(tl)} ${f(-tl)}`
  return d + 'z'
}

/** 是否位于三个定位图形（7×7）内 */
export function inFinder(r: number, c: number, size: number): boolean {
  return (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7)
}

/** 校正图形中心的行列坐标（与 QR 规范 / qrcode 库一致） */
export function alignmentCoords(version: number): number[] {
  if (version < 2) return []
  const count = Math.floor(version / 7) + 2
  const size = version * 4 + 17
  const interval = size === 145 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2
  const pos = [size - 7]
  for (let i = 1; i < count - 1; i++) pos[i] = pos[i - 1] - interval
  pos.push(6)
  return pos.reverse()
}

/** 所有校正图形中心（去掉与定位图形重叠的三个角） */
export function alignmentCenters(version: number): [number, number][] {
  const coords = alignmentCoords(version)
  const last = coords.length - 1
  const out: [number, number][] = []
  coords.forEach((r, i) =>
    coords.forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      out.push([r, c])
    }),
  )
  return out
}

/**
 * 最终要画的深色码点（去掉定位图形、Logo 挖空区；skipAlignment 时再去掉校正图形，
 * 由调用方整体绘制——圆点风格下校正图形若也画成圆点，识别率会明显下降）
 */
export function drawnModules(m: QrMatrix, box?: LogoBox, skipAlignment = false): Uint8Array {
  const { size } = m
  const out = new Uint8Array(size * size)
  const align = new Uint8Array(size * size)
  if (skipAlignment) {
    for (const [cr, cc] of alignmentCenters(m.version)) {
      for (let r = cr - 2; r <= cr + 2; r++)
        for (let c = cc - 2; c <= cc + 2; c++) align[r * size + c] = 1
    }
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!m.dark[r * size + c] || inFinder(r, c, size) || align[r * size + c]) continue
      if (
        box &&
        box.size > 0 &&
        r >= box.start &&
        r < box.start + box.size &&
        c >= box.start &&
        c < box.start + box.size
      ) {
        continue
      }
      out[r * size + c] = 1
    }
  }
  return out
}

export function buildGeometry(m: QrMatrix, o: GeometryOptions): QrGeometry {
  const { size } = m
  const margin = Math.max(0, Math.round(o.margin))
  const dim = size + margin * 2
  const box = o.logoArea ? logoBox(size, o.logoArea) : undefined
  const solidAlignment = o.moduleStyle === 'dots'
  const draw = drawnModules(m, box, solidAlignment)
  const at = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < size && c < size && draw[r * size + c] === 1

  const parts: string[] = []
  let drawn = 0
  for (let r = 0; r < size; r++) {
    if (o.moduleStyle === 'square') {
      // 同一行连续的码点合并成一个矩形，路径更短、边缘无缝
      let c = 0
      while (c < size) {
        if (!at(r, c)) {
          c++
          continue
        }
        const start = c
        while (c < size && at(r, c)) c++
        drawn += c - start
        parts.push(rectPath(start + margin, r + margin, c - start, 1))
      }
      continue
    }
    for (let c = 0; c < size; c++) {
      if (!at(r, c)) continue
      drawn++
      const x = c + margin
      const y = r + margin
      if (o.moduleStyle === 'dots') {
        parts.push(circlePath(x + 0.5, y + 0.5, 0.45))
      } else {
        const up = at(r - 1, c)
        const down = at(r + 1, c)
        const left = at(r, c - 1)
        const right = at(r, c + 1)
        const R = 0.5
        parts.push(
          moduleCornerPath(
            x,
            y,
            !up && !left ? R : 0,
            !up && !right ? R : 0,
            !down && !right ? R : 0,
            !down && !left ? R : 0,
          ),
        )
      }
    }
  }

  const outer: string[] = []
  const inner: string[] = []
  const corners: [number, number][] = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]
  for (const [cx, cy] of corners) {
    const x = cx + margin
    const y = cy + margin
    switch (o.eyeStyle) {
      case 'circle':
        outer.push(circlePath(x + 3.5, y + 3.5, 3.5), circlePath(x + 3.5, y + 3.5, 2.5))
        inner.push(circlePath(x + 3.5, y + 3.5, 1.5))
        break
      case 'rounded':
        outer.push(roundedRectPath(x, y, 7, 7, 2.2), roundedRectPath(x + 1, y + 1, 5, 5, 1.4))
        inner.push(roundedRectPath(x + 2, y + 2, 3, 3, 0.9))
        break
      default:
        outer.push(rectPath(x, y, 7, 7), rectPath(x + 1, y + 1, 5, 5))
        inner.push(rectPath(x + 2, y + 2, 3, 3))
    }
  }

  // 圆点风格：校正图形按码眼样式整体绘制（5×5 外环 + 中心点）
  if (solidAlignment) {
    for (const [r, c] of alignmentCenters(m.version)) {
      const x = c - 2 + margin
      const y = r - 2 + margin
      switch (o.eyeStyle) {
        case 'circle':
          outer.push(circlePath(x + 2.5, y + 2.5, 2.5), circlePath(x + 2.5, y + 2.5, 1.5))
          inner.push(circlePath(x + 2.5, y + 2.5, 0.5))
          break
        case 'rounded':
          outer.push(roundedRectPath(x, y, 5, 5, 1.6), roundedRectPath(x + 1, y + 1, 3, 3, 0.8))
          inner.push(roundedRectPath(x + 2, y + 2, 1, 1, 0.3))
          break
        default:
          outer.push(rectPath(x, y, 5, 5), rectPath(x + 1, y + 1, 3, 3))
          inner.push(rectPath(x + 2, y + 2, 1, 1))
      }
    }
  }

  const geo: QrGeometry = {
    dim,
    modules: parts.join(''),
    eyeOuter: outer.join(''),
    eyeInner: inner.join(''),
    drawn,
  }
  if (box && box.size > 0) {
    geo.logo = {
      x: box.start + margin,
      y: box.start + margin,
      size: box.size,
      radius: box.size * 0.2,
      inset: Math.max(0.6, box.size * 0.1),
    }
  }
  return geo
}

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export interface SvgOptions {
  fg: string
  bg: string
  /** 输出宽高（像素） */
  size: number
  logoHref?: string
  moduleStyle?: ModuleStyle
}

/** 独立的 SVG 文件文本 */
export function renderSvg(g: QrGeometry, o: SvgOptions): string {
  const fg = escAttr(o.fg)
  const bg = escAttr(o.bg)
  const crisp = o.moduleStyle === 'square' ? ' shape-rendering="crispEdges"' : ''
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.dim} ${g.dim}" width="${o.size}" height="${o.size}">`,
    `<rect width="${g.dim}" height="${g.dim}" fill="${bg}"/>`,
  ]
  if (g.modules) out.push(`<path d="${g.modules}" fill="${fg}"${crisp}/>`)
  out.push(`<path d="${g.eyeOuter}" fill="${fg}" fill-rule="evenodd"/>`)
  out.push(`<path d="${g.eyeInner}" fill="${fg}"/>`)
  if (g.logo && o.logoHref) {
    const { x, y, size, radius, inset } = g.logo
    out.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(size)}" height="${f(size)}" rx="${f(radius)}" fill="${bg}"/>`,
      `<image href="${escAttr(o.logoHref)}" x="${f(x + inset)}" y="${f(y + inset)}" width="${f(size - inset * 2)}" height="${f(size - inset * 2)}" preserveAspectRatio="xMidYMid meet"/>`,
    )
  }
  out.push('</svg>')
  return out.join('\n')
}

/* ───────────────────────── 颜色 ───────────────────────── */

/** #rgb / #rrggbb → [r, g, b]；无效返回 null */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex)
  return rgb ? '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') : null
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 对比度 1–21 */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return null
  const la = relativeLuminance(ca)
  const lb = relativeLuminance(cb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 颜色搭配是否影响识别 */
export function colorWarning(fg: string, bg: string): string | null {
  const ratio = contrastRatio(fg, bg)
  if (ratio === null) return '颜色格式无效，请使用 #RRGGBB。'
  const lf = relativeLuminance(parseHex(fg)!)
  const lb = relativeLuminance(parseHex(bg)!)
  if (ratio < 3) {
    return `前景与背景对比度只有 ${ratio.toFixed(1)}:1，很可能扫不出来，建议至少 4:1。`
  }
  if (lf > lb) {
    return '前景比背景浅（反色二维码），部分扫码软件无法识别，建议深色前景 + 浅色背景。'
  }
  if (ratio < 4) {
    return `对比度 ${ratio.toFixed(1)}:1 偏低，在光线较暗或屏幕反光时可能难以识别。`
  }
  return null
}
