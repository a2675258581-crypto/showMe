/**
 * 对称加解密（纯逻辑，基于 crypto-js）：AES / DES / 3DES / RC4 / Rabbit。
 * - 分组模式 CBC / ECB / CFB / OFB / CTR，填充由本模块自己实现，解密时严格校验并给出中文错误。
 * - 口令模式兼容 OpenSSL `enc`：「Salted__」+ 8 字节盐 + 密文；KDF 支持 EVP_BytesToKey(MD5 / SHA-256) 与 PBKDF2。
 */
import CryptoJS from 'crypto-js'
import {
  ByteDecodeError,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  concatBytes,
  decodeInput,
  hexToBytes,
  randomBytes,
  utf8Decode,
  utf8Encode,
  type ByteEncoding,
} from './hash-bytes'

type WordArray = CryptoJS.lib.WordArray

export type CipherAlgo = 'AES' | 'DES' | 'TripleDES' | 'RC4' | 'Rabbit'
export type CipherMode = 'CBC' | 'ECB' | 'CFB' | 'OFB' | 'CTR'
export type PaddingId = 'Pkcs7' | 'ZeroPadding' | 'NoPadding' | 'Iso10126' | 'AnsiX923' | 'Iso97971'
export type KdfId = 'md5' | 'sha256' | 'pbkdf2'
export type Direction = 'encrypt' | 'decrypt'

export interface CipherInfo {
  id: CipherAlgo
  label: string
  /** 分组大小（字节），流密码为 0 */
  blockSize: number
  /** 允许的密钥长度（字节）；RC4 为 1–256 任意 */
  keySizes: readonly number[]
  /** 默认 / 口令模式派生的密钥长度（字节） */
  defaultKeySize: number
  /** IV 长度（字节），0 表示不用 IV */
  ivSize: number
  note: string
  weak?: string
}

export const CIPHERS: Record<CipherAlgo, CipherInfo> = {
  AES: {
    id: 'AES',
    label: 'AES',
    blockSize: 16,
    keySizes: [16, 24, 32],
    defaultKeySize: 32,
    ivSize: 16,
    note: '高级加密标准，分组 128 位，密钥 128 / 192 / 256 位',
  },
  DES: {
    id: 'DES',
    label: 'DES',
    blockSize: 8,
    keySizes: [8],
    defaultKeySize: 8,
    ivSize: 8,
    note: '分组 64 位，密钥 8 字节（有效 56 位）',
    weak: 'DES 只有 56 位有效密钥，可被暴力破解，仅用于兼容旧系统。',
  },
  TripleDES: {
    id: 'TripleDES',
    label: '3DES',
    blockSize: 8,
    keySizes: [16, 24],
    defaultKeySize: 24,
    ivSize: 8,
    note: 'DES-EDE，密钥 16 字节（双倍长）或 24 字节（三倍长）',
    weak: '3DES 分组只有 64 位，已被 NIST 弃用，新系统请用 AES。',
  },
  RC4: {
    id: 'RC4',
    label: 'RC4',
    blockSize: 0,
    keySizes: [5, 16, 32],
    defaultKeySize: 32,
    ivSize: 0,
    note: '流密码，密钥 1–256 字节，无 IV、无填充',
    weak: 'RC4 存在严重的密钥流偏差，已被 RFC 7465 禁用。',
  },
  Rabbit: {
    id: 'Rabbit',
    label: 'Rabbit',
    blockSize: 0,
    keySizes: [16],
    defaultKeySize: 16,
    ivSize: 8,
    note: '流密码（eSTREAM），密钥 16 字节，IV 8 字节可选',
  },
}

export const CIPHER_IDS: readonly CipherAlgo[] = ['AES', 'DES', 'TripleDES', 'RC4', 'Rabbit']
export const MODES: readonly CipherMode[] = ['CBC', 'ECB', 'CFB', 'OFB', 'CTR']
export const PADDINGS: readonly { id: PaddingId; label: string; note: string }[] = [
  { id: 'Pkcs7', label: 'PKCS7', note: '最常用；补 N 个值为 N 的字节（等同 PKCS5）' },
  { id: 'ZeroPadding', label: 'ZeroPadding', note: '补 0x00；解密时去掉末尾所有 0x00' },
  { id: 'NoPadding', label: 'NoPadding', note: '不填充；ECB/CBC 要求数据是分组的整数倍' },
  { id: 'Iso10126', label: 'ISO 10126', note: '随机字节 + 最后一字节为长度' },
  { id: 'AnsiX923', label: 'ANSI X.923', note: '0x00 + 最后一字节为长度' },
  { id: 'Iso97971', label: 'ISO/IEC 9797-1', note: '0x80 后补 0x00' },
]
export const KDFS: readonly { id: KdfId; label: string; note: string }[] = [
  {
    id: 'md5',
    label: 'EVP_BytesToKey · MD5',
    note: 'CryptoJS 默认、OpenSSL 1.1 之前的默认（-md md5）',
  },
  { id: 'sha256', label: 'EVP_BytesToKey · SHA-256', note: 'OpenSSL 1.1+ 默认（-md sha256）' },
  { id: 'pbkdf2', label: 'PBKDF2 · SHA-256', note: 'openssl enc -pbkdf2（默认 10000 次迭代）' },
]

export const isStream = (algo: CipherAlgo) => CIPHERS[algo].blockSize === 0

/** IV 需求：required 必填，optional 可选（Rabbit），none 不使用 */
export function ivRequirement(
  algo: CipherAlgo,
  mode: CipherMode,
): 'required' | 'optional' | 'none' {
  if (algo === 'RC4') return 'none'
  if (algo === 'Rabbit') return 'optional'
  return mode === 'ECB' ? 'none' : 'required'
}

/** 分组密码在各模式下是否需要按分组对齐（ECB / CBC 需要） */
const needsAlignment = (mode: CipherMode) => mode === 'ECB' || mode === 'CBC'

/** 对应的 OpenSSL 算法名，如 aes-256-cbc；没有对应项时返回 null */
export function opensslName(algo: CipherAlgo, mode: CipherMode, keyBytes: number): string | null {
  const m = mode.toLowerCase()
  switch (algo) {
    case 'AES':
      return `aes-${keyBytes * 8}-${m}`
    case 'DES':
      return mode === 'CTR' ? null : `des-${m}`
    case 'TripleDES':
      if (mode === 'CTR') return null
      return `${keyBytes === 16 ? 'des-ede' : 'des-ede3'}${mode === 'ECB' ? '-ecb' : `-${m}`}`
    case 'RC4':
      return keyBytes === 16 ? 'rc4' : null
    case 'Rabbit':
      return null
  }
}

// ───────────── 错误 ─────────────

export type CipherField = 'key' | 'iv' | 'input' | 'passphrase' | 'salt' | 'iterations'

export class CipherError extends Error {
  readonly field?: CipherField
  constructor(message: string, field?: CipherField) {
    super(message)
    this.name = 'CipherError'
    this.field = field
  }
}

// ───────────── 校验 ─────────────

/** 返回密钥长度错误（中文），合法时返回 null */
export function validateKey(algo: CipherAlgo, key: Uint8Array): string | null {
  const n = key.length
  if (n === 0) return '密钥不能为空'
  switch (algo) {
    case 'AES':
      return [16, 24, 32].includes(n)
        ? null
        : `AES 密钥必须是 16 / 24 / 32 字节（AES-128 / 192 / 256），当前 ${n} 字节`
    case 'DES':
      return n === 8 ? null : `DES 密钥必须是 8 字节，当前 ${n} 字节`
    case 'TripleDES':
      return n === 16 || n === 24
        ? null
        : `3DES 密钥必须是 16 字节（双倍长）或 24 字节（三倍长），当前 ${n} 字节`
    case 'RC4':
      return n <= 256 ? null : `RC4 密钥最长 256 字节，当前 ${n} 字节`
    case 'Rabbit':
      return n === 16 ? null : `Rabbit 密钥必须是 16 字节，当前 ${n} 字节`
  }
}

export function validateIv(algo: CipherAlgo, mode: CipherMode, iv: Uint8Array): string | null {
  const req = ivRequirement(algo, mode)
  if (req === 'none') return null
  const size = CIPHERS[algo].ivSize
  if (req === 'optional' && iv.length === 0) return null
  if (iv.length === 0) return `${mode} 模式需要 IV（${size} 字节）`
  if (iv.length !== size) {
    return `${CIPHERS[algo].label} 的 IV 必须是 ${size} 字节，当前 ${iv.length} 字节`
  }
  return null
}

/** 额外提示（不阻止运行） */
export function cipherWarnings(
  algo: CipherAlgo,
  mode: CipherMode,
  padding: PaddingId,
  key?: Uint8Array,
): string[] {
  const out: string[] = []
  const info = CIPHERS[algo]
  if (info.weak) out.push(info.weak)
  if (!isStream(algo)) {
    if (mode === 'ECB')
      out.push('ECB 模式不使用 IV，相同的明文分组会得到相同的密文分组，会泄露数据模式。')
    if (mode !== 'ECB' && mode !== 'CBC' && padding !== 'NoPadding') {
      out.push(
        `${mode} 是流式模式，OpenSSL / Java / Go 通常不填充（NoPadding）；CryptoJS 默认仍会 PKCS7 填充，互通时请保持一致。`,
      )
    }
    if (padding === 'ZeroPadding') out.push('ZeroPadding 解密时会去掉明文末尾所有 0x00 字节。')
    if (algo === 'TripleDES' && key && key.length >= 16) {
      const k1 = key.subarray(0, 8)
      const k2 = key.subarray(8, 16)
      const k3 = key.length === 24 ? key.subarray(16, 24) : k1
      if (bytesEqual(k1, k2) || bytesEqual(k2, k3)) {
        out.push('3DES 的相邻子密钥相同，实际退化为单 DES。')
      }
    }
  }
  return out
}

// ───────────── 填充 ─────────────

export function pad(data: Uint8Array, blockSize: number, padding: PaddingId): Uint8Array {
  if (padding === 'NoPadding') return data
  const rem = data.length % blockSize
  if (padding === 'ZeroPadding') {
    return rem === 0 ? data : concatBytes(data, new Uint8Array(blockSize - rem))
  }
  const n = blockSize - rem
  const tail = new Uint8Array(n)
  switch (padding) {
    case 'Pkcs7':
      tail.fill(n)
      break
    case 'AnsiX923':
      tail[n - 1] = n
      break
    case 'Iso10126':
      tail.set(randomBytes(n - 1))
      tail[n - 1] = n
      break
    case 'Iso97971':
      tail[0] = 0x80
      break
  }
  return concatBytes(data, tail)
}

const hexByte = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

const PAD_FAIL = '通常意味着密钥、IV、模式或填充方式与加密时不一致。'

/** 去掉填充并严格校验；失败抛 CipherError */
export function unpad(data: Uint8Array, blockSize: number, padding: PaddingId): Uint8Array {
  if (padding === 'NoPadding') return data
  if (padding === 'ZeroPadding') {
    let end = data.length
    while (end > 0 && data[end - 1] === 0) end--
    return data.subarray(0, end)
  }
  if (data.length === 0) throw new CipherError('密文为空，无法去除填充', 'input')
  const last = data[data.length - 1]
  if (padding === 'Iso97971') {
    let i = data.length - 1
    while (i >= 0 && data[i] === 0 && data.length - i <= blockSize) i--
    if (i < 0 || data[i] !== 0x80 || data.length - i > blockSize) {
      throw new CipherError(
        `填充校验失败：末尾不是合法的 ISO/IEC 9797-1 填充（0x80 00…）。${PAD_FAIL}`,
      )
    }
    return data.subarray(0, i)
  }
  const name = { Pkcs7: 'PKCS7', AnsiX923: 'ANSI X.923', Iso10126: 'ISO 10126' }[padding]
  if (last < 1 || last > blockSize || last > data.length) {
    throw new CipherError(
      `填充校验失败：最后一个字节是 ${hexByte(last)}，不是合法的 ${name} 填充长度（应为 1–${blockSize}）。${PAD_FAIL}`,
    )
  }
  for (let i = data.length - last; i < data.length - 1; i++) {
    const expect = padding === 'Pkcs7' ? last : padding === 'AnsiX923' ? 0 : data[i]
    if (data[i] !== expect) {
      throw new CipherError(
        `填充校验失败：${name} 填充的倒数第 ${data.length - i} 个字节应为 ${hexByte(expect)}，实际是 ${hexByte(data[i])}。${PAD_FAIL}`,
      )
    }
  }
  return data.subarray(0, data.length - last)
}

// ───────────── crypto-js 桥接 ─────────────

function toWords(b: Uint8Array): WordArray {
  const words: number[] = new Array((b.length + 3) >>> 2).fill(0)
  for (let i = 0; i < b.length; i++) words[i >>> 2] |= b[i] << (24 - (i % 4) * 8)
  return CryptoJS.lib.WordArray.create(words, b.length)
}

function fromWords(w: WordArray): Uint8Array {
  const out = new Uint8Array(Math.max(0, w.sigBytes))
  for (let i = 0; i < out.length; i++) out[i] = (w.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
  return out
}

const HELPERS: Record<CipherAlgo, typeof CryptoJS.AES> = {
  AES: CryptoJS.AES,
  DES: CryptoJS.DES,
  TripleDES: CryptoJS.TripleDES,
  RC4: CryptoJS.RC4,
  Rabbit: CryptoJS.Rabbit,
}

const MODE_IMPL: Record<CipherMode, unknown> = {
  CBC: CryptoJS.mode.CBC,
  ECB: CryptoJS.mode.ECB,
  CFB: CryptoJS.mode.CFB,
  OFB: CryptoJS.mode.OFB,
  CTR: CryptoJS.mode.CTR,
}

export interface RawCipherOptions {
  algo: CipherAlgo
  mode: CipherMode
  padding: PaddingId
  key: Uint8Array
  iv?: Uint8Array
}

function checkParams({ algo, mode, key, iv }: RawCipherOptions) {
  const keyErr = validateKey(algo, key)
  if (keyErr) throw new CipherError(keyErr, 'key')
  const ivErr = validateIv(algo, mode, iv ?? new Uint8Array(0))
  if (ivErr) throw new CipherError(ivErr, 'iv')
}

/** 不做填充的原始变换（数据长度已由调用方处理好） */
function transform(dir: Direction, o: RawCipherOptions, data: Uint8Array): Uint8Array {
  const helper = HELPERS[o.algo]
  const cfg: Record<string, unknown> = { padding: CryptoJS.pad.NoPadding }
  if (!isStream(o.algo)) {
    cfg.mode = MODE_IMPL[o.mode]
    if (o.mode !== 'ECB') cfg.iv = toWords(o.iv!)
  } else if (o.algo === 'Rabbit' && o.iv?.length) {
    cfg.iv = toWords(o.iv)
  }
  const key = toWords(o.key)
  if (dir === 'encrypt') return fromWords(helper.encrypt(toWords(data), key, cfg).ciphertext)
  const params = CryptoJS.lib.CipherParams.create({ ciphertext: toWords(data) })
  return fromWords(helper.decrypt(params, key, cfg))
}

export function encryptBytes(o: RawCipherOptions, plaintext: Uint8Array): Uint8Array {
  checkParams(o)
  if (isStream(o.algo)) return transform('encrypt', o, plaintext)
  const bs = CIPHERS[o.algo].blockSize
  if (o.padding === 'NoPadding' && needsAlignment(o.mode) && plaintext.length % bs !== 0) {
    throw new CipherError(
      `NoPadding 下 ${o.mode} 模式要求明文长度是 ${bs} 字节的整数倍，当前 ${plaintext.length} 字节（还差 ${bs - (plaintext.length % bs)} 字节）。可改用 PKCS7 填充。`,
      'input',
    )
  }
  return transform('encrypt', o, pad(plaintext, bs, o.padding))
}

export function decryptBytes(o: RawCipherOptions, ciphertext: Uint8Array): Uint8Array {
  checkParams(o)
  if (isStream(o.algo)) return transform('decrypt', o, ciphertext)
  const bs = CIPHERS[o.algo].blockSize
  const aligned = ciphertext.length % bs === 0
  if (!aligned && (needsAlignment(o.mode) || o.padding !== 'NoPadding')) {
    throw new CipherError(
      `密文长度 ${ciphertext.length} 字节不是 ${bs} 字节的整数倍，${
        needsAlignment(o.mode) ? `${o.mode} 模式无法解密` : '与所选填充方式不符'
      }。请检查密文是否完整、密文编码（Base64 / Hex）是否选对。`,
      'input',
    )
  }
  return unpad(transform('decrypt', o, ciphertext), bs, o.padding)
}

// ───────────── 口令模式（OpenSSL 兼容） ─────────────

export const SALTED_MAGIC = utf8Encode('Salted__')

export interface KdfOptions {
  kdf: KdfId
  /** PBKDF2 迭代次数 */
  iterations?: number
}

/** OpenSSL EVP_BytesToKey（count = 1）：D_i = H(D_{i-1} || pass || salt) */
export function evpBytesToKey(
  pass: Uint8Array,
  salt: Uint8Array,
  total: number,
  digest: 'md5' | 'sha256',
): Uint8Array {
  const hash = digest === 'md5' ? CryptoJS.MD5 : CryptoJS.SHA256
  const parts: Uint8Array[] = []
  let have = 0
  let prev: Uint8Array = new Uint8Array(0)
  while (have < total) {
    prev = fromWords(hash(toWords(concatBytes(prev, pass, salt))))
    parts.push(prev)
    have += prev.length
  }
  return concatBytes(...parts).slice(0, total)
}

// PBKDF2 很慢（CryptoJS 同步实现 1 万次迭代约 0.3 秒），派生结果按参数缓存，
// 界面先用 WebCrypto 异步算好（pbkdf2Sha256Async），同步流程再命中缓存，避免卡住主线程。
const PBKDF2_CACHE_MAX = 16
const pbkdf2Cache = new Map<string, Uint8Array>()

const pbkdf2CacheKey = (pass: Uint8Array, salt: Uint8Array, total: number, iterations: number) =>
  `${iterations}|${total}|${bytesToHex(salt)}|${bytesToHex(pass)}`

function rememberPbkdf2(key: string, value: Uint8Array) {
  pbkdf2Cache.delete(key)
  pbkdf2Cache.set(key, value)
  while (pbkdf2Cache.size > PBKDF2_CACHE_MAX) {
    pbkdf2Cache.delete(pbkdf2Cache.keys().next().value!)
  }
}

export function pbkdf2Sha256(
  pass: Uint8Array,
  salt: Uint8Array,
  total: number,
  iterations: number,
): Uint8Array {
  const cacheKey = pbkdf2CacheKey(pass, salt, total, iterations)
  const hit = pbkdf2Cache.get(cacheKey)
  if (hit) return hit.slice()
  const out = fromWords(
    CryptoJS.PBKDF2(toWords(pass), toWords(salt), {
      keySize: Math.ceil(total / 4),
      iterations,
      hasher: CryptoJS.algo.SHA256,
    }),
  ).slice(0, total)
  rememberPbkdf2(cacheKey, out)
  return out.slice()
}

/** PBKDF2-HMAC-SHA256：优先用 WebCrypto（原生、异步），不可用时退回 CryptoJS；结果写入缓存 */
export async function pbkdf2Sha256Async(
  pass: Uint8Array,
  salt: Uint8Array,
  total: number,
  iterations: number,
): Promise<Uint8Array> {
  const cacheKey = pbkdf2CacheKey(pass, salt, total, iterations)
  const hit = pbkdf2Cache.get(cacheKey)
  if (hit) return hit.slice()
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return pbkdf2Sha256(pass, salt, total, iterations)
  let out: Uint8Array
  try {
    const base = await subtle.importKey('raw', new Uint8Array(pass), 'PBKDF2', false, [
      'deriveBits',
    ])
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations },
      base,
      total * 8,
    )
    out = new Uint8Array(bits)
  } catch {
    // 非安全上下文或实现不支持（如空口令）：退回同步实现
    return pbkdf2Sha256(pass, salt, total, iterations)
  }
  rememberPbkdf2(cacheKey, out)
  return out.slice()
}

export const MAX_ITERATIONS = 5_000_000

export function deriveKeyIv(
  pass: Uint8Array,
  salt: Uint8Array,
  keyLen: number,
  ivLen: number,
  { kdf, iterations = 10000 }: KdfOptions,
): { key: Uint8Array; iv: Uint8Array } {
  let bytes: Uint8Array
  if (kdf === 'pbkdf2') {
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
      throw new CipherError(
        `PBKDF2 迭代次数应为 1–${MAX_ITERATIONS.toLocaleString()} 之间的整数`,
        'iterations',
      )
    }
    bytes = pbkdf2Sha256(pass, salt, keyLen + ivLen, iterations)
  } else {
    bytes = evpBytesToKey(pass, salt, keyLen + ivLen, kdf)
  }
  return { key: bytes.slice(0, keyLen), iv: bytes.slice(keyLen, keyLen + ivLen) }
}

export interface PassphraseOptions extends KdfOptions {
  algo: CipherAlgo
  mode: CipherMode
  padding: PaddingId
  passphrase: Uint8Array
  /** 派生密钥长度（字节），缺省用算法默认值 */
  keySize?: number
}

export interface PassphraseResult {
  /** 加密：Salted__ + salt + 密文；解密：明文 */
  data: Uint8Array
  salt: Uint8Array
  key: Uint8Array
  iv: Uint8Array
}

function derivedSizes(o: PassphraseOptions) {
  const info = CIPHERS[o.algo]
  const keySize = o.keySize ?? info.defaultKeySize
  if (!info.keySizes.includes(keySize) && o.algo !== 'RC4') {
    throw new CipherError(`${info.label} 不支持 ${keySize * 8} 位密钥`, 'key')
  }
  return { keySize, ivSize: info.ivSize }
}

export function encryptWithPassphrase(
  o: PassphraseOptions,
  plaintext: Uint8Array,
  salt: Uint8Array = randomBytes(8),
): PassphraseResult {
  if (salt.length !== 8) throw new CipherError(`盐必须是 8 字节，当前 ${salt.length} 字节`, 'salt')
  const { keySize, ivSize } = derivedSizes(o)
  const { key, iv } = deriveKeyIv(o.passphrase, salt, keySize, ivSize, o)
  const ct = encryptBytes({ ...o, key, iv }, plaintext)
  return { data: concatBytes(SALTED_MAGIC, salt, ct), salt, key, iv }
}

export function hasSaltedHeader(data: Uint8Array): boolean {
  return data.length >= 16 && bytesEqual(data.subarray(0, 8), SALTED_MAGIC)
}

export function decryptWithPassphrase(o: PassphraseOptions, data: Uint8Array): PassphraseResult {
  if (!hasSaltedHeader(data)) {
    throw new CipherError(
      '口令模式的密文应以「Salted__」开头（Base64 形如 U2FsdGVkX1…），当前密文没有盐值头。若是用密钥 + IV 加密的，请切换到「密钥」模式。',
      'input',
    )
  }
  const salt = data.slice(8, 16)
  const { keySize, ivSize } = derivedSizes(o)
  const { key, iv } = deriveKeyIv(o.passphrase, salt, keySize, ivSize, o)
  return { data: decryptBytes({ ...o, key, iv }, data.subarray(16)), salt, key, iv }
}

// ───────────── 面向界面的一站式入口 ─────────────

export type PlainEncoding = 'utf8' | 'hex' | 'base64'
export type CipherEncoding = 'base64' | 'hex'

export interface CipherRequest {
  direction: Direction
  algo: CipherAlgo
  mode: CipherMode
  padding: PaddingId
  keyMode: 'raw' | 'passphrase'
  key: string
  keyEncoding: ByteEncoding
  iv: string
  ivEncoding: ByteEncoding
  passphrase: string
  kdf: KdfId
  iterations: number
  /** 口令模式的盐（Hex，8 字节）；留空则随机生成 */
  salt: string
  /** 口令模式派生的密钥长度（字节） */
  keySize: number
  input: string
  plainEncoding: PlainEncoding
  cipherEncoding: CipherEncoding
}

export interface CipherSuccess {
  ok: true
  output: string
  /** 实际使用的密钥 / IV / 盐（Hex），便于核对 */
  used: { key: string; iv: string; salt?: string }
  inputBytes: number
  outputBytes: number
  warnings: string[]
}

export interface CipherFailure {
  ok: false
  error: string
  field?: CipherField
  /** 可以一键采纳的建议 */
  suggestion?: { label: string; patch: Partial<CipherRequest> }
}

export type CipherOutcome = CipherSuccess | CipherFailure

function decodeField(text: string, enc: ByteEncoding, name: string, field: CipherField) {
  try {
    return decodeInput(text, enc)
  } catch (e) {
    const msg = e instanceof ByteDecodeError ? e.message : String(e)
    throw new CipherError(`${name}：${msg}`, field)
  }
}

function decodeCiphertext(text: string, enc: CipherEncoding): Uint8Array {
  const compact = text.replace(/\s+/g, '')
  try {
    return enc === 'hex' ? hexToBytes(compact) : base64ToBytes(compact)
  } catch (e) {
    const msg = e instanceof ByteDecodeError ? e.message : String(e)
    throw new CipherError(`密文：${msg}`, 'input')
  }
}

const looksHex = (s: string) => {
  const c = s.replace(/\s+/g, '')
  return c.length > 0 && c.length % 2 === 0 && /^[0-9a-f]+$/i.test(c)
}

/** 密文看起来是 OpenSSL / CryptoJS 口令格式（「Salted__」头） */
const looksSalted = (input: string, enc: CipherEncoding) =>
  enc === 'base64' ? /^\s*U2FsdGVkX1/.test(input) : /^\s*53616c7465645f5f/i.test(input)

/** 根据出错情况给出一键修正建议（只针对密文本身或解密结果的问题） */
function suggestFix(req: CipherRequest, e: CipherError): CipherFailure['suggestion'] {
  if (req.direction !== 'decrypt' || (e.field !== undefined && e.field !== 'input')) return
  if (req.cipherEncoding === 'base64' && looksHex(req.input)) {
    return { label: '改用 Hex 解析密文', patch: { cipherEncoding: 'hex' } }
  }
  if (req.keyMode === 'raw' && looksSalted(req.input, req.cipherEncoding)) {
    return { label: '切换到口令模式', patch: { keyMode: 'passphrase' } }
  }
  if (req.keyMode === 'passphrase' && e.field === 'input' && /Salted__/.test(e.message)) {
    return { label: '切换到密钥 + IV 模式', patch: { keyMode: 'raw' } }
  }
  if (e.field === undefined && /UTF-8/.test(e.message) && req.plainEncoding === 'utf8') {
    return { label: '以 Hex 显示明文', patch: { plainEncoding: 'hex' } }
  }
}

/** 执行一次加密或解密；永不抛出 */
export function runCipher(req: CipherRequest): CipherOutcome {
  try {
    return runUnsafe(req)
  } catch (e) {
    if (e instanceof CipherError) {
      const fail: CipherFailure = { ok: false, error: e.message, field: e.field }
      const suggestion = suggestFix(req, e)
      if (suggestion) fail.suggestion = suggestion
      return fail
    }
    return { ok: false, error: `处理失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * 与 runCipher 结果相同，但 PBKDF2 口令派生先用 WebCrypto 异步完成，界面不会卡顿。
 * 加密且未指定盐时，会先随机生成盐再派生（结果里的 used.salt 即实际使用的盐）。
 */
export async function runCipherAsync(req: CipherRequest): Promise<CipherOutcome> {
  if (req.keyMode !== 'passphrase' || req.kdf !== 'pbkdf2' || !req.passphrase) {
    return runCipher(req)
  }
  let next = req
  try {
    let salt: Uint8Array | null = null
    if (req.direction === 'encrypt') {
      if (req.salt.trim()) salt = hexToBytes(req.salt.trim())
      else {
        salt = randomBytes(8)
        next = { ...req, salt: bytesToHex(salt) }
      }
    } else {
      const data = decodeCiphertext(req.input, req.cipherEncoding)
      if (hasSaltedHeader(data)) salt = data.slice(8, 16)
    }
    const { iterations } = req
    if (salt?.length === 8 && Number.isInteger(iterations) && iterations >= 1) {
      if (iterations <= MAX_ITERATIONS) {
        const { keySize, ivSize } = derivedSizes({ ...req, passphrase: new Uint8Array(0) })
        await pbkdf2Sha256Async(utf8Encode(req.passphrase), salt, keySize + ivSize, iterations)
      }
    }
  } catch {
    // 参数有误：交给 runCipher 给出具体的错误信息
  }
  return runCipher(next)
}

function runUnsafe(req: CipherRequest): CipherSuccess {
  const opts = { algo: req.algo, mode: req.mode, padding: req.padding }
  const warnings: string[] = []

  // 输入
  let input: Uint8Array
  if (req.direction === 'encrypt') {
    input = decodeField(req.input, req.plainEncoding, '明文', 'input')
  } else {
    input = decodeCiphertext(req.input, req.cipherEncoding)
    if (input.length === 0) throw new CipherError('请输入要解密的密文', 'input')
  }

  let out: Uint8Array
  let used: CipherSuccess['used']
  if (req.keyMode === 'passphrase') {
    if (!req.passphrase) throw new CipherError('请输入口令', 'passphrase')
    const po: PassphraseOptions = {
      ...opts,
      passphrase: utf8Encode(req.passphrase),
      kdf: req.kdf,
      iterations: req.iterations,
      keySize: req.keySize,
    }
    let r: PassphraseResult
    if (req.direction === 'encrypt') {
      const salt = req.salt.trim()
        ? decodeField(req.salt.trim(), 'hex', '盐', 'salt')
        : randomBytes(8)
      r = encryptWithPassphrase(po, input, salt)
    } else {
      r = decryptWithPassphrase(po, input)
    }
    out = r.data
    used = { key: bytesToHex(r.key), iv: bytesToHex(r.iv), salt: bytesToHex(r.salt) }
    warnings.push(...cipherWarnings(req.algo, req.mode, req.padding, r.key))
    if (req.kdf !== 'pbkdf2') {
      warnings.push('EVP_BytesToKey 只做一次哈希，抗暴力破解能力弱；新数据建议使用 PBKDF2。')
    }
  } else {
    const key = decodeField(req.key, req.keyEncoding, '密钥', 'key')
    const ivReq = ivRequirement(req.algo, req.mode)
    const iv =
      ivReq === 'none' ? new Uint8Array(0) : decodeField(req.iv, req.ivEncoding, 'IV', 'iv')
    const ro: RawCipherOptions = { ...opts, key, iv }
    out = req.direction === 'encrypt' ? encryptBytes(ro, input) : decryptBytes(ro, input)
    used = { key: bytesToHex(key), iv: bytesToHex(iv) }
    warnings.push(...cipherWarnings(req.algo, req.mode, req.padding, key))
  }

  let output: string
  if (req.direction === 'encrypt') {
    output = req.cipherEncoding === 'hex' ? bytesToHex(out) : bytesToBase64(out)
  } else if (req.plainEncoding === 'utf8') {
    try {
      output = utf8Decode(out, true)
    } catch (e) {
      const at =
        e instanceof ByteDecodeError && e.position !== undefined
          ? `（第 ${e.position + 1} 字节起）`
          : ''
      throw new CipherError(
        `解密完成，但结果不是有效的 UTF-8 文本${at}。可能是密钥、IV、模式或填充不对；如果原文本来就是二进制，请把明文编码切换为 Hex 或 Base64。`,
      )
    }
  } else {
    output = req.plainEncoding === 'hex' ? bytesToHex(out) : bytesToBase64(out)
  }

  return {
    ok: true,
    output,
    used,
    inputBytes: input.length,
    outputBytes: out.length,
    warnings: [...new Set(warnings)],
  }
}

/** 随机密钥 / IV 的字节数 */
export function randomKeySize(algo: CipherAlgo, preferred?: number): number {
  const info = CIPHERS[algo]
  if (preferred && (info.keySizes.includes(preferred) || (algo === 'RC4' && preferred <= 256))) {
    return preferred
  }
  return info.defaultKeySize
}

// ───────────── 等价的 OpenSSL 命令 ─────────────

/** POSIX shell 单引号转义 */
export function shellQuote(s: string): string {
  if (/^[\w@%+=:,./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export type OpensslCommand = { ok: true; command: string } | { ok: false; reason: string }

/**
 * 生成与当前参数等价的 `openssl enc` 命令（从标准输入读取原始字节）。
 * used 为 runCipher 返回的实际密钥 / IV（Hex）。
 */
export function opensslCommand(
  req: Pick<
    CipherRequest,
    | 'direction'
    | 'algo'
    | 'mode'
    | 'padding'
    | 'keyMode'
    | 'passphrase'
    | 'kdf'
    | 'iterations'
    | 'keySize'
    | 'cipherEncoding'
  >,
  used: { key: string; iv: string },
): OpensslCommand {
  const info = CIPHERS[req.algo]
  const keyBytes =
    req.keyMode === 'raw' ? used.key.length / 2 : (req.keySize ?? info.defaultKeySize)
  const name = opensslName(req.algo, req.mode, keyBytes)
  if (!name) {
    return {
      ok: false,
      reason:
        req.algo === 'RC4'
          ? 'OpenSSL 的 rc4 固定使用 16 字节密钥'
          : `OpenSSL enc 没有 ${info.label}${isStream(req.algo) ? '' : `-${req.mode}`} 对应的算法`,
    }
  }
  if (!isStream(req.algo)) {
    if (needsAlignment(req.mode) && req.padding !== 'Pkcs7' && req.padding !== 'NoPadding') {
      return { ok: false, reason: 'OpenSSL enc 只支持 PKCS7 填充或不填充（-nopad）' }
    }
    if (!needsAlignment(req.mode) && req.padding !== 'NoPadding') {
      return {
        ok: false,
        reason: `OpenSSL 在 ${req.mode} 模式下不填充；把填充改为 NoPadding 即可得到一致的结果`,
      }
    }
  }
  const legacy = /^(des-(?!ede)|rc4)/.test(name)
  const parts = ['openssl', 'enc']
  if (req.direction === 'decrypt') parts.push('-d')
  parts.push(`-${name}`)
  if (legacy) parts.push('-provider', 'legacy', '-provider', 'default')
  if (req.keyMode === 'raw') {
    parts.push('-K', used.key)
    if (used.iv && (req.algo === 'Rabbit' || ivRequirement(req.algo, req.mode) !== 'none')) {
      parts.push('-iv', used.iv)
    }
    if (!isStream(req.algo) && req.padding === 'NoPadding' && needsAlignment(req.mode)) {
      parts.push('-nopad')
    }
  } else {
    if (req.kdf === 'pbkdf2')
      parts.push('-pbkdf2', '-iter', String(req.iterations), '-md', 'sha256')
    else parts.push('-md', req.kdf)
    parts.push('-pass', `pass:${shellQuote(req.passphrase)}`)
  }
  let command = parts.join(' ')
  if (req.cipherEncoding === 'base64') command += ' -base64 -A'
  else if (req.direction === 'encrypt') command += " | xxd -p | tr -d '\\n'"
  else command = `xxd -r -p | ${command}`
  return { ok: true, command }
}
