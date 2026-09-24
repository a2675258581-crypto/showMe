import { describe, expect, it } from 'vitest'
import { SNIPPET_LANGS, hmacSnippet, type SnippetInput, type SnippetLang } from './hmac-snippets'
import { hmac } from './hmac'
import { decodeInput } from './hash-bytes'
import { formatDigest } from './hash'

const base: SnippetInput = {
  algo: 'sha256',
  key: 'showMe-secret',
  keyEncoding: 'utf8',
  message: '{"event":"order.paid","id":"ord_1024"}\n中文 "引号" \\ $var',
  messageEncoding: 'utf8',
  format: 'hex',
  upper: false,
}

async function expected(o: SnippetInput) {
  const d = await hmac(
    o.algo,
    decodeInput(o.key, o.keyEncoding),
    decodeInput(o.message, o.messageEncoding),
  )
  return formatDigest(d, o.format, o.upper)
}

// ───── 用真实的语言运行时执行片段（本机没有对应工具链时自动跳过） ─────

interface Node {
  execFileSync: (
    f: string,
    a: string[],
    o?: { cwd?: string; timeout?: number; stdio?: string[] },
  ) => Uint8Array
}
interface Fs {
  mkdtempSync: (p: string) => string
  writeFileSync: (p: string, d: string) => void
  rmSync: (p: string, o: object) => void
}

async function load() {
  try {
    const cp = (await import(/* @vite-ignore */ 'node:' + 'child_process')) as Node
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as Fs
    const os = (await import(/* @vite-ignore */ 'node:' + 'os')) as { tmpdir: () => string }
    return { cp, fs, os }
  } catch {
    return null
  }
}

async function run(lang: SnippetLang, code: string): Promise<string | null> {
  const env = await load()
  if (!env) return null
  const { cp, fs, os } = env
  const dir = fs.mkdtempSync(`${os.tmpdir()}/hmac-snippet-`)
  const exec = (file: string, args: string[]) => {
    try {
      return new TextDecoder()
        .decode(
          cp.execFileSync(file, args, {
            cwd: dir,
            timeout: 60_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        )
        .trim()
    } catch (e) {
      const err = e as { code?: string; stderr?: Uint8Array }
      if (err.code === 'ENOENT') return null
      throw new Error(
        `${lang} failed: ${err.stderr ? new TextDecoder().decode(err.stderr) : String(e)}`,
        { cause: e },
      )
    }
  }
  try {
    switch (lang) {
      case 'node': {
        fs.writeFileSync(`${dir}/a.mjs`, `${code}\nprocess.stdout.write(signature)`)
        return exec('node', ['a.mjs'])
      }
      case 'python':
        return exec('python3', ['-c', `${code}\nprint(signature)`])
      case 'go':
        fs.writeFileSync(`${dir}/main.go`, code)
        return exec('go', ['run', 'main.go'])
      case 'java': {
        const lines = code.split('\n')
        const imports = lines.filter((l) => l.startsWith('import '))
        const body = lines.filter((l) => !l.startsWith('import ') && l.trim())
        fs.writeFileSync(
          `${dir}/Main.java`,
          `${imports.join('\n')}\npublic class Main { public static void main(String[] args) throws Exception {\n${body.join('\n')}\nSystem.out.print(signature);\n} }`,
        )
        return exec('java', ['Main.java'])
      }
      case 'php':
        return exec('php', ['-r', `${code.replace('<?php', '')}\necho $signature;`])
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('hmacSnippet', () => {
  it('generates a snippet for every language', () => {
    for (const { id } of SNIPPET_LANGS) expect(hmacSnippet(id, base), id).toBeTruthy()
  })

  it('returns null where the standard library lacks the algorithm', () => {
    expect(hmacSnippet('go', { ...base, algo: 'sm3' })).toBeNull()
    expect(hmacSnippet('java', { ...base, algo: 'sm3' })).toBeNull()
    expect(hmacSnippet('php', { ...base, algo: 'sm3' })).toBeNull()
    expect(hmacSnippet('python', { ...base, algo: 'sm3' })).toContain("'sm3'")
  })

  it('uses decoding helpers for hex / base64 inputs', () => {
    const o = {
      ...base,
      key: '00 ff',
      keyEncoding: 'hex',
      message: 'aGk=',
      messageEncoding: 'base64',
    } as const
    expect(hmacSnippet('node', o)).toContain(`Buffer.from("00ff", 'hex')`)
    expect(hmacSnippet('python', o)).toContain('base64.b64decode("aGk=")')
    expect(hmacSnippet('go', o)).toContain('hex.DecodeString("00ff")')
    expect(hmacSnippet('java', o)).toContain('HexFormat.of().parseHex("00ff")')
    expect(hmacSnippet('php', o)).toContain("base64_decode('aGk=')")
  })

  it('abbreviates very long values and says so in a comment', () => {
    const node = hmacSnippet('node', { ...base, message: 'x'.repeat(5000) })!
    expect(node).toContain('const message = "..."')
    expect(node.split('\n')[0]).toBe(
      '// 注意：消息（5,000 个字符）过长，已用 "..." 代替，请替换为实际内容',
    )
    expect(hmacSnippet('python', { ...base, key: 'k'.repeat(1001) })!.split('\n')[0]).toMatch(
      /^# 注意：密钥（1,001 个字符）/,
    )
    const php = hmacSnippet('php', { ...base, key: 'k'.repeat(1001) })!.split('\n')
    expect(php[0]).toBe('<?php')
    expect(php[1]).toMatch(/^\/\/ 注意：密钥/)
    // 1000 字符以内原样保留
    expect(hmacSnippet('node', { ...base, message: 'y'.repeat(1000) })).toContain('y'.repeat(1000))
  })

  it('normalises hex / base64 so every runtime can parse them', () => {
    const o = {
      ...base,
      key: '0x0A:0B:0C',
      keyEncoding: 'hex',
      message: 'aGk_-w',
      messageEncoding: 'base64',
    } as const
    expect(hmacSnippet('node', o)).toContain(`Buffer.from("0a0b0c", 'hex')`)
    expect(hmacSnippet('python', o)).toContain('base64.b64decode("aGk/+w==")')
    // 无法解析的输入原样保留（界面会同时显示错误）
    expect(hmacSnippet('go', { ...o, key: 'zz 1' })).toContain('hex.DecodeString("zz1")')
  })

  const combos: SnippetInput[] = [
    base,
    { ...base, algo: 'sha512', format: 'base64' },
    { ...base, algo: 'md5', upper: true, key: '0a0b0c', keyEncoding: 'hex' },
    {
      ...base,
      algo: 'sha3-256',
      message: 'aGVsbG8gd29ybGQ=',
      messageEncoding: 'base64',
      key: 'a2V5',
      keyEncoding: 'base64',
    },
    // 带分隔符的 Hex 与 URL-safe Base64 也要能在各语言里复现
    { ...base, key: '0x0a:0b:0c', keyEncoding: 'hex', message: '-_-_', messageEncoding: 'base64' },
    { ...base, message: '长消息'.repeat(300) },
  ]

  for (const lang of ['node', 'python', 'php', 'go', 'java'] as const) {
    it(`${lang} snippets reproduce the signature`, async () => {
      for (const o of combos) {
        const code = hmacSnippet(lang, o)
        if (!code) continue
        const out = await run(lang, code)
        if (out === null) return // 工具链不可用
        expect(out, `${lang} ${o.algo}`).toBe(await expected(o))
      }
    }, 120_000)
  }
})
