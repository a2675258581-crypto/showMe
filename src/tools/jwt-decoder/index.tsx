import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ClipboardPaste, Sparkles, Trash2 } from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EditorPane } from '@/components/editor/IOPanel'
import { Button, CopyButton, ErrorNotice, Notice, Tabs } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { readClipboard } from '@/lib/clipboard'
import { bytesToHex } from '@/lib/hash-bytes'
import {
  algFamily,
  decodeJwt,
  makeHs256Sample,
  verifyJwt,
  type VerifyOutcome,
} from '@/lib/jwt-decoder'
import { DEMO_SECRET, ES256_SAMPLE, RS256_SAMPLE } from '@/lib/jwt-decoder-samples'
import { ClaimsTable } from './ClaimsTable'
import { Generator } from './Generator'
import { initialGeneratorState } from './generatorState'
import { TimeStatus } from './TimeStatus'
import { TokenEditor } from './TokenEditor'
import { VerifyPanel } from './VerifyPanel'

type Tab = 'decode' | 'encode'

interface Options {
  tab: Tab
  secretBase64: boolean
}

const DEFAULTS: Options = { tab: 'decode', secretBase64: false }

const nowSec = () => Math.floor(Date.now() / 1000)

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] font-medium text-fg-3">
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-sys-pink" />
        Header
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-sys-purple" />
        Payload
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-sys-blue" />
        Signature
      </span>
    </div>
  )
}

export default function JwtDecoder() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('jwt-decoder.options.v1', DEFAULTS)
  const opts: Options = {
    tab: stored?.tab === 'encode' ? 'encode' : 'decode',
    secretBase64: stored?.secretBase64 === true,
  }
  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setStored((prev) => ({ ...DEFAULTS, ...prev, [key]: value }))

  const [token, setToken] = useState(() => makeHs256Sample(nowSec(), DEMO_SECRET))
  const [secret, setSecret] = useState(DEMO_SECRET)
  const [publicKey, setPublicKey] = useState('')
  const [generator, setGenerator] = useState(initialGeneratorState)

  const decoded = useMemo(() => decodeJwt(token), [token])
  const jwt = decoded?.ok ? decoded.jwt : null

  // ───── 验签（异步，防抖） ─────
  const verifyInput = useMemo(
    () => ({ token, secret, secretBase64: opts.secretBase64, publicKey }),
    [token, secret, opts.secretBase64, publicKey],
  )
  const dVerify = useDebounced(verifyInput, 250)
  const [verify, setVerify] = useState<{ input: typeof dVerify; result: VerifyOutcome } | null>(
    null,
  )
  useEffect(() => {
    if (!decodeJwt(dVerify.token)?.ok) return
    let alive = true
    verifyJwt(dVerify.token, {
      secret: dVerify.secret,
      secretBase64: dVerify.secretBase64,
      publicKey: dVerify.publicKey,
    }).then((result) => {
      if (alive) setVerify({ input: dVerify, result })
    })
    return () => {
      alive = false
    }
  }, [dVerify])
  // 令牌或密钥变了而新结果还没出来时，不显示旧的结论（避免改了密钥仍短暂显示「签名有效」）
  const fresh =
    !!verify &&
    verify.input.token === token &&
    verify.input.secret === secret &&
    verify.input.secretBase64 === opts.secretBase64 &&
    verify.input.publicKey === publicKey
  const verifyResult = fresh ? verify.result : null
  const verifyPending = !!jwt && !verifyResult

  const loadSample = (kind: 'HS256' | 'RS256' | 'ES256') => {
    if (kind === 'HS256') {
      setToken(makeHs256Sample(nowSec(), DEMO_SECRET))
      setSecret(DEMO_SECRET)
      set('secretBase64', false)
    } else if (kind === 'RS256') {
      setToken(RS256_SAMPLE.token)
      setPublicKey(RS256_SAMPLE.publicKey)
    } else {
      setToken(ES256_SAMPLE.token)
      setPublicKey(ES256_SAMPLE.publicKey)
    }
  }

  const family = jwt ? algFamily(jwt.alg) : null

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        items={[
          { value: 'decode', label: '解码与验证' },
          { value: 'encode', label: '生成令牌' },
        ]}
        value={opts.tab}
        onChange={(v) => set('tab', v)}
      />

      <AnimatePresence mode="wait" initial={false}>
        {opts.tab === 'decode' ? (
          <motion.div
            key="decode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-4"
          >
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {/* 左栏：令牌、有效期、验签 */}
              <div className="flex min-w-0 flex-col gap-4">
                <section className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="text-[15px] font-semibold tracking-tight text-fg">令牌</h3>
                      <Legend />
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Sparkles className="mr-0.5 size-3.5 text-fg-3" aria-hidden />
                      {(['HS256', 'RS256', 'ES256'] as const).map((k) => (
                        <Button
                          key={k}
                          size="sm"
                          variant="ghost"
                          className="px-2"
                          title={`载入 ${k} 示例令牌`}
                          onClick={() => loadSample(k)}
                        >
                          {k}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<ClipboardPaste />}
                        aria-label="粘贴令牌"
                        title="粘贴"
                        onClick={async () => {
                          const t = await readClipboard()
                          if (t !== null) setToken(t.trim())
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<Trash2 />}
                        aria-label="清空令牌"
                        title="清空"
                        disabled={!token}
                        onClick={() => setToken('')}
                      />
                    </div>
                  </div>
                  <TokenEditor
                    value={token}
                    onChange={setToken}
                    errorPos={decoded && !decoded.ok ? decoded.position : undefined}
                    placeholder="粘贴 JWT（eyJ…），也可以带 Bearer 前缀"
                    aria-label="JWT 令牌"
                  />
                  <div className="flex flex-wrap justify-between gap-2 text-[11px] text-fg-3 tabular-nums">
                    <span>
                      {token.length.toLocaleString()} 字符
                      {jwt?.strippedBearer && ' · 已忽略 Bearer 前缀'}
                    </span>
                    {jwt && (
                      <span title={bytesToHex(jwt.signature)}>
                        签名 {jwt.signature.length} 字节
                      </span>
                    )}
                  </div>
                  <ErrorNotice error={decoded && !decoded.ok ? decoded.error : null} />
                  {jwt && jwt.warnings.length > 0 && (
                    <Notice tone="warning">{jwt.warnings.join('\n')}</Notice>
                  )}
                </section>

                {jwt && <TimeStatus payload={jwt.payload} />}

                {jwt && family !== 'unknown' && (
                  <VerifyPanel
                    alg={jwt.alg}
                    secret={secret}
                    onSecret={setSecret}
                    secretBase64={opts.secretBase64}
                    onSecretBase64={(v) => set('secretBase64', v)}
                    publicKey={publicKey}
                    onPublicKey={setPublicKey}
                    result={verifyResult}
                    pending={verifyPending}
                  />
                )}
              </div>

              {/* 右栏：解码结果 */}
              <div className="flex min-w-0 flex-col gap-4">
                <EditorPane
                  title={
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-sys-pink" />
                      Header
                      <span className="font-normal text-fg-3">算法与令牌类型</span>
                    </span>
                  }
                  height="auto"
                  actions={
                    <CopyButton
                      text={jwt?.headerJson ?? ''}
                      disabled={!jwt}
                      iconOnly
                      variant="ghost"
                      label="复制 Header"
                    />
                  }
                >
                  <CodeEditor
                    value={jwt?.headerJson ?? ''}
                    lang="json"
                    readOnly
                    height="auto"
                    minHeight="72px"
                    maxHeight="240px"
                    placeholder="解码后的 Header"
                    aria-label="Header"
                  />
                </EditorPane>
                <EditorPane
                  title={
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-sys-purple" />
                      Payload
                      <span className="font-normal text-fg-3">数据与声明</span>
                    </span>
                  }
                  height="auto"
                  actions={
                    <CopyButton
                      text={jwt?.payloadJson ?? ''}
                      disabled={!jwt}
                      iconOnly
                      variant="ghost"
                      label="复制 Payload"
                    />
                  }
                >
                  <CodeEditor
                    value={jwt?.payloadJson ?? ''}
                    lang="json"
                    readOnly
                    height="auto"
                    minHeight="160px"
                    maxHeight="460px"
                    placeholder="解码后的 Payload"
                    aria-label="Payload"
                  />
                </EditorPane>
              </div>
            </div>

            {jwt && <ClaimsTable payload={jwt.payload} />}
          </motion.div>
        ) : (
          <motion.div
            key="encode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <Generator
              state={generator}
              onState={setGenerator}
              secretBase64={opts.secretBase64}
              onSecretBase64={(v) => set('secretBase64', v)}
              onOpen={(t, s) => {
                setToken(t)
                setSecret(s)
                set('tab', 'decode')
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
