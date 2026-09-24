/**
 * RSA 工具（无 DOM 依赖，浏览器与 Node 22 通用）：
 * - 纯 DER 运算：PEM ⇄ DER、PKCS#1 ⇄ PKCS#8 / SPKI、OpenSSH 公钥、JWK、从证书 / 私钥提取公钥
 * - Web Crypto：生成密钥对、RSA-OAEP 加解密、RSASSA-PKCS1-v1_5 / RSA-PSS 签名验签
 * 所有错误都抛出带中文说明的 RsaError。
 */

export class RsaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RsaError'
  }
}

// ═════════════════════════ 字节编码 ═════════════════════════

export type BinaryEncoding = 'base64' | 'hex'

export function bytesToBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function bytesToBase64Url(b: Uint8Array): string {
  return bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 宽松的 Base64 解码：忽略空白，兼容 URL 安全字符与缺省填充；出错时指出原文位置 */
export function base64ToBytes(input: string, what = '内容'): Uint8Array {
  let clean = ''
  let padStarted = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (/\s/.test(c)) continue
    if (c === '=') {
      padStarted = true
      continue
    }
    if (!/[A-Za-z0-9+/\-_]/.test(c)) {
      throw new RsaError(`${what}第 ${i + 1} 个字符「${c}」不是合法的 Base64 字符`)
    }
    if (padStarted) throw new RsaError(`${what}第 ${i + 1} 个字符出现在填充符「=」之后`)
    clean += c === '-' ? '+' : c === '_' ? '/' : c
  }
  if (!clean) throw new RsaError(`${what}为空`)
  if (clean.length % 4 === 1) {
    throw new RsaError(`${what}的 Base64 长度不正确（有效字符 ${clean.length} 个，可能被截断）`)
  }
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

/** 十六进制解码：忽略空白、冒号与 0x 前缀 */
export function hexToBytes(input: string, what = '内容'): Uint8Array {
  const prefix = /^\s*0x/i.exec(input)?.[0].length ?? 0
  let clean = ''
  for (let i = prefix; i < input.length; i++) {
    const c = input[i]
    if (/[\s:]/.test(c)) continue
    if (!/[0-9a-fA-F]/.test(c)) {
      // 位置按原始输入计算（含 0x 前缀），方便对照
      throw new RsaError(`${what}第 ${i + 1} 个字符「${c}」不是十六进制数字`)
    }
    clean += c
  }
  if (!clean) throw new RsaError(`${what}为空`)
  if (clean.length % 2) throw new RsaError(`${what}的十六进制长度为奇数（${clean.length} 位）`)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function decodeBinary(text: string, enc: BinaryEncoding, what = '内容'): Uint8Array {
  return enc === 'hex' ? hexToBytes(text, what) : base64ToBytes(text, what)
}

export function encodeBinary(b: Uint8Array, enc: BinaryEncoding): string {
  return enc === 'hex' ? bytesToHex(b) : bytesToBase64(b)
}

// ═════════════════════════ DER ═════════════════════════

interface Tlv {
  tag: number
  /** TLV 头的起点 */
  start: number
  /** 值的起止下标 [valueStart, end) */
  valueStart: number
  end: number
}

const TAG = {
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  SEQUENCE: 0x30,
}

function readTlv(b: Uint8Array, pos: number, limit = b.length): Tlv {
  if (pos + 2 > limit) throw new RsaError('DER 数据被截断')
  const tag = b[pos]
  let len = b[pos + 1]
  let p = pos + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0) throw new RsaError('不支持不定长编码（不是有效的 DER）')
    if (n > 4) throw new RsaError('DER 长度字段过大')
    if (p + n > limit) throw new RsaError('DER 数据被截断')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[p + i]
    p += n
  }
  if (p + len > limit)
    throw new RsaError(`DER 数据被截断（需要 ${p + len} 字节，只有 ${limit} 字节）`)
  return { tag, start: pos, valueStart: p, end: p + len }
}

function childrenOf(b: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = []
  let p = parent.valueStart
  while (p < parent.end) {
    const t = readTlv(b, p, parent.end)
    out.push(t)
    p = t.end
  }
  return out
}

function valueOf(b: Uint8Array, t: Tlv): Uint8Array {
  return b.subarray(t.valueStart, t.end)
}

function rootSequence(der: Uint8Array): Tlv {
  const root = readTlv(der, 0)
  if (root.tag !== TAG.SEQUENCE)
    throw new RsaError('不是 DER 编码的 ASN.1 结构（应以 SEQUENCE 开头）')
  return root
}

function encodeLength(n: number): number[] {
  if (n < 0x80) return [n]
  const bytes: number[] = []
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n = Math.floor(n / 256)
  }
  return [0x80 | bytes.length, ...bytes]
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function encodeTlv(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag, ...encodeLength(value.length)), value)
}

/** 无符号大端整数 → DER INTEGER（去掉多余前导 0，最高位为 1 时补 0） */
function encodeUnsignedInteger(bytes: Uint8Array): Uint8Array {
  let i = 0
  while (i < bytes.length - 1 && bytes[i] === 0) i++
  let v = bytes.subarray(i)
  if (v.length === 0) v = Uint8Array.of(0)
  if (v[0] & 0x80) v = concatBytes(Uint8Array.of(0), v)
  return encodeTlv(TAG.INTEGER, v)
}

/** DER INTEGER 的值 → 无符号大端字节（去掉符号位补的 0） */
function unsignedValue(b: Uint8Array): Uint8Array {
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  return b.subarray(i)
}

export function decodeOid(b: Uint8Array): string {
  if (!b.length) return ''
  const parts = [Math.floor(b[0] / 40), b[0] % 40]
  if (b[0] >= 80) {
    parts[0] = 2
    parts[1] = b[0] - 80
  }
  let v = 0
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f)
    if (!(b[i] & 0x80)) {
      parts.push(v)
      v = 0
    }
  }
  return parts.join('.')
}

const OID_RSA = '1.2.840.113549.1.1.1'
const OID_RSA_PSS = '1.2.840.113549.1.1.10'
const OTHER_KEY_OIDS: Record<string, string> = {
  '1.2.840.10045.2.1': 'EC（椭圆曲线）',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.2.840.10040.4.1': 'DSA',
  '1.2.840.10046.2.1': 'DH',
  '1.2.156.10197.1.301': 'SM2',
}

/** AlgorithmIdentifier { rsaEncryption, NULL } */
const RSA_ALG_ID = Uint8Array.of(
  0x30,
  0x0d,
  0x06,
  0x09,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x01,
  0x01,
  0x05,
  0x00,
)

function checkAlgorithm(der: Uint8Array, algId: Tlv): { pss: boolean } {
  const oidTlv = childrenOf(der, algId)[0]
  if (!oidTlv || oidTlv.tag !== TAG.OID) throw new RsaError('算法标识缺少 OID')
  const oid = decodeOid(valueOf(der, oidTlv))
  if (oid === OID_RSA) return { pss: false }
  if (oid === OID_RSA_PSS) return { pss: true }
  const name = OTHER_KEY_OIDS[oid]
  throw new RsaError(
    name
      ? `这是 ${name}${name.endsWith('）') ? '' : ' '}密钥，不是 RSA 密钥`
      : `不是 RSA 密钥（算法 OID 为 ${oid}）`,
  )
}

/** PKCS#1 RSAPrivateKey → PKCS#8 PrivateKeyInfo */
export function wrapPkcs1Private(pkcs1: Uint8Array): Uint8Array {
  return encodeTlv(
    TAG.SEQUENCE,
    concatBytes(Uint8Array.of(0x02, 0x01, 0x00), RSA_ALG_ID, encodeTlv(TAG.OCTET_STRING, pkcs1)),
  )
}

/** PKCS#1 RSAPublicKey → SPKI SubjectPublicKeyInfo */
export function wrapPkcs1Public(pkcs1: Uint8Array): Uint8Array {
  return encodeTlv(
    TAG.SEQUENCE,
    concatBytes(RSA_ALG_ID, encodeTlv(TAG.BIT_STRING, concatBytes(Uint8Array.of(0), pkcs1))),
  )
}

/** PKCS#8 → 内层 PKCS#1 RSAPrivateKey */
export function unwrapPkcs8(pkcs8: Uint8Array): Uint8Array {
  const kids = childrenOf(pkcs8, rootSequence(pkcs8))
  if (
    kids.length < 3 ||
    kids[0].tag !== TAG.INTEGER ||
    kids[1].tag !== TAG.SEQUENCE ||
    kids[2].tag !== TAG.OCTET_STRING
  ) {
    throw new RsaError('不是有效的 PKCS#8 私钥结构')
  }
  checkAlgorithm(pkcs8, kids[1])
  return valueOf(pkcs8, kids[2]).slice()
}

/** SPKI → 内层 PKCS#1 RSAPublicKey */
export function unwrapSpki(spki: Uint8Array): Uint8Array {
  const kids = childrenOf(spki, rootSequence(spki))
  if (kids.length !== 2 || kids[0].tag !== TAG.SEQUENCE || kids[1].tag !== TAG.BIT_STRING) {
    throw new RsaError('不是有效的 SPKI 公钥结构')
  }
  checkAlgorithm(spki, kids[0])
  const bits = valueOf(spki, kids[1])
  if (bits[0] !== 0) throw new RsaError('公钥 BIT STRING 的未用位数应为 0')
  return bits.slice(1)
}

export interface RsaPublicParts {
  n: Uint8Array
  e: Uint8Array
}

export interface RsaPrivateParts extends RsaPublicParts {
  d: Uint8Array
  p: Uint8Array
  q: Uint8Array
  dp: Uint8Array
  dq: Uint8Array
  qi: Uint8Array
}

function integers(der: Uint8Array, what: string, min: number): Uint8Array[] {
  const kids = childrenOf(der, rootSequence(der))
  if (kids.length < min || kids.slice(0, min).some((k) => k.tag !== TAG.INTEGER)) {
    throw new RsaError(`不是有效的 ${what} 结构`)
  }
  return kids.slice(0, min).map((k) => unsignedValue(valueOf(der, k)))
}

export function readPkcs1Public(pkcs1: Uint8Array): RsaPublicParts {
  const [n, e] = integers(pkcs1, 'PKCS#1 公钥', 2)
  return { n, e }
}

export function readPkcs1Private(pkcs1: Uint8Array): RsaPrivateParts {
  const [version, n, e, d, p, q, dp, dq, qi] = integers(pkcs1, 'PKCS#1 私钥', 9)
  if (version.length !== 1 || version[0] > 1) throw new RsaError('PKCS#1 私钥版本号无效')
  return { n, e, d, p, q, dp, dq, qi }
}

export function buildPkcs1Public({ n, e }: RsaPublicParts): Uint8Array {
  return encodeTlv(TAG.SEQUENCE, concatBytes(encodeUnsignedInteger(n), encodeUnsignedInteger(e)))
}

export function buildPkcs1Private(k: RsaPrivateParts): Uint8Array {
  return encodeTlv(
    TAG.SEQUENCE,
    concatBytes(
      Uint8Array.of(0x02, 0x01, 0x00),
      ...[k.n, k.e, k.d, k.p, k.q, k.dp, k.dq, k.qi].map(encodeUnsignedInteger),
    ),
  )
}

/** 从 PKCS#8 私钥推导 SPKI 公钥（取模数 n 与公钥指数 e） */
export function publicFromPrivate(pkcs8: Uint8Array): Uint8Array {
  const { n, e } = readPkcs1Private(unwrapPkcs8(pkcs8))
  return wrapPkcs1Public(buildPkcs1Public({ n, e }))
}

/** 从 X.509 证书中取出 SubjectPublicKeyInfo */
export function spkiFromCertificate(cert: Uint8Array): Uint8Array {
  const top = childrenOf(cert, rootSequence(cert))
  if (top.length !== 3 || top[0].tag !== TAG.SEQUENCE)
    throw new RsaError('不是有效的 X.509 证书结构')
  const tbs = childrenOf(cert, top[0])
  // [0] version 可选；随后依次为 serialNumber、signature、issuer、validity、subject、subjectPublicKeyInfo
  const start = tbs[0]?.tag === 0xa0 ? 1 : 0
  const spki = tbs[start + 5]
  if (!spki || spki.tag !== TAG.SEQUENCE) throw new RsaError('证书中找不到公钥信息')
  return cert.slice(spki.start, spki.end)
}

/** 按结构识别 DER 内容 */
export type DerKind = 'spki' | 'pkcs8' | 'pkcs1-public' | 'pkcs1-private' | 'x509'

export function detectDer(der: Uint8Array): DerKind {
  const kids = childrenOf(der, rootSequence(der))
  const tags = kids.map((k) => k.tag)
  if (tags.length === 2 && tags[0] === TAG.SEQUENCE && tags[1] === TAG.BIT_STRING) return 'spki'
  if (
    tags.length === 3 &&
    tags[0] === TAG.SEQUENCE &&
    tags[1] === TAG.SEQUENCE &&
    tags[2] === TAG.BIT_STRING
  ) {
    return 'x509'
  }
  if (
    tags.length >= 3 &&
    tags[0] === TAG.INTEGER &&
    tags[1] === TAG.SEQUENCE &&
    tags[2] === TAG.OCTET_STRING
  ) {
    return 'pkcs8'
  }
  if (tags.length === 2 && tags.every((t) => t === TAG.INTEGER)) return 'pkcs1-public'
  if (tags.length >= 9 && tags.slice(0, 9).every((t) => t === TAG.INTEGER)) return 'pkcs1-private'
  throw new RsaError('无法识别的 DER 结构：不是 SPKI / PKCS#8 / PKCS#1 密钥或 X.509 证书')
}

// ═════════════════════════ PEM ═════════════════════════

export interface PemBlock {
  label: string
  der: Uint8Array
}

export function toPem(der: Uint8Array, label: string): string {
  const b64 = bytesToBase64(der)
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

/** 解析文本中的第一个 PEM 块（base64 出错时给出行号） */
export function parsePem(text: string): PemBlock | null {
  const begin = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(text)
  if (!begin) return null
  const label = begin[1]
  const endMarker = `-----END ${label}-----`
  const bodyStart = begin.index + begin[0].length
  const endIdx = text.indexOf(endMarker, bodyStart)
  if (endIdx < 0) throw new RsaError(`缺少结尾行「${endMarker}」，PEM 可能没有复制完整`)
  const body = text.slice(bodyStart, endIdx)
  if (/Proc-Type:\s*4,\s*ENCRYPTED/i.test(body) || /DEK-Info:/i.test(body)) {
    throw new RsaError(
      '这是用口令加密的传统格式私钥，Web Crypto 无法直接使用。请先解密：openssl pkey -in key.pem -out plain.pem',
    )
  }
  const firstLine = text.slice(0, bodyStart).split('\n').length
  const lines = body.split('\n')
  lines.forEach((line, i) => {
    const bad = /[^A-Za-z0-9+/=\s]/.exec(line)
    if (bad) {
      throw new RsaError(
        `第 ${firstLine + i} 行第 ${bad.index + 1} 列出现非 Base64 字符「${bad[0]}」`,
      )
    }
  })
  const der = base64ToBytes(body, 'PEM 内容')
  return { label, der }
}

// ═════════════════════════ OpenSSH ═════════════════════════

function sshString(b: Uint8Array): Uint8Array {
  const len = b.length
  return concatBytes(Uint8Array.of(len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255), b)
}

/** SSH mpint：大端补码，正数最高位为 1 时补 0 */
function sshMpint(unsigned: Uint8Array): Uint8Array {
  let v = unsignedValue(unsigned)
  if (v.length === 1 && v[0] === 0) v = new Uint8Array(0)
  else if (v[0] & 0x80) v = concatBytes(Uint8Array.of(0), v)
  return sshString(v)
}

function sshBlob(parts: RsaPublicParts): Uint8Array {
  return concatBytes(
    sshString(new TextEncoder().encode('ssh-rsa')),
    sshMpint(parts.e),
    sshMpint(parts.n),
  )
}

export function toOpenSshPublic(spki: Uint8Array, comment = ''): string {
  const blob = sshBlob(readPkcs1Public(unwrapSpki(spki)))
  return `ssh-rsa ${bytesToBase64(blob)}${comment ? ' ' + comment : ''}`
}

/** 解析「ssh-rsa AAAA… 注释」一行 → SPKI */
export function parseOpenSshPublic(line: string): Uint8Array {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== 'ssh-rsa') {
    throw new RsaError(`只支持 ssh-rsa 公钥，当前类型为 ${parts[0]}`)
  }
  if (!parts[1]) throw new RsaError('ssh-rsa 后缺少 Base64 数据')
  const blob = base64ToBytes(parts[1], 'OpenSSH 公钥')
  let p = 0
  const read = (): Uint8Array => {
    if (p + 4 > blob.length) throw new RsaError('OpenSSH 公钥数据被截断')
    const len = ((blob[p] << 24) | (blob[p + 1] << 16) | (blob[p + 2] << 8) | blob[p + 3]) >>> 0
    p += 4
    if (p + len > blob.length) throw new RsaError('OpenSSH 公钥数据被截断')
    const v = blob.subarray(p, p + len)
    p += len
    return v
  }
  const type = new TextDecoder().decode(read())
  if (type !== 'ssh-rsa') throw new RsaError(`公钥数据中的类型为 ${type}，不是 ssh-rsa`)
  const e = read()
  const n = read()
  return wrapPkcs1Public(buildPkcs1Public({ n: unsignedValue(n), e: unsignedValue(e) }))
}

// ═════════════════════════ JWK ═════════════════════════

export interface RsaJwk {
  kty: 'RSA'
  n: string
  e: string
  d?: string
  p?: string
  q?: string
  dp?: string
  dq?: string
  qi?: string
  [k: string]: unknown
}

export function publicToJwk(spki: Uint8Array): RsaJwk {
  const { n, e } = readPkcs1Public(unwrapSpki(spki))
  return { kty: 'RSA', n: bytesToBase64Url(n), e: bytesToBase64Url(e) }
}

export function privateToJwk(pkcs8: Uint8Array): RsaJwk {
  const k = readPkcs1Private(unwrapPkcs8(pkcs8))
  return {
    kty: 'RSA',
    n: bytesToBase64Url(k.n),
    e: bytesToBase64Url(k.e),
    d: bytesToBase64Url(k.d),
    p: bytesToBase64Url(k.p),
    q: bytesToBase64Url(k.q),
    dp: bytesToBase64Url(k.dp),
    dq: bytesToBase64Url(k.dq),
    qi: bytesToBase64Url(k.qi),
  }
}

const CRT_FIELDS = ['p', 'q', 'dp', 'dq', 'qi'] as const

function jwkField(jwk: Record<string, unknown>, name: string): Uint8Array {
  const v = jwk[name]
  if (v === undefined || v === '') {
    if ((CRT_FIELDS as readonly string[]).includes(name)) {
      throw new RsaError(
        `私钥 JWK 缺少 CRT 参数「${name}」：Web Crypto 要求私钥同时包含 p、q、dp、dq、qi`,
      )
    }
    throw new RsaError(`JWK 缺少字段「${name}」`)
  }
  if (typeof v !== 'string') {
    throw new RsaError(`JWK 字段「${name}」应为 Base64URL 字符串，实际是 ${typeof v}`)
  }
  return base64ToBytes(v, `JWK 字段 ${name} `)
}

/** JWK Set（{"keys":[…]}）取第一个 RSA 密钥；普通 JWK 原样返回 */
function pickJwk(json: unknown): Record<string, unknown> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new RsaError('JWK 应为 JSON 对象，如 {"kty":"RSA","n":"…","e":"AQAB"}')
  }
  const obj = json as Record<string, unknown>
  if (obj.kty === undefined && Array.isArray(obj.keys)) {
    const keys = obj.keys as unknown[]
    const rsa = keys.find(
      (k): k is Record<string, unknown> =>
        typeof k === 'object' && k !== null && (k as Record<string, unknown>).kty === 'RSA',
    )
    if (!rsa) throw new RsaError(`JWK Set 中的 ${keys.length} 个密钥都不是 RSA 密钥`)
    return rsa
  }
  return obj
}

/** JWK → SPKI 或 PKCS#8（含 d 即视为私钥） */
export function jwkToDer(jwk: Record<string, unknown>): {
  kind: 'public' | 'private'
  der: Uint8Array
} {
  if (jwk.kty !== 'RSA') throw new RsaError(`JWK 的 kty 为「${String(jwk.kty)}」，不是 RSA`)
  const n = jwkField(jwk, 'n')
  const e = jwkField(jwk, 'e')
  if (jwk.d === undefined)
    return { kind: 'public', der: wrapPkcs1Public(buildPkcs1Public({ n, e })) }
  const k: RsaPrivateParts = {
    n,
    e,
    d: jwkField(jwk, 'd'),
    p: jwkField(jwk, 'p'),
    q: jwkField(jwk, 'q'),
    dp: jwkField(jwk, 'dp'),
    dq: jwkField(jwk, 'dq'),
    qi: jwkField(jwk, 'qi'),
  }
  return { kind: 'private', der: wrapPkcs1Private(buildPkcs1Private(k)) }
}

// ═════════════════════════ 统一解析 ═════════════════════════

export type KeySource =
  'spki' | 'pkcs1-public' | 'openssh' | 'x509' | 'pkcs8' | 'pkcs1-private' | 'jwk'

export const KEY_SOURCE_LABELS: Record<KeySource, string> = {
  spki: 'SPKI（X.509 公钥）',
  'pkcs1-public': 'PKCS#1 公钥',
  openssh: 'OpenSSH 公钥',
  x509: 'X.509 证书',
  pkcs8: 'PKCS#8 私钥',
  'pkcs1-private': 'PKCS#1 私钥',
  jwk: 'JWK',
}

export interface RsaKeyInfo {
  kind: 'public' | 'private'
  source: KeySource
  /** 规范化后的 DER：公钥为 SPKI，私钥为 PKCS#8（算法 OID 统一为 rsaEncryption） */
  der: Uint8Array
  /** 模数位数 */
  bits: number
  /** 公钥指数（十进制） */
  exponent: string
  /** 模数（十六进制，无前导 0） */
  modulusHex: string
  /** 原密钥是否带 RSASSA-PSS 专用 OID（已自动转换） */
  pssOid?: boolean
}

function bitLength(unsigned: Uint8Array): number {
  const v = unsignedValue(unsigned)
  if (v.length === 1 && v[0] === 0) return 0
  return (v.length - 1) * 8 + (32 - Math.clz32(v[0]))
}

function bigintOf(unsigned: Uint8Array): bigint {
  return unsigned.length ? BigInt('0x' + bytesToHex(unsigned)) : 0n
}

function infoFromPublic(pkcs1: Uint8Array, source: KeySource, pss = false): RsaKeyInfo {
  const { n, e } = readPkcs1Public(pkcs1)
  return {
    kind: 'public',
    source,
    der: wrapPkcs1Public(buildPkcs1Public({ n, e })),
    bits: bitLength(n),
    exponent: bigintOf(e).toString(10),
    modulusHex: bytesToHex(unsignedValue(n)),
    pssOid: pss || undefined,
  }
}

function infoFromPrivate(pkcs1: Uint8Array, source: KeySource, pss = false): RsaKeyInfo {
  const k = readPkcs1Private(pkcs1)
  return {
    kind: 'private',
    source,
    der: wrapPkcs1Private(pkcs1),
    bits: bitLength(k.n),
    exponent: bigintOf(k.e).toString(10),
    modulusHex: bytesToHex(unsignedValue(k.n)),
    pssOid: pss || undefined,
  }
}

function pssFlag(der: Uint8Array, algIndex: number): boolean {
  const kids = childrenOf(der, rootSequence(der))
  return checkAlgorithm(der, kids[algIndex]).pss
}

function fromDer(der: Uint8Array): RsaKeyInfo {
  const kind = detectDer(der)
  switch (kind) {
    case 'spki':
      return infoFromPublic(unwrapSpki(der), 'spki', pssFlag(der, 0))
    case 'pkcs8':
      return infoFromPrivate(unwrapPkcs8(der), 'pkcs8', pssFlag(der, 1))
    case 'pkcs1-public':
      return infoFromPublic(der, 'pkcs1-public')
    case 'pkcs1-private':
      return infoFromPrivate(der, 'pkcs1-private')
    case 'x509':
      return infoFromPublic(unwrapSpki(spkiFromCertificate(der)), 'x509')
  }
}

/**
 * 解析用户粘贴的 RSA 密钥：PEM（SPKI / PKCS#8 / PKCS#1 / 证书）、裸 Base64 DER、
 * 「ssh-rsa AAAA…」OpenSSH 公钥、JWK 或 JWK Set（取第一个 RSA 密钥）。
 */
export function parseRsaKey(text: string): RsaKeyInfo {
  const s = text.trim()
  if (!s) throw new RsaError('请粘贴密钥')

  if (s.startsWith('{')) {
    let json: unknown
    try {
      json = JSON.parse(s)
    } catch (e) {
      throw new RsaError(`JWK 不是有效的 JSON：${(e as Error).message}`)
    }
    const { kind, der } = jwkToDer(pickJwk(json))
    return kind === 'public'
      ? infoFromPublic(unwrapSpki(der), 'jwk')
      : infoFromPrivate(unwrapPkcs8(der), 'jwk')
  }
  if (/^ssh-(rsa|ed25519|dss)|^ecdsa-sha2-/.test(s)) {
    return infoFromPublic(unwrapSpki(parseOpenSshPublic(s)), 'openssh')
  }

  const pem = parsePem(s)
  if (pem) {
    switch (pem.label) {
      case 'ENCRYPTED PRIVATE KEY':
        throw new RsaError(
          '这是用口令加密的 PKCS#8 私钥，Web Crypto 无法直接使用。请先解密：openssl pkcs8 -in key.pem -out plain.pem',
        )
      case 'OPENSSH PRIVATE KEY':
        throw new RsaError(
          '这是 OpenSSH 格式的私钥，请先转换为 PEM：ssh-keygen -p -m PKCS8 -f id_rsa（会原地改写文件，请先备份）',
        )
      case 'EC PRIVATE KEY':
        throw new RsaError('这是 EC（椭圆曲线）私钥，不是 RSA 密钥')
      case 'DSA PRIVATE KEY':
        throw new RsaError('这是 DSA 私钥，不是 RSA 密钥')
      case 'CERTIFICATE REQUEST':
      case 'NEW CERTIFICATE REQUEST':
        throw new RsaError('这是证书签名请求（CSR），不是密钥')
    }
    // 以内容结构为准（PKCS#1 / PKCS#8 标签写错也能用），但公私钥类别必须与标签一致
    const info = fromDer(pem.der)
    if (/PRIVATE/.test(pem.label) && info.kind !== 'private') {
      throw new RsaError(`PEM 标签为「${pem.label}」，但内容是公钥`)
    }
    if (/PUBLIC/.test(pem.label) && info.kind !== 'public') {
      throw new RsaError(`PEM 标签为「${pem.label}」，但内容是私钥`)
    }
    return info
  }

  if (/^-----/.test(s))
    throw new RsaError('PEM 开头行格式不正确，应形如「-----BEGIN PUBLIC KEY-----」')
  // 没有 PEM 头尾：尝试当作 Base64 编码的 DER
  let der: Uint8Array
  try {
    der = base64ToBytes(s, '密钥')
  } catch {
    throw new RsaError(
      '无法识别的密钥格式：请粘贴 PEM（-----BEGIN … KEY-----）、Base64 DER、ssh-rsa 公钥或 JWK',
    )
  }
  return fromDer(der)
}

export type PublicFormat = 'spki' | 'pkcs1' | 'openssh' | 'jwk'
export type PrivateFormat = 'pkcs8' | 'pkcs1' | 'jwk'

export function exportPublic(spki: Uint8Array, format: PublicFormat): string {
  switch (format) {
    case 'spki':
      return toPem(spki, 'PUBLIC KEY')
    case 'pkcs1':
      return toPem(unwrapSpki(spki), 'RSA PUBLIC KEY')
    case 'openssh':
      return toOpenSshPublic(spki, 'showme-rsa') + '\n'
    case 'jwk':
      return JSON.stringify(publicToJwk(spki), null, 2) + '\n'
  }
}

export function exportPrivate(pkcs8: Uint8Array, format: PrivateFormat): string {
  switch (format) {
    case 'pkcs8':
      return toPem(pkcs8, 'PRIVATE KEY')
    case 'pkcs1':
      return toPem(unwrapPkcs8(pkcs8), 'RSA PRIVATE KEY')
    case 'jwk':
      return JSON.stringify(privateToJwk(pkcs8), null, 2) + '\n'
  }
}

/** 两把密钥的模数与指数是否相同（即是否为一对） */
export function keysMatch(a: RsaKeyInfo, b: RsaKeyInfo): boolean {
  return a.modulusHex === b.modulusHex && a.exponent === b.exponent
}

// ═════════════════════════ Web Crypto ═════════════════════════

export type RsaHash = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
export type SignScheme = 'RSASSA-PKCS1-v1_5' | 'RSA-PSS'
export type KeyPurpose = 'encrypt' | 'sign'

export const KEY_SIZES = [1024, 2048, 3072, 4096] as const
export type KeySize = (typeof KEY_SIZES)[number]

export const HASH_BYTES: Record<RsaHash, number> = {
  'SHA-1': 20,
  'SHA-256': 32,
  'SHA-384': 48,
  'SHA-512': 64,
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new RsaError('当前环境不支持 Web Crypto（需要 HTTPS 或 localhost）')
  return s
}

/** 复制到独立的 ArrayBuffer，满足 BufferSource 的类型要求 */
function buf(b: Uint8Array): ArrayBuffer {
  return b.slice().buffer as ArrayBuffer
}

/** OAEP 单次可加密的最大明文字节数：k − 2·hLen − 2 */
export function maxOaepPlaintext(bits: number, hash: RsaHash): number {
  return Math.max(0, Math.ceil(bits / 8) - 2 * HASH_BYTES[hash] - 2)
}

/** PSS 默认盐长 = 哈希长度 */
export function defaultSaltLength(hash: RsaHash): number {
  return HASH_BYTES[hash]
}

export interface KeyGenOptions {
  bits: number
  purpose: KeyPurpose
  hash: RsaHash
  scheme: SignScheme
}

export async function generateRsaKeyPair(
  o: KeyGenOptions,
): Promise<{ spki: Uint8Array; pkcs8: Uint8Array }> {
  const name = o.purpose === 'encrypt' ? 'RSA-OAEP' : o.scheme
  const usages: KeyUsage[] = o.purpose === 'encrypt' ? ['encrypt', 'decrypt'] : ['sign', 'verify']
  const pair = (await subtle().generateKey(
    { name, modulusLength: o.bits, publicExponent: Uint8Array.of(1, 0, 1), hash: o.hash },
    true,
    usages,
  )) as CryptoKeyPair
  const [spki, pkcs8] = await Promise.all([
    subtle().exportKey('spki', pair.publicKey),
    subtle().exportKey('pkcs8', pair.privateKey),
  ])
  return { spki: new Uint8Array(spki), pkcs8: new Uint8Array(pkcs8) }
}

function describeCryptoError(e: unknown, fallback: string): RsaError {
  if (e instanceof RsaError) return e
  const name = (e as { name?: string })?.name
  const msg = (e as Error)?.message ?? String(e)
  if (name === 'DataError') return new RsaError(`密钥数据无效：${msg}`)
  if (name === 'NotSupportedError') return new RsaError(`当前浏览器不支持该算法：${msg}`)
  return new RsaError(fallback)
}

export async function rsaOaepEncrypt(
  spki: Uint8Array,
  data: Uint8Array,
  hash: RsaHash,
): Promise<Uint8Array> {
  const bits = parseRsaKeyDer(spki, 'public').bits
  const max = maxOaepPlaintext(bits, hash)
  if (max === 0) throw new RsaError(`RSA-${bits} 太短，无法与 OAEP-${hash} 搭配使用`)
  if (data.length > max) {
    throw new RsaError(
      `明文 ${data.length} 字节，超过 RSA-${bits} + OAEP-${hash} 单次加密上限 ${max} 字节。长数据请用 AES 加密，再用 RSA 加密 AES 密钥（混合加密）`,
    )
  }
  try {
    const key = await subtle().importKey('spki', buf(spki), { name: 'RSA-OAEP', hash }, false, [
      'encrypt',
    ])
    return new Uint8Array(await subtle().encrypt({ name: 'RSA-OAEP' }, key, buf(data)))
  } catch (e) {
    throw describeCryptoError(e, '加密失败')
  }
}

export async function rsaOaepDecrypt(
  pkcs8: Uint8Array,
  cipher: Uint8Array,
  hash: RsaHash,
): Promise<Uint8Array> {
  const bits = parseRsaKeyDer(pkcs8, 'private').bits
  const k = Math.ceil(bits / 8)
  if (cipher.length !== k) {
    throw new RsaError(`密文长度为 ${cipher.length} 字节，RSA-${bits} 的密文应恰好为 ${k} 字节`)
  }
  try {
    const key = await subtle().importKey('pkcs8', buf(pkcs8), { name: 'RSA-OAEP', hash }, false, [
      'decrypt',
    ])
    return new Uint8Array(await subtle().decrypt({ name: 'RSA-OAEP' }, key, buf(cipher)))
  } catch (e) {
    throw describeCryptoError(
      e,
      `解密失败：私钥与加密所用公钥不是一对、OAEP 哈希（当前 ${hash}）与加密时不一致，或密文已损坏 / 使用了 PKCS#1 v1.5 填充`,
    )
  }
}

function signParams(scheme: SignScheme, hash: RsaHash, saltLength?: number) {
  return scheme === 'RSA-PSS'
    ? { name: 'RSA-PSS', saltLength: saltLength ?? defaultSaltLength(hash) }
    : { name: 'RSASSA-PKCS1-v1_5' }
}

export async function rsaSign(
  pkcs8: Uint8Array,
  data: Uint8Array,
  scheme: SignScheme,
  hash: RsaHash,
  saltLength?: number,
): Promise<Uint8Array> {
  try {
    const key = await subtle().importKey('pkcs8', buf(pkcs8), { name: scheme, hash }, false, [
      'sign',
    ])
    return new Uint8Array(await subtle().sign(signParams(scheme, hash, saltLength), key, buf(data)))
  } catch (e) {
    throw describeCryptoError(e, '签名失败：请检查私钥与盐长设置')
  }
}

export async function rsaVerify(
  spki: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array,
  scheme: SignScheme,
  hash: RsaHash,
  saltLength?: number,
): Promise<boolean> {
  const bits = parseRsaKeyDer(spki, 'public').bits
  const k = Math.ceil(bits / 8)
  if (signature.length !== k) {
    throw new RsaError(`签名长度为 ${signature.length} 字节，RSA-${bits} 的签名应恰好为 ${k} 字节`)
  }
  try {
    const key = await subtle().importKey('spki', buf(spki), { name: scheme, hash }, false, [
      'verify',
    ])
    return await subtle().verify(
      signParams(scheme, hash, saltLength),
      key,
      buf(signature),
      buf(data),
    )
  } catch (e) {
    throw describeCryptoError(e, '验签过程出错')
  }
}

/** 从规范化 DER 读取位数（用于前置校验） */
function parseRsaKeyDer(der: Uint8Array, kind: 'public' | 'private'): { bits: number } {
  const pkcs1 = kind === 'public' ? unwrapSpki(der) : unwrapPkcs8(der)
  const n = kind === 'public' ? readPkcs1Public(pkcs1).n : readPkcs1Private(pkcs1).n
  return { bits: bitLength(n) }
}

/** 公钥指纹：SPKI DER 的 SHA-256（十六进制冒号分隔）与 OpenSSH 风格（SHA256:base64） */
export async function fingerprints(
  spki: Uint8Array,
): Promise<{ spkiSha256: string; openssh: string }> {
  const blob = sshBlob(readPkcs1Public(unwrapSpki(spki)))
  const [a, b] = await Promise.all([
    subtle().digest('SHA-256', buf(spki)),
    subtle().digest('SHA-256', buf(blob)),
  ])
  const hex = bytesToHex(new Uint8Array(a)).match(/../g)!.join(':')
  return {
    spkiSha256: hex,
    openssh: 'SHA256:' + bytesToBase64(new Uint8Array(b)).replace(/=+$/, ''),
  }
}

// ═════════════════════════ OpenSSL 等价命令 ═════════════════════════

const md = (h: RsaHash) => h.replace('-', '').toLowerCase()

export type RsaOperation = 'keygen' | 'encrypt' | 'decrypt' | 'sign' | 'verify'

export function opensslCommand(
  op: RsaOperation,
  o: { bits: number; hash: RsaHash; scheme: SignScheme; saltLength?: number },
): string {
  const oaep = `-pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:${md(o.hash)} -pkeyopt rsa_mgf1_md:${md(o.hash)}`
  const pss =
    o.scheme === 'RSA-PSS'
      ? ` -sigopt rsa_padding_mode:pss -sigopt rsa_pss_saltlen:${o.saltLength ?? defaultSaltLength(o.hash)}`
      : ''
  switch (op) {
    case 'keygen':
      return [
        `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:${o.bits} -out private.pem`,
        'openssl pkey -in private.pem -pubout -out public.pem',
      ].join('\n')
    case 'encrypt':
      return `openssl pkeyutl -encrypt -pubin -inkey public.pem ${oaep} -in plain.txt | base64`
    case 'decrypt':
      return `base64 -d cipher.b64 | openssl pkeyutl -decrypt -inkey private.pem ${oaep}`
    case 'sign':
      return `openssl dgst -${md(o.hash)} -sign private.pem${pss} -out sig.bin message.txt && base64 sig.bin`
    case 'verify':
      return `openssl dgst -${md(o.hash)} -verify public.pem${pss} -signature sig.bin message.txt`
  }
}
