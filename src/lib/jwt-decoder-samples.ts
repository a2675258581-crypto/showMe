/** JWT 解析工具的示例令牌与公钥（由本地生成的测试密钥签名，私钥未保存） */

/** RS256 示例：exp 为 2100-01-01，公钥为 SPKI PEM */
export const RS256_SAMPLE = {
  token:
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InNob3dtZS1yc2EtMjAyNiJ9.eyJpc3MiOiJodHRwczovL2F1dGguc2hvd21lLmRldiIsInN1YiI6InVzZXJfMTAwODYiLCJhdWQiOiJzaG93bWUtd2ViIiwibmFtZSI6IuadjumbtyIsInJvbGVzIjpbImFkbWluIiwiZWRpdG9yIl0sImlhdCI6MTc2NzIyNTYwMCwibmJmIjoxNzY3MjI1NjAwLCJleHAiOjQxMDI0NDQ4MDAsImp0aSI6IjdmM2MyYTllLTViMWQtNGU4YS05YzZmLTJkNGI4YTFlMGYzNyJ9.EbvSIcbacMzrNAYIUxMSsv7irSNopj8_ksqtccKVMsSXo68r9535iz5HN26pGu-RhKI0L7hDRielXDdbw_0J8AWE2mpgALFGSpJ-X93USso-L8Qb43FDn25qu7mL7F42DN33QJiXP-ui_bpY24zZZwILPNHtlSSyq6W1zh6UZGawc5ICtfQuUhtYsTI5Hx1PDVV2-0hUxtbFP2srNeXU1WTednK_SMy1GCrKR5Bcq36HbX6WFWCoNr7Sa-w7vw_0YySBsp96oOBK6B34lh77bbT0KdOCpjcoKoJQnGjgIFBzpmSGKjzSxkHF-XykTN0bJ2u2Eh9i6dwz7GooHNzeKg',
  publicKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArsbowuX7pPnEXtbvDU+b
UkHm5fkJ/KjozYqsjlU+WIxO+jVarHSdeKr4NJJa1Z7RKuP6+acoG/pbreNd+Noi
HrvCmEiwzW7qe5+3YnaDENmKoJuQ7nCZ/yGEEFW36Xei/srACbVQ2ZDfVeZHWQWy
sSJ/01JeW3Tvo8NQEQib4VRRei7xmRbNGAxBvVxpaKg5pHHymC73S1198KTPpVGy
ACD2hUUlMHfUx9ruXWFlHIUkcBMgPbSZPNBtTmL239SJ5BMawRwGggyiBzItm+JV
PrSyznfKSVRV39+pN/wXopn7yEWFs0j8Ez7cdIaRWwlBwVfCCfcXe9APLJiftA1w
NQIDAQAB
-----END PUBLIC KEY-----`,
}

/** ES256 示例：受众为数组，公钥为 JWK */
export const ES256_SAMPLE = {
  token:
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InNob3dtZS1lYy0xIn0.eyJpc3MiOiJodHRwczovL2lkLmV4YW1wbGUuY24iLCJzdWIiOiLpn6nmooXmooUiLCJhdWQiOlsiYXBpOi8vb3JkZXJzIiwiYXBpOi8vYmlsbGluZyJdLCJzY29wZSI6Im9yZGVyczpyZWFkIGJpbGxpbmc6d3JpdGUiLCJpYXQiOjE3NjcyMjU2MDAsImV4cCI6NDEwMjQ0NDgwMH0.cWT3z9nKyP-f2ij3ln0ulQpnbAy-MvqbOq478M6ZHeKzU2zSITJqEPFWXpu3mobfLlt5B2P0YCxg0KcybtvxoQ',
  publicKey: JSON.stringify(
    {
      kty: 'EC',
      crv: 'P-256',
      x: 'jvccrH-IkFJL_dS_fHy7-mn-OsVCHAs51VIZNdX3wwM',
      y: 'WkGrJTs0kL6IwwhDWAc1mx8W5DxfsMrqE40Ma-4ReXM',
      kid: 'showme-ec-1',
      use: 'sig',
      alg: 'ES256',
    },
    null,
    2,
  ),
}

/** jwt.io 首页的经典示例 */
export const JWT_IO_SAMPLE = {
  token:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  secret: 'your-256-bit-secret',
}

/** 「生成」页默认的 HS 密钥 */
export const DEMO_SECRET = 'showme-demo-secret-请换成你自己的密钥'
