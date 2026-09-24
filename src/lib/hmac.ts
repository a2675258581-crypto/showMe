/**
 * HMAC 计算（纯逻辑，基于 hash-wasm 的 createHMAC）。
 */
import {
  createHMAC,
  createMD5,
  createSHA1,
  createSHA224,
  createSHA256,
  createSHA3,
  createSHA384,
  createSHA512,
  createSM3,
  type IHasher,
} from 'hash-wasm'
import { ByteDecodeError, decodeInput, type ByteEncoding } from './hash-bytes'

export type HmacAlgoId =
  'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512' | 'sha3-256' | 'sm3'

export interface HmacAlgo {
  id: HmacAlgoId
  label: string
  bits: number
  /** 块大小（字节），超过块大小的密钥会先被哈希 */
  blockSize: number
  note: string
}

export const HMAC_ALGOS: readonly HmacAlgo[] = [
  { id: 'md5', label: 'HMAC-MD5', bits: 128, blockSize: 64, note: 'RFC 2104，老接口常见' },
  { id: 'sha1', label: 'HMAC-SHA1', bits: 160, blockSize: 64, note: 'OAuth 1.0、TOTP 默认' },
  { id: 'sha224', label: 'HMAC-SHA224', bits: 224, blockSize: 64, note: 'SHA-2 家族' },
  {
    id: 'sha256',
    label: 'HMAC-SHA256',
    bits: 256,
    blockSize: 64,
    note: 'API 签名、Webhook、JWT HS256',
  },
  { id: 'sha384', label: 'HMAC-SHA384', bits: 384, blockSize: 128, note: 'JWT HS384' },
  { id: 'sha512', label: 'HMAC-SHA512', bits: 512, blockSize: 128, note: 'JWT HS512' },
  { id: 'sha3-256', label: 'HMAC-SHA3-256', bits: 256, blockSize: 136, note: 'FIPS 202 SHA-3' },
  { id: 'sm3', label: 'HMAC-SM3', bits: 256, blockSize: 64, note: '国密 SM3 杂凑' },
]

export const ALL_HMAC_IDS: readonly HmacAlgoId[] = HMAC_ALGOS.map((a) => a.id)

export const hmacAlgo = (id: HmacAlgoId): HmacAlgo => HMAC_ALGOS.find((a) => a.id === id)!

const FACTORIES: Record<HmacAlgoId, () => Promise<IHasher>> = {
  md5: createMD5,
  sha1: createSHA1,
  sha224: createSHA224,
  sha256: createSHA256,
  sha384: createSHA384,
  sha512: createSHA512,
  'sha3-256': () => createSHA3(256),
  sm3: createSM3,
}

export type HmacDigests = Partial<Record<HmacAlgoId, Uint8Array>>

/** 计算多种 HMAC；key / message 为原始字节 */
export async function hmacAll(
  key: Uint8Array,
  message: Uint8Array,
  ids: readonly HmacAlgoId[] = ALL_HMAC_IDS,
): Promise<HmacDigests> {
  const list = await Promise.all(ids.map((id) => createHMAC(FACTORIES[id](), key)))
  const out: HmacDigests = {}
  ids.forEach((id, i) => {
    out[id] = list[i].init().update(message).digest('binary')
  })
  return out
}

export async function hmac(id: HmacAlgoId, key: Uint8Array, message: Uint8Array) {
  return (await hmacAll(key, message, [id]))[id]!
}

/** 把用户输入按编码转成字节，出错时给出带字段名的中文说明 */
export function decodeField(
  text: string,
  enc: ByteEncoding,
  field: string,
): { bytes: Uint8Array } | { error: string } {
  try {
    return { bytes: decodeInput(text, enc) }
  } catch (e) {
    const msg = e instanceof ByteDecodeError ? e.message : String(e)
    return { error: `${field}：${msg}` }
  }
}
