import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Clock, Dices, Eraser, TimerReset } from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EditorPane } from '@/components/editor/IOPanel'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Input,
  Notice,
  SegmentedControl,
  Switch,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { randomEncoded } from '@/lib/hash-bytes'
import {
  HMAC_ALGS,
  MIN_SECRET_BYTES,
  parseJson,
  patchClaims,
  signHmacJwt,
  type HmacAlg,
  type SignResult,
} from '@/lib/jwt-decoder'
import type { GeneratorState } from './generatorState'
import { ColoredToken } from './TokenEditor'

interface Props {
  state: GeneratorState
  onState: Dispatch<SetStateAction<GeneratorState>>
  secretBase64: boolean
  onSecretBase64: (v: boolean) => void
  /** 在「解码」页打开生成的令牌 */
  onOpen: (token: string, secret: string) => void
}

const QUICK_EXP: { label: string; seconds: number }[] = [
  { label: '15 分钟', seconds: 15 * 60 },
  { label: '1 小时', seconds: 3600 },
  { label: '1 天', seconds: 86400 },
  { label: '7 天', seconds: 7 * 86400 },
  { label: '30 天', seconds: 30 * 86400 },
]

/** 「生成」页：编辑 Header / Payload，用 HS256 / 384 / 512 签名 */
export function Generator({ state, onState, secretBase64, onSecretBase64, onOpen }: Props) {
  const { header, payload, secret } = state
  const setHeader = (v: string) => onState((s) => ({ ...s, header: v }))
  const setPayload = (v: string) => onState((s) => ({ ...s, payload: v }))
  const setSecret = (v: string) => onState((s) => ({ ...s, secret: v }))
  const [patchError, setPatchError] = useState<string | null>(null)

  const alg: HmacAlg = useMemo(() => {
    const r = parseJson(header)
    const a =
      r.ok && r.value && typeof r.value === 'object' ? (r.value as { alg?: unknown }).alg : null
    return HMAC_ALGS.includes(a as HmacAlg) ? (a as HmacAlg) : 'HS256'
  }, [header])

  const setAlg = (next: HmacAlg) => {
    const r = patchClaims(header, { alg: next })
    if (r.ok) setHeader(r.text)
    else setPatchError(`无法修改 Header：${r.error}`)
  }

  const patchPayload = (patch: Record<string, unknown>) => {
    const r = patchClaims(payload, patch)
    if (r.ok) {
      setPayload(r.text)
      setPatchError(null)
    } else setPatchError(r.error)
  }

  const input = useMemo(
    () => ({ header, payload, secret, secretBase64, alg }),
    [header, payload, secret, secretBase64, alg],
  )
  const dInput = useDebounced(input, 200)
  const [result, setResult] = useState<SignResult | null>(null)

  useEffect(() => {
    let alive = true
    signHmacJwt(dInput.header, dInput.payload, dInput.secret, dInput.secretBase64, dInput.alg).then(
      (r) => {
        if (alive) setResult(r)
      },
    )
    return () => {
      alive = false
    }
  }, [dInput])

  const nowSec = () => Math.floor(Date.now() / 1000)
  const token = result?.ok ? result.token : ''

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        <EditorPane
          title={
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-sys-pink" />
              Header
            </span>
          }
          height="auto"
        >
          <CodeEditor
            value={header}
            onChange={setHeader}
            lang="json"
            minHeight="96px"
            maxHeight="220px"
            height="auto"
            aria-label="Header JSON"
          />
        </EditorPane>
        <EditorPane
          title={
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-sys-purple" />
              Payload
            </span>
          }
          height="auto"
          footer={
            <div className="flex w-full flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                icon={<Clock />}
                onClick={() => patchPayload({ iat: nowSec() })}
              >
                iat = 现在
              </Button>
              <span className="ml-1 text-[11px] text-fg-3">exp =</span>
              {QUICK_EXP.map((q) => (
                <Button
                  key={q.label}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const now = nowSec()
                    patchPayload({ iat: now, exp: now + q.seconds })
                  }}
                  title={`iat 设为现在，exp 设为 ${q.label}后`}
                >
                  +{q.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                icon={<TimerReset />}
                onClick={() => patchPayload({ exp: nowSec() - 60 })}
                title="生成一个 1 分钟前就过期的令牌，便于测试"
              >
                已过期
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Eraser />}
                onClick={() => patchPayload({ exp: undefined, nbf: undefined })}
                title="删除 exp（以及 nbf），生成永不过期的令牌"
              >
                去掉 exp
              </Button>
            </div>
          }
        >
          <CodeEditor
            value={payload}
            onChange={setPayload}
            lang="json"
            minHeight="200px"
            maxHeight="420px"
            height="auto"
            aria-label="Payload JSON"
          />
        </EditorPane>
        <ErrorNotice error={patchError} />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-5">
          <Field label="签名算法" hint="会同步写入 Header 的 alg 字段">
            <SegmentedControl
              block
              aria-label="签名算法"
              value={alg}
              onChange={setAlg}
              options={HMAC_ALGS.map((a) => ({ value: a, label: a }))}
            />
          </Field>
          <Field
            label="密钥（Secret）"
            hint={`建议至少 ${MIN_SECRET_BYTES[alg]} 字节随机密钥`}
            action={
              <div className="flex items-center gap-1">
                <Switch
                  checked={secretBase64}
                  onChange={onSecretBase64}
                  label={<span className="text-xs text-fg-2">Base64 编码</span>}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon={<Dices />}
                  aria-label="随机生成密钥"
                  title={`随机生成 ${MIN_SECRET_BYTES[alg]} 字节密钥`}
                  onClick={() =>
                    setSecret(
                      randomEncoded(MIN_SECRET_BYTES[alg], secretBase64 ? 'base64' : 'utf8'),
                    )
                  }
                />
              </div>
            }
          >
            <Input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              mono
              aria-label="签名密钥"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight text-fg">生成的令牌</h3>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowRight />}
                disabled={!token}
                onClick={() => onOpen(token, secret)}
              >
                在解码器中查看
              </Button>
              <CopyButton text={token} disabled={!token} variant="primary" />
            </div>
          </div>
          {result && !result.ok ? (
            <ErrorNotice error={result.error} />
          ) : (
            <motion.pre
              key="token"
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 1 }}
              className="min-h-28 rounded-2xl bg-surface-2 p-4 font-mono text-[13px] leading-[1.7] whitespace-pre-wrap break-all"
            >
              {token ? <ColoredToken value={token} /> : <span className="text-fg-3">签名中…</span>}
            </motion.pre>
          )}
          {result?.ok && result.warnings.length > 0 && (
            <Notice tone="warning">{result.warnings.join('\n')}</Notice>
          )}
          <p className="text-xs text-fg-3">
            签名在浏览器本地用 Web Crypto 完成；Header 与 Payload 会被压缩为紧凑 JSON 后再做
            Base64URL 编码。
          </p>
        </section>
      </div>
    </div>
  )
}
