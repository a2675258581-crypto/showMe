import CryptoJS from 'crypto-js'
import { describe, expect, it } from 'vitest'
import {
  CIPHERS,
  CIPHER_IDS,
  CipherError,
  MODES,
  PADDINGS,
  cipherWarnings,
  decryptBytes,
  decryptWithPassphrase,
  deriveKeyIv,
  encryptBytes,
  encryptWithPassphrase,
  evpBytesToKey,
  hasSaltedHeader,
  ivRequirement,
  opensslCommand,
  opensslName,
  pad,
  pbkdf2Sha256,
  pbkdf2Sha256Async,
  randomKeySize,
  runCipher,
  runCipherAsync,
  shellQuote,
  unpad,
  validateIv,
  validateKey,
  type CipherAlgo,
  type CipherMode,
  type CipherRequest,
  type PaddingId,
  type RawCipherOptions,
} from './aes-des'
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8Encode } from './hash-bytes'

const h = hexToBytes
const hex = bytesToHex

const NIST_KEY = h('2b7e151628aed2a6abf7158809cf4f3c')
const NIST_IV = h('000102030405060708090a0b0c0d0e0f')
const NIST_PT = h('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51')

function enc(o: Partial<RawCipherOptions> & { key: Uint8Array }, pt: Uint8Array) {
  return hex(encryptBytes({ algo: 'AES', mode: 'CBC', padding: 'NoPadding', ...o }, pt))
}

function caught(fn: () => unknown): CipherError {
  try {
    fn()
  } catch (e) {
    if (e instanceof CipherError) return e
    throw e
  }
  throw new Error('expected CipherError')
}

describe('AES known-answer tests', () => {
  it('FIPS-197 C.1 AES-128', () => {
    const key = h('000102030405060708090a0b0c0d0e0f')
    const pt = h('00112233445566778899aabbccddeeff')
    expect(enc({ key, mode: 'ECB' }, pt)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a')
    const back = decryptBytes(
      { algo: 'AES', mode: 'ECB', padding: 'NoPadding', key },
      h('69c4e0d86a7b0430d8cdb78070b4c55a'),
    )
    expect(hex(back)).toBe('00112233445566778899aabbccddeeff')
  })

  it('FIPS-197 C.2 AES-192 and C.3 AES-256', () => {
    const pt = h('00112233445566778899aabbccddeeff')
    expect(
      enc({ key: h('000102030405060708090a0b0c0d0e0f1011121314151617'), mode: 'ECB' }, pt),
    ).toBe('dda97ca4864cdfe06eaf70a0ec0d7191')
    expect(
      enc(
        { key: h('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'), mode: 'ECB' },
        pt,
      ),
    ).toBe('8ea2b7ca516745bfeafc49904b496089')
  })

  it('SP 800-38A F.1.1 ECB-AES128 and F.1.5 ECB-AES256', () => {
    expect(enc({ key: NIST_KEY, mode: 'ECB' }, NIST_PT)).toBe(
      '3ad77bb40d7a3660a89ecaf32466ef97f5d3d58503b9699de785895a96fdbaaf',
    )
    const key256 = h('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4')
    expect(enc({ key: key256, mode: 'ECB' }, NIST_PT.subarray(0, 16))).toBe(
      'f3eed1bdb5d2a03c064b5a7e3db181f8',
    )
  })

  it('SP 800-38A F.2.1 CBC, F.3.13 CFB128, F.4.1 OFB', () => {
    const o = { key: NIST_KEY, iv: NIST_IV }
    expect(enc({ ...o, mode: 'CBC' }, NIST_PT)).toBe(
      '7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2',
    )
    expect(enc({ ...o, mode: 'CFB' }, NIST_PT)).toBe(
      '3b3fd92eb72dad20333449f8e83cfb4ac8a64537a0b3a93fcde3cdad9f1ce58b',
    )
    expect(enc({ ...o, mode: 'OFB' }, NIST_PT)).toBe(
      '3b3fd92eb72dad20333449f8e83cfb4a7789508d16918f03f53c52dac54ed825',
    )
  })

  it('SP 800-38A F.5.1 CTR-AES128', () => {
    const iv = h('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff')
    expect(enc({ key: NIST_KEY, iv, mode: 'CTR' }, NIST_PT)).toBe(
      '874d6191b620e3261bef6864990db6ce9806f66b7970fdff8617187bb9fffdff',
    )
  })

  it('matches OpenSSL for partial final blocks in CTR / CFB / OFB (NoPadding)', () => {
    const pt = utf8Encode('Hello, 世界! 🔐')
    expect(pt.length).toBe(19)
    const ctr = { algo: 'AES', mode: 'CTR', padding: 'NoPadding', key: NIST_KEY } as const
    const ctrIv = h('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff')
    expect(hex(encryptBytes({ ...ctr, iv: ctrIv }, pt))).toBe(
      'a4e9b31ff74c5c544a44f1e066bf8114a9bfec',
    )
    expect(hex(encryptBytes({ ...ctr, mode: 'CFB', iv: NIST_IV }, pt))).toBe(
      '189b0ba0f6411252629fd07c178ecc9036dbdd',
    )
    expect(hex(encryptBytes({ ...ctr, mode: 'OFB', iv: NIST_IV }, pt))).toBe(
      '189b0ba0f6411252629fd07c178ecc9046304a',
    )
    expect(
      decryptBytes(
        { ...ctr, mode: 'CFB', iv: NIST_IV },
        h('189b0ba0f6411252629fd07c178ecc9036dbdd'),
      ),
    ).toEqual(pt)
  })

  it('AES-256-CBC with PKCS7 matches OpenSSL and CryptoJS defaults', () => {
    const key = h('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4')
    const pt = utf8Encode('Hello, 世界! 🔐')
    const ct = encryptBytes({ algo: 'AES', mode: 'CBC', padding: 'Pkcs7', key, iv: NIST_IV }, pt)
    expect(bytesToBase64(ct)).toBe('flwNTUsjQuZzbbtmcv1KKU2vTbEK8ssA0cIIvFHo3Co=')
    const viaCryptoJS = CryptoJS.AES.encrypt(
      CryptoJS.enc.Utf8.parse('Hello, 世界! 🔐'),
      CryptoJS.enc.Hex.parse(hex(key)),
      { iv: CryptoJS.enc.Hex.parse(hex(NIST_IV)) },
    ).toString()
    expect(viaCryptoJS).toBe('flwNTUsjQuZzbbtmcv1KKU2vTbEK8ssA0cIIvFHo3Co=')
  })
})

describe('DES / 3DES / RC4 / Rabbit known answers', () => {
  it('DES classic vector 133457799BBCDFF1', () => {
    const o = {
      algo: 'DES',
      mode: 'ECB',
      padding: 'NoPadding',
      key: h('133457799BBCDFF1'),
    } as const
    expect(hex(encryptBytes(o, h('0123456789ABCDEF')))).toBe('85e813540f0ab405')
    expect(hex(decryptBytes(o, h('85e813540f0ab405')))).toBe('0123456789abcdef')
    const zero = { ...o, key: h('0E329232EA6D0D73') }
    expect(hex(encryptBytes(zero, h('8787878787878787')))).toBe('0000000000000000')
  })

  it('DES-CBC with PKCS7 matches OpenSSL', () => {
    const o = {
      algo: 'DES',
      mode: 'CBC',
      padding: 'Pkcs7',
      key: h('0123456789ABCDEF'),
      iv: h('1122334455667788'),
    } as const
    expect(hex(encryptBytes(o, utf8Encode('你好，DES！')))).toBe('81d8e7d5053e8c2c86163899157c213a')
  })

  it('3DES SP 800-67 example (three-key) and two-key CBC vs OpenSSL', () => {
    const o = {
      algo: 'TripleDES',
      mode: 'ECB',
      padding: 'NoPadding',
      key: h('0123456789ABCDEF23456789ABCDEF01456789ABCDEF0123'),
    } as const
    expect(hex(encryptBytes(o, utf8Encode('The qufck brown fox jump')))).toBe(
      'a826fd8ce53b855fcce21c8112256fe668d5c05dd9b6b900',
    )
    const two = {
      algo: 'TripleDES',
      mode: 'CBC',
      padding: 'Pkcs7',
      key: h('0123456789ABCDEFFEDCBA9876543210'),
      iv: h('1122334455667788'),
    } as const
    expect(hex(encryptBytes(two, utf8Encode('你好，3DES！')))).toBe(
      'f0174af265f19af0622db15f2e168abd18e659472a531417',
    )
  })

  it('3DES with K1=K2=K3 equals single DES', () => {
    const k = h('133457799BBCDFF1')
    const triple = { algo: 'TripleDES', mode: 'ECB', padding: 'NoPadding' } as const
    const key24 = new Uint8Array([...k, ...k, ...k])
    expect(hex(encryptBytes({ ...triple, key: key24 }, h('0123456789ABCDEF')))).toBe(
      '85e813540f0ab405',
    )
    expect(cipherWarnings('TripleDES', 'ECB', 'NoPadding', key24).join()).toContain('退化为单 DES')
  })

  it('RC4 Wikipedia vectors', () => {
    const rc4 = (key: string, pt: string) =>
      hex(
        encryptBytes(
          { algo: 'RC4', mode: 'CBC', padding: 'Pkcs7', key: utf8Encode(key) },
          utf8Encode(pt),
        ),
      )
    expect(rc4('Key', 'Plaintext')).toBe('bbf316e8d940af0ad3')
    expect(rc4('Wiki', 'pedia')).toBe('1021bf0420')
    expect(rc4('Secret', 'Attack at dawn')).toBe('45a01f645fc35b383552544b9bf5')
  })

  it('Rabbit matches the crypto-js reference vector and IV variant round-trips', () => {
    const o = {
      algo: 'Rabbit',
      mode: 'CBC',
      padding: 'Pkcs7',
      key: new Uint8Array(16),
    } as const
    expect(hex(encryptBytes(o, new Uint8Array(16)))).toBe('02f74a1c26456bf5ecd6a536f05457b1')
    const withIv = { ...o, iv: h('0001020304050607') }
    const ct = encryptBytes(withIv, utf8Encode('兔子 Rabbit 🐇'))
    expect(hex(ct)).not.toBe(hex(encryptBytes(o, utf8Encode('兔子 Rabbit 🐇'))))
    expect(decryptBytes(withIv, ct)).toEqual(utf8Encode('兔子 Rabbit 🐇'))
  })
})

describe('round-trips for every algorithm / mode / padding', () => {
  const lengths = [0, 1, 7, 8, 15, 16, 17, 31, 32, 33, 100]
  const keyFor = (algo: CipherAlgo) => {
    const n = CIPHERS[algo].keySizes[CIPHERS[algo].keySizes.length - 1]
    return Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)
  }
  for (const algo of CIPHER_IDS) {
    const modes: readonly CipherMode[] = CIPHERS[algo].blockSize ? MODES : ['CBC']
    for (const mode of modes) {
      for (const { id: padding } of PADDINGS) {
        it(`${algo}-${mode}-${padding}`, () => {
          const bs = CIPHERS[algo].blockSize || 1
          const o: RawCipherOptions = {
            algo,
            mode,
            padding,
            key: keyFor(algo),
            iv: CIPHERS[algo].ivSize
              ? Uint8Array.from({ length: CIPHERS[algo].ivSize }, (_, i) => i)
              : undefined,
          }
          for (const n of lengths) {
            const pt = Uint8Array.from({ length: n }, (_, i) => (i * 13 + 1) & 255 || 1)
            const aligned = n % bs === 0
            const blockish = CIPHERS[algo].blockSize > 0
            if (
              blockish &&
              padding === 'NoPadding' &&
              !aligned &&
              (mode === 'ECB' || mode === 'CBC')
            ) {
              expect(() => encryptBytes(o, pt)).toThrow(/整数倍/)
              continue
            }
            const ct = encryptBytes(o, pt)
            if (blockish && padding !== 'NoPadding' && padding !== 'ZeroPadding') {
              expect(ct.length).toBe((Math.floor(n / bs) + 1) * bs)
            }
            expect(hex(decryptBytes(o, ct)), `len ${n}`).toBe(hex(pt))
          }
        })
      }
    }
  }
})

describe('padding', () => {
  const data = utf8Encode('abc')
  it.each([
    ['Pkcs7', '6162630505050505'],
    ['AnsiX923', '6162630000000005'],
    ['ZeroPadding', '6162630000000000'],
    ['Iso97971', '6162638000000000'],
    ['NoPadding', '616263'],
  ] as [PaddingId, string][])('%s', (p, expected) => {
    expect(hex(pad(data, 8, p))).toBe(expected)
    expect(unpad(pad(data, 8, p), 8, p)).toEqual(data)
  })

  it('adds a full block when already aligned', () => {
    expect(hex(pad(h('0102030405060708'), 8, 'Pkcs7'))).toBe('01020304050607080808080808080808')
    expect(hex(pad(h('0102030405060708'), 8, 'ZeroPadding'))).toBe('0102030405060708')
    const iso = pad(data, 8, 'Iso10126')
    expect(iso).toHaveLength(8)
    expect(iso[7]).toBe(5)
    expect(unpad(iso, 8, 'Iso10126')).toEqual(data)
  })

  it('rejects corrupted padding with precise messages', () => {
    expect(caught(() => unpad(h('6162630505050509'), 8, 'Pkcs7')).message).toContain(
      '最后一个字节是 0x09',
    )
    expect(caught(() => unpad(h('6162630505050500'), 8, 'Pkcs7')).message).toContain(
      '最后一个字节是 0x00',
    )
    expect(caught(() => unpad(h('6162630505050504'), 8, 'Pkcs7')).message).toContain(
      '倒数第 4 个字节应为 0x04',
    )
    expect(caught(() => unpad(h('6162630505050905'), 8, 'Pkcs7')).message).toContain(
      '倒数第 2 个字节应为 0x05，实际是 0x09',
    )
    expect(caught(() => unpad(h('6162630000000009'), 8, 'AnsiX923')).message).toContain('0x09')
    expect(caught(() => unpad(h('6162630001000005'), 8, 'AnsiX923')).message).toContain('应为 0x00')
    expect(caught(() => unpad(h('6162630000000000'), 8, 'Iso97971')).message).toContain('9797-1')
    expect(caught(() => unpad(new Uint8Array(0), 8, 'Pkcs7')).message).toContain('为空')
  })

  it('wrong key produces a padding error rather than garbage', () => {
    const o = { algo: 'AES', mode: 'CBC', padding: 'Pkcs7', iv: NIST_IV } as const
    const ct = encryptBytes({ ...o, key: NIST_KEY }, utf8Encode('secret message'))
    const wrong = new Uint8Array(NIST_KEY)
    wrong[0] ^= 1
    // 极小概率碰巧得到合法填充；固定数据下是确定的
    expect(() => decryptBytes({ ...o, key: wrong }, ct)).toThrow(/填充校验失败/)
  })
})

describe('validation', () => {
  it('key lengths', () => {
    expect(validateKey('AES', new Uint8Array(16))).toBeNull()
    expect(validateKey('AES', new Uint8Array(24))).toBeNull()
    expect(validateKey('AES', new Uint8Array(32))).toBeNull()
    expect(validateKey('AES', new Uint8Array(20))).toBe(
      'AES 密钥必须是 16 / 24 / 32 字节（AES-128 / 192 / 256），当前 20 字节',
    )
    expect(validateKey('AES', new Uint8Array(0))).toBe('密钥不能为空')
    expect(validateKey('DES', new Uint8Array(16))).toContain('DES 密钥必须是 8 字节')
    expect(validateKey('TripleDES', new Uint8Array(16))).toBeNull()
    expect(validateKey('TripleDES', new Uint8Array(8))).toContain('16 字节（双倍长）或 24 字节')
    expect(validateKey('RC4', new Uint8Array(1))).toBeNull()
    expect(validateKey('RC4', new Uint8Array(257))).toContain('256')
    expect(validateKey('Rabbit', new Uint8Array(32))).toContain('16 字节')
  })

  it('IV requirements', () => {
    expect(ivRequirement('AES', 'ECB')).toBe('none')
    expect(ivRequirement('AES', 'CTR')).toBe('required')
    expect(ivRequirement('RC4', 'CBC')).toBe('none')
    expect(ivRequirement('Rabbit', 'CBC')).toBe('optional')
    expect(validateIv('AES', 'CBC', new Uint8Array(0))).toBe('CBC 模式需要 IV（16 字节）')
    expect(validateIv('AES', 'CBC', new Uint8Array(8))).toBe(
      'AES 的 IV 必须是 16 字节，当前 8 字节',
    )
    expect(validateIv('DES', 'CBC', new Uint8Array(16))).toBe(
      'DES 的 IV 必须是 8 字节，当前 16 字节',
    )
    expect(validateIv('AES', 'ECB', new Uint8Array(3))).toBeNull()
    expect(validateIv('Rabbit', 'CBC', new Uint8Array(0))).toBeNull()
    expect(validateIv('Rabbit', 'CBC', new Uint8Array(4))).toContain('8 字节')
  })

  it('encrypt / decrypt raise field-tagged errors', () => {
    const o = {
      algo: 'AES',
      mode: 'CBC',
      padding: 'Pkcs7',
      key: new Uint8Array(15),
      iv: NIST_IV,
    } as const
    expect(caught(() => encryptBytes(o, data())).field).toBe('key')
    expect(caught(() => encryptBytes({ ...o, key: NIST_KEY, iv: undefined }, data())).field).toBe(
      'iv',
    )
    const e = caught(() => decryptBytes({ ...o, key: NIST_KEY }, new Uint8Array(17)))
    expect(e.field).toBe('input')
    expect(e.message).toContain('不是 16 字节的整数倍')
    function data() {
      return utf8Encode('x')
    }
  })

  it('openssl names', () => {
    expect(opensslName('AES', 'CBC', 32)).toBe('aes-256-cbc')
    expect(opensslName('TripleDES', 'CBC', 16)).toBe('des-ede-cbc')
    expect(opensslName('TripleDES', 'ECB', 24)).toBe('des-ede3-ecb')
    expect(opensslName('Rabbit', 'CBC', 16)).toBeNull()
    expect(randomKeySize('AES', 16)).toBe(16)
    expect(randomKeySize('AES', 20)).toBe(32)
  })
})

describe('OpenSSL-compatible passphrase mode', () => {
  const pt = utf8Encode('Hello, 世界! 🔐')
  const pass = utf8Encode('秘密passphrase')
  const salt = h('0102030405060708')

  it('EVP_BytesToKey(MD5) matches `openssl enc -P`', () => {
    const { key, iv } = deriveKeyIv(pass, salt, 32, 16, { kdf: 'md5' })
    expect(hex(key)).toBe('b354e9ceb21d3bd1f526d97e2292b245b3f9979ae6d81713d22aa70f6a887323')
    expect(hex(iv)).toBe('34696a17f0488d1674cfa8a9e6ec3b3e')
    expect(evpBytesToKey(pass, salt, 48, 'md5')).toHaveLength(48)
  })

  // openssl enc -e <cipher> -S 0102030405060708 -pass pass:秘密passphrase -base64 -A
  const cases: [
    string,
    CipherAlgo,
    CipherMode,
    PaddingId,
    number,
    'md5' | 'sha256' | 'pbkdf2',
    string,
  ][] = [
    [
      'aes-256-cbc -md md5',
      'AES',
      'CBC',
      'Pkcs7',
      32,
      'md5',
      '6TG1RA38juHol9DZIKJmp1zDWJgYJy6t48ymqyzK4Yk=',
    ],
    [
      'aes-256-cbc -md sha256',
      'AES',
      'CBC',
      'Pkcs7',
      32,
      'sha256',
      '/GKgRWso6IIChfYG5xk2YHn1/DWCdcEpeZmQaNXA7EA=',
    ],
    [
      'aes-256-cbc -pbkdf2',
      'AES',
      'CBC',
      'Pkcs7',
      32,
      'pbkdf2',
      'pmKWRySZQ5t+SRGhRcVpK9cjVvTyXFQk6aGThDl9rtI=',
    ],
    [
      'aes-128-ecb -md md5',
      'AES',
      'ECB',
      'Pkcs7',
      16,
      'md5',
      'MZxA+U96GnGRZCb+7ts0lE0/4Q8HlgnMqZWlWQ3XyDU=',
    ],
    ['aes-192-cfb -md md5', 'AES', 'CFB', 'NoPadding', 24, 'md5', '6Tt91vOOv3TMgU96500BaKMv3g=='],
    [
      'aes-256-ctr -md sha256',
      'AES',
      'CTR',
      'NoPadding',
      32,
      'sha256',
      'tbh+IgvhzslYYqtJGaGjv49+Hw==',
    ],
    ['aes-128-ofb -md md5', 'AES', 'OFB', 'NoPadding', 16, 'md5', '/6TnI6qd45Xw6uVWBPN2e8DQ/A=='],
    [
      'des-ede3-cbc -md md5',
      'TripleDES',
      'CBC',
      'Pkcs7',
      24,
      'md5',
      '7utq6BbA7ANlmtd6MfjyrS5WbZ4KrpwX',
    ],
    ['des-cbc -md md5', 'DES', 'CBC', 'Pkcs7', 8, 'md5', 'uhrlE+HhgwX2NoD+gDXnkACR1alQMfx2'],
    ['rc4 -md md5', 'RC4', 'CBC', 'NoPadding', 16, 'md5', 'icCPq6aEE2xiAUXmxc6DATfy1w=='],
  ]

  it.each(cases)('%s', (_, algo, mode, padding, keySize, kdf, expected) => {
    const o = { algo, mode, padding, passphrase: pass, kdf, iterations: 10000, keySize }
    const r = encryptWithPassphrase(o, pt, salt)
    expect(hasSaltedHeader(r.data)).toBe(true)
    expect(bytesToBase64(r.data.subarray(16))).toBe(expected)
    // 带 Salted__ 头的完整格式可以解回来
    expect(decryptWithPassphrase(o, r.data).data).toEqual(pt)
  })

  it('decrypts CryptoJS.AES.encrypt(text, passphrase) output', () => {
    const ct = CryptoJS.AES.encrypt('来自 CryptoJS 的消息 ✓', 'hunter2').toString()
    expect(ct.startsWith('U2FsdGVkX1')).toBe(true)
    const r = decryptWithPassphrase(
      { algo: 'AES', mode: 'CBC', padding: 'Pkcs7', passphrase: utf8Encode('hunter2'), kdf: 'md5' },
      base64ToBytes(ct),
    )
    expect(new TextDecoder().decode(r.data)).toBe('来自 CryptoJS 的消息 ✓')
  })

  it('random salt makes every encryption different', () => {
    const o = { algo: 'AES', mode: 'CBC', padding: 'Pkcs7', passphrase: pass, kdf: 'md5' } as const
    const a = encryptWithPassphrase(o, pt)
    const b = encryptWithPassphrase(o, pt)
    expect(hex(a.data)).not.toBe(hex(b.data))
    expect(decryptWithPassphrase(o, b.data).data).toEqual(pt)
  })

  it('rejects data without the Salted__ header and bad iteration counts', () => {
    const o = { algo: 'AES', mode: 'CBC', padding: 'Pkcs7', passphrase: pass, kdf: 'md5' } as const
    expect(caught(() => decryptWithPassphrase(o, new Uint8Array(32))).message).toContain('Salted__')
    expect(
      caught(() => deriveKeyIv(pass, salt, 32, 16, { kdf: 'pbkdf2', iterations: 0 })).field,
    ).toBe('iterations')
    expect(caught(() => encryptWithPassphrase(o, pt, new Uint8Array(4))).field).toBe('salt')
  })
})

describe('runCipher (UI entry point)', () => {
  const base: CipherRequest = {
    direction: 'encrypt',
    algo: 'AES',
    mode: 'CBC',
    padding: 'Pkcs7',
    keyMode: 'raw',
    key: '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4',
    keyEncoding: 'hex',
    iv: '000102030405060708090a0b0c0d0e0f',
    ivEncoding: 'hex',
    passphrase: '',
    kdf: 'md5',
    iterations: 10000,
    salt: '',
    keySize: 32,
    input: 'Hello, 世界! 🔐',
    plainEncoding: 'utf8',
    cipherEncoding: 'base64',
  }

  it('encrypts and decrypts with text keys and encodings', () => {
    const r = runCipher(base)
    expect(r).toMatchObject({ ok: true, output: 'flwNTUsjQuZzbbtmcv1KKU2vTbEK8ssA0cIIvFHo3Co=' })
    const back = runCipher({ ...base, direction: 'decrypt', input: r.ok ? r.output : '' })
    expect(back).toMatchObject({
      ok: true,
      output: 'Hello, 世界! 🔐',
      inputBytes: 32,
      outputBytes: 19,
    })

    const hexOut = runCipher({ ...base, cipherEncoding: 'hex' })
    expect(hexOut.ok && hexOut.output).toBe(
      hex(base64ToBytes('flwNTUsjQuZzbbtmcv1KKU2vTbEK8ssA0cIIvFHo3Co=')),
    )

    const utf8Key = runCipher({
      ...base,
      key: '1234567890abcdef',
      keyEncoding: 'utf8',
      iv: 'abcdef1234567890',
      ivEncoding: 'utf8',
    })
    expect(utf8Key.ok).toBe(true)
    const b64Key = runCipher({
      ...base,
      key: bytesToBase64(utf8Encode('1234567890abcdef')),
      keyEncoding: 'base64',
      iv: bytesToBase64(utf8Encode('abcdef1234567890')),
      ivEncoding: 'base64',
    })
    expect(b64Key.ok && b64Key.output).toBe(utf8Key.ok && utf8Key.output)
  })

  it('handles empty plaintext, hex plaintext and whitespace in ciphertext', () => {
    const empty = runCipher({ ...base, input: '' })
    expect(empty.ok && base64ToBytes(empty.output)).toHaveLength(16)
    const hexPt = runCipher({ ...base, input: '48656c6c6f', plainEncoding: 'hex' })
    const txtPt = runCipher({ ...base, input: 'Hello' })
    expect(hexPt.ok && hexPt.output).toBe(txtPt.ok && txtPt.output)
    const spaced = runCipher({
      ...base,
      direction: 'decrypt',
      input: 'flwNTUsjQuZzbbtm\ncv1KKU2vTbEK8ssA 0cIIvFHo3Co=',
      plainEncoding: 'hex',
    })
    expect(spaced.ok && spaced.output).toBe(hex(utf8Encode('Hello, 世界! 🔐')))
  })

  it('large input round-trip', () => {
    const big = '中文🙂'.repeat(50_000)
    const r = runCipher({ ...base, input: big })
    expect(r.ok).toBe(true)
    const back = runCipher({ ...base, direction: 'decrypt', input: r.ok ? r.output : '' })
    expect(back.ok && back.output === big).toBe(true)
  })

  it('reports field errors without throwing', () => {
    expect(runCipher({ ...base, key: 'abc', keyEncoding: 'hex' })).toMatchObject({
      ok: false,
      field: 'key',
      error: expect.stringContaining('密钥：Hex 长度为奇数'),
    })
    expect(runCipher({ ...base, key: '00'.repeat(20) })).toMatchObject({ ok: false, field: 'key' })
    expect(runCipher({ ...base, iv: '' })).toMatchObject({ ok: false, field: 'iv' })
    expect(runCipher({ ...base, iv: 'zz' })).toMatchObject({ ok: false, field: 'iv' })
    expect(runCipher({ ...base, direction: 'decrypt', input: '' })).toMatchObject({
      ok: false,
      field: 'input',
    })
    expect(runCipher({ ...base, direction: 'decrypt', input: 'abc*' })).toMatchObject({
      ok: false,
      field: 'input',
      error: expect.stringContaining('密文：Base64 第 4 个字符「*」'),
    })
  })

  it('suggests hex when base64 decode fails on hex-looking data', () => {
    const ct = runCipher({ ...base, cipherEncoding: 'hex', input: 'hi' })
    const r = runCipher({
      ...base,
      direction: 'decrypt',
      input: ct.ok ? ct.output.slice(0, 30) : '',
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.suggestion?.patch).toEqual({ cipherEncoding: 'hex' })
  })

  it('suggests passphrase mode for Salted__ data', () => {
    const ct = CryptoJS.AES.encrypt('x', 'pw').toString()
    const r = runCipher({ ...base, direction: 'decrypt', input: ct.slice(0, 30) })
    expect(!r.ok && r.suggestion?.patch).toEqual({ keyMode: 'passphrase' })
  })

  it('reports non-UTF-8 plaintext clearly', () => {
    const ct = runCipher({ ...base, input: 'ff00fe', plainEncoding: 'hex' })
    const r = runCipher({ ...base, direction: 'decrypt', input: ct.ok ? ct.output : '' })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('不是有效的 UTF-8') })
    const asHex = runCipher({
      ...base,
      direction: 'decrypt',
      input: ct.ok ? ct.output : '',
      plainEncoding: 'hex',
    })
    expect(asHex).toMatchObject({ ok: true, output: 'ff00fe' })
  })

  it('passphrase mode with fixed salt, reporting derived key / iv', () => {
    const r = runCipher({
      ...base,
      keyMode: 'passphrase',
      passphrase: '秘密passphrase',
      salt: '0102030405060708',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output.startsWith('U2FsdGVkX18BAgMEBQYHC')).toBe(true)
    expect(r.used).toEqual({
      key: 'b354e9ceb21d3bd1f526d97e2292b245b3f9979ae6d81713d22aa70f6a887323',
      iv: '34696a17f0488d1674cfa8a9e6ec3b3e',
      salt: '0102030405060708',
    })
    expect(r.warnings.join()).toContain('EVP_BytesToKey')
    const back = runCipher({
      ...base,
      direction: 'decrypt',
      keyMode: 'passphrase',
      passphrase: '秘密passphrase',
      input: r.output,
    })
    expect(back).toMatchObject({ ok: true, output: 'Hello, 世界! 🔐' })
    expect(runCipher({ ...base, keyMode: 'passphrase', passphrase: '' })).toMatchObject({
      ok: false,
      field: 'passphrase',
    })
    expect(
      runCipher({ ...base, keyMode: 'passphrase', passphrase: 'x', salt: '0102' }),
    ).toMatchObject({ ok: false, field: 'salt' })
  })

  it('stream ciphers ignore mode / padding and IV', () => {
    const r = runCipher({
      ...base,
      algo: 'RC4',
      key: 'Key',
      keyEncoding: 'utf8',
      input: 'Plaintext',
      cipherEncoding: 'hex',
      iv: '',
    })
    expect(r).toMatchObject({ ok: true, output: 'bbf316e8d940af0ad3' })
    expect(r.ok && r.warnings.join()).toContain('RC4')
  })

  it('ECB mode warns and ignores the IV field', () => {
    const r = runCipher({ ...base, mode: 'ECB', iv: 'garbage!' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.warnings.join()).toContain('ECB')
  })
})

describe('opensslCommand', () => {
  const raw = {
    direction: 'encrypt',
    algo: 'AES',
    mode: 'CBC',
    padding: 'Pkcs7',
    keyMode: 'raw',
    passphrase: '',
    kdf: 'md5',
    iterations: 10000,
    keySize: 32,
    cipherEncoding: 'base64',
  } as const
  const used = { key: '00'.repeat(16), iv: '11'.repeat(16) }

  it('builds raw-key commands', () => {
    expect(opensslCommand(raw, used)).toEqual({
      ok: true,
      command: `openssl enc -aes-128-cbc -K ${used.key} -iv ${used.iv} -base64 -A`,
    })
    expect(
      opensslCommand({ ...raw, mode: 'ECB', padding: 'NoPadding', direction: 'decrypt' }, used),
    ).toEqual({
      ok: true,
      command: `openssl enc -d -aes-128-ecb -K ${used.key} -nopad -base64 -A`,
    })
    const des = opensslCommand(
      { ...raw, algo: 'DES', cipherEncoding: 'hex' },
      { key: '00'.repeat(8), iv: '11'.repeat(8) },
    )
    expect(des.ok && des.command).toBe(
      `openssl enc -des-cbc -provider legacy -provider default -K ${'00'.repeat(8)} -iv ${'11'.repeat(8)} | xxd -p | tr -d '\\n'`,
    )
  })

  it('builds passphrase commands with shell quoting', () => {
    const r = opensslCommand(
      { ...raw, keyMode: 'passphrase', passphrase: "it's 秘密", kdf: 'pbkdf2' },
      used,
    )
    expect(r.ok && r.command).toBe(
      `openssl enc -aes-256-cbc -pbkdf2 -iter 10000 -md sha256 -pass pass:'it'\\''s 秘密' -base64 -A`,
    )
    expect(shellQuote('plain-Value_1')).toBe('plain-Value_1')
  })

  it('explains unsupported combinations', () => {
    expect(opensslCommand({ ...raw, algo: 'Rabbit' }, { key: '00'.repeat(16), iv: '' }).ok).toBe(
      false,
    )
    expect(opensslCommand({ ...raw, padding: 'AnsiX923' }, used)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('PKCS7'),
    })
    expect(opensslCommand({ ...raw, mode: 'CTR' }, used)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('NoPadding'),
    })
    expect(opensslCommand({ ...raw, algo: 'RC4' }, { key: '00'.repeat(5), iv: '' })).toMatchObject({
      ok: false,
    })
  })

  it('commands reproduce our output when openssl is installed', async () => {
    let cp: { execFileSync: (f: string, a: string[], o?: object) => Uint8Array }
    try {
      cp = (await import(/* @vite-ignore */ 'node:' + 'child_process')) as typeof cp
      cp.execFileSync('openssl', ['version'], { stdio: 'ignore' })
    } catch {
      return
    }
    const base: CipherRequest = {
      direction: 'encrypt',
      algo: 'AES',
      mode: 'CBC',
      padding: 'Pkcs7',
      keyMode: 'raw',
      key: '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4',
      keyEncoding: 'hex',
      iv: '000102030405060708090a0b0c0d0e0f',
      ivEncoding: 'hex',
      passphrase: "pa$$ 'word' 口令",
      kdf: 'md5',
      iterations: 1000,
      salt: '',
      keySize: 32,
      input: 'Hello, 世界! 🔐',
      plainEncoding: 'utf8',
      cipherEncoding: 'base64',
    }
    const variants: Partial<CipherRequest>[] = [
      {},
      { mode: 'CTR', padding: 'NoPadding' },
      {
        algo: 'TripleDES',
        key: '0123456789ABCDEFFEDCBA987654321089ABCDEF01234567',
        iv: '1122334455667788',
      },
      { algo: 'DES', key: '0123456789ABCDEF', iv: '1122334455667788', mode: 'ECB' },
    ]
    for (const v of variants) {
      const req = { ...base, ...v }
      const r = runCipher(req)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const cmd = opensslCommand(req, r.used)
      expect(cmd.ok).toBe(true)
      if (!cmd.ok) continue
      const out = new TextDecoder()
        .decode(
          cp.execFileSync('sh', ['-c', `printf '%s' ${shellQuote(req.input)} | ${cmd.command}`], {
            stdio: ['ignore', 'pipe', 'ignore'],
          }),
        )
        .trim()
      expect(out, cmd.command).toBe(r.output)
    }
    // 口令模式：用 openssl 解密我们的输出
    for (const kdf of ['md5', 'sha256', 'pbkdf2'] as const) {
      const req = { ...base, keyMode: 'passphrase' as const, kdf }
      const r = runCipher(req)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const cmd = opensslCommand({ ...req, direction: 'decrypt' }, r.used)
      expect(cmd.ok).toBe(true)
      if (!cmd.ok) continue
      const out = new TextDecoder().decode(
        cp.execFileSync('sh', ['-c', `printf '%s' ${shellQuote(r.output)} | ${cmd.command}`], {
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      )
      expect(out, cmd.command).toBe(req.input)
    }
  })
})

describe('PBKDF2 (WebCrypto + cache)', () => {
  // RFC 7914 §11 的 PBKDF2-HMAC-SHA256 测试向量
  it('matches RFC 7914 vectors, sync and async', async () => {
    const v1 =
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783'
    expect(hex(pbkdf2Sha256(utf8Encode('passwd'), utf8Encode('salt'), 64, 1))).toBe(v1)
    expect(hex(await pbkdf2Sha256Async(utf8Encode('passwd'), utf8Encode('salt'), 64, 1))).toBe(v1)
    const v2 =
      '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d'
    expect(
      hex(await pbkdf2Sha256Async(utf8Encode('Password'), utf8Encode('NaCl'), 64, 80000)),
    ).toBe(v2)
  })

  it('async result is cached for the sync path (中文口令)', async () => {
    const pass = utf8Encode('口令')
    const salt = h('0102030405060708')
    const expected =
      'ff31b9cbe91eb89fc1c2789adeca8c518e383eb86a786092b194141396f04398828b2234c2c042a029613db3309205cd'
    expect(hex(await pbkdf2Sha256Async(pass, salt, 48, 10000))).toBe(expected)
    const t = performance.now()
    const again = pbkdf2Sha256(pass, salt, 48, 10000)
    expect(performance.now() - t).toBeLessThan(50)
    expect(hex(again)).toBe(expected)
    // 缓存返回副本，调用方修改不会污染缓存
    again.fill(0)
    expect(hex(pbkdf2Sha256(pass, salt, 48, 10000))).toBe(expected)
  })

  const req: CipherRequest = {
    direction: 'encrypt',
    algo: 'AES',
    mode: 'CBC',
    padding: 'Pkcs7',
    keyMode: 'passphrase',
    key: '',
    keyEncoding: 'utf8',
    iv: '',
    ivEncoding: 'utf8',
    passphrase: '秘密passphrase',
    kdf: 'pbkdf2',
    iterations: 10000,
    salt: '0102030405060708',
    keySize: 32,
    input: 'Hello, 世界! 🔐',
    plainEncoding: 'utf8',
    cipherEncoding: 'base64',
  }

  it('runCipherAsync gives the same result as runCipher (fixed salt, OpenSSL vector)', async () => {
    const a = await runCipherAsync(req)
    expect(a).toEqual(runCipher(req))
    // openssl enc -aes-256-cbc -pbkdf2 -S 0102030405060708 -pass pass:秘密passphrase
    expect(a.ok && bytesToBase64(base64ToBytes(a.output).subarray(16))).toBe(
      'pmKWRySZQ5t+SRGhRcVpK9cjVvTyXFQk6aGThDl9rtI=',
    )
  })

  it('runCipherAsync picks a random salt, reports it, and decrypts back', async () => {
    const enc1 = await runCipherAsync({ ...req, salt: '' })
    const enc2 = await runCipherAsync({ ...req, salt: '' })
    expect(enc1.ok && enc2.ok).toBe(true)
    if (!enc1.ok || !enc2.ok) return
    expect(enc1.output).not.toBe(enc2.output)
    expect(enc1.used.salt).toMatch(/^[0-9a-f]{16}$/)
    expect(bytesToHex(base64ToBytes(enc1.output).slice(8, 16))).toBe(enc1.used.salt)
    const back = await runCipherAsync({
      ...req,
      salt: '',
      direction: 'decrypt',
      input: enc1.output,
    })
    expect(back).toMatchObject({ ok: true, output: req.input })
  })

  it('runCipherAsync still reports parameter errors', async () => {
    expect(await runCipherAsync({ ...req, iterations: 0 })).toMatchObject({
      ok: false,
      field: 'iterations',
    })
    expect(await runCipherAsync({ ...req, salt: '01' })).toMatchObject({ ok: false, field: 'salt' })
    expect(await runCipherAsync({ ...req, passphrase: '' })).toMatchObject({
      ok: false,
      field: 'passphrase',
    })
    expect(
      await runCipherAsync({ ...req, direction: 'decrypt', input: 'not salted data!' }),
    ).toMatchObject({ ok: false, field: 'input' })
  })
})

describe('runCipher suggestions', () => {
  const base: CipherRequest = {
    direction: 'decrypt',
    algo: 'AES',
    mode: 'CBC',
    padding: 'Pkcs7',
    keyMode: 'raw',
    key: '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4',
    keyEncoding: 'hex',
    iv: '000102030405060708090a0b0c0d0e0f',
    ivEncoding: 'hex',
    passphrase: 'pw',
    kdf: 'md5',
    iterations: 10000,
    salt: '',
    keySize: 32,
    input: '',
    plainEncoding: 'utf8',
    cipherEncoding: 'base64',
  }

  it('suggests passphrase mode for a complete Salted__ ciphertext that fails to unpad', () => {
    // 完整密文长度是 16 的倍数：错误来自填充校验而不是长度
    const ct = CryptoJS.AES.encrypt('some secret text', 'pw').toString()
    const r = runCipher({ ...base, input: ct })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.suggestion?.patch).toEqual({ keyMode: 'passphrase' })
    const fixed = runCipher({ ...base, input: ct, keyMode: 'passphrase' })
    expect(fixed).toMatchObject({ ok: true, output: 'some secret text' })
  })

  it('suggests hex for aligned hex ciphertext read as Base64', () => {
    const ct = runCipher({
      ...base,
      direction: 'encrypt',
      input: 'x'.repeat(20),
      cipherEncoding: 'hex',
    })
    expect(ct.ok && ct.output).toHaveLength(64)
    const r = runCipher({ ...base, input: ct.ok ? ct.output : '' })
    expect(!r.ok && r.suggestion?.patch).toEqual({ cipherEncoding: 'hex' })
  })

  it('suggests raw mode when passphrase ciphertext has no Salted__ header', () => {
    const r = runCipher({ ...base, keyMode: 'passphrase', input: 'AAAAAAAAAAAAAAAAAAAAAA==' })
    expect(!r.ok && r.suggestion?.patch).toEqual({ keyMode: 'raw' })
  })

  it('suggests hex plaintext when the result is not UTF-8', () => {
    const ct = runCipher({ ...base, direction: 'encrypt', input: 'ff00fe', plainEncoding: 'hex' })
    const r = runCipher({ ...base, input: ct.ok ? ct.output : '' })
    expect(!r.ok && r.suggestion?.patch).toEqual({ plainEncoding: 'hex' })
  })

  it('does not suggest anything for key / IV problems', () => {
    const r = runCipher({ ...base, key: 'abc', keyEncoding: 'utf8', input: 'AAAA' })
    expect(r).toMatchObject({ ok: false, field: 'key' })
    expect(!r.ok && r.suggestion).toBeUndefined()
  })
})
