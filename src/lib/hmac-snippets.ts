/**
 * 为当前 HMAC 参数生成各语言的等价代码（纯字符串拼接，便于在项目里复现同样的签名）。
 */
import { bytesToBase64, bytesToHex, decodeInput, type ByteEncoding } from './hash-bytes'
import type { DigestFormat } from './hash'
import type { HmacAlgoId } from './hmac'

export type SnippetLang = 'node' | 'python' | 'go' | 'java' | 'php'

export const SNIPPET_LANGS: readonly { id: SnippetLang; label: string }[] = [
  { id: 'node', label: 'Node.js' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'java', label: 'Java' },
  { id: 'php', label: 'PHP' },
]

export interface SnippetInput {
  algo: HmacAlgoId
  key: string
  keyEncoding: ByteEncoding
  message: string
  messageEncoding: ByteEncoding
  format: DigestFormat
  upper: boolean
}

const NODE: Record<HmacAlgoId, string> = {
  md5: 'md5',
  sha1: 'sha1',
  sha224: 'sha224',
  sha256: 'sha256',
  sha384: 'sha384',
  sha512: 'sha512',
  'sha3-256': 'sha3-256',
  sm3: 'sm3',
}
const PY: Record<HmacAlgoId, string> = { ...NODE, 'sha3-256': 'sha3_256' }
const JAVA: Partial<Record<HmacAlgoId, string>> = {
  md5: 'HmacMD5',
  sha1: 'HmacSHA1',
  sha224: 'HmacSHA224',
  sha256: 'HmacSHA256',
  sha384: 'HmacSHA384',
  sha512: 'HmacSHA512',
  'sha3-256': 'HmacSHA3-256',
}
const GO: Partial<Record<HmacAlgoId, { pkg: string; ctor: string }>> = {
  md5: { pkg: 'crypto/md5', ctor: 'md5.New' },
  sha1: { pkg: 'crypto/sha1', ctor: 'sha1.New' },
  sha224: { pkg: 'crypto/sha256', ctor: 'sha256.New224' },
  sha256: { pkg: 'crypto/sha256', ctor: 'sha256.New' },
  sha384: { pkg: 'crypto/sha512', ctor: 'sha512.New384' },
  sha512: { pkg: 'crypto/sha512', ctor: 'sha512.New' },
  'sha3-256': { pkg: 'crypto/sha3', ctor: 'func() hash.Hash { return sha3.New256() }' },
}
const PHP: Partial<Record<HmacAlgoId, string>> = {
  md5: 'md5',
  sha1: 'sha1',
  sha224: 'sha224',
  sha256: 'sha256',
  sha384: 'sha384',
  sha512: 'sha512',
  'sha3-256': 'sha3-256',
}

/** 双引号字符串字面量（JS / Python / Go / Java 通用的转义） */
function dq(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '"' || ch === '\\') out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (c < 0x20 || c === 0x7f) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

/** JS / Python：内容含双引号而不含单引号时改用单引号，读起来更清爽 */
function smartQuote(s: string): string {
  if (!s.includes('"') || s.includes("'")) return dq(s)
  const inner = dq(s).slice(1, -1).replace(/\\"/g, '"')
  return `'${inner}'`
}

/** PHP 单引号字符串：只需转义 \ 与 ' */
const sq = (s: string) => `'${s.replace(/[\\']/g, (m) => `\\${m}`)}'`

export const MAX_LITERAL = 1000

/**
 * Hex / Base64 规范化成各语言标准库都能解析的形式：
 * 去掉空白、冒号、0x 前缀，URL-safe Base64 转成标准 Base64 并补齐填充；无法解析时原样保留。
 */
function canonical(v: string, e: ByteEncoding): string {
  if (e === 'utf8') return v
  try {
    const bytes = decodeInput(v, e)
    return e === 'hex' ? bytesToHex(bytes) : bytesToBase64(bytes)
  } catch {
    return v.replace(/\s+/g, '')
  }
}

/** 返回代码片段；该语言标准库不支持此算法时返回 null */
export function hmacSnippet(lang: SnippetLang, o: SnippetInput): string | null {
  const quote = lang === 'php' ? sq : lang === 'node' || lang === 'python' ? smartQuote : dq
  const comment = lang === 'python' ? '#' : '//'
  // 过长的值用省略号代替并加注释提醒，避免片段被撑爆
  const omitted: string[] = []
  const lit = (v: string, name: string) => {
    if (v.length <= MAX_LITERAL) return quote(v)
    omitted.push(`${name}（${v.length.toLocaleString('en-US')} 个字符）`)
    return quote('...')
  }
  const keyLit = lit(canonical(o.key, o.keyEncoding), '密钥')
  const msgLit = lit(canonical(o.message, o.messageEncoding), '消息')
  const code = build(lang, o, keyLit, msgLit)
  if (!code || !omitted.length) return code
  const note = `${comment} 注意：${omitted.join('、')}过长，已用 "..." 代替，请替换为实际内容`
  return lang === 'php' || lang === 'go' ? code.replace('\n', `\n${note}\n`) : `${note}\n${code}`
}

function build(lang: SnippetLang, o: SnippetInput, keyLit: string, msgLit: string): string | null {
  switch (lang) {
    case 'node': {
      const dec = (v: string, e: ByteEncoding) => (e === 'utf8' ? v : `Buffer.from(${v}, '${e}')`)
      const up = o.upper && o.format === 'hex' ? '.toUpperCase()' : ''
      return [
        "import { createHmac } from 'node:crypto'",
        '',
        `const key = ${dec(keyLit, o.keyEncoding)}`,
        `const message = ${dec(msgLit, o.messageEncoding)}`,
        `const signature = createHmac('${NODE[o.algo]}', key).update(message).digest('${o.format}')${up}`,
      ].join('\n')
    }
    case 'python': {
      const dec = (v: string, e: ByteEncoding) =>
        e === 'utf8'
          ? `${v}.encode()`
          : e === 'hex'
            ? `bytes.fromhex(${v})`
            : `base64.b64decode(${v})`
      const needB64 =
        o.format === 'base64' || o.keyEncoding === 'base64' || o.messageEncoding === 'base64'
      const out =
        o.format === 'hex'
          ? `mac.hexdigest()${o.upper ? '.upper()' : ''}`
          : 'base64.b64encode(mac.digest()).decode()'
      return [
        `import hmac${needB64 ? ', base64' : ''}`,
        '',
        `key = ${dec(keyLit, o.keyEncoding)}`,
        `message = ${dec(msgLit, o.messageEncoding)}`,
        `mac = hmac.new(key, message, '${PY[o.algo]}')`,
        `signature = ${out}`,
      ].join('\n')
    }
    case 'go': {
      const g = GO[o.algo]
      if (!g) return null
      const imports = new Set(['crypto/hmac', g.pkg, 'fmt'])
      if (o.algo === 'sha3-256') imports.add('hash')
      const dec = (name: string, v: string, e: ByteEncoding) => {
        if (e === 'utf8') return `${name} := []byte(${v})`
        imports.add(e === 'hex' ? 'encoding/hex' : 'encoding/base64')
        return `${name}, _ := ${e === 'hex' ? 'hex.DecodeString' : 'base64.StdEncoding.DecodeString'}(${v})`
      }
      const keyLine = dec('key', keyLit, o.keyEncoding)
      const msgLine = dec('message', msgLit, o.messageEncoding)
      let out: string
      if (o.format === 'hex') {
        imports.add('encoding/hex')
        out = 'hex.EncodeToString(mac.Sum(nil))'
        if (o.upper) {
          imports.add('strings')
          out = `strings.ToUpper(${out})`
        }
      } else {
        imports.add('encoding/base64')
        out = 'base64.StdEncoding.EncodeToString(mac.Sum(nil))'
      }
      return [
        'package main',
        '',
        'import (',
        ...[...imports].sort().map((i) => `\t"${i}"`),
        ')',
        '',
        'func main() {',
        `\t${keyLine}`,
        `\t${msgLine}`,
        `\tmac := hmac.New(${g.ctor}, key)`,
        '\tmac.Write(message)',
        `\tfmt.Println(${out})`,
        '}',
      ].join('\n')
    }
    case 'java': {
      const name = JAVA[o.algo]
      if (!name) return null
      const dec = (v: string, e: ByteEncoding) =>
        e === 'utf8'
          ? `${v}.getBytes(StandardCharsets.UTF_8)`
          : e === 'hex'
            ? `HexFormat.of().parseHex(${v})`
            : `Base64.getDecoder().decode(${v})`
      const out =
        o.format === 'hex'
          ? `HexFormat.of()${o.upper ? '.withUpperCase()' : ''}.formatHex(mac.doFinal(message))`
          : 'Base64.getEncoder().encodeToString(mac.doFinal(message))'
      return [
        'import javax.crypto.Mac;',
        'import javax.crypto.spec.SecretKeySpec;',
        'import java.nio.charset.StandardCharsets;',
        'import java.util.Base64;',
        'import java.util.HexFormat;',
        '',
        `byte[] key = ${dec(keyLit, o.keyEncoding)};`,
        `byte[] message = ${dec(msgLit, o.messageEncoding)};`,
        `Mac mac = Mac.getInstance("${name}");`,
        `mac.init(new SecretKeySpec(key, "${name}"));`,
        `String signature = ${out};`,
      ].join('\n')
    }
    case 'php': {
      const name = PHP[o.algo]
      if (!name) return null
      const dec = (v: string, e: ByteEncoding) =>
        e === 'utf8' ? v : e === 'hex' ? `hex2bin(${v})` : `base64_decode(${v})`
      const call = (raw: boolean) => `hash_hmac('${name}', $message, $key${raw ? ', true' : ''})`
      const out =
        o.format === 'hex'
          ? o.upper
            ? `strtoupper(${call(false)})`
            : call(false)
          : `base64_encode(${call(true)})`
      return [
        '<?php',
        `$key = ${dec(keyLit, o.keyEncoding)};`,
        `$message = ${dec(msgLit, o.messageEncoding)};`,
        `$signature = ${out};`,
      ].join('\n')
    }
  }
}
