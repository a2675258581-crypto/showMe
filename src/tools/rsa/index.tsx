import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BadgeCheck,
  Fingerprint,
  KeyRound,
  Link2Off,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { Button, Field, Notice, Panel, SegmentedControl, type SelectOption } from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  KEY_SIZES,
  exportPrivate,
  exportPublic,
  fingerprints,
  generateRsaKeyPair,
  keysMatch,
  parseRsaKey,
  publicFromPrivate,
  type BinaryEncoding,
  type KeyPurpose,
  type KeySize,
  type PrivateFormat,
  type PublicFormat,
  type RsaHash,
  type SignScheme,
} from '@/lib/rsa'
import { KeyPane, type Parsed } from './KeyPane'
import { Operations, type KeyRef } from './Operations'

interface Options {
  purpose: KeyPurpose
  bits: KeySize
  oaepHash: RsaHash
  signScheme: SignScheme
  signHash: RsaHash
  enc: BinaryEncoding
  pubFormat: PublicFormat
  privFormat: PrivateFormat
}

const DEFAULTS: Options = {
  purpose: 'encrypt',
  bits: 2048,
  oaepHash: 'SHA-256',
  signScheme: 'RSASSA-PKCS1-v1_5',
  signHash: 'SHA-256',
  enc: 'base64',
  pubFormat: 'spki',
  privFormat: 'pkcs8',
}

const PUBLIC_FORMATS: SelectOption[] = [
  { value: 'spki', label: 'SPKI PEM' },
  { value: 'pkcs1', label: 'PKCS#1 PEM' },
  { value: 'openssh', label: 'OpenSSH' },
  { value: 'jwk', label: 'JWK' },
]
const PRIVATE_FORMATS: SelectOption[] = [
  { value: 'pkcs8', label: 'PKCS#8 PEM' },
  { value: 'pkcs1', label: 'PKCS#1 PEM' },
  { value: 'jwk', label: 'JWK' },
]

const HASHES: { value: RsaHash; label: string }[] = [
  { value: 'SHA-1', label: 'SHA-1' },
  { value: 'SHA-256', label: 'SHA-256' },
  { value: 'SHA-384', label: 'SHA-384' },
  { value: 'SHA-512', label: 'SHA-512' },
]

const PUB_EXT: Record<PublicFormat, string> = {
  spki: 'public.pem',
  pkcs1: 'public-pkcs1.pem',
  openssh: 'id_rsa.pub',
  jwk: 'public.jwk.json',
}
const PRIV_EXT: Record<PrivateFormat, string> = {
  pkcs8: 'private.pem',
  pkcs1: 'private-pkcs1.pem',
  jwk: 'private.jwk.json',
}

function parse(text: string): Parsed {
  if (!text.trim()) return null
  try {
    return { ok: true, info: parseRsaKey(text) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function keyRef(p: Parsed, kind: 'public' | 'private'): KeyRef | null {
  if (!p?.ok || p.info.kind !== kind) return null
  return { der: p.info.der, bits: p.info.bits, id: `${p.info.modulusHex}:${p.info.exponent}` }
}

export default function RsaTool() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('rsa.options.v1', DEFAULTS)
  const merged: Options = { ...DEFAULTS, ...stored }
  // 位数来自 localStorage，非法值（如被改成 16384）会让生成卡住很久，这里限定在可选范围内
  const o: Options = {
    ...merged,
    bits: KEY_SIZES.includes(merged.bits) ? merged.bits : DEFAULTS.bits,
  }
  const set = (patch: Partial<Options>) => setStored((prev) => ({ ...DEFAULTS, ...prev, ...patch }))

  const [publicText, setPublicText] = useState('')
  const [privateText, setPrivateText] = useState('')
  const [generating, setGenerating] = useState(true)
  /** 正在生成的位数（生成过程中改选项也不影响提示文字） */
  const [genBits, setGenBits] = useState<number>(o.bits)
  const [genError, setGenError] = useState<string | null>(null)
  /** 上一次生成的结果摘要（与当前选项分开保存，改选项后不会“说谎”） */
  const [lastGen, setLastGen] = useState<{ bits: number; hash: RsaHash; ms: number } | null>(null)
  /** 生成中的计时（每 100ms 累加） */
  const [genMs, setGenMs] = useState(0)

  const pubParsed = useMemo(() => parse(publicText), [publicText])
  const privParsed = useMemo(() => parse(privateText), [privateText])
  const pub = useMemo(() => keyRef(pubParsed, 'public'), [pubParsed])
  const priv = useMemo(() => keyRef(privParsed, 'private'), [privParsed])
  const match =
    pubParsed?.ok && privParsed?.ok && pub && priv
      ? keysMatch(pubParsed.info, privParsed.info)
      : null

  const runGenerate = async (opts: Options) => {
    const t0 = performance.now()
    try {
      const pair = await generateRsaKeyPair({
        bits: opts.bits,
        purpose: opts.purpose,
        hash: opts.purpose === 'encrypt' ? opts.oaepHash : opts.signHash,
        scheme: opts.signScheme,
      })
      setPublicText(exportPublic(pair.spki, opts.pubFormat))
      setPrivateText(exportPrivate(pair.pkcs8, opts.privFormat))
      setGenError(null)
      setLastGen({
        bits: opts.bits,
        hash: opts.purpose === 'encrypt' ? opts.oaepHash : opts.signHash,
        ms: performance.now() - t0,
      })
    } catch (e) {
      setGenError(`生成失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setGenerating(false)
    }
  }

  // 首次进入自动生成一对 2048 位（或上次选择的长度）密钥，方便直接体验
  const firstRun = useRef(true)
  useEffect(() => {
    if (!firstRun.current) return
    firstRun.current = false
    void runGenerate(o)
    // 只在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 生成中显示计时
  useEffect(() => {
    if (!generating) return
    const t = setInterval(() => setGenMs((x) => x + 100), 100)
    return () => clearInterval(t)
  }, [generating])

  const generate = () => {
    setGenerating(true)
    setGenBits(o.bits)
    setLastGen(null)
    setGenMs(0)
    void runGenerate(o)
  }

  // 公钥指纹（异步）
  const [fp, setFp] = useState<{ id: string; spki: string; ssh: string } | null>(null)
  useEffect(() => {
    if (!pub) return
    let alive = true
    fingerprints(pub.der).then(
      (f) => alive && setFp({ id: pub.id, spki: f.spkiSha256, ssh: f.openssh }),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [pub])

  const changePubFormat = (f: string) => {
    const format = f as PublicFormat
    set({ pubFormat: format })
    if (pubParsed?.ok && pubParsed.info.kind === 'public')
      setPublicText(exportPublic(pubParsed.info.der, format))
  }
  const changePrivFormat = (f: string) => {
    const format = f as PrivateFormat
    set({ privFormat: format })
    if (privParsed?.ok && privParsed.info.kind === 'private') {
      setPrivateText(exportPrivate(privParsed.info.der, format))
    }
  }
  const derivePublic = () => {
    if (privParsed?.ok && privParsed.info.kind === 'private') {
      setPublicText(exportPublic(publicFromPrivate(privParsed.info.der), o.pubFormat))
    }
  }

  const seconds = genMs / 1000

  return (
    <div className="flex flex-col gap-4">
      {/* ───── 生成选项 ───── */}
      <Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 xl:grid-cols-[auto_auto_1fr]">
          <Field label="用途">
            <SegmentedControl<KeyPurpose>
              className="self-start"
              aria-label="密钥用途"
              value={o.purpose}
              onChange={(v) => set({ purpose: v })}
              options={[
                {
                  value: 'encrypt',
                  label: (
                    <>
                      <LockKeyhole />
                      加密
                    </>
                  ),
                },
                {
                  value: 'sign',
                  label: (
                    <>
                      <BadgeCheck />
                      签名
                    </>
                  ),
                },
              ]}
            />
          </Field>
          <Field
            label="密钥长度"
            hint={
              o.bits === 1024
                ? '1024 位已不安全，仅用于测试'
                : o.bits === 4096
                  ? '4096 位更安全，但生成可能需要数秒'
                  : o.bits === 2048
                    ? '推荐：兼顾安全与性能'
                    : undefined
            }
          >
            <SegmentedControl<string>
              className="self-start"
              aria-label="密钥长度"
              value={String(o.bits)}
              onChange={(v) => set({ bits: Number(v) as KeySize })}
              options={KEY_SIZES.map((b) => ({ value: String(b), label: String(b) }))}
            />
          </Field>
          <AnimatePresence mode="popLayout" initial={false}>
            {o.purpose === 'encrypt' ? (
              <motion.div
                key="oaep"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
              >
                <Field label="RSA-OAEP 哈希（MGF1 同哈希）">
                  <SegmentedControl<RsaHash>
                    size="sm"
                    className="self-start"
                    aria-label="OAEP 哈希"
                    value={o.oaepHash}
                    onChange={(v) => set({ oaepHash: v })}
                    options={HASHES}
                  />
                </Field>
              </motion.div>
            ) : (
              <motion.div
                key="sign"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                className="flex flex-wrap gap-5"
              >
                <Field label="签名方案">
                  <SegmentedControl<SignScheme>
                    size="sm"
                    className="self-start"
                    aria-label="签名方案"
                    value={o.signScheme}
                    onChange={(v) => set({ signScheme: v })}
                    options={[
                      { value: 'RSASSA-PKCS1-v1_5', label: 'PKCS#1 v1.5' },
                      { value: 'RSA-PSS', label: 'PSS' },
                    ]}
                  />
                </Field>
                <Field label="哈希">
                  <SegmentedControl<RsaHash>
                    size="sm"
                    className="self-start"
                    aria-label="签名哈希"
                    value={o.signHash}
                    onChange={(v) => set({ signHash: v })}
                    options={HASHES.filter((h) => h.value !== 'SHA-1')}
                  />
                </Field>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button
            variant="primary"
            size="lg"
            onClick={generate}
            disabled={generating}
            icon={generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          >
            {generating ? `正在生成 RSA-${genBits}…` : '生成密钥对'}
          </Button>
          <span className="text-[13px] text-fg-2 tabular-nums" aria-live="polite">
            {generating
              ? `${seconds.toFixed(1)} 秒`
              : lastGen !== null
                ? `已生成 RSA-${lastGen.bits} · ${lastGen.hash} · 用时 ${(lastGen.ms / 1000).toFixed(2)} 秒`
                : ''}
          </span>
          <span className="w-full text-xs text-fg-3 sm:ml-auto sm:w-auto">
            密钥只在浏览器内存中，不会上传也不会保存
          </span>
        </div>
        {genError && (
          <Notice tone="error" className="mt-4">
            {genError}
          </Notice>
        )}
      </Panel>

      {/* ───── 密钥 ───── */}
      <div className="relative grid gap-4 lg:grid-cols-2">
        <KeyPane
          title="公钥"
          icon={<KeyRound />}
          kind="public"
          value={publicText}
          onChange={setPublicText}
          parsed={pubParsed}
          format={o.pubFormat}
          formats={PUBLIC_FORMATS}
          onFormat={changePubFormat}
          downloadName={PUB_EXT[o.pubFormat]}
          placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'}
          busy={generating}
          extra={
            priv && (!pub || match === false) ? (
              <Button size="sm" variant="ghost" icon={<Wand2 />} onClick={derivePublic}>
                从私钥提取
              </Button>
            ) : null
          }
          footer={
            pub &&
            fp?.id === pub.id && (
              <div className="flex items-start gap-2 border-t border-line px-4 py-2 text-[11px] text-fg-3">
                <Fingerprint className="mt-px size-3.5 shrink-0" />
                <div className="min-w-0 font-mono break-all">
                  <div>{fp.ssh}</div>
                  <div className="hidden sm:block">SPKI SHA-256 {fp.spki}</div>
                </div>
              </div>
            )
          }
        />
        <KeyPane
          title="私钥"
          icon={<LockKeyhole />}
          kind="private"
          value={privateText}
          onChange={setPrivateText}
          parsed={privParsed}
          format={o.privFormat}
          formats={PRIVATE_FORMATS}
          onFormat={changePrivFormat}
          downloadName={PRIV_EXT[o.privFormat]}
          placeholder={'-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'}
          busy={generating}
        />
        <AnimatePresence>
          {match !== null && (
            <motion.div
              key={String(match)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 26 }}
              className={
                'mx-auto -my-1 flex w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold shadow-card lg:col-span-2 ' +
                (match ? 'text-success' : 'text-danger')
              }
              role="status"
            >
              {match ? <BadgeCheck className="size-4" /> : <Link2Off className="size-4" />}
              {match ? '公私钥匹配' : '公私钥不是一对'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ───── 操作 ───── */}
      <Operations
        purpose={o.purpose}
        pub={pub}
        priv={priv}
        oaepHash={o.oaepHash}
        signScheme={o.signScheme}
        signHash={o.signHash}
        enc={o.enc}
        onEnc={(enc) => set({ enc })}
      />

      <Notice tone="info">
        浏览器 Web Crypto 只提供 RSA-OAEP 加密，不支持 RSAES-PKCS1-v1_5（旧式 PKCS#1 v1.5
        填充）加密。若对方系统（如 JSEncrypt、openssl rsautl 默认模式、部分 Java / PHP 旧代码）使用
        PKCS#1 v1.5 填充，这里的密文无法与之互通，请改用 OpenSSL 等工具，或让对方升级到
        OAEP。签名不受影响：PKCS#1 v1.5 签名与 PSS 均可用。
      </Notice>
    </div>
  )
}
