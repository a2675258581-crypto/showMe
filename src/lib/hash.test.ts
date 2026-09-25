import { describe, expect, it } from 'vitest'
import {
  ALL_HASH_IDS,
  HASH_ALGOS,
  HashAbortedError,
  digestsToText,
  formatDigest,
  hashBytes,
  hashChunks,
  matchDigest,
  md5Variants,
  parseExpectedDigest,
  type HashAlgoId,
  type HashDigests,
} from './hash'
import { bytesToHex, hexToBytes, utf16leEncode, utf8Encode } from './hash-bytes'

const hexOf = (d: HashDigests) =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, bytesToHex(v!)]))

// 各算法的标准测试向量（FIPS 180 / FIPS 202 / GB/T 32905 / 官方参考实现）
const ABC: Record<HashAlgoId, string> = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  'md5-16': '3cd24fb0d6963f7d',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha224: '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  sha384:
    'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
  sha512:
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  'sha3-256': '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
  'sha3-512':
    'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0',
  keccak256: '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  sm3: '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0',
  crc32: '352441c2',
  xxhash64: '44bc2cf5ad770999',
  blake3: '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85',
}

const EMPTY: Record<HashAlgoId, string> = {
  md5: 'd41d8cd98f00b204e9800998ecf8427e',
  'md5-16': '8f00b204e9800998',
  sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
  sha224: 'd14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f',
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  sha384:
    '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
  sha512:
    'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
  'sha3-256': 'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
  'sha3-512':
    'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26',
  keccak256: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  sm3: '1ab21d8355cfa17f8e61194831e81a8f22bec8c728fefb747ed035eb5082aa2b',
  crc32: '00000000',
  xxhash64: 'ef46db3751d8e999',
  blake3: 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
}

/** 用 Node 自带的 OpenSSL 做交叉验证（动态导入，避免浏览器类型依赖） */
async function nodeHash(alg: string, data: Uint8Array): Promise<string> {
  const mod = 'node:crypto'
  const nc = (await import(/* @vite-ignore */ mod)) as {
    createHash: (a: string) => { update(d: Uint8Array): { digest(e: 'hex'): string } }
  }
  return nc.createHash(alg).update(data).digest('hex')
}

describe('hashBytes', () => {
  it('lists every algorithm once', () => {
    expect(new Set(ALL_HASH_IDS).size).toBe(HASH_ALGOS.length)
    expect(ALL_HASH_IDS).toHaveLength(14)
  })

  it('matches standard vectors for "abc"', async () => {
    expect(hexOf(await hashBytes(utf8Encode('abc')))).toEqual(ABC)
  })

  it('matches standard vectors for empty input', async () => {
    expect(hexOf(await hashBytes(new Uint8Array(0)))).toEqual(EMPTY)
  })

  it('CRC32 check value and a classic MD5', async () => {
    const d = await hashBytes(utf8Encode('123456789'), ['crc32'])
    expect(bytesToHex(d.crc32!)).toBe('cbf43926')
    const fox = await hashBytes(utf8Encode('The quick brown fox jumps over the lazy dog'), [
      'md5',
      'sha3-512',
    ])
    expect(bytesToHex(fox.md5!)).toBe('9e107d9d372bb6826bd81d3542a419d6')
    expect(bytesToHex(fox['sha3-512']!)).toBe(
      '01dedd5de4ef14642445ba5f5b97c15e47b9ad931326e4b0727cd94cefc44fff23f07bf543139939b49128caf436dc1bdee54fcb24023a08d9403f9b4bf0d450',
    )
  })

  it('hashes UTF-8 Chinese text', async () => {
    const d = await hashBytes(utf8Encode('中文'), ['md5', 'md5-16'])
    expect(bytesToHex(d.md5!)).toBe('a7bac2239fcdcb3a067903d8077c4a07')
    expect(bytesToHex(d['md5-16']!)).toBe('9fcdcb3a067903d8')
  })

  it('agrees with OpenSSL for emoji / mixed unicode, UTF-8 and UTF-16LE', async () => {
    const text = 'Hello, 世界 👋🏽 — ünïcødé\n\t'
    for (const bytes of [utf8Encode(text), utf16leEncode(text)]) {
      const d = await hashBytes(bytes)
      expect(bytesToHex(d.md5!)).toBe(await nodeHash('md5', bytes))
      expect(bytesToHex(d.sha1!)).toBe(await nodeHash('sha1', bytes))
      expect(bytesToHex(d.sha224!)).toBe(await nodeHash('sha224', bytes))
      expect(bytesToHex(d.sha256!)).toBe(await nodeHash('sha256', bytes))
      expect(bytesToHex(d.sha384!)).toBe(await nodeHash('sha384', bytes))
      expect(bytesToHex(d.sha512!)).toBe(await nodeHash('sha512', bytes))
      expect(bytesToHex(d['sha3-256']!)).toBe(await nodeHash('sha3-256', bytes))
      expect(bytesToHex(d['sha3-512']!)).toBe(await nodeHash('sha3-512', bytes))
      expect(bytesToHex(d.sm3!)).toBe(await nodeHash('sm3', bytes))
    }
  })

  it('only returns requested algorithms (md5-16 alone does not leak md5)', async () => {
    const d = await hashBytes(utf8Encode('abc'), ['md5-16', 'sha1'])
    expect(Object.keys(d).sort()).toEqual(['md5-16', 'sha1'])
  })
})

describe('hashChunks', () => {
  const big = new Uint8Array(5 * 1024 * 1024 + 123)
  for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24

  it('streams a large blob in uneven chunks with identical results', async () => {
    const progress: number[] = []
    const streamed = await hashChunks(new Blob([big]), {
      chunkSize: 1_000_003,
      onProgress: (done, total) => {
        expect(total).toBe(big.length)
        progress.push(done)
      },
    })
    const whole = await hashBytes(big)
    expect(hexOf(streamed)).toEqual(hexOf(whole))
    expect(bytesToHex(streamed.sha256!)).toBe(await nodeHash('sha256', big))
    expect(progress[0]).toBe(0)
    expect(progress[progress.length - 1]).toBe(big.length)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  })

  it('handles an empty file', async () => {
    const d = await hashChunks(new Blob([]), { ids: ['sha256', 'crc32'] })
    expect(bytesToHex(d.sha256!)).toBe(EMPTY.sha256)
    expect(bytesToHex(d.crc32!)).toBe('00000000')
  })

  it('can be cancelled mid-way', async () => {
    const ctrl = new AbortController()
    let calls = 0
    const run = hashChunks(new Blob([big]), {
      chunkSize: 512 * 1024,
      signal: ctrl.signal,
      onProgress: () => {
        if (++calls === 3) ctrl.abort()
      },
    })
    await expect(run).rejects.toBeInstanceOf(HashAbortedError)
    expect(calls).toBeLessThan(6)
  })
})

describe('formatDigest', () => {
  const bytes = hexToBytes('900150983cd24fb0d6963f7d28e17f72')
  it('hex lower / upper and base64', () => {
    expect(formatDigest(bytes, 'hex')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(formatDigest(bytes, 'hex', true)).toBe('900150983CD24FB0D6963F7D28E17F72')
    expect(formatDigest(bytes, 'base64')).toBe('kAFQmDzST7DWlj99KOF/cg==')
    expect(formatDigest(bytes, 'base64', true)).toBe('kAFQmDzST7DWlj99KOF/cg==')
  })

  it('digestsToText lists lines in algorithm order', async () => {
    const d = await hashBytes(utf8Encode('abc'), ['sha1', 'md5'])
    expect(digestsToText(d, 'hex', true)).toBe(
      'MD5: 900150983CD24FB0D6963F7D28E17F72\nSHA-1: A9993E364706816ABA3E25717850C26C9CD0D89D',
    )
  })
})

describe('md5Variants', () => {
  it('gives 32 / 16 位 in lower and upper case', async () => {
    const d = await hashBytes(utf8Encode('abc'), ['md5'])
    expect(md5Variants(d.md5!).map((v) => [v.label, v.value])).toEqual([
      ['32 位小写', '900150983cd24fb0d6963f7d28e17f72'],
      ['32 位大写', '900150983CD24FB0D6963F7D28E17F72'],
      ['16 位小写', '3cd24fb0d6963f7d'],
      ['16 位大写', '3CD24FB0D6963F7D'],
    ])
  })
})

describe('matchDigest', () => {
  let digests: HashDigests
  const load = async () => (digests ??= await hashBytes(utf8Encode('abc')))

  it('empty input', async () => {
    expect(matchDigest('   ', await load())).toEqual({ status: 'empty' })
  })

  it('matches hex regardless of case and whitespace', async () => {
    const r = matchDigest(' 900150983CD24FB0 D6963F7D28E17F72 \n', await load())
    expect(r).toEqual({ status: 'match', ids: ['md5'], format: 'hex' })
    const grouped = matchDigest(
      'ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 96177a9c b410ff61 f20015ad',
      await load(),
    )
    expect(grouped.status === 'match' && grouped.ids).toEqual(['sha256'])
  })

  it('matches md5 16-bit, base64, SRI and sha256sum formats', async () => {
    const d = await load()
    expect(matchDigest('3cd24fb0d6963f7d', d)).toMatchObject({ ids: ['md5-16'] })
    expect(matchDigest('kAFQmDzST7DWlj99KOF/cg==', d)).toMatchObject({
      status: 'match',
      ids: ['md5'],
      format: 'base64',
    })
    expect(matchDigest('sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=', d)).toMatchObject({
      ids: ['sha256'],
    })
    expect(matchDigest(`sha256:${ABC.sha256}`, d)).toMatchObject({ ids: ['sha256'] })
    expect(matchDigest(`${ABC.sm3}  ./abc.txt`, d)).toMatchObject({ ids: ['sm3'] })
    expect(matchDigest(`0x${ABC.keccak256}`, d)).toMatchObject({ ids: ['keccak256'] })
  })

  it('matches colon-separated fingerprints (openssl / ssh-keygen style)', async () => {
    const d = await load()
    const colon = ABC.sha256.toUpperCase().match(/../g)!.join(':')
    expect(matchDigest(colon, d)).toMatchObject({ status: 'match', ids: ['sha256'] })
    expect(matchDigest(`SHA256 Fingerprint=${colon}`, d)).toMatchObject({ ids: ['sha256'] })
    expect(matchDigest(`MD5:${ABC.md5.match(/../g)!.join(':')}`, d)).toMatchObject({
      ids: ['md5'],
    })
    // 不成对的分隔写法仍按错误处理
    expect(matchDigest('90:015:09', d).status).not.toBe('match')
  })

  it('reports mismatch with the algorithms of the same length', async () => {
    const r = matchDigest('00000000000000000000000000000000', await load())
    expect(r).toEqual({ status: 'mismatch', byteLength: 16, sameLength: ['md5'], format: 'hex' })
    const r2 = matchDigest('0'.repeat(64), await load())
    expect(r2.status === 'mismatch' && r2.sameLength).toEqual([
      'sha256',
      'sha3-256',
      'keccak256',
      'sm3',
      'blake3',
    ])
  })

  it('rejects garbage', async () => {
    expect(matchDigest('not a hash!', await load()).status).toBe('invalid')
    expect(parseExpectedDigest('中文')).toMatchObject({ error: expect.any(String) })
  })
})
