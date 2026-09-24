import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Dices, KeyRound, Sparkles, Trash2 } from 'lucide-react'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Input,
  Panel,
  SegmentedControl,
  Select,
  Switch,
  TextArea,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import { formatDigest, matchDigest, type DigestFormat } from '@/lib/hash'
import { randomEncoded, type ByteEncoding } from '@/lib/hash-bytes'
import {
  ALL_HMAC_IDS,
  HMAC_ALGOS,
  decodeField,
  hmacAlgo,
  hmacAll,
  type HmacAlgoId,
  type HmacDigests,
} from '@/lib/hmac'
import { SNIPPET_LANGS, type SnippetLang } from '@/lib/hmac-snippets'
import { DigestList } from '../hash/DigestList'
import { VerifyField } from '../hash/VerifyField'
import { SnippetCard } from './SnippetCard'

interface Options {
  keyEncoding: ByteEncoding
  msgEncoding: ByteEncoding
  format: DigestFormat
  upper: boolean
  view: 'all' | 'single'
  algo: HmacAlgoId
  lang: SnippetLang
}

const DEFAULTS: Options = {
  keyEncoding: 'utf8',
  msgEncoding: 'utf8',
  format: 'hex',
  upper: false,
  view: 'all',
  algo: 'sha256',
  lang: 'node',
}

const SAMPLE_KEY = 'whsec_showMe_2026'
const SAMPLE_MESSAGE =
  '1767225600.{"event":"order.paid","data":{"id":"ord_1024","amount":9900,"currency":"CNY","buyer":"张三"}}'

const ENCODING_OPTIONS = [
  { value: 'utf8', label: 'UTF-8' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
] as const

const oneOf = <T,>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback
const BYTE_ENCODINGS = ['utf8', 'hex', 'base64'] as const

/** localStorage 里的旧值或被改坏的值回落到默认值，避免渲染时出错 */
function sanitize(stored: unknown): Options {
  const o = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) } as Options
  return {
    keyEncoding: oneOf(o.keyEncoding, BYTE_ENCODINGS, DEFAULTS.keyEncoding),
    msgEncoding: oneOf(o.msgEncoding, BYTE_ENCODINGS, DEFAULTS.msgEncoding),
    format: oneOf(o.format, ['hex', 'base64'] as const, DEFAULTS.format),
    upper: o.upper === true,
    view: oneOf(o.view, ['all', 'single'] as const, DEFAULTS.view),
    algo: oneOf(o.algo, ALL_HMAC_IDS, DEFAULTS.algo),
    lang: oneOf(
      o.lang,
      SNIPPET_LANGS.map((l) => l.id),
      DEFAULTS.lang,
    ),
  }
}

export default function HmacTool() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('hmac.options.v1', DEFAULTS)
  const opts = sanitize(stored)

  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setStored((prev) => ({ ...DEFAULTS, ...prev, [key]: value }))

  const [key, setKey] = useState(SAMPLE_KEY)
  const [message, setMessage] = useState(SAMPLE_MESSAGE)
  const [expected, setExpected] = useState('')

  const dKey = useDebounced(key, 120)
  const dMsg = useDebounced(message, 120)

  type Decoded =
    { key: Uint8Array; message: Uint8Array } | { error: string; field: 'key' | 'message' }
  const decoded = useMemo<Decoded>(() => {
    const k = decodeField(dKey, opts.keyEncoding, '密钥')
    const m = decodeField(dMsg, opts.msgEncoding, '消息')
    if ('error' in k) return { error: k.error, field: 'key' as const }
    if ('error' in m) return { error: m.error, field: 'message' as const }
    return { key: k.bytes, message: m.bytes }
  }, [dKey, dMsg, opts.keyEncoding, opts.msgEncoding])

  const [result, setResult] = useState<{ source: string; digests: HmacDigests } | null>(null)
  const sourceOf = (k: string, m: string) =>
    JSON.stringify([k, m, opts.keyEncoding, opts.msgEncoding])
  const dSource = sourceOf(dKey, dMsg)
  useEffect(() => {
    if ('error' in decoded) return
    let alive = true
    hmacAll(decoded.key, decoded.message)
      .then((digests) => {
        if (alive) setResult({ source: dSource, digests })
      })
      .catch(() => {
        // WebAssembly 不可用时保留上一次结果
      })
    return () => {
      alive = false
    }
  }, [decoded, dSource])

  const error = 'error' in decoded ? decoded.error : null
  const errorField = 'error' in decoded ? decoded.field : null
  const digests = error ? null : (result?.digests ?? null)
  // 输入已变而新结果还没出来：旧结果变淡
  const stale = !!digests && result?.source !== sourceOf(key, message)

  const shown = useMemo(() => {
    const out: HmacDigests = {}
    const ids = opts.view === 'all' ? ALL_HMAC_IDS : [opts.algo]
    if (digests) for (const id of ids) if (digests[id]) out[id] = digests[id]
    return out
  }, [digests, opts.view, opts.algo])

  const match = useMemo(() => matchDigest(expected, shown), [expected, shown])
  const matched = useMemo(() => new Set<string>(match.status === 'match' ? match.ids : []), [match])

  const fmt = (id: HmacAlgoId) => {
    const d = digests?.[id]
    return d ? formatDigest(d, opts.format, opts.upper) : null
  }

  const keyBytes = 'key' in decoded ? decoded.key.length : null
  // 密钥超过算法的块大小时，HMAC 会先把密钥哈希一次
  const hashedFor =
    keyBytes === null
      ? []
      : (opts.view === 'single' ? [hmacAlgo(opts.algo)] : HMAC_ALGOS).filter(
          (a) => keyBytes > a.blockSize,
        )
  const keyHint =
    keyBytes === null
      ? '—'
      : keyBytes === 0
        ? '空密钥（合法，但不安全）'
        : `${keyBytes} 字节${
            !hashedFor.length
              ? ''
              : opts.view === 'single'
                ? ` · 超过 ${hashedFor[0].blockSize} 字节块大小，会先对密钥做一次哈希`
                : hashedFor.length === HMAC_ALGOS.length
                  ? ' · 超过所有算法的块大小，会先对密钥做一次哈希'
                  : ` · 超过 ${hashedFor.map((a) => a.label.replace('HMAC-', '')).join(' / ')} 的块大小（${[...new Set(hashedFor.map((a) => a.blockSize))].join(' / ')} 字节），这些算法会先对密钥做一次哈希`
          }`
  const msgBytes = 'message' in decoded ? decoded.message.length : null

  const snippetInput = useMemo(
    () => ({
      algo: opts.algo,
      key,
      keyEncoding: opts.keyEncoding,
      message,
      messageEncoding: opts.msgEncoding,
      format: opts.format,
      upper: opts.upper,
    }),
    [opts.algo, key, opts.keyEncoding, message, opts.msgEncoding, opts.format, opts.upper],
  )

  const single = fmt(opts.algo)
  const singleHit = matched.has(opts.algo)

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-4">
        <Field
          label="密钥"
          action={
            <div className="flex items-center gap-1">
              <SegmentedControl
                size="sm"
                aria-label="密钥编码"
                value={opts.keyEncoding}
                onChange={(v) => set('keyEncoding', v)}
                options={ENCODING_OPTIONS}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Dices />}
                title="随机生成 32 字节密钥"
                aria-label="随机生成密钥"
                onClick={() => setKey(randomEncoded(32, opts.keyEncoding))}
              />
            </div>
          }
          hint={keyHint}
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-3" />
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              mono
              placeholder={
                opts.keyEncoding === 'utf8'
                  ? '输入密钥'
                  : opts.keyEncoding === 'hex'
                    ? '如 0a1b2c…'
                    : '如 c2VjcmV0'
              }
              aria-label="密钥"
              aria-invalid={errorField === 'key'}
              className={cn('pl-10', errorField === 'key' && 'border-danger/60!')}
            />
          </div>
        </Field>

        <Field
          label="消息"
          action={
            <div className="flex items-center gap-1">
              <SegmentedControl
                size="sm"
                aria-label="消息编码"
                value={opts.msgEncoding}
                onChange={(v) => set('msgEncoding', v)}
                options={ENCODING_OPTIONS}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Sparkles />}
                title="示例（Webhook 签名：时间戳.请求体）"
                aria-label="填入示例"
                onClick={() => {
                  setKey(SAMPLE_KEY)
                  setMessage(SAMPLE_MESSAGE)
                  set('keyEncoding', 'utf8')
                  set('msgEncoding', 'utf8')
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Trash2 />}
                title="清空消息"
                aria-label="清空消息"
                disabled={!message}
                onClick={() => setMessage('')}
              />
            </div>
          }
          hint={msgBytes === null ? '—' : `${msgBytes.toLocaleString()} 字节`}
        >
          <TextArea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            mono
            placeholder="输入要签名的消息，结果实时更新"
            aria-label="消息"
            aria-invalid={errorField === 'message'}
            className={cn('min-h-28', errorField === 'message' && 'border-danger/60!')}
          />
        </Field>
      </Panel>

      <ErrorNotice error={error} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card sm:px-5">
        <SegmentedControl
          size="sm"
          aria-label="显示方式"
          value={opts.view}
          onChange={(v) => set('view', v)}
          options={[
            { value: 'all', label: '全部算法' },
            { value: 'single', label: '单个算法' },
          ]}
        />
        <AnimatePresence initial={false}>
          {opts.view === 'single' && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="overflow-hidden"
            >
              <Select
                size="sm"
                value={opts.algo}
                onChange={(v) => set('algo', v as HmacAlgoId)}
                options={HMAC_ALGOS.map((a) => ({ value: a.id, label: a.label }))}
                aria-label="算法"
              />
            </motion.div>
          )}
        </AnimatePresence>
        <SegmentedControl
          size="sm"
          aria-label="输出格式"
          value={opts.format}
          onChange={(v) => set('format', v)}
          options={[
            { value: 'hex', label: 'Hex' },
            { value: 'base64', label: 'Base64' },
          ]}
        />
        <Switch
          checked={opts.upper}
          onChange={(v) => set('upper', v)}
          label="大写"
          disabled={opts.format !== 'hex'}
        />
        {opts.view === 'all' && (
          <CopyButton
            className="ml-auto"
            label="复制全部"
            disabled={!digests}
            text={() =>
              ALL_HMAC_IDS.map((id) => `${hmacAlgo(id).label}: ${fmt(id) ?? ''}`).join('\n')
            }
          />
        )}
      </div>

      <VerifyField
        value={expected}
        onChange={setExpected}
        result={match}
        labelOf={(id) => hmacAlgo(id).label}
        idle={!digests}
        placeholder="粘贴收到的签名，自动比对"
        emptyHint="Hex / Base64 均可，不区分大小写；也支持 Webhook 常见的 sha256=… 前缀"
      />

      <AnimatePresence mode="wait" initial={false}>
        {opts.view === 'all' ? (
          <motion.div
            key="all"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <DigestList
              items={HMAC_ALGOS.map((a) => ({
                id: a.id,
                label: a.label,
                bits: a.bits,
                note: a.note,
                value: fmt(a.id),
              }))}
              matched={matched}
              pending={!digests && !error}
              stale={stale}
            />
          </motion.div>
        ) : (
          <motion.section
            key="single"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn(
              'relative overflow-hidden rounded-3xl border bg-surface p-5 shadow-card transition-colors duration-300 sm:p-6',
              singleHit ? 'border-success/50' : 'border-line',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div
                  className={cn('text-sm font-semibold', singleHit ? 'text-success' : 'text-fg')}
                >
                  {hmacAlgo(opts.algo).label}
                </div>
                <div className="text-xs text-fg-3">
                  {hmacAlgo(opts.algo).bits} 位 · {hmacAlgo(opts.algo).note}
                </div>
              </div>
              <CopyButton text={single ?? ''} disabled={!single} variant="primary" />
            </div>
            <motion.div
              key={single ?? ''}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className={cn(
                'mt-4 font-mono text-[15px] leading-relaxed break-all select-all sm:text-lg',
                single ? (singleHit ? 'text-success' : 'text-fg') : 'text-fg-3',
                stale && 'opacity-50',
              )}
            >
              {single ?? '—'}
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>

      <SnippetCard
        input={snippetInput}
        lang={opts.lang}
        onLang={(l) => set('lang', l)}
        onAlgo={(a) => set('algo', a)}
      />
    </div>
  )
}
