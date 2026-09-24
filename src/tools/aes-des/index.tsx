import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Dices,
  KeyRound,
  LoaderCircle,
  Lock,
  LockOpen,
  Sparkles,
  TextCursorInput,
  Wand2,
} from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import {
  Button,
  Field,
  Input,
  Notice,
  Panel,
  SegmentedControl,
  Select,
  useToast,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  CIPHERS,
  CIPHER_IDS,
  KDFS,
  MODES,
  PADDINGS,
  ivRequirement,
  isStream,
  opensslCommand,
  runCipherAsync,
  validateIv,
  validateKey,
  type CipherAlgo,
  type CipherEncoding,
  type CipherMode,
  type CipherOutcome,
  type CipherRequest,
  type Direction,
  type KdfId,
  type PaddingId,
  type PlainEncoding,
} from '@/lib/aes-des'
import {
  decodeInput,
  encodeOutput,
  randomEncoded,
  utf8Encode,
  type ByteEncoding,
} from '@/lib/hash-bytes'
import { KeyField, type LengthStatus } from './KeyField'
import { UsedParams } from './UsedParams'

interface Options {
  direction: Direction
  algo: CipherAlgo
  mode: CipherMode
  padding: PaddingId
  keyMode: 'raw' | 'passphrase'
  keyEncoding: ByteEncoding
  ivEncoding: ByteEncoding
  kdf: KdfId
  iterations: number
  keySize: number
  plainEncoding: PlainEncoding
  cipherEncoding: CipherEncoding
}

const DEFAULTS: Options = {
  direction: 'encrypt',
  algo: 'AES',
  mode: 'CBC',
  padding: 'Pkcs7',
  keyMode: 'raw',
  keyEncoding: 'utf8',
  ivEncoding: 'utf8',
  kdf: 'md5',
  iterations: 10000,
  keySize: 32,
  plainEncoding: 'utf8',
  cipherEncoding: 'base64',
}

const SAMPLE_PLAIN =
  '你好，showMe！这是一段需要加密的敏感数据：{"user":"张三","card":"6222 **** 1024"} 🔐'

/** 各算法的演示密钥 / IV（UTF-8，长度恰好合法） */
const DEMO_KEYS: Record<CipherAlgo, string> = {
  AES: 'showMe-AES-256-key-please-change',
  DES: 'showMe!!',
  TripleDES: 'showMe-3DES-24-bytes-key',
  RC4: 'showMe-RC4-key',
  Rabbit: 'showMe-rabbit-16',
}
const DEMO_IVS: Record<CipherAlgo, string> = {
  AES: 'showMe-iv-16byte',
  DES: 'iv-8byte',
  TripleDES: 'iv-8byte',
  RC4: '',
  Rabbit: 'rabbitIV',
}

const MODE_LABELS: Record<CipherMode, string> = {
  CBC: 'CBC · 密码分组链接',
  ECB: 'ECB · 电子密码本',
  CFB: 'CFB · 密文反馈',
  OFB: 'OFB · 输出反馈',
  CTR: 'CTR · 计数器',
}

const ALGO_LABEL: Record<CipherAlgo, string> = {
  AES: 'AES',
  DES: 'DES',
  TripleDES: '3DES',
  RC4: 'RC4',
  Rabbit: 'Rabbit',
}

/** 可选的派生 / 随机密钥长度 */
const KEY_SIZE_OPTIONS: Partial<Record<CipherAlgo, { value: string; label: string }[]>> = {
  AES: [
    { value: '16', label: 'AES-128' },
    { value: '24', label: 'AES-192' },
    { value: '32', label: 'AES-256' },
  ],
  TripleDES: [
    { value: '16', label: '双倍长 16 字节' },
    { value: '24', label: '三倍长 24 字节' },
  ],
  RC4: [
    { value: '16', label: '128 位（OpenSSL）' },
    { value: '32', label: '256 位（CryptoJS）' },
  ],
}

/** 「密钥」标签行里空间有限，用短标签 */
const KEY_SIZE_SHORT: Partial<Record<CipherAlgo, { value: string; label: string }[]>> = {
  AES: KEY_SIZE_OPTIONS.AES,
  TripleDES: [
    { value: '16', label: '16 字节' },
    { value: '24', label: '24 字节' },
  ],
  RC4: [
    { value: '16', label: '128 位' },
    { value: '32', label: '256 位' },
  ],
}

function keyLabel(algo: CipherAlgo, n: number): string {
  switch (algo) {
    case 'AES':
      return `AES-${n * 8}`
    case 'TripleDES':
      return n === 16 ? '双倍长' : '三倍长'
    case 'RC4':
      return `${n * 8} 位`
    default:
      return `${n * 8} 位`
  }
}

function lengthStatus(
  text: string,
  enc: ByteEncoding,
  validate: (b: Uint8Array) => string | null,
  okLabel: (n: number) => string,
): LengthStatus | undefined {
  if (!text) return undefined
  let bytes: Uint8Array
  try {
    bytes = decodeInput(text, enc)
  } catch (e) {
    return { tone: 'bad', text: '编码错误', title: e instanceof Error ? e.message : String(e) }
  }
  const err = validate(bytes)
  return err
    ? { tone: 'bad', text: `${bytes.length} 字节`, title: err }
    : { tone: 'ok', text: okLabel(bytes.length) }
}

const PADDING_IDS = PADDINGS.map((p) => p.id)
const KDF_IDS = KDFS.map((k) => k.id)
const BYTE_ENCODINGS = ['utf8', 'hex', 'base64'] as const
const oneOf = <T,>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback
const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** localStorage 里的旧值或被改坏的值回落到默认值，避免渲染时出错 */
function sanitize(stored: unknown): Options {
  const o = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) } as Options
  return {
    direction: oneOf(o.direction, ['encrypt', 'decrypt'] as const, DEFAULTS.direction),
    algo: oneOf(o.algo, CIPHER_IDS, DEFAULTS.algo),
    mode: oneOf(o.mode, MODES, DEFAULTS.mode),
    padding: oneOf(o.padding, PADDING_IDS, DEFAULTS.padding),
    keyMode: oneOf(o.keyMode, ['raw', 'passphrase'] as const, DEFAULTS.keyMode),
    keyEncoding: oneOf(o.keyEncoding, BYTE_ENCODINGS, DEFAULTS.keyEncoding),
    ivEncoding: oneOf(o.ivEncoding, BYTE_ENCODINGS, DEFAULTS.ivEncoding),
    kdf: oneOf(o.kdf, KDF_IDS, DEFAULTS.kdf),
    iterations: finite(o.iterations, DEFAULTS.iterations),
    keySize: finite(o.keySize, DEFAULTS.keySize),
    plainEncoding: oneOf(o.plainEncoding, BYTE_ENCODINGS, DEFAULTS.plainEncoding),
    cipherEncoding: oneOf(o.cipherEncoding, ['base64', 'hex'] as const, DEFAULTS.cipherEncoding),
  }
}

export default function AesDesTool() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('aes-des.options.v1', DEFAULTS)
  const opts = sanitize(stored)
  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setStored((prev) => ({ ...DEFAULTS, ...prev, [key]: value }))
  const patch = (p: Partial<Options>) => setStored((prev) => ({ ...DEFAULTS, ...prev, ...p }))

  const info = CIPHERS[opts.algo]
  const stream = isStream(opts.algo)
  const keySize = info.keySizes.includes(opts.keySize) ? opts.keySize : info.defaultKeySize
  const ivReq = ivRequirement(opts.algo, opts.mode)

  const [input, setInput] = useState(SAMPLE_PLAIN)
  const [key, setKey] = useState(DEMO_KEYS[opts.algo])
  const [iv, setIv] = useState(DEMO_IVS[opts.algo])
  const [keyTouched, setKeyTouched] = useState(false)
  const [ivTouched, setIvTouched] = useState(false)
  const [passphrase, setPassphrase] = useState('showMe-口令-2026')
  const [salt, setSalt] = useState('')

  const changeAlgo = (algo: CipherAlgo) => {
    set('algo', algo)
    // 还没改过的演示密钥 / IV 跟随算法换成合法长度
    if (!keyTouched && opts.keyEncoding === 'utf8') setKey(DEMO_KEYS[algo])
    if (!ivTouched && opts.ivEncoding === 'utf8') setIv(DEMO_IVS[algo])
  }

  const randomKey = (size = keySize) => {
    setKey(randomEncoded(size, opts.keyEncoding))
    setKeyTouched(true)
  }
  const randomIv = () => {
    setIv(randomEncoded(info.ivSize, opts.ivEncoding))
    setIvTouched(true)
  }

  const req = useMemo<CipherRequest>(
    () => ({
      direction: opts.direction,
      algo: opts.algo,
      mode: opts.mode,
      padding: opts.padding,
      keyMode: opts.keyMode,
      key,
      keyEncoding: opts.keyEncoding,
      iv,
      ivEncoding: opts.ivEncoding,
      passphrase,
      kdf: opts.kdf,
      iterations: opts.iterations,
      salt,
      keySize,
      input,
      plainEncoding: opts.plainEncoding,
      cipherEncoding: opts.cipherEncoding,
    }),
    [
      opts.direction,
      opts.algo,
      opts.mode,
      opts.padding,
      opts.keyMode,
      key,
      opts.keyEncoding,
      iv,
      opts.ivEncoding,
      passphrase,
      opts.kdf,
      opts.iterations,
      salt,
      keySize,
      input,
      opts.plainEncoding,
      opts.cipherEncoding,
    ],
  )
  const dReq = useDebounced(req, 150)
  // PBKDF2 口令派生在 WebCrypto 里异步完成，大迭代次数也不会卡住页面
  const [done, setDone] = useState<{ req: CipherRequest; outcome: CipherOutcome } | null>(null)
  useEffect(() => {
    if (!dReq.input) return
    let alive = true
    runCipherAsync(dReq).then((outcome) => {
      if (alive) setDone({ req: dReq, outcome })
    })
    return () => {
      alive = false
    }
  }, [dReq])
  const outcome = req.input && done ? done.outcome : null
  const computing = !!req.input && done?.req !== req
  // 只有明显变慢（如 PBKDF2 迭代次数很大）时才显示「计算中」，避免每次输入都闪一下
  const slow = useDebounced(computing, 400) && computing
  const command = useMemo(
    () => (done?.outcome.ok ? opensslCommand(done.req, done.outcome.used) : null),
    [done],
  )

  const toast = useToast()
  // 「示例」：加密时填入示例明文；解密时用当前参数把示例明文加密后填入
  const loadSample = async () => {
    if (opts.direction === 'encrypt') {
      setInput(encodeOutput(utf8Encode(SAMPLE_PLAIN), opts.plainEncoding))
      return
    }
    const enc = await runCipherAsync({
      ...req,
      direction: 'encrypt',
      input: SAMPLE_PLAIN,
      plainEncoding: 'utf8',
    })
    if (enc.ok) setInput(enc.output)
    else toast(`无法用当前参数生成示例密文：${enc.error}`, 'error')
  }

  const swap = () => {
    if (outcome?.ok) setInput(outcome.output)
    const next = opts.direction === 'encrypt' ? 'decrypt' : 'encrypt'
    set('direction', next)
  }

  const keyStatus =
    opts.keyMode === 'raw'
      ? lengthStatus(
          key,
          opts.keyEncoding,
          (b) => validateKey(opts.algo, b),
          (n) => `${n} 字节 · ${keyLabel(opts.algo, n)}`,
        )
      : undefined
  const ivStatus =
    ivReq !== 'none'
      ? lengthStatus(
          iv,
          opts.ivEncoding,
          (b) => validateIv(opts.algo, opts.mode, b),
          (n) => `${n} 字节`,
        )
      : undefined

  const err = outcome && !outcome.ok ? outcome : null
  const errorField = err?.field
  const isEncrypt = opts.direction === 'encrypt'
  const paddingNote = PADDINGS.find((p) => p.id === opts.padding)?.note

  const plainSeg = (
    <SegmentedControl
      size="sm"
      aria-label="明文编码"
      value={opts.plainEncoding}
      onChange={(v) => set('plainEncoding', v)}
      options={[
        { value: 'utf8', label: 'UTF-8' },
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ]}
    />
  )
  const cipherSeg = (
    <SegmentedControl
      size="sm"
      aria-label="密文编码"
      value={opts.cipherEncoding}
      onChange={(v) => set('cipherEncoding', v)}
      options={[
        { value: 'base64', label: 'Base64' },
        { value: 'hex', label: 'Hex' },
      ]}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-5">
        {/* 方向 + 算法 */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <SegmentedControl
            aria-label="加密或解密"
            value={opts.direction}
            onChange={(v) => set('direction', v)}
            options={[
              {
                value: 'encrypt',
                label: (
                  <>
                    <Lock />
                    加密
                  </>
                ),
              },
              {
                value: 'decrypt',
                label: (
                  <>
                    <LockOpen />
                    解密
                  </>
                ),
              },
            ]}
          />
          {/* 窄屏用小号分段控件，避免 5 个选项撑出卡片 */}
          {(['sm', 'md'] as const).map((size) => (
            <div key={size} className={size === 'sm' ? 'sm:hidden' : 'hidden sm:block'}>
              <SegmentedControl
                size={size}
                aria-label="算法"
                value={opts.algo}
                onChange={changeAlgo}
                options={CIPHER_IDS.map((id) => ({
                  value: id,
                  label: ALGO_LABEL[id],
                  title: CIPHERS[id].note,
                }))}
              />
            </div>
          ))}
          <span className="hidden text-xs text-fg-3 lg:inline">{info.note}</span>
        </div>

        {/* 模式 / 填充 / 密钥方式 */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="模式" hint={stream ? '流密码不分组，没有模式' : undefined}>
            <Select
              value={opts.mode}
              onChange={(v) => set('mode', v as CipherMode)}
              options={MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
              disabled={stream}
              aria-label="模式"
              className={
                stream ? 'w-full opacity-50 transition-opacity' : 'w-full transition-opacity'
              }
            />
          </Field>
          <Field label="填充" hint={stream ? '流密码无需填充' : paddingNote}>
            <Select
              value={opts.padding}
              onChange={(v) => set('padding', v as PaddingId)}
              options={PADDINGS.map((p) => ({ value: p.id, label: p.label }))}
              disabled={stream}
              aria-label="填充"
              className={
                stream ? 'w-full opacity-50 transition-opacity' : 'w-full transition-opacity'
              }
            />
          </Field>
          <Field
            label="密钥方式"
            hint={
              opts.keyMode === 'raw' ? '直接给出密钥与 IV' : '由口令派生，兼容 OpenSSL / CryptoJS'
            }
          >
            <SegmentedControl
              block
              aria-label="密钥方式"
              value={opts.keyMode}
              onChange={(v) => set('keyMode', v)}
              options={[
                {
                  value: 'raw',
                  label: (
                    <>
                      <KeyRound />
                      密钥 + IV
                    </>
                  ),
                },
                {
                  value: 'passphrase',
                  label: (
                    <>
                      <TextCursorInput />
                      口令
                    </>
                  ),
                },
              ]}
            />
          </Field>
        </div>

        {/* 密钥区 */}
        <AnimatePresence mode="wait" initial={false}>
          {opts.keyMode === 'raw' ? (
            <motion.div
              key="raw"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="grid gap-4 lg:grid-cols-2"
            >
              <KeyField
                label="密钥"
                value={key}
                onChange={(v) => {
                  setKey(v)
                  setKeyTouched(true)
                }}
                encoding={opts.keyEncoding}
                onEncoding={(e) => set('keyEncoding', e)}
                onRandom={() => randomKey()}
                randomLabel={`随机生成 ${keySize} 字节密钥`}
                status={keyStatus}
                invalid={errorField === 'key' || keyStatus?.tone === 'bad'}
                placeholder={`${info.keySizes.join(' / ')} 字节`}
                extra={
                  KEY_SIZE_SHORT[opts.algo] && (
                    <Select
                      size="sm"
                      value={String(keySize)}
                      onChange={(v) => {
                        set('keySize', Number(v))
                        randomKey(Number(v))
                      }}
                      options={KEY_SIZE_SHORT[opts.algo]!}
                      aria-label="生成的密钥长度"
                      title="选择后随机生成该长度的密钥"
                    />
                  )
                }
              />
              {ivReq !== 'none' ? (
                <KeyField
                  label={ivReq === 'optional' ? 'IV（可选）' : 'IV'}
                  value={iv}
                  onChange={(v) => {
                    setIv(v)
                    setIvTouched(true)
                  }}
                  encoding={opts.ivEncoding}
                  onEncoding={(e) => set('ivEncoding', e)}
                  onRandom={randomIv}
                  randomLabel={`随机生成 ${info.ivSize} 字节 IV`}
                  status={ivStatus}
                  invalid={errorField === 'iv' || ivStatus?.tone === 'bad'}
                  placeholder={`${info.ivSize} 字节`}
                  hint={ivReq === 'optional' ? 'Rabbit 可以不带 IV' : '每次加密都应使用新的随机 IV'}
                />
              ) : (
                <div className="flex items-center rounded-2xl border border-dashed border-line-strong px-4 py-3 text-xs leading-relaxed text-fg-3 lg:mt-7">
                  {opts.algo === 'RC4'
                    ? 'RC4 是流密码，只需要密钥，没有 IV。'
                    : 'ECB 模式不使用 IV：每个分组独立加密。'}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="pass"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="grid gap-4 lg:grid-cols-2"
            >
              <KeyField
                label="口令"
                value={passphrase}
                onChange={setPassphrase}
                secret
                invalid={errorField === 'passphrase'}
                placeholder="输入口令（UTF-8）"
                hint="与 CryptoJS.AES.encrypt(text, '口令') 及 openssl enc -pass 兼容"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="密钥派生" hint={KDFS.find((k) => k.id === opts.kdf)?.note}>
                  <Select
                    value={opts.kdf}
                    onChange={(v) => set('kdf', v as KdfId)}
                    options={KDFS.map((k) => ({ value: k.id, label: k.label }))}
                    aria-label="密钥派生算法"
                    className="w-full"
                  />
                </Field>
                {opts.kdf === 'pbkdf2' ? (
                  <Field label="迭代次数" hint="OpenSSL 默认 10000">
                    <Input
                      type="number"
                      min={1}
                      max={5_000_000}
                      value={opts.iterations}
                      onChange={(e) => set('iterations', Math.floor(Number(e.target.value)) || 0)}
                      aria-invalid={errorField === 'iterations'}
                      aria-label="迭代次数"
                      mono
                    />
                  </Field>
                ) : (
                  KEY_SIZE_OPTIONS[opts.algo] && (
                    <Field label="派生密钥长度">
                      <Select
                        value={String(keySize)}
                        onChange={(v) => set('keySize', Number(v))}
                        options={KEY_SIZE_OPTIONS[opts.algo]!}
                        aria-label="派生密钥长度"
                        className="w-full"
                      />
                    </Field>
                  )
                )}
                {opts.kdf === 'pbkdf2' && KEY_SIZE_OPTIONS[opts.algo] && (
                  <Field label="派生密钥长度">
                    <Select
                      value={String(keySize)}
                      onChange={(v) => set('keySize', Number(v))}
                      options={KEY_SIZE_OPTIONS[opts.algo]!}
                      aria-label="派生密钥长度"
                      className="w-full"
                    />
                  </Field>
                )}
                {isEncrypt ? (
                  <KeyField
                    className="sm:col-span-2"
                    label="盐（Hex，可选）"
                    value={salt}
                    onChange={setSalt}
                    onRandom={() => setSalt(randomEncoded(8, 'hex'))}
                    randomLabel="随机生成 8 字节盐"
                    invalid={errorField === 'salt'}
                    placeholder="留空则每次随机生成（推荐）"
                    status={
                      salt
                        ? lengthStatus(
                            salt,
                            'hex',
                            (b) => (b.length === 8 ? null : '盐必须是 8 字节'),
                            (n) => `${n} 字节`,
                          )
                        : undefined
                    }
                  />
                ) : (
                  <p className="text-xs leading-relaxed text-fg-3 sm:col-span-2">
                    解密时从密文开头的「Salted__」头读取 8 字节盐。
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>

      <IOPanel
        input={input}
        onInputChange={setInput}
        output={outcome?.ok ? outcome.output : ''}
        inputTitle={isEncrypt ? '明文' : '密文'}
        outputTitle={isEncrypt ? '密文' : '明文'}
        inputPlaceholder={
          isEncrypt
            ? '输入要加密的内容…'
            : opts.keyMode === 'passphrase'
              ? '粘贴 OpenSSL / CryptoJS 口令密文（U2FsdGVkX1…）'
              : `粘贴 ${opts.cipherEncoding === 'hex' ? 'Hex' : 'Base64'} 密文…`
        }
        outputPlaceholder={isEncrypt ? '密文会显示在这里' : '明文会显示在这里'}
        inputActions={
          <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={loadSample}>
            示例
          </Button>
        }
        onSwap={swap}
        downloadName={isEncrypt ? 'ciphertext.txt' : 'plaintext.txt'}
        height="clamp(200px, 36vh, 380px)"
        outputFooter={
          <>
            <span>{(outcome?.ok ? outcome.output.length : 0).toLocaleString()} 字符</span>
            {slow ? (
              <span className="flex items-center gap-1">
                <LoaderCircle className="size-3 animate-spin" />
                计算中…
              </span>
            ) : (
              <span>{outcome?.ok ? `${outcome.outputBytes.toLocaleString()} 字节` : ''}</span>
            )}
          </>
        }
        toolbar={
          <>
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold text-fg-2">明文</span>
              {plainSeg}
            </span>
            <span className="flex items-center gap-2 sm:ml-2">
              <span className="text-xs font-semibold text-fg-2">密文</span>
              {cipherSeg}
            </span>
            <span className="ml-auto hidden text-xs text-fg-3 md:inline">
              所有运算都在浏览器本地完成
            </span>
          </>
        }
      />

      {/* 按出错的字段做 key：同一字段的提示随输入原地更新，不会每敲一个字就抖一下 */}
      <AnimatePresence mode="popLayout">
        {err && (
          <Notice key={err.field ?? 'general'} tone="error">
            <div className="flex flex-col gap-2">
              <span>{err.error}</span>
              {(err.suggestion || err.field === 'key' || err.field === 'iv') && (
                <div className="flex flex-wrap gap-2">
                  {err.suggestion && (
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Wand2 />}
                      onClick={() => patch(err.suggestion!.patch as Partial<Options>)}
                    >
                      {err.suggestion.label}
                    </Button>
                  )}
                  {err.field === 'key' && opts.keyMode === 'raw' && (
                    <Button size="sm" variant="danger" icon={<Dices />} onClick={() => randomKey()}>
                      随机生成 {keySize} 字节密钥
                    </Button>
                  )}
                  {err.field === 'iv' && (
                    <Button size="sm" variant="danger" icon={<Dices />} onClick={randomIv}>
                      随机生成 {info.ivSize} 字节 IV
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Notice>
        )}
      </AnimatePresence>

      {outcome?.ok && outcome.warnings.length > 0 && (
        <Notice tone="warning">
          <ul className="flex flex-col gap-1">
            {outcome.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {!stream &&
            opts.mode !== 'ECB' &&
            opts.mode !== 'CBC' &&
            opts.padding !== 'NoPadding' && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                icon={<Wand2 />}
                onClick={() => set('padding', 'NoPadding')}
              >
                改用 NoPadding
              </Button>
            )}
        </Notice>
      )}

      {outcome?.ok && command && (
        <UsedParams
          used={outcome.used}
          inputBytes={outcome.inputBytes}
          outputBytes={outcome.outputBytes}
          command={command}
          direction={done?.req.direction ?? opts.direction}
        />
      )}
    </div>
  )
}
