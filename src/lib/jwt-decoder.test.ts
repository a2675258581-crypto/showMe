import { describe, expect, it, vi } from 'vitest'
import { CompactSign, exportJWK, exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import {
  algFamily,
  claimRows,
  decodeJwt,
  describeJsonError,
  formatCountdown,
  formatDateTime,
  formatDuration,
  formatRelative,
  importVerifyKey,
  jsonErrorPosition,
  lineColumn,
  makeHs256Sample,
  NO_WEBCRYPTO,
  normalizeToken,
  patchClaims,
  segmentRanges,
  signHmacJwt,
  timeState,
  verifyJwt,
} from './jwt-decoder'
import { ES256_SAMPLE, JWT_IO_SAMPLE, RS256_SAMPLE } from './jwt-decoder-samples'
import { bytesToBase64, bytesToBase64Url, utf8Encode } from './hash-bytes'

const b64u = (o: unknown) =>
  bytesToBase64Url(utf8Encode(typeof o === 'string' ? o : JSON.stringify(o)))

describe('normalizeToken / segmentRanges', () => {
  it('strips Bearer prefix, whitespace and quotes, keeping an index map', () => {
    const n = normalizeToken('  Bearer  "aa.b\nb.cc" ')
    expect(n.token).toBe('aa.bb.cc')
    expect(n.strippedBearer).toBe(true)
    expect(n.map[0]).toBe(11)
    expect('  Bearer  "aa.b\nb.cc" '[n.map[4]]).toBe('b')
    expect(n.map[4]).toBe(16)
    expect(normalizeToken('Authorization: Bearer x.y.z').token).toBe('x.y.z')
  })

  it('splits raw input into colored ranges', () => {
    const r = segmentRanges('Bearer aa.bb.cc.dd')
    expect(r.dots).toEqual([9, 12, 15])
    expect(r.segments.map((s) => [s.kind, s.start, s.end])).toEqual([
      ['header', 7, 9],
      ['payload', 10, 12],
      ['signature', 13, 15],
      ['extra', 16, 18],
    ])
    expect(segmentRanges('').segments).toEqual([{ kind: 'header', start: 0, end: 0 }])
  })
})

describe('decodeJwt', () => {
  it('decodes the jwt.io sample', () => {
    const r = decodeJwt(JWT_IO_SAMPLE.token)
    expect(r?.ok).toBe(true)
    if (!r?.ok) return
    expect(r.jwt.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(r.jwt.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 })
    expect(r.jwt.alg).toBe('HS256')
    expect(r.jwt.signature).toHaveLength(32)
    expect(r.jwt.headerJson).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
    expect(r.jwt.warnings).toEqual([])
  })

  it('decodes Chinese / emoji payloads', () => {
    const t = `${b64u({ alg: 'HS256' })}.${b64u({ name: '张三 🚀', city: '北京' })}.c2ln`
    const r = decodeJwt(t)
    expect(r?.ok && r.jwt.payload).toEqual({ name: '张三 🚀', city: '北京' })
  })

  it('returns null for empty input', () => {
    expect(decodeJwt('')).toBeNull()
    expect(decodeJwt('  \n ')).toBeNull()
  })

  it('reports wrong segment counts', () => {
    expect(decodeJwt('abc')).toMatchObject({
      ok: false,
      error: expect.stringContaining('没有「.」'),
    })
    expect(decodeJwt('a.b')).toMatchObject({
      ok: false,
      error: expect.stringContaining('只有 2 段'),
    })
    expect(decodeJwt('a.b.c.d')).toMatchObject({
      ok: false,
      error: expect.stringContaining('4 段'),
    })
    const jwe = `${b64u({ alg: 'RSA-OAEP', enc: 'A256GCM' })}.x.y.z.w`
    expect(decodeJwt(jwe)).toMatchObject({
      ok: false,
      error: expect.stringContaining('JWE 加密令牌（5 段）（alg: RSA-OAEP，enc: A256GCM）'),
    })
  })

  it('reports bad base64url with segment and absolute position', () => {
    const t = `${b64u({ alg: 'HS256' })}.eyJh+GciOi.sig`
    const r = decodeJwt(`Bearer ${t}`)
    expect(r).toMatchObject({ ok: false, segment: 'payload' })
    if (r && !r.ok) {
      expect(r.error).toContain('Payload 不是合法的 Base64URL：Payload 第 5 个字符「+」不合法')
      expect(`Bearer ${t}`[r.position!]).toBe('+')
    }
    expect(decodeJwt(`${b64u({ alg: 'HS256' })}.${b64u({})}.ab=`)).toMatchObject({
      segment: 'signature',
    })
    expect(decodeJwt(`e.${b64u({})}.x`)).toMatchObject({
      segment: 'header',
      error: expect.stringContaining('末尾可能被截断'),
    })
  })

  it('reports bad JSON with line / column', () => {
    const r = decodeJwt(`${b64u('{"alg":"HS256",}')}.${b64u({})}.`)
    expect(r).toMatchObject({ ok: false, segment: 'header' })
    expect(r && !r.ok && r.error).toMatch(/Header 不是合法的 JSON（第 1 行第 \d+ 列/)
    const p = decodeJwt(`${b64u({ alg: 'HS256' })}.${b64u('not json')}.`)
    expect(p && !p.ok && p.error).toContain('Payload 不是合法的 JSON')
    expect(p && !p.ok && p.error).toContain('解码内容：not json')
    const arr = decodeJwt(`${b64u({ alg: 'HS256' })}.${b64u([1, 2])}.`)
    expect(arr && !arr.ok && arr.error).toContain('必须是 JSON 对象，当前是 数组')
  })

  it('reports invalid UTF-8 and empty segments', () => {
    const bad = bytesToBase64Url(new Uint8Array([0x7b, 0xff, 0x7d]))
    expect(decodeJwt(`${bad}.${b64u({})}.`)).toMatchObject({
      segment: 'header',
      error: expect.stringContaining('不是有效的 UTF-8'),
    })
    expect(decodeJwt(`.${b64u({})}.x`)).toMatchObject({ segment: 'header' })
    expect(decodeJwt(`${b64u({ alg: 'HS256' })}..x`)).toMatchObject({ segment: 'payload' })
  })

  it('warns about alg none, missing alg and empty signatures', () => {
    const none = decodeJwt(`${b64u({ alg: 'none' })}.${b64u({ a: 1 })}.`)
    expect(none?.ok && none.jwt.warnings.join()).toContain('未签名')
    const noAlg = decodeJwt(`${b64u({ typ: 'JWT' })}.${b64u({})}.`)
    expect(noAlg?.ok && noAlg.jwt.warnings.join()).toContain('缺少 alg')
    const emptySig = decodeJwt(`${b64u({ alg: 'HS256' })}.${b64u({})}.`)
    expect(emptySig?.ok && emptySig.jwt.warnings.join()).toContain('签名段为空')
  })
})

describe('claims & time', () => {
  const payload = {
    name: '张三',
    exp: 1_700_003_600,
    iss: 'https://auth.example.com',
    iat: 1_700_000_000,
    aud: ['a', 'b'],
    nbf: 1_700_000_000,
    custom: { x: 1 },
    sub: 42,
  }

  it('orders registered claims first and explains them', () => {
    const rows = claimRows(payload)
    expect(rows.map((r) => r.key)).toEqual([
      'iss',
      'sub',
      'aud',
      'exp',
      'nbf',
      'iat',
      'name',
      'custom',
    ])
    const exp = rows.find((r) => r.key === 'exp')!
    expect(exp).toMatchObject({ name: '过期时间', registered: true, seconds: 1_700_003_600 })
    expect(rows.find((r) => r.key === 'aud')!.text).toBe('a, b')
    expect(rows.find((r) => r.key === 'custom')!).toMatchObject({
      name: '自定义声明',
      text: '{"x":1}',
    })
    expect(rows.find((r) => r.key === 'name')!.name).toBe('姓名')
    expect(rows.find((r) => r.key === 'sub')!.issue).toBe('sub 应为字符串')
  })

  it('flags millisecond and string timestamps', () => {
    const rows = claimRows({ exp: 1_700_000_000_000, iat: '1700000000', nbf: 'soon' })
    expect(rows.find((r) => r.key === 'exp')!.issue).toContain('毫秒')
    expect(rows.find((r) => r.key === 'iat')!).toMatchObject({
      seconds: 1_700_000_000,
      issue: '应为数字而不是字符串',
    })
    expect(rows.find((r) => r.key === 'nbf')!.issue).toContain('秒级时间戳')
  })

  it('computes valid / expired / not-yet / no-exp states', () => {
    const now = 1_700_001_800_000
    expect(timeState(payload, now)).toMatchObject({
      state: 'valid',
      remainingMs: 1_800_000,
      progress: 0.5,
    })
    expect(timeState(payload, 1_700_003_600_000)).toMatchObject({
      state: 'expired',
      remainingMs: 0,
    })
    expect(timeState(payload, 1_700_010_000_000).remainingMs).toBeLessThan(0)
    expect(timeState(payload, 1_699_999_000_000)).toMatchObject({
      state: 'notYet',
      untilValidMs: 1_000_000,
    })
    expect(timeState({ iat: 1 }, now)).toMatchObject({ state: 'noExp', iat: 1 })
  })

  it('formats times and durations in Chinese', () => {
    expect(formatDateTime(0, 'UTC')).toBe('1970-01-01 00:00:00')
    expect(formatDateTime(1_700_000_000, 'Asia/Shanghai')).toBe('2023-11-15 06:13:20')
    expect(formatDuration(0)).toBe('0 秒')
    expect(formatDuration(90_061_000)).toBe('1 天 1 小时 1 分 1 秒')
    expect(formatDuration(-3_600_000)).toBe('1 小时')
    expect(formatDuration(400 * 86_400_000, 2)).toBe('1 年 35 天')
    expect(formatRelative(-1000)).toBe('刚刚')
    expect(formatRelative(-120_000)).toBe('2 分钟前')
    expect(formatRelative(3 * 86_400_000)).toBe('3 天后')
    expect(formatCountdown(3_723_000)).toBe('01:02:03')
    expect(formatCountdown(90_061_000)).toBe('1 天 01:01:01')
    expect(formatCountdown(-5)).toBe('00:00:00')
  })
})

describe('JSON errors', () => {
  it('locates syntax errors itself', () => {
    expect(jsonErrorPosition('{"a":1}')).toBe(-1)
    expect(jsonErrorPosition(' [1, -2.5e3, "x\\u00e9", true, null, {"b": false}] ')).toBe(-1)
    expect(jsonErrorPosition('{"a":}')).toBe(5)
    expect(jsonErrorPosition('{"a":1')).toBe(6)
    expect(jsonErrorPosition('[01]')).toBe(2)
    expect(jsonErrorPosition('"bad \\x"')).toBe(6)
    expect(jsonErrorPosition('{"a":1} x')).toBe(8)
    expect(jsonErrorPosition('tru')).toBe(0)
  })

  it('translates V8 messages and computes line / column', () => {
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
    const err = (t: string) => {
      try {
        JSON.parse(t)
      } catch (e) {
        return describeJsonError(t, e)
      }
      return ''
    }
    expect(err('{\n  "a": 1,\n}')).toMatch(/^第 3 行第 1 列：/)
    expect(err('{"a" 1}')).toContain('冒号')
    expect(err('{"a": 1')).toMatch(/^第 1 行第 8 列：.*(JSON 意外结束|逗号或 })/)
    expect(err('{"a":}')).toBe('第 1 行第 6 列：意外的字符「}」')
    expect(err('[1, 2,\n 3,, 4]')).toMatch(/^第 2 行第 4 列：/)
    expect(err('{"a": "x\ty"}')).toMatch(/^第 1 行第 9 列：/)
    expect(err('')).toMatch(/意外结束/)
  })
})

describe('verifyJwt', () => {
  it('HS256 jwt.io sample: correct and wrong secret', async () => {
    expect(await verifyJwt(JWT_IO_SAMPLE.token, { secret: JWT_IO_SAMPLE.secret })).toMatchObject({
      status: 'valid',
    })
    expect(await verifyJwt(JWT_IO_SAMPLE.token, { secret: 'nope' })).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('签名不匹配'),
    })
    expect(await verifyJwt(JWT_IO_SAMPLE.token, { secret: '' })).toMatchObject({
      status: 'error',
      message: '请输入密钥',
    })
  })

  it('HS secret as base64', async () => {
    const secret = utf8Encode('这是一个足够长的 HS384 密钥，长度超过四十八个字节！！')
    const token = await new CompactSign(utf8Encode('{"a":1}'))
      .setProtectedHeader({ alg: 'HS384' })
      .sign(secret)
    const b64 = bytesToBase64(secret)
    expect(await verifyJwt(token, { secret: b64, secretBase64: true })).toMatchObject({
      status: 'valid',
    })
    expect(await verifyJwt(token, { secret: b64, secretBase64: false })).toMatchObject({
      status: 'invalid',
    })
    expect(await verifyJwt(token, { secret: '***', secretBase64: true })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('密钥（Base64） 第 1 个字符「*」'),
    })
  })

  it('RS256 sample with SPKI PEM, ES256 sample with JWK and JWKS', async () => {
    expect(
      await verifyJwt(RS256_SAMPLE.token, { publicKey: RS256_SAMPLE.publicKey }),
    ).toMatchObject({
      status: 'valid',
      message: '签名有效（RS256）',
    })
    expect(
      await verifyJwt(ES256_SAMPLE.token, { publicKey: ES256_SAMPLE.publicKey }),
    ).toMatchObject({
      status: 'valid',
    })
    const jwks = JSON.stringify({ keys: [JSON.parse(ES256_SAMPLE.publicKey)] })
    expect(await verifyJwt(ES256_SAMPLE.token, { publicKey: jwks })).toMatchObject({
      status: 'valid',
      note: expect.stringContaining('JWKS'),
    })
    const tampered = RS256_SAMPLE.token.replace(/\.(.)/, (_, c) => `.${c === 'e' ? 'f' : 'e'}`)
    expect((await verifyJwt(tampered, { publicKey: RS256_SAMPLE.publicKey })).status).not.toBe(
      'valid',
    )
  })

  it('PS256 / ES384 / EdDSA with generated keys, private-key extraction', async () => {
    for (const alg of ['PS256', 'ES384', 'EdDSA', 'RS512'] as const) {
      const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true })
      const token = await new CompactSign(utf8Encode(JSON.stringify({ sub: alg })))
        .setProtectedHeader({ alg })
        .sign(privateKey)
      const pem = await exportSPKI(publicKey)
      expect(await verifyJwt(token, { publicKey: pem }), alg).toMatchObject({ status: 'valid' })
      const jwk = JSON.stringify(await exportJWK(publicKey))
      expect(await verifyJwt(token, { publicKey: jwk }), alg).toMatchObject({ status: 'valid' })
      const pkcs8 = await exportPKCS8(privateKey)
      expect(await verifyJwt(token, { publicKey: pkcs8 }), alg).toMatchObject({
        status: 'valid',
        note: expect.stringContaining('私钥'),
      })
      const privJwk = JSON.stringify(await exportJWK(privateKey))
      expect(await verifyJwt(token, { publicKey: privJwk }), alg).toMatchObject({
        status: 'valid',
        note: expect.stringContaining('私钥 JWK'),
      })
    }
  })

  it('explains key problems', async () => {
    const wrongType = await verifyJwt(ES256_SAMPLE.token, { publicKey: RS256_SAMPLE.publicKey })
    expect(wrongType).toMatchObject({ status: 'error', message: expect.stringContaining('不匹配') })
    expect(await verifyJwt(RS256_SAMPLE.token, { publicKey: '' })).toMatchObject({
      message: expect.stringContaining('请粘贴公钥'),
    })
    expect(await verifyJwt(RS256_SAMPLE.token, { publicKey: 'hello' })).toMatchObject({
      message: expect.stringContaining('无法识别'),
    })
    expect(
      await verifyJwt(RS256_SAMPLE.token, {
        publicKey: '-----BEGIN RSA PUBLIC KEY-----\nMIIB\n-----END RSA PUBLIC KEY-----',
      }),
    ).toMatchObject({ message: expect.stringContaining('PKCS#1') })
    expect(
      await verifyJwt(RS256_SAMPLE.token, {
        publicKey: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
      }),
    ).toMatchObject({ status: 'error' })
    expect(await verifyJwt(RS256_SAMPLE.token, { publicKey: '{"kty": ' })).toMatchObject({
      message: expect.stringContaining('JWK 不是合法的 JSON'),
    })
    expect(
      await verifyJwt(RS256_SAMPLE.token, { publicKey: '{"kty":"oct","k":"abc"}' }),
    ).toMatchObject({
      message: expect.stringContaining('对称密钥'),
    })
    const other = JSON.stringify({
      keys: [{ ...JSON.parse(ES256_SAMPLE.publicKey), kid: 'other' }],
    })
    expect(await verifyJwt(ES256_SAMPLE.token, { publicKey: other })).toMatchObject({
      message: expect.stringContaining('没有与令牌 kid'),
    })
    await expect(
      importVerifyKey('-----BEGIN EC PRIVATE KEY-----\nx\n-----END EC PRIVATE KEY-----', 'ES256'),
    ).rejects.toThrow(/PKCS#8/)
  })

  it('handles none / unknown algorithms and broken tokens', async () => {
    expect(await verifyJwt(`${b64u({ alg: 'none' })}.${b64u({})}.`, {})).toMatchObject({
      status: 'invalid',
    })
    expect(await verifyJwt(`${b64u({ alg: 'XX1' })}.${b64u({})}.`, {})).toMatchObject({
      status: 'error',
      message: expect.stringContaining('XX1'),
    })
    expect(await verifyJwt('a.b', { secret: 'x' })).toMatchObject({ status: 'error' })
  })

  it('classifies algorithm families', () => {
    expect(algFamily('HS512')).toBe('hmac')
    expect(algFamily('RS256')).toBe('rsa')
    expect(algFamily('PS384')).toBe('rsa-pss')
    expect(algFamily('ES256K')).toBe('ec')
    expect(algFamily('EdDSA')).toBe('eddsa')
    expect(algFamily('none')).toBe('none')
    expect(algFamily('HS1')).toBe('unknown')
  })
})

describe('signing', () => {
  it('signs HS256 / HS384 / HS512 and verifies', async () => {
    for (const alg of ['HS256', 'HS384', 'HS512'] as const) {
      const r = await signHmacJwt(
        '{"typ":"JWT","alg":"HS256","kid":"k1"}',
        '{"sub":"张三","n":1}',
        'secret-秘密',
        false,
        alg,
      )
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      const d = decodeJwt(r.token)
      expect(d?.ok && d.jwt.header).toEqual({ typ: 'JWT', alg, kid: 'k1' })
      expect(d?.ok && d.jwt.payload).toEqual({ sub: '张三', n: 1 })
      expect(r.warnings.join()).toContain('RFC 7518')
      expect(await verifyJwt(r.token, { secret: 'secret-秘密' })).toMatchObject({ status: 'valid' })
    }
  })

  it('reproduces the jwt.io sample signature', async () => {
    const r = await signHmacJwt(
      '{"alg":"HS256","typ":"JWT"}',
      '{"sub":"1234567890","name":"John Doe","iat":1516239022}',
      'your-256-bit-secret',
      false,
      'HS256',
    )
    expect(r.ok && r.token).toBe(JWT_IO_SAMPLE.token)
  })

  it('reports header / payload / secret errors', async () => {
    expect(await signHmacJwt('{', '{}', 's', false, 'HS256')).toMatchObject({
      ok: false,
      field: 'header',
    })
    expect(await signHmacJwt('[]', '{}', 's', false, 'HS256')).toMatchObject({ field: 'header' })
    expect(await signHmacJwt('{}', '{"a":}', 's', false, 'HS256')).toMatchObject({
      field: 'payload',
      error: expect.stringContaining('第 1 行'),
    })
    expect(await signHmacJwt('{}', '"x"', 's', false, 'HS256')).toMatchObject({ field: 'payload' })
    expect(await signHmacJwt('{}', '{}', '', false, 'HS256')).toMatchObject({ field: 'secret' })
    expect(await signHmacJwt('{}', '{}', '@@', true, 'HS256')).toMatchObject({ field: 'secret' })
  })

  it('patchClaims sets and removes claims', () => {
    expect(patchClaims('{"a":1,"exp":5}', { iat: 10, exp: undefined })).toEqual({
      ok: true,
      text: '{\n  "a": 1,\n  "iat": 10\n}',
    })
    expect(patchClaims('', { a: 1 })).toEqual({ ok: true, text: '{\n  "a": 1\n}' })
    expect(patchClaims('[', { a: 1 }).ok).toBe(false)
    expect(patchClaims('[1]', { a: 1 }).ok).toBe(false)
  })

  it('makeHs256Sample is deterministic and verifiable', async () => {
    const t = makeHs256Sample(1_800_000_000, 's3cret')
    expect(t).toBe(makeHs256Sample(1_800_000_000, 's3cret'))
    const d = decodeJwt(t)
    expect(d?.ok && d.jwt.payload).toMatchObject({
      iat: 1_800_000_000,
      exp: 1_800_003_600,
      name: '张三',
    })
    expect(await verifyJwt(t, { secret: 's3cret' })).toMatchObject({ status: 'valid' })
  })
})

describe('large tokens', () => {
  it('decodes a ~1 MB token quickly and keeps unicode claims intact', () => {
    const payload = { sub: '用户🙂', blob: '数据'.repeat(200_000) }
    const token = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.${b64u('sig')}`
    expect(token.length).toBeGreaterThan(1_000_000)
    const t = performance.now()
    const r = decodeJwt(`"${token}"\n`)
    expect(performance.now() - t).toBeLessThan(2000)
    expect(r?.ok && r.jwt.payload.sub).toBe('用户🙂')
    expect(normalizeToken(`'${token}'`).token).toBe(token)
  })
})

describe('without Web Crypto (insecure context)', () => {
  it('explains why verify / sign cannot run instead of leaking a TypeError', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(crypto) })
    try {
      expect(await verifyJwt(JWT_IO_SAMPLE.token, { secret: JWT_IO_SAMPLE.secret })).toEqual({
        status: 'error',
        message: NO_WEBCRYPTO,
      })
      expect(await signHmacJwt('{}', '{}', 'k'.repeat(32), false, 'HS256')).toMatchObject({
        ok: false,
        error: NO_WEBCRYPTO,
      })
      // 解码与示例令牌不依赖 Web Crypto
      expect(decodeJwt(makeHs256Sample(1_700_000_000, 'secret'))?.ok).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(await verifyJwt(JWT_IO_SAMPLE.token, { secret: JWT_IO_SAMPLE.secret })).toMatchObject({
      status: 'valid',
    })
  })
})
