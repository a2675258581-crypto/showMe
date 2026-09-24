import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Terminal,
  XCircle,
} from 'lucide-react'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Notice,
  Panel,
  SegmentedControl,
  Tabs,
  TextArea,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'
import {
  decodeBinary,
  encodeBinary,
  maxOaepPlaintext,
  opensslCommand,
  rsaOaepDecrypt,
  rsaOaepEncrypt,
  rsaSign,
  rsaVerify,
  type BinaryEncoding,
  type KeyPurpose,
  type RsaHash,
  type SignScheme,
} from '@/lib/rsa'

export interface KeyRef {
  der: Uint8Array
  bits: number
  /** 用于判断密钥是否变化（模数 + 指数） */
  id: string
}

type Tab = 'encrypt' | 'decrypt' | 'sign' | 'verify'

const SAMPLE_PLAIN = '你好，showMe！这是一段用 RSA-OAEP 加密的机密消息 🔐'
const SAMPLE_MESSAGE = '{"order":"20260924-001","amount":199.00,"currency":"CNY"}'

const utf8 = new TextEncoder()

interface JobState<T> {
  key: string
  value?: T
  error?: string
}

/** 以 key 标识的异步任务：key 变化就重新执行，只接收最新一次的结果 */
function useAsyncJob<T>(key: string | null, run: () => Promise<T>) {
  const [state, setState] = useState<JobState<T> | null>(null)
  const exec = useEffectEvent(run)
  useEffect(() => {
    if (key === null) return
    let alive = true
    exec().then(
      (value) => alive && setState({ key, value }),
      (e: unknown) => alive && setState({ key, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      alive = false
    }
  }, [key])
  const fresh = state !== null && state.key === key
  return { state: key === null ? null : state, fresh, pending: key !== null && !fresh }
}

function tryDecode(text: string, enc: BinaryEncoding, what: string) {
  if (!text.trim()) return { bytes: null, error: null }
  try {
    return { bytes: decodeBinary(text, enc, what), error: null }
  } catch (e) {
    return { bytes: null, error: e instanceof Error ? e.message : String(e) }
  }
}

function describeBytes(b: Uint8Array): { text: string; binary: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), binary: false }
  } catch {
    return { text: encodeBinary(b, 'hex'), binary: true }
  }
}

function ResultBox({
  label,
  value,
  placeholder,
  pending,
  action,
}: {
  label: string
  value: string
  placeholder: string
  pending?: boolean
  action?: ReactNode
}) {
  return (
    <Field
      label={
        <span className="inline-flex items-center gap-1.5">
          {label}
          {pending && <LoaderCircle className="size-3.5 animate-spin text-fg-3" />}
        </span>
      }
      action={
        <span className="flex items-center gap-1">
          {action}
          <CopyButton text={value} disabled={!value} />
        </span>
      }
    >
      <TextArea
        readOnly
        mono
        value={value}
        placeholder={placeholder}
        aria-label={label}
        className={cn('min-h-40 bg-surface-2 transition-opacity', pending && 'opacity-60')}
      />
    </Field>
  )
}

export function Operations({
  purpose,
  pub,
  priv,
  oaepHash,
  signScheme,
  signHash,
  enc,
  onEnc,
}: {
  purpose: KeyPurpose
  pub: KeyRef | null
  priv: KeyRef | null
  oaepHash: RsaHash
  signScheme: SignScheme
  signHash: RsaHash
  enc: BinaryEncoding
  onEnc: (e: BinaryEncoding) => void
}) {
  const [tabState, setTab] = useState<Tab>('encrypt')
  const tabs: Tab[] = purpose === 'encrypt' ? ['encrypt', 'decrypt'] : ['sign', 'verify']
  const tab = tabs.includes(tabState) ? tabState : tabs[0]

  const [plain, setPlain] = useState(SAMPLE_PLAIN)
  const [cipherIn, setCipherIn] = useState('')
  const [message, setMessage] = useState(SAMPLE_MESSAGE)
  const [verifyMsg, setVerifyMsg] = useState(SAMPLE_MESSAGE)
  const [sigIn, setSigIn] = useState('')
  const [nonce, setNonce] = useState(0)
  const [showCmd, setShowCmd] = useState(false)

  const dPlain = useDebounced(plain, 200)
  const dCipher = useDebounced(cipherIn, 200)
  const dMessage = useDebounced(message, 200)
  const dVerifyMsg = useDebounced(verifyMsg, 200)
  const dSig = useDebounced(sigIn, 200)

  const plainBytes = utf8.encode(plain).length
  const maxPlain = pub ? maxOaepPlaintext(pub.bits, oaepHash) : 0

  // ───── 加密 ─────
  const encKey = tab === 'encrypt' && pub ? `${pub.id}|${oaepHash}|${nonce}|${dPlain}` : null
  const encJob = useAsyncJob(encKey, () => rsaOaepEncrypt(pub!.der, utf8.encode(dPlain), oaepHash))
  const cipherOut = encJob.state?.value ? encodeBinary(encJob.state.value, enc) : ''

  // ───── 解密 ─────
  const cipherDecoded = useMemo(() => tryDecode(dCipher, enc, '密文'), [dCipher, enc])
  const decKey =
    tab === 'decrypt' && priv && cipherDecoded.bytes
      ? `${priv.id}|${oaepHash}|${enc}|${dCipher}`
      : null
  const decJob = useAsyncJob(decKey, () =>
    rsaOaepDecrypt(priv!.der, cipherDecoded.bytes!, oaepHash),
  )
  const decoded = decJob.state?.value ? describeBytes(decJob.state.value) : null

  // ───── 签名 ─────
  const signKey =
    tab === 'sign' && priv ? `${priv.id}|${signScheme}|${signHash}|${nonce}|${dMessage}` : null
  const signJob = useAsyncJob(signKey, () =>
    rsaSign(priv!.der, utf8.encode(dMessage), signScheme, signHash),
  )
  const sigOut = signJob.state?.value ? encodeBinary(signJob.state.value, enc) : ''

  // ───── 验签 ─────
  const sigDecoded = useMemo(() => tryDecode(dSig, enc, '签名'), [dSig, enc])
  const verifyKey =
    tab === 'verify' && pub && sigDecoded.bytes
      ? `${pub.id}|${signScheme}|${signHash}|${enc}|${dSig}|${dVerifyMsg}`
      : null
  const verifyJob = useAsyncJob(verifyKey, () =>
    rsaVerify(pub!.der, utf8.encode(dVerifyMsg), sigDecoded.bytes!, signScheme, signHash),
  )

  /** 切换编码时把已输入的密文 / 签名一并转换 */
  const changeEnc = (next: BinaryEncoding) => {
    const convert = (t: string) => {
      if (!t.trim()) return t
      try {
        return encodeBinary(decodeBinary(t, enc), next)
      } catch {
        return t
      }
    }
    setCipherIn(convert(cipherIn))
    setSigIn(convert(sigIn))
    onEnc(next)
  }

  const needPub = (tab === 'encrypt' || tab === 'verify') && !pub
  const needPriv = (tab === 'decrypt' || tab === 'sign') && !priv
  const cmd = opensslCommand(tab, {
    bits: pub?.bits ?? priv?.bits ?? 2048,
    hash: purpose === 'encrypt' ? oaepHash : signHash,
    scheme: signScheme,
  })

  const labels: Record<Tab, string> = {
    encrypt: '公钥加密',
    decrypt: '私钥解密',
    sign: '私钥签名',
    verify: '公钥验签',
  }
  const encLabel = enc === 'hex' ? 'Hex' : 'Base64'

  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3 sm:px-6">
        <Tabs<Tab>
          className="-mb-px border-b-0"
          items={tabs.map((t) => ({ value: t, label: labels[t] }))}
          value={tab}
          onChange={setTab}
        />
        <SegmentedControl<BinaryEncoding>
          size="sm"
          aria-label="密文与签名编码"
          value={enc}
          onChange={changeEnc}
          options={[
            { value: 'base64', label: 'Base64' },
            { value: 'hex', label: 'Hex' },
          ]}
        />
      </div>
      <div className="border-t border-line p-5 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-4"
          >
            {needPub && <Notice tone="info">请先在上方生成或粘贴公钥</Notice>}
            {needPriv && <Notice tone="info">请先在上方生成或粘贴私钥</Notice>}

            {tab === 'encrypt' && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field
                    label="明文（UTF-8）"
                    action={
                      pub && (
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            plainBytes > maxPlain ? 'font-semibold text-danger' : 'text-fg-3',
                          )}
                        >
                          {plainBytes} / {maxPlain} 字节
                        </span>
                      )
                    }
                  >
                    <TextArea
                      mono
                      value={plain}
                      onChange={(e) => setPlain(e.target.value)}
                      placeholder="输入要加密的文本"
                      aria-label="明文"
                      className="min-h-40"
                    />
                    {pub && (
                      <div className="h-1 overflow-hidden rounded-full bg-fill">
                        <motion.div
                          className={cn(
                            'h-full rounded-full',
                            plainBytes > maxPlain ? 'bg-danger' : 'bg-accent',
                          )}
                          animate={{
                            width: `${Math.min(100, maxPlain ? (plainBytes / maxPlain) * 100 : 100)}%`,
                          }}
                          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                        />
                      </div>
                    )}
                  </Field>
                  <ResultBox
                    label={`密文（${encLabel}）`}
                    value={encJob.state?.error ? '' : cipherOut}
                    placeholder="加密结果会显示在这里"
                    pending={encJob.pending}
                    action={
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<RefreshCw />}
                        title="重新加密（OAEP 每次结果都不同）"
                        aria-label="重新加密"
                        disabled={!pub}
                        onClick={() => setNonce((n) => n + 1)}
                      />
                    }
                  />
                </div>
                <ErrorNotice error={encJob.fresh ? encJob.state?.error : null} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!cipherOut || !encJob.fresh}
                    onClick={() => {
                      setCipherIn(cipherOut)
                      setTab('decrypt')
                    }}
                  >
                    用私钥解密这段密文
                    <ArrowRight />
                  </Button>
                  <span className="text-xs text-fg-3">
                    OAEP 带随机填充，同一明文每次加密的结果都不同，这是正常的
                  </span>
                </div>
              </>
            )}

            {tab === 'decrypt' && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label={`密文（${encLabel}）`}>
                    <TextArea
                      mono
                      value={cipherIn}
                      onChange={(e) => setCipherIn(e.target.value)}
                      placeholder={`粘贴 ${encLabel} 编码的密文`}
                      aria-label="密文"
                      className="min-h-40"
                    />
                  </Field>
                  <ResultBox
                    label={decoded?.binary ? '明文（非 UTF-8，以 Hex 显示）' : '明文'}
                    value={decJob.fresh && !decJob.state?.error ? (decoded?.text ?? '') : ''}
                    placeholder="解密结果会显示在这里"
                    pending={decJob.pending}
                  />
                </div>
                <ErrorNotice
                  error={cipherDecoded.error ?? (decJob.fresh ? decJob.state?.error : null)}
                />
              </>
            )}

            {tab === 'sign' && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="消息（UTF-8）">
                    <TextArea
                      mono
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="输入要签名的消息"
                      aria-label="消息"
                      className="min-h-40"
                    />
                  </Field>
                  <ResultBox
                    label={`签名（${encLabel}）`}
                    value={signJob.state?.error ? '' : sigOut}
                    placeholder="签名会显示在这里"
                    pending={signJob.pending}
                  />
                </div>
                <ErrorNotice error={signJob.fresh ? signJob.state?.error : null} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!sigOut || !signJob.fresh}
                    onClick={() => {
                      setVerifyMsg(message)
                      setSigIn(sigOut)
                      setTab('verify')
                    }}
                  >
                    用公钥验证这个签名
                    <ArrowRight />
                  </Button>
                  <span className="text-xs text-fg-3">
                    {signScheme === 'RSA-PSS'
                      ? `RSA-PSS 盐长 = 哈希长度，每次签名结果都不同`
                      : 'PKCS#1 v1.5 签名是确定性的：同一私钥和消息总得到相同签名'}
                  </span>
                </div>
              </>
            )}

            {tab === 'verify' && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="消息（UTF-8）">
                    <TextArea
                      mono
                      value={verifyMsg}
                      onChange={(e) => setVerifyMsg(e.target.value)}
                      placeholder="输入被签名的原始消息"
                      aria-label="待验证的消息"
                      className="min-h-40"
                    />
                  </Field>
                  <Field label={`签名（${encLabel}）`}>
                    <TextArea
                      mono
                      value={sigIn}
                      onChange={(e) => setSigIn(e.target.value)}
                      placeholder={`粘贴 ${encLabel} 编码的签名`}
                      aria-label="签名"
                      className="min-h-40"
                    />
                  </Field>
                </div>
                <AnimatePresence mode="wait">
                  {verifyJob.fresh && verifyJob.state?.value !== undefined && (
                    <motion.div
                      key={String(verifyJob.state.value)}
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                      role="status"
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border px-4 py-3',
                        verifyJob.state.value
                          ? 'border-success/25 bg-success/8 text-success'
                          : 'border-danger/25 bg-danger/8 text-danger',
                      )}
                    >
                      {verifyJob.state.value ? (
                        <BadgeCheck className="size-6" />
                      ) : (
                        <XCircle className="size-6" />
                      )}
                      <div>
                        <div className="text-[15px] font-semibold">
                          {verifyJob.state.value ? '签名有效' : '签名无效'}
                        </div>
                        <div className="text-xs opacity-80">
                          {verifyJob.state.value
                            ? '消息未被篡改，且确实由对应私钥签名'
                            : '消息被改动、公钥不匹配，或签名方案 / 哈希算法与签名时不一致'}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <ErrorNotice
                  error={sigDecoded.error ?? (verifyJob.fresh ? verifyJob.state?.error : null)}
                />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-5 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => setShowCmd((v) => !v)}
            aria-expanded={showCmd}
            className="flex items-center gap-2 text-[13px] font-medium text-fg-2 hover:text-fg"
          >
            <Terminal className="size-4" />
            OpenSSL 等价命令
            <motion.span animate={{ rotate: showCmd ? 180 : 0 }} className="inline-flex">
              <ChevronDown className="size-4" />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {showCmd && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex items-start gap-2 rounded-2xl bg-surface-2 p-3">
                  <pre className="thin-scrollbar min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre text-fg">
                    {cmd}
                  </pre>
                  <CopyButton text={cmd} iconOnly variant="ghost" label="复制命令" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Panel>
  )
}
