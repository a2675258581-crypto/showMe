/**
 * 哈希计算（纯逻辑，基于 hash-wasm，浏览器与 Node 都能跑）。
 * 一次性计算多种摘要；大文件按块增量计算，可汇报进度、可取消。
 */
import {
  createBLAKE3,
  createCRC32,
  createKeccak,
  createMD5,
  createSHA1,
  createSHA224,
  createSHA256,
  createSHA3,
  createSHA384,
  createSHA512,
  createSM3,
  createXXHash64,
  type IHasher,
} from 'hash-wasm'
import { base64ToBytes, bytesEqual, bytesToBase64, bytesToHex, hexToBytes } from './hash-bytes'

export type HashAlgoId =
  | 'md5'
  | 'md5-16'
  | 'sha1'
  | 'sha224'
  | 'sha256'
  | 'sha384'
  | 'sha512'
  | 'sha3-256'
  | 'sha3-512'
  | 'keccak256'
  | 'sm3'
  | 'crc32'
  | 'xxhash64'
  | 'blake3'

export interface HashAlgo {
  id: HashAlgoId
  label: string
  /** 输出位数 */
  bits: number
  /** 简短说明 */
  note: string
  /** 不安全 / 仅作校验 */
  weak?: boolean
  /** 由其它算法的结果派生（md5-16 取自 md5） */
  derivedFrom?: HashAlgoId
}

export const HASH_ALGOS: readonly HashAlgo[] = [
  { id: 'md5', label: 'MD5', bits: 128, note: '最常见的文件校验值', weak: true },
  {
    id: 'md5-16',
    label: 'MD5 16 位',
    bits: 64,
    note: '取 32 位 MD5 的中间 16 位（第 9–24 位）',
    weak: true,
    derivedFrom: 'md5',
  },
  { id: 'sha1', label: 'SHA-1', bits: 160, note: 'Git 对象 ID 使用', weak: true },
  { id: 'sha224', label: 'SHA-224', bits: 224, note: 'SHA-2 家族' },
  { id: 'sha256', label: 'SHA-256', bits: 256, note: '通用首选，下载校验、区块链' },
  { id: 'sha384', label: 'SHA-384', bits: 384, note: 'SHA-2 家族，TLS 常用' },
  { id: 'sha512', label: 'SHA-512', bits: 512, note: 'SHA-2 家族，64 位平台更快' },
  { id: 'sha3-256', label: 'SHA3-256', bits: 256, note: 'FIPS 202 标准 SHA-3' },
  { id: 'sha3-512', label: 'SHA3-512', bits: 512, note: 'FIPS 202 标准 SHA-3' },
  { id: 'keccak256', label: 'Keccak-256', bits: 256, note: '以太坊使用（与 SHA3-256 填充不同）' },
  { id: 'sm3', label: 'SM3', bits: 256, note: '国密杂凑算法 GB/T 32905' },
  { id: 'crc32', label: 'CRC32', bits: 32, note: 'ZIP / PNG 使用的循环冗余校验', weak: true },
  { id: 'xxhash64', label: 'xxHash64', bits: 64, note: '极快的非加密哈希', weak: true },
  { id: 'blake3', label: 'BLAKE3', bits: 256, note: '现代高速加密哈希' },
]

export const ALL_HASH_IDS: readonly HashAlgoId[] = HASH_ALGOS.map((a) => a.id)

export const hashAlgo = (id: HashAlgoId): HashAlgo => HASH_ALGOS.find((a) => a.id === id)!

type RealId = Exclude<HashAlgoId, 'md5-16'>

const FACTORIES: Record<RealId, () => Promise<IHasher>> = {
  md5: createMD5,
  sha1: createSHA1,
  sha224: createSHA224,
  sha256: createSHA256,
  sha384: createSHA384,
  sha512: createSHA512,
  'sha3-256': () => createSHA3(256),
  'sha3-512': () => createSHA3(512),
  keccak256: () => createKeccak(256),
  sm3: createSM3,
  crc32: () => createCRC32(),
  xxhash64: () => createXXHash64(),
  blake3: () => createBLAKE3(),
}

export type HashDigests = Partial<Record<HashAlgoId, Uint8Array>>

/** 需要真正实例化的底层算法（md5-16 依赖 md5） */
function realIds(ids: readonly HashAlgoId[]): RealId[] {
  const set = new Set<RealId>()
  for (const id of ids) set.add(id === 'md5-16' ? 'md5' : id)
  return ALL_HASH_IDS.filter((id): id is RealId => set.has(id as RealId))
}

async function createHashers(ids: readonly HashAlgoId[]) {
  const real = realIds(ids)
  const list = await Promise.all(real.map((id) => FACTORIES[id]()))
  return real.map((id, i) => ({ id, hasher: list[i].init() }))
}

function finish(
  ids: readonly HashAlgoId[],
  hashers: { id: RealId; hasher: IHasher }[],
): HashDigests {
  const out: HashDigests = {}
  for (const { id, hasher } of hashers) out[id] = hasher.digest('binary')
  if (ids.includes('md5-16') && out.md5) out['md5-16'] = out.md5.slice(4, 12)
  if (!ids.includes('md5')) delete out.md5
  return out
}

/** 一次性计算多种哈希 */
export async function hashBytes(
  data: Uint8Array,
  ids: readonly HashAlgoId[] = ALL_HASH_IDS,
): Promise<HashDigests> {
  const hashers = await createHashers(ids)
  for (const { hasher } of hashers) hasher.update(data)
  return finish(ids, hashers)
}

/** 取消时抛出的错误 */
export class HashAbortedError extends Error {
  constructor() {
    super('已取消')
    this.name = 'HashAbortedError'
  }
}

/** 能按字节区间读取的数据源（浏览器 File / Blob 满足此接口） */
export interface ChunkSource {
  size: number
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

export interface HashStreamOptions {
  ids?: readonly HashAlgoId[]
  /** 每块字节数，默认 2 MB */
  chunkSize?: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0))

/** 分块增量计算（大文件不会一次读进内存），每块之间让出主线程 */
export async function hashChunks(
  source: ChunkSource,
  { ids = ALL_HASH_IDS, chunkSize = 2 * 1024 * 1024, onProgress, signal }: HashStreamOptions = {},
): Promise<HashDigests> {
  const hashers = await createHashers(ids)
  const total = source.size
  onProgress?.(0, total)
  for (let pos = 0; pos < total; pos += chunkSize) {
    if (signal?.aborted) throw new HashAbortedError()
    const end = Math.min(total, pos + chunkSize)
    const buf = new Uint8Array(await source.slice(pos, end).arrayBuffer())
    if (signal?.aborted) throw new HashAbortedError()
    for (const { hasher } of hashers) hasher.update(buf)
    onProgress?.(end, total)
    await yieldToEventLoop()
  }
  if (signal?.aborted) throw new HashAbortedError()
  return finish(ids, hashers)
}

export type DigestFormat = 'hex' | 'base64'

export function formatDigest(bytes: Uint8Array, format: DigestFormat, upper = false): string {
  return format === 'hex' ? bytesToHex(bytes, upper) : bytesToBase64(bytes)
}

// ───────────── 校验：粘贴期望值，找出匹配的算法 ─────────────

export type MatchResult<T extends string = string> =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'match'; ids: T[]; format: DigestFormat }
  | { status: 'mismatch'; byteLength: number; sameLength: T[]; format: DigestFormat }

/** 形如 "sha256-..."（SRI）、"sha256:..."（Docker）、"md5=..." 的前缀 */
const PREFIX = /^([a-z][a-z0-9]*(?:-\d+)?)\s*[:=-]\s*/i

/**
 * 解析期望的摘要：去掉常见前缀与空白，优先按 Hex 解析，否则按 Base64。
 * 也接受 `sha256sum` 输出（"<hash>  文件名"）。
 */
export function parseExpectedDigest(
  input: string,
): { bytes: Uint8Array; format: DigestFormat } | { error: string } | null {
  let s = input.trim()
  if (!s) return null
  // openssl x509 -fingerprint 的输出：「SHA256 Fingerprint=AB:CD:…」
  s = s.replace(/^[a-z][a-z0-9-]*\s+fingerprint\s*=\s*/i, '')
  const m = PREFIX.exec(s)
  if (m && /^(md5|sha|sm3|crc|xxh|blake|keccak)/i.test(m[1])) s = s.slice(m[0].length)
  let compact = s.replace(/\s+/g, '')
  // 冒号 / 短横线分隔的十六进制（证书指纹、ssh-keygen -E md5 常见）
  if (/^[0-9a-f]{2}(?:[:-][0-9a-f]{2})+$/i.test(compact)) compact = compact.replace(/[:-]/g, '')
  // sha256sum / md5sum 输出（"<hash>  文件名"）：取第一段
  const sum = /^([0-9a-f]{8,})\s+\*?\S/i.exec(s)
  if (sum && !/^[0-9a-f]+$/i.test(compact)) compact = sum[1]
  if (/^(0x)?[0-9a-f]+$/i.test(compact)) {
    const hex = compact.replace(/^0x/i, '')
    if (hex.length % 2 === 0) return { bytes: hexToBytes(hex), format: 'hex' }
  }
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    try {
      return { bytes: base64ToBytes(compact), format: 'base64' }
    } catch {
      // 落到下面的错误
    }
  }
  return { error: '无法识别期望值：请粘贴 Hex（如 900150…）或 Base64 格式的摘要' }
}

/** 在一组结果里查找与期望值一致的项（不区分大小写，Hex / Base64 均可） */
export function matchDigest<T extends string>(
  input: string,
  digests: Partial<Record<T, Uint8Array>>,
): MatchResult<T> {
  const parsed = parseExpectedDigest(input)
  if (!parsed) return { status: 'empty' }
  if ('error' in parsed) return { status: 'invalid', message: parsed.error }
  const entries = Object.entries(digests) as [T, Uint8Array | undefined][]
  const ids = entries.filter(([, d]) => d && bytesEqual(d, parsed.bytes)).map(([id]) => id)
  if (ids.length) return { status: 'match', ids, format: parsed.format }
  return {
    status: 'mismatch',
    byteLength: parsed.bytes.length,
    sameLength: entries.filter(([, d]) => d?.length === parsed.bytes.length).map(([id]) => id),
    format: parsed.format,
  }
}

/** 把结果整理成「算法: 值」多行文本，便于一次复制 */
export function digestsToText(
  digests: HashDigests,
  format: DigestFormat,
  upper: boolean,
  ids: readonly HashAlgoId[] = ALL_HASH_IDS,
): string {
  return ids
    .filter((id) => digests[id])
    .map((id) => `${hashAlgo(id).label}: ${formatDigest(digests[id]!, format, upper)}`)
    .join('\n')
}
