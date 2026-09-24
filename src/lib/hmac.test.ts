import { describe, expect, it } from 'vitest'
import { ALL_HMAC_IDS, HMAC_ALGOS, decodeField, hmac, hmacAll, type HmacAlgoId } from './hmac'
import { bytesToHex, hexToBytes, utf16leEncode, utf8Encode } from './hash-bytes'
import { formatDigest, matchDigest } from './hash'

const rep = (byte: number, n: number) => new Uint8Array(n).fill(byte)
const seq = (from: number, to: number) =>
  Uint8Array.from({ length: to - from + 1 }, (_, i) => from + i)
const txt = utf8Encode

async function nodeHmac(alg: string, key: Uint8Array, data: Uint8Array): Promise<string> {
  const mod = 'node:crypto'
  const nc = (await import(/* @vite-ignore */ mod)) as {
    createHmac: (
      a: string,
      k: Uint8Array,
    ) => { update(d: Uint8Array): { digest(e: 'hex'): string } }
  }
  return nc.createHmac(alg, key).update(data).digest('hex')
}

const NODE_NAME: Record<HmacAlgoId, string> = {
  md5: 'md5',
  sha1: 'sha1',
  sha224: 'sha224',
  sha256: 'sha256',
  sha384: 'sha384',
  sha512: 'sha512',
  'sha3-256': 'sha3-256',
  sm3: 'sm3',
}

describe('RFC 2202 HMAC-MD5 / HMAC-SHA1', () => {
  const cases: { key: Uint8Array; data: Uint8Array; md5: string; sha1: string }[] = [
    {
      key: rep(0x0b, 16),
      data: txt('Hi There'),
      md5: '9294727a3638bb1c13f48ef8158bfc9d',
      sha1: '',
    },
    {
      key: txt('Jefe'),
      data: txt('what do ya want for nothing?'),
      md5: '750c783e6ab0b503eaa86e310a5db738',
      sha1: 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    },
    {
      key: rep(0xaa, 16),
      data: rep(0xdd, 50),
      md5: '56be34521d144c88dbb8c733f0e8b3f6',
      sha1: '',
    },
    {
      key: seq(1, 25),
      data: rep(0xcd, 50),
      md5: '697eaf0aca3a3aea3a75164746ffaa79',
      sha1: '4c9007f4026250c6bc8414f9bf50c86c2d7235da',
    },
    {
      key: rep(0xaa, 80),
      data: txt('Test Using Larger Than Block-Size Key - Hash Key First'),
      md5: '6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd',
      sha1: 'aa4ae5e15272d00e95705637ce8a3b55ed402112',
    },
    {
      key: rep(0xaa, 80),
      data: txt('Test Using Larger Than Block-Size Key and Larger Than One Block-Size Data'),
      md5: '6f630fad67cda0ee1fb1f562db3aa53e',
      sha1: 'e8e99d0f45237d786d6bbaa7965c7808bbff1a91',
    },
  ]

  it.each(cases.map((c, i) => [i + 1, c] as const))('HMAC-MD5 case %i', async (_, c) => {
    expect(bytesToHex(await hmac('md5', c.key, c.data))).toBe(c.md5)
  })

  it.each(cases.filter((c) => c.sha1).map((c, i) => [i + 1, c] as const))(
    'HMAC-SHA1 case %i',
    async (_, c) => {
      expect(bytesToHex(await hmac('sha1', c.key, c.data))).toBe(c.sha1)
    },
  )

  it('HMAC-SHA1 cases with 20-byte keys', async () => {
    expect(bytesToHex(await hmac('sha1', rep(0x0b, 20), txt('Hi There')))).toBe(
      'b617318655057264e28bc0b6fb378c8ef146be00',
    )
    expect(bytesToHex(await hmac('sha1', rep(0xaa, 20), rep(0xdd, 50)))).toBe(
      '125d7342b9ac11cd91a39af48aa17b4f63f175d3',
    )
    expect(bytesToHex(await hmac('sha1', rep(0x0c, 20), txt('Test With Truncation')))).toBe(
      '4c1a03424b55e07fe7f27be1d58bb9324a9a5a04',
    )
  })
})

describe('RFC 4231 HMAC-SHA-224/256/384/512', () => {
  const cases: {
    name: string
    key: Uint8Array
    data: Uint8Array
    out: [string, string, string, string]
    truncate?: number
  }[] = [
    {
      name: 'TC1',
      key: rep(0x0b, 20),
      data: txt('Hi There'),
      out: [
        '896fb1128abbdf196832107cd49df33f47b4b1169912ba4f53684b22',
        'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
        'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
        '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
      ],
    },
    {
      name: 'TC2',
      key: txt('Jefe'),
      data: txt('what do ya want for nothing?'),
      out: [
        'a30e01098bc6dbbf45690f3a7e9e6d0f8bbea2a39e6148008fd05e44',
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
        'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
        '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
      ],
    },
    {
      name: 'TC3',
      key: rep(0xaa, 20),
      data: rep(0xdd, 50),
      out: [
        '7fb3cb3588c6c1f6ffa9694d7d6ad2649365b0c1f65d69d1ec8333ea',
        '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
        '88062608d3e6ad8a0aa2ace014c8a86f0aa635d947ac9febe83ef4e55966144b2a5ab39dc13814b94e3ab6e101a34f27',
        'fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb',
      ],
    },
    {
      name: 'TC4',
      key: seq(1, 25),
      data: rep(0xcd, 50),
      out: [
        '6c11506874013cac6a2abc1bb382627cec6a90d86efc012de7afec5a',
        '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
        '3e8a69b7783c25851933ab6290af6ca77a9981480850009cc5577c6e1f573b4e6801dd23c4a7d679ccf8a386c674cffb',
        'b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd',
      ],
    },
    {
      name: 'TC5 (truncated to 128 bits)',
      key: rep(0x0c, 20),
      data: txt('Test With Truncation'),
      truncate: 16,
      out: [
        '0e2aea68a90c8d37c988bcdb9fca6fa8',
        'a3b6167473100ee06e0c796c2955552b',
        '3abf34c3503b2a23a46efc619baef897',
        '415fad6271580a531d4179bc891d87a6',
      ],
    },
    {
      name: 'TC6',
      key: rep(0xaa, 131),
      data: txt('Test Using Larger Than Block-Size Key - Hash Key First'),
      out: [
        '95e9a0db962095adaebe9b2d6f0dbce2d499f112f2d2b7273fa6870e',
        '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
        '4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952',
        '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
      ],
    },
    {
      name: 'TC7',
      key: rep(0xaa, 131),
      data: txt(
        'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
      ),
      out: [
        '3a854166ac5d9f023f54d517d0b39dbd946770db9c2b95c9f6f565d1',
        '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
        '6617178e941f020d351e2f254e8fd32c602420feb0b8fb9adccebb82461e99c5a678cc31e799176d3860e6110c46523e',
        'e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58',
      ],
    },
  ]

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_, c) => {
    const d = await hmacAll(c.key, c.data, ['sha224', 'sha256', 'sha384', 'sha512'])
    const got = (['sha224', 'sha256', 'sha384', 'sha512'] as const).map((id) => {
      const hex = bytesToHex(d[id]!)
      return c.truncate ? hex.slice(0, c.truncate * 2) : hex
    })
    expect(got).toEqual(c.out)
  })
})

describe('SHA3-256 and SM3', () => {
  it('NIST HMAC-SHA3-256 sample (keylen < blocklen)', async () => {
    const out = await hmac('sha3-256', seq(0, 31), txt('Sample message for keylen<blocklen'))
    expect(bytesToHex(out)).toBe('4fe8e202c4f058e8dddc23d8c34e467343e23555e24fc2f025d598f558f67205')
  })

  it('agrees with OpenSSL for every algorithm, unicode, empty and long keys', async () => {
    const inputs: [Uint8Array, Uint8Array][] = [
      [txt('密钥🔑'), txt('你好，世界！👋')],
      [new Uint8Array(0), new Uint8Array(0)],
      [rep(0x5a, 300), utf16leEncode('long key > block size')],
      [txt('k'), rep(0x42, 100_000)],
    ]
    for (const [key, data] of inputs) {
      const all = await hmacAll(key, data)
      for (const id of ALL_HMAC_IDS) {
        expect(bytesToHex(all[id]!), id).toBe(await nodeHmac(NODE_NAME[id], key, data))
      }
    }
  })
})

describe('helpers', () => {
  it('algorithm metadata is consistent', async () => {
    expect(HMAC_ALGOS).toHaveLength(8)
    const all = await hmacAll(txt('k'), txt('m'))
    for (const a of HMAC_ALGOS) expect(all[a.id]!.length * 8).toBe(a.bits)
  })

  it('decodeField reports errors with the field name', () => {
    expect(decodeField('abc', 'utf8', '密钥')).toEqual({ bytes: txt('abc') })
    expect(decodeField('0a0b', 'hex', '密钥')).toEqual({ bytes: hexToBytes('0a0b') })
    const bad = decodeField('0g', 'hex', '密钥')
    expect('error' in bad && bad.error).toMatch(/^密钥：Hex 第 2 个字符「g」/)
    const bad64 = decodeField('a*', 'base64', '消息')
    expect('error' in bad64 && bad64.error).toMatch(/^消息：Base64 第 2 个字符/)
  })

  it('works with the shared formatter and matcher', async () => {
    const d = await hmacAll(txt('Jefe'), txt('what do ya want for nothing?'))
    expect(formatDigest(d.sha256!, 'base64')).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=')
    expect(formatDigest(d.md5!, 'hex', true)).toBe('750C783E6AB0B503EAA86E310A5DB738')
    const m = matchDigest('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=', d)
    expect(m).toMatchObject({ status: 'match', ids: ['sha256'] })
  })
})
