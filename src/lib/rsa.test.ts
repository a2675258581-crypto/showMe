import {
  constants,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  verify,
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  RsaError,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decodeBinary,
  decodeOid,
  detectDer,
  encodeBinary,
  exportPrivate,
  exportPublic,
  fingerprints,
  generateRsaKeyPair,
  hexToBytes,
  jwkToDer,
  keysMatch,
  maxOaepPlaintext,
  opensslCommand,
  parsePem,
  parseRsaKey,
  privateToJwk,
  publicFromPrivate,
  publicToJwk,
  rsaOaepDecrypt,
  rsaOaepEncrypt,
  rsaSign,
  rsaVerify,
  spkiFromCertificate,
  toOpenSshPublic,
  toPem,
  unwrapPkcs8,
  unwrapSpki,
  wrapPkcs1Private,
  wrapPkcs1Public,
} from './rsa'
import {
  CERT_PEM,
  EC_PUBLIC_PEM,
  ED25519_PRIVATE_PEM,
  ENCRYPTED_PKCS8_PEM,
  ENCRYPTED_TRADITIONAL_PEM,
  MESSAGE,
  MODULUS_HEX,
  OAEP_SHA256_CIPHERTEXT,
  PKCS1_PRIVATE_PEM,
  PKCS1_PUBLIC_PEM,
  PKCS8_PRIVATE_PEM,
  PSS_PRIVATE_PEM,
  PSS_PUBLIC_PEM,
  SIGNATURE_PKCS1_SHA256,
  SPKI_PUBLIC_PEM,
} from './rsa-fixtures'

const utf8 = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)
const der = (pem: string) => parsePem(pem)!.der

describe('byte encodings', () => {
  it('round-trips base64 and hex', () => {
    const b = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 255)
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b)
    expect(hexToBytes(bytesToHex(b))).toEqual(b)
    expect(decodeBinary(encodeBinary(b, 'hex'), 'hex')).toEqual(b)
    expect(decodeBinary(encodeBinary(b, 'base64'), 'base64')).toEqual(b)
  })

  it('is lenient with whitespace, URL-safe alphabet, missing padding and separators', () => {
    expect(text(base64ToBytes(' 5L2g\n5aW9 '))).toBe('你好')
    expect(base64ToBytes('-_8')).toEqual(Uint8Array.of(0xfb, 0xff))
    expect(hexToBytes('0xDE:AD be ef')).toEqual(Uint8Array.of(0xde, 0xad, 0xbe, 0xef))
  })

  it('reports precise errors', () => {
    expect(() => base64ToBytes('abc$', '密文')).toThrow(
      '密文第 4 个字符「$」不是合法的 Base64 字符',
    )
    expect(() => base64ToBytes('ab=c')).toThrow('填充符')
    expect(() => base64ToBytes('abcde')).toThrow('长度不正确')
    expect(() => base64ToBytes('  ')).toThrow('为空')
    expect(() => hexToBytes('abz')).toThrow('第 3 个字符「z」')
    expect(() => hexToBytes('abc')).toThrow('奇数')
    // 位置按原始输入（含 0x 前缀）计算
    expect(() => hexToBytes('0xabz')).toThrow('第 5 个字符「z」')
    expect(() => hexToBytes('  0Xab:cz')).toThrow('第 9 个字符「z」')
  })
})

describe('DER / PEM conversions (OpenSSL vectors)', () => {
  it('decodes OIDs', () => {
    expect(decodeOid(Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01))).toBe(
      '1.2.840.113549.1.1.1',
    )
    expect(decodeOid(Uint8Array.of(0x2b, 0x65, 0x70))).toBe('1.3.101.112')
  })

  it('detects DER structures', () => {
    expect(detectDer(der(SPKI_PUBLIC_PEM))).toBe('spki')
    expect(detectDer(der(PKCS8_PRIVATE_PEM))).toBe('pkcs8')
    expect(detectDer(der(PKCS1_PRIVATE_PEM))).toBe('pkcs1-private')
    expect(detectDer(der(PKCS1_PUBLIC_PEM))).toBe('pkcs1-public')
    expect(detectDer(der(CERT_PEM))).toBe('x509')
    expect(() => detectDer(Uint8Array.of(0x02, 0x01, 0x00))).toThrow('SEQUENCE')
  })

  it('wraps PKCS#1 into byte-identical PKCS#8 / SPKI and back', () => {
    expect(wrapPkcs1Private(der(PKCS1_PRIVATE_PEM))).toEqual(der(PKCS8_PRIVATE_PEM))
    expect(wrapPkcs1Public(der(PKCS1_PUBLIC_PEM))).toEqual(der(SPKI_PUBLIC_PEM))
    expect(unwrapPkcs8(der(PKCS8_PRIVATE_PEM))).toEqual(der(PKCS1_PRIVATE_PEM))
    expect(unwrapSpki(der(SPKI_PUBLIC_PEM))).toEqual(der(PKCS1_PUBLIC_PEM))
  })

  it('exports every PEM format exactly like OpenSSL', () => {
    const pkcs8 = der(PKCS8_PRIVATE_PEM)
    const spki = der(SPKI_PUBLIC_PEM)
    expect(exportPrivate(pkcs8, 'pkcs8')).toBe(PKCS8_PRIVATE_PEM)
    expect(exportPrivate(pkcs8, 'pkcs1')).toBe(PKCS1_PRIVATE_PEM)
    expect(exportPublic(spki, 'spki')).toBe(SPKI_PUBLIC_PEM)
    expect(exportPublic(spki, 'pkcs1')).toBe(PKCS1_PUBLIC_PEM)
    expect(toPem(spki, 'PUBLIC KEY')).toBe(SPKI_PUBLIC_PEM)
  })

  it('derives the public key from the private key and from a certificate', () => {
    expect(publicFromPrivate(der(PKCS8_PRIVATE_PEM))).toEqual(der(SPKI_PUBLIC_PEM))
    expect(spkiFromCertificate(der(CERT_PEM))).toEqual(der(SPKI_PUBLIC_PEM))
  })

  it('builds OpenSSH public keys per RFC 4253 and parses them back', () => {
    const spki = der(SPKI_PUBLIC_PEM)
    const line = toOpenSshPublic(spki, 'me@host')
    expect(line).toMatch(/^ssh-rsa AAAAB3NzaC1yc2E\S+ me@host$/)
    const blob = base64ToBytes(line.split(' ')[1])
    // string "ssh-rsa" | mpint e=65537 | mpint n（最高位为 1，补 0 后 129 字节）
    expect(bytesToHex(blob.subarray(0, 11))).toBe('00000007' + '7373682d727361')
    expect(bytesToHex(blob.subarray(11, 18))).toBe('00000003010001')
    expect(bytesToHex(blob.subarray(18, 23))).toBe('0000008100')
    expect(bytesToHex(blob.subarray(23))).toBe(MODULUS_HEX)
    const parsed = parseRsaKey(line)
    expect(parsed.source).toBe('openssh')
    expect(parsed.der).toEqual(spki)
  })

  it('converts JWK exactly like Node / OpenSSL', () => {
    const nodePriv = createPrivateKey(PKCS8_PRIVATE_PEM).export({ format: 'jwk' })
    const nodePub = createPublicKey(SPKI_PUBLIC_PEM).export({ format: 'jwk' })
    expect(privateToJwk(der(PKCS8_PRIVATE_PEM))).toEqual(nodePriv)
    expect(publicToJwk(der(SPKI_PUBLIC_PEM))).toEqual(nodePub)
    expect(jwkToDer(nodePriv as Record<string, unknown>)).toEqual({
      kind: 'private',
      der: der(PKCS8_PRIVATE_PEM),
    })
    expect(jwkToDer(nodePub as Record<string, unknown>).der).toEqual(der(SPKI_PUBLIC_PEM))
    const json = exportPrivate(der(PKCS8_PRIVATE_PEM), 'jwk')
    expect(parseRsaKey(json)).toMatchObject({ kind: 'private', source: 'jwk', bits: 1024 })
  })
})

describe('parseRsaKey', () => {
  it('parses every supported format into normalized DER', () => {
    const cases: [string, string, 'public' | 'private'][] = [
      [SPKI_PUBLIC_PEM, 'spki', 'public'],
      [PKCS1_PUBLIC_PEM, 'pkcs1-public', 'public'],
      [PKCS8_PRIVATE_PEM, 'pkcs8', 'private'],
      [PKCS1_PRIVATE_PEM, 'pkcs1-private', 'private'],
      [CERT_PEM, 'x509', 'public'],
    ]
    for (const [pem, source, kind] of cases) {
      const info = parseRsaKey(pem)
      expect(info.source).toBe(source)
      expect(info.kind).toBe(kind)
      expect(info.bits).toBe(1024)
      expect(info.exponent).toBe('65537')
      expect(info.modulusHex).toBe(MODULUS_HEX)
      expect(info.der).toEqual(der(kind === 'public' ? SPKI_PUBLIC_PEM : PKCS8_PRIVATE_PEM))
    }
  })

  it('accepts bare base64 DER and surrounding text', () => {
    const b64 = bytesToBase64(der(SPKI_PUBLIC_PEM))
    expect(parseRsaKey(b64).source).toBe('spki')
    expect(parseRsaKey(`注释\n${PKCS8_PRIVATE_PEM}\n尾巴`).kind).toBe('private')
  })

  it('normalizes RSASSA-PSS OID keys to rsaEncryption', () => {
    const priv = parseRsaKey(PSS_PRIVATE_PEM)
    const pub = parseRsaKey(PSS_PUBLIC_PEM)
    expect(priv.pssOid).toBe(true)
    expect(pub.pssOid).toBe(true)
    expect(keysMatch(priv, pub)).toBe(true)
    expect(detectDer(pub.der)).toBe('spki')
    expect(bytesToHex(pub.der.subarray(0, 19))).toContain('2a864886f70d010101')
  })

  it('accepts a JWK Set and picks its first RSA key', () => {
    const jwk = publicToJwk(der(SPKI_PUBLIC_PEM))
    const set = {
      keys: [
        { kty: 'EC', crv: 'P-256', x: 'AA', y: 'AA' },
        { ...jwk, kid: 'k1' },
      ],
    }
    const info = parseRsaKey(JSON.stringify(set))
    expect(info.source).toBe('jwk')
    expect(info.der).toEqual(der(SPKI_PUBLIC_PEM))
    expect(() => parseRsaKey('{"keys":[{"kty":"EC"}]}')).toThrow('都不是 RSA 密钥')
    expect(() => parseRsaKey('{"keys":[]}')).toThrow('0 个密钥都不是 RSA')
  })

  it('explains incomplete or malformed JWK fields', () => {
    const j = privateToJwk(der(PKCS8_PRIVATE_PEM))
    expect(() => parseRsaKey(JSON.stringify({ kty: 'RSA', n: j.n, e: j.e, d: j.d }))).toThrow(
      '缺少 CRT 参数「p」',
    )
    expect(() => parseRsaKey('{"kty":"RSA","n":123,"e":"AQAB"}')).toThrow(
      '字段「n」应为 Base64URL 字符串',
    )
  })

  it('matches key pairs', () => {
    expect(keysMatch(parseRsaKey(PKCS1_PRIVATE_PEM), parseRsaKey(SPKI_PUBLIC_PEM))).toBe(true)
    expect(keysMatch(parseRsaKey(PSS_PRIVATE_PEM), parseRsaKey(SPKI_PUBLIC_PEM))).toBe(false)
  })

  it('explains unsupported or wrong inputs in Chinese', () => {
    expect(() => parseRsaKey('')).toThrow('请粘贴密钥')
    expect(() => parseRsaKey(EC_PUBLIC_PEM)).toThrow('这是 EC（椭圆曲线）密钥，不是 RSA 密钥')
    expect(() => parseRsaKey(ED25519_PRIVATE_PEM)).toThrow('这是 Ed25519 密钥')
    expect(() => parseRsaKey(ENCRYPTED_PKCS8_PEM)).toThrow('口令加密的 PKCS#8')
    expect(() => parseRsaKey(ENCRYPTED_TRADITIONAL_PEM)).toThrow('口令加密的传统格式')
    expect(() =>
      parseRsaKey('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'),
    ).toThrow('OpenSSH 格式的私钥')
    expect(() => parseRsaKey(SPKI_PUBLIC_PEM.replace('-----END PUBLIC KEY-----', ''))).toThrow(
      '缺少结尾行',
    )
    const broken = SPKI_PUBLIC_PEM.replace(/\n(.)/, '\n#')
    expect(() => parseRsaKey(broken)).toThrow('第 2 行第 1 列出现非 Base64 字符「#」')
    const truncated = SPKI_PUBLIC_PEM.split('\n')
      .filter((_, i) => i !== 2)
      .join('\n')
    expect(() => parseRsaKey(truncated)).toThrow(RsaError)
    expect(() => parseRsaKey('hello world 你好')).toThrow('无法识别的密钥格式')
    expect(() => parseRsaKey('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5')).toThrow('只支持 ssh-rsa')
    expect(() => parseRsaKey('{"kty":"EC"}')).toThrow('不是 RSA')
    expect(() => parseRsaKey('{"kty":')).toThrow('JWK 不是有效的 JSON')
    expect(() => parseRsaKey('{"kty":"RSA","n":"AQAB"}')).toThrow('JWK 缺少字段「e」')
    const mislabeled = PKCS8_PRIVATE_PEM.replace(/PRIVATE KEY/g, 'PUBLIC KEY')
    expect(() => parseRsaKey(mislabeled)).toThrow('内容是私钥')
  })
})

describe('Web Crypto operations', () => {
  it('generate → export → import → encrypt/decrypt round-trip (UTF-8, 中文, emoji)', async () => {
    const pair = await generateRsaKeyPair({
      bits: 1024,
      purpose: 'encrypt',
      hash: 'SHA-256',
      scheme: 'RSA-PSS',
    })
    const pubPem = exportPublic(pair.spki, 'spki')
    const privPem = exportPrivate(pair.pkcs8, 'pkcs1')
    const pub = parseRsaKey(pubPem)
    const priv = parseRsaKey(privPem)
    expect(pub.bits).toBe(1024)
    expect(keysMatch(pub, priv)).toBe(true)
    const msg = '你好，showMe 🔐 RSA-OAEP'
    const ct = await rsaOaepEncrypt(pub.der, utf8(msg), 'SHA-256')
    expect(ct.length).toBe(128)
    const b64 = encodeBinary(ct, 'base64')
    const pt = await rsaOaepDecrypt(priv.der, decodeBinary(b64, 'base64'), 'SHA-256')
    expect(text(pt)).toBe(msg)
    // OAEP 是随机化的：两次加密结果不同
    const ct2 = await rsaOaepEncrypt(pub.der, utf8(msg), 'SHA-256')
    expect(bytesToHex(ct2)).not.toBe(bytesToHex(ct))
    // 空明文也可以
    expect(
      await rsaOaepDecrypt(
        priv.der,
        await rsaOaepEncrypt(pub.der, new Uint8Array(0), 'SHA-256'),
        'SHA-256',
      ),
    ).toEqual(new Uint8Array(0))
  })

  it('interoperates with OpenSSL OAEP ciphertext and Node publicEncrypt', async () => {
    const priv = parseRsaKey(PKCS1_PRIVATE_PEM)
    const pt = await rsaOaepDecrypt(priv.der, base64ToBytes(OAEP_SHA256_CIPHERTEXT), 'SHA-256')
    expect(text(pt)).toBe(MESSAGE)
    const nodeCt = publicEncrypt(
      { key: SPKI_PUBLIC_PEM, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
      Buffer.from('SHA-1 OAEP'),
    )
    expect(text(await rsaOaepDecrypt(priv.der, new Uint8Array(nodeCt), 'SHA-1'))).toBe('SHA-1 OAEP')
    const ours = await rsaOaepEncrypt(
      parseRsaKey(SPKI_PUBLIC_PEM).der,
      utf8('回到 OpenSSL'),
      'SHA-256',
    )
    const back = privateDecrypt(
      { key: PKCS8_PRIVATE_PEM, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      ours,
    )
    expect(back.toString('utf8')).toBe('回到 OpenSSL')
  })

  it('enforces the OAEP size limit and ciphertext length', async () => {
    expect(maxOaepPlaintext(1024, 'SHA-256')).toBe(62)
    expect(maxOaepPlaintext(2048, 'SHA-256')).toBe(190)
    expect(maxOaepPlaintext(2048, 'SHA-1')).toBe(214)
    expect(maxOaepPlaintext(4096, 'SHA-512')).toBe(382)
    expect(maxOaepPlaintext(1024, 'SHA-512')).toBe(0)
    const pub = parseRsaKey(SPKI_PUBLIC_PEM).der
    await expect(rsaOaepEncrypt(pub, new Uint8Array(63), 'SHA-256')).rejects.toThrow(
      '明文 63 字节，超过 RSA-1024 + OAEP-SHA-256 单次加密上限 62 字节',
    )
    await expect(rsaOaepEncrypt(pub, new Uint8Array(1), 'SHA-512')).rejects.toThrow('太短')
    const priv = parseRsaKey(PKCS8_PRIVATE_PEM).der
    await expect(rsaOaepDecrypt(priv, new Uint8Array(100), 'SHA-256')).rejects.toThrow(
      '密文长度为 100 字节，RSA-1024 的密文应恰好为 128 字节',
    )
  })

  it('fails decryption with a clear message for the wrong key or hash', async () => {
    const ct = base64ToBytes(OAEP_SHA256_CIPHERTEXT)
    const priv = parseRsaKey(PKCS8_PRIVATE_PEM).der
    await expect(rsaOaepDecrypt(priv, ct, 'SHA-1')).rejects.toThrow(
      /解密失败.*OAEP 哈希（当前 SHA-1）/,
    )
    const other = parseRsaKey(PSS_PRIVATE_PEM).der
    await expect(rsaOaepDecrypt(other, ct, 'SHA-256')).rejects.toThrow('解密失败')
  })

  it('signs deterministically like OpenSSL (PKCS#1 v1.5) and verifies', async () => {
    const priv = parseRsaKey(PKCS8_PRIVATE_PEM).der
    const pub = parseRsaKey(CERT_PEM).der
    const sig = await rsaSign(priv, utf8(MESSAGE), 'RSASSA-PKCS1-v1_5', 'SHA-256')
    expect(bytesToBase64(sig)).toBe(SIGNATURE_PKCS1_SHA256)
    expect(await rsaVerify(pub, utf8(MESSAGE), sig, 'RSASSA-PKCS1-v1_5', 'SHA-256')).toBe(true)
    expect(await rsaVerify(pub, utf8(MESSAGE + '!'), sig, 'RSASSA-PKCS1-v1_5', 'SHA-256')).toBe(
      false,
    )
    await expect(
      rsaVerify(pub, utf8(MESSAGE), sig.subarray(1), 'RSASSA-PKCS1-v1_5', 'SHA-256'),
    ).rejects.toThrow('签名长度为 127 字节')
  })

  it('signs with RSA-PSS (salt = hash length) verifiable by Node / OpenSSL', async () => {
    const priv = parseRsaKey(PSS_PRIVATE_PEM)
    const pub = parseRsaKey(PSS_PUBLIC_PEM)
    const sig = await rsaSign(priv.der, utf8('PSS 签名'), 'RSA-PSS', 'SHA-256')
    expect(await rsaVerify(pub.der, utf8('PSS 签名'), sig, 'RSA-PSS', 'SHA-256')).toBe(true)
    const ok = verify(
      'sha256',
      Buffer.from('PSS 签名'),
      {
        key: createPublicKey({ key: Buffer.from(pub.der), format: 'der', type: 'spki' }),
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
      sig,
    )
    expect(ok).toBe(true)
    // 用 PKCS#1 v1.5 校验 PSS 签名必然失败
    expect(await rsaVerify(pub.der, utf8('PSS 签名'), sig, 'RSASSA-PKCS1-v1_5', 'SHA-256')).toBe(
      false,
    )
  })

  it('generates signing key pairs of the requested size', async () => {
    const pair = await generateRsaKeyPair({
      bits: 2048,
      purpose: 'sign',
      hash: 'SHA-256',
      scheme: 'RSASSA-PKCS1-v1_5',
    })
    const info = parseRsaKey(exportPrivate(pair.pkcs8, 'pkcs8'))
    expect(info.bits).toBe(2048)
    expect(publicFromPrivate(pair.pkcs8)).toEqual(pair.spki)
  })

  it('computes fingerprints', async () => {
    const fp = await fingerprints(der(SPKI_PUBLIC_PEM))
    expect(fp.spkiSha256).toMatch(/^([0-9a-f]{2}:){31}[0-9a-f]{2}$/)
    expect(fp.openssh).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })
})

describe('opensslCommand', () => {
  it('builds matching OpenSSL commands', () => {
    const o = { bits: 2048, hash: 'SHA-256' as const, scheme: 'RSA-PSS' as const }
    expect(opensslCommand('keygen', o)).toContain('rsa_keygen_bits:2048')
    expect(opensslCommand('encrypt', o)).toContain('rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256')
    expect(opensslCommand('decrypt', { ...o, hash: 'SHA-1' })).toContain('rsa_oaep_md:sha1')
    expect(opensslCommand('sign', o)).toContain(
      '-sha256 -sign private.pem -sigopt rsa_padding_mode:pss -sigopt rsa_pss_saltlen:32',
    )
    expect(opensslCommand('verify', { ...o, scheme: 'RSASSA-PKCS1-v1_5' })).toBe(
      'openssl dgst -sha256 -verify public.pem -signature sig.bin message.txt',
    )
  })
})
