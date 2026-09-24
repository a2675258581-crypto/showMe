import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownToLine,
  CircleAlert,
  CircleSlash,
  Clock,
  Cookie,
  Download,
  ImageOff,
  LoaderCircle,
  RotateCw,
  Send,
  Timer,
} from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import type { EditorLang } from '@/components/editor/languages'
import { Badge, Button, CopyButton, Kbd, Notice, Tabs } from '@/components/ui'
import { modKey } from '@/hooks/useHotkey'
import {
  STATUS_COLORS,
  decodeText,
  detectBodyKind,
  formatDuration,
  getHeader,
  hexDump,
  previewDocument,
  prettyJson,
  prettyXml,
  reasonPhrase,
  responseCookies,
  statusMeaning,
  statusTone,
  suggestFileName,
  truncateText,
  type BodyKind,
} from '@/lib/api-client-response'
import type { SampleRequest } from '@/lib/api-client-store'
import { cn } from '@/lib/cn'
import { downloadBlob, formatBytes } from '@/lib/file'
import { TONE_TEXT, toneStyle } from './MethodBadge'
import type { ProxyStatus } from './RequestPanel'
import type { ApiResponse, SendError } from './send'

export type ResponseState =
  | { phase: 'loading'; startedAt: number }
  | { phase: 'done'; response: ApiResponse; seq: number; imageUrl?: string }
  | { phase: 'error'; error: string; kind: SendError['kind']; timeMs?: number; seq: number }

type View = 'pretty' | 'raw' | 'preview' | 'headers' | 'cookies'

/** 编辑器里最多展示的字符数，超出部分请下载查看 */
const MAX_VIEW_CHARS = 1_000_000
const BODY_H = 'clamp(280px, 52vh, 600px)'

const LANG: Partial<Record<BodyKind, EditorLang>> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  javascript: 'javascript',
  css: 'css',
}

export function ResponsePanel({
  state,
  proxy,
  samples,
  onSample,
  onRetry,
  onCancel,
  className,
}: {
  state: ResponseState | undefined
  proxy: ProxyStatus
  samples: SampleRequest[]
  onSample: (s: SampleRequest) => void
  onRetry: () => void
  onCancel: () => void
  className?: string
}) {
  // 放在这里而不是 ResponseView 里：切换到新响应时保持当前查看的标签
  const [view, setView] = useState<View>('pretty')
  return (
    <div
      className={cn(
        'relative flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card',
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!state ? (
          <Fade key="empty">
            <EmptyState samples={samples} onSample={onSample} />
          </Fade>
        ) : state.phase === 'loading' ? (
          <Fade key="loading">
            <Loading startedAt={state.startedAt} onCancel={onCancel} />
          </Fade>
        ) : state.phase === 'error' ? (
          <Fade key={`error-${state.seq}`}>
            <ErrorView state={state} proxy={proxy} onRetry={onRetry} />
          </Fade>
        ) : (
          <Fade key={`done-${state.seq}`}>
            <ResponseView state={state} view={view} onView={setView} />
          </Fade>
        )}
      </AnimatePresence>
    </div>
  )
}

function Fade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="flex min-h-[360px] flex-1 flex-col"
      initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
    >
      {children}
    </motion.div>
  )
}

// ───────────────────────────── 空状态 / 加载 / 错误 ─────────────────────────────

function EmptyState({
  samples,
  onSample,
}: {
  samples: SampleRequest[]
  onSample: (s: SampleRequest) => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <div className="relative">
        <div className="absolute -inset-6 rounded-full bg-accent-soft blur-2xl" aria-hidden />
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="relative flex size-16 items-center justify-center rounded-[20px] border border-line bg-surface shadow-card"
        >
          <Send className="size-7 -rotate-12 text-accent" />
        </motion.div>
      </div>
      <div>
        <p className="text-[15px] font-semibold text-fg">还没有响应</p>
        <p className="mt-1 text-[13px] text-fg-2">
          填好 URL 后点击「发送」，或按 <Kbd>{modKey}</Kbd> <Kbd>Enter</Kbd>
        </p>
      </div>
      <div className="flex max-w-lg flex-wrap justify-center gap-2">
        {samples.slice(0, 4).map((s) => (
          <button
            key={s.name}
            type="button"
            onClick={() => onSample(s)}
            title={s.description}
            className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg-2 transition-[background-color,color,transform] hover:bg-fill-2 hover:text-fg active:scale-95"
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function Loading({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <LoaderCircle className="size-5 animate-spin text-accent" />
        <span className="text-sm font-medium text-fg">正在等待响应…</span>
        <span className="font-mono text-xs text-fg-3 tabular-nums">
          {formatDuration(Math.max(0, now - startedAt))}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>
          取消
        </Button>
      </div>
      <div className="flex flex-col gap-2.5" aria-hidden>
        {[92, 76, 84, 58, 70, 40].map((w, i) => (
          <div
            key={i}
            className="h-3 animate-shimmer rounded-full bg-[linear-gradient(90deg,var(--fill-2)_0%,var(--fill-3)_50%,var(--fill-2)_100%)] bg-[length:200%_100%]"
            style={{ width: `${w}%`, animationDelay: `${i * 0.08}s` }}
          />
        ))}
      </div>
    </div>
  )
}

function ErrorView({
  state,
  proxy,
  onRetry,
}: {
  state: Extract<ResponseState, { phase: 'error' }>
  proxy: ProxyStatus
  onRetry: () => void
}) {
  const title =
    state.kind === 'aborted'
      ? '请求已取消'
      : state.kind === 'timeout'
        ? '请求超时'
        : state.kind === 'invalid'
          ? '无法发送'
          : '请求失败'
  const Icon =
    state.kind === 'aborted' ? CircleSlash : state.kind === 'timeout' ? Timer : CircleAlert
  const tone = state.kind === 'aborted' ? 'text-fg-2' : 'text-danger'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <motion.span
        initial={{ scale: 0.6, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 16 }}
        className={cn(
          'flex size-14 items-center justify-center rounded-[18px]',
          state.kind === 'aborted' ? 'bg-fill' : 'bg-danger/10',
          tone,
        )}
      >
        <Icon className="size-6" />
      </motion.span>
      <div className="max-w-xl">
        <p className="text-[15px] font-semibold text-fg">{title}</p>
        {state.kind !== 'aborted' && (
          <p className="mt-2 text-left text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fg-2">
            {state.error}
          </p>
        )}
        {state.timeMs !== undefined && state.kind !== 'aborted' && (
          <p className="mt-2 text-xs text-fg-3">耗时 {formatDuration(state.timeMs)}</p>
        )}
      </div>
      {state.kind === 'cors' && (
        <Notice tone="info" className="max-w-xl text-left">
          {proxy === 'available'
            ? '本地代理可用：在「设置」里开启「使用本地代理」后重新发送，就不会再受 CORS 限制。'
            : '当前没有检测到本地代理。用 npm run dev 启动 showMe 后，请求会经由本机转发，不再受 CORS 限制。'}
        </Notice>
      )}
      <Button variant="secondary" size="sm" icon={<RotateCw />} onClick={onRetry}>
        重新发送
      </Button>
    </div>
  )
}

// ───────────────────────────── 响应内容 ─────────────────────────────

function ResponseView({
  state,
  view,
  onView,
}: {
  state: Extract<ResponseState, { phase: 'done' }>
  view: View
  onView: (v: View) => void
}) {
  const res = state.response
  const contentType = getHeader(res.headers, 'content-type')
  const kind = useMemo(() => detectBodyKind(contentType, res.body), [contentType, res.body])
  const text = useMemo(
    () =>
      kind === 'image' || kind === 'binary' || kind === 'empty'
        ? ''
        : decodeText(res.body, contentType),
    [kind, res.body, contentType],
  )
  // 先按完整内容美化再截断（截断后的 JSON 已经不合法，没法再美化）
  const pretty = useMemo(() => {
    const full =
      kind === 'json' ? (prettyJson(text) ?? text) : kind === 'xml' ? prettyXml(text) : text
    return { full, ...truncateText(full, MAX_VIEW_CHARS) }
  }, [kind, text])
  const raw = useMemo(() => {
    if (kind !== 'binary') return { full: text, ...truncateText(text, MAX_VIEW_CHARS) }
    const dump = hexDump(res.body)
    return { full: dump, text: dump, truncated: false }
  }, [kind, res.body, text])
  const cookies = useMemo(() => responseCookies(res.headers), [res.headers])
  const canPreview = kind === 'html' || kind === 'image'
  const active: View = view === 'preview' && !canPreview ? 'pretty' : view
  const tone = statusTone(res.status)
  const color = STATUS_COLORS[tone]
  const reason = reasonPhrase(res.status, res.statusText)

  const download = () => {
    const name = suggestFileName(
      res.url,
      contentType,
      getHeader(res.headers, 'content-disposition'),
    )
    downloadBlob(
      name,
      new Blob([res.body as BlobPart], { type: contentType || 'application/octet-stream' }),
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <motion.span
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[13px] font-semibold',
            TONE_TEXT,
          )}
          style={toneStyle(color, 14)}
          title={statusMeaning(res.status)}
        >
          {res.status}
          {reason && <span className="font-sans font-medium">{reason}</span>}
        </motion.span>
        <Metric icon={<Clock />} label="耗时" value={formatDuration(res.timeMs)} />
        <Metric icon={<ArrowDownToLine />} label="大小" value={formatBytes(res.size)} />
        <Badge color={res.via === 'proxy' ? 'var(--sys-green)' : 'var(--sys-orange)'}>
          {res.via === 'proxy' ? '本地代理' : '浏览器直连'}
        </Badge>
        {res.redirected && <Badge color="var(--sys-blue)">已重定向</Badge>}
        <div className="ml-auto flex items-center gap-1">
          <CopyButton
            text={
              active === 'headers'
                ? res.headers.map(([k, v]) => `${k}: ${v}`).join('\n')
                : active === 'raw'
                  ? raw.full
                  : pretty.full
            }
            variant="ghost"
            label={active === 'headers' ? '复制响应头' : '复制'}
            disabled={active !== 'headers' && !pretty.text && !raw.text}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Download />}
            iconOnly
            aria-label="下载响应体"
            title="下载响应体"
            disabled={!res.body.length}
            onClick={download}
          />
        </div>
      </div>

      {res.notes.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-line bg-surface-2 px-4 py-2 text-xs text-fg-2 sm:px-5">
          {res.notes.map((n) => (
            <span key={n}>· {n}</span>
          ))}
        </div>
      )}
      {res.redirected && res.url && (
        <div className="border-b border-line px-4 py-2 font-mono text-xs break-all text-fg-3 sm:px-5">
          最终地址：{res.url}
        </div>
      )}

      <Tabs
        className="px-3"
        value={active}
        onChange={onView}
        items={[
          { value: 'pretty', label: '美化' },
          { value: 'raw', label: '原始' },
          ...(canPreview ? [{ value: 'preview' as const, label: '预览' }] : []),
          { value: 'headers', label: '响应头', badge: res.headers.length },
          { value: 'cookies', label: 'Cookie', badge: cookies.length },
        ]}
      />

      {((active === 'pretty' && pretty.truncated) || (active === 'raw' && raw.truncated)) && (
        <div className="border-b border-line bg-warning/5 px-4 py-2 text-xs text-warning sm:px-5">
          响应体较大（{formatBytes(res.size)}），这里只显示前 {MAX_VIEW_CHARS.toLocaleString()}{' '}
          个字符，完整内容请下载。
        </div>
      )}

      <div
        className="thin-scrollbar min-h-0 overflow-auto"
        style={{ height: BODY_H }}
        data-lenis-prevent
      >
        {active === 'pretty' &&
          (kind === 'empty' ? (
            <Placeholder
              text={
                res.status === 204 || res.status === 304
                  ? `${res.status} 响应没有响应体`
                  : '响应体为空'
              }
            />
          ) : kind === 'image' ? (
            <ImagePreview url={state.imageUrl} />
          ) : kind === 'binary' ? (
            <Placeholder
              text={`二进制内容（${contentType || '未知类型'}，${formatBytes(res.size)}），可在「原始」里查看十六进制，或下载后打开`}
            />
          ) : (
            <CodeEditor
              value={pretty.text}
              readOnly
              lang={LANG[kind] ?? 'text'}
              aria-label="响应体"
            />
          ))}
        {active === 'raw' &&
          (kind === 'empty' ? (
            <Placeholder text="响应体为空" />
          ) : kind === 'image' ? (
            <CodeEditor
              value={hexDump(res.body)}
              readOnly
              lineWrapping={false}
              aria-label="原始响应体"
            />
          ) : (
            <CodeEditor
              value={raw.text}
              readOnly
              lineWrapping={kind !== 'binary'}
              aria-label="原始响应体"
            />
          ))}
        {active === 'preview' &&
          (kind === 'image' ? (
            <ImagePreview url={state.imageUrl} />
          ) : (
            <iframe
              title="HTML 预览"
              sandbox=""
              srcDoc={previewDocument(text, res.url)}
              className="size-full border-0"
              style={{ colorScheme: 'light', background: 'Canvas' }}
            />
          ))}
        {active === 'headers' && <HeadersTable headers={res.headers} />}
        {active === 'cookies' && <CookiesTable cookies={cookies} via={res.via} />}
      </div>
    </>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-fg-2 [&_svg]:size-3.5"
      title={label}
    >
      {icon}
      <span className="font-mono text-fg tabular-nums">{value}</span>
    </span>
  )
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-fg-3">
      {text}
    </div>
  )
}

function ImagePreview({ url }: { url?: string }) {
  if (!url) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-3">
        <ImageOff className="size-6" />
        <span className="text-[13px]">无法预览图片</span>
      </div>
    )
  }
  return (
    <div
      className="flex min-h-full items-center justify-center p-6"
      style={{
        backgroundImage:
          'linear-gradient(45deg, var(--fill-2) 25%, transparent 25%), linear-gradient(-45deg, var(--fill-2) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--fill-2) 75%), linear-gradient(-45deg, transparent 75%, var(--fill-2) 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
      }}
    >
      <motion.img
        src={url}
        alt="响应图片预览"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-h-full max-w-full rounded-xl shadow-card"
      />
    </div>
  )
}

function HeadersTable({ headers }: { headers: [string, string][] }) {
  if (!headers.length) return <Placeholder text="没有响应头" />
  return (
    <table className="w-full table-fixed text-left text-[13px]">
      <tbody>
        {headers.map(([k, v], i) => (
          <tr key={`${k}-${i}`} className="border-b border-line last:border-0 odd:bg-fill-2/40">
            <td className="w-[36%] px-4 py-2 align-top font-mono font-medium break-all text-fg sm:w-[28%] sm:px-5">
              {k}
            </td>
            <td className="px-4 py-2 align-top font-mono break-all text-fg-2 sm:px-5">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CookiesTable({
  cookies,
  via,
}: {
  cookies: ReturnType<typeof responseCookies>
  via: ApiResponse['via']
}) {
  if (!cookies.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-fg-3">
        <Cookie className="size-6" />
        <span className="text-[13px]">
          {via === 'direct'
            ? '浏览器直连时无法读取 Set-Cookie，使用本地代理可以看到'
            : '这个响应没有设置 Cookie'}
        </span>
      </div>
    )
  }
  return (
    <div className="divide-y divide-line">
      {cookies.map((c, i) => (
        <div key={`${c.name}-${i}`} className="flex flex-col gap-1.5 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-[13px]">
            <span className="font-semibold text-fg">{c.name || '（无名称）'}</span>
            <span className="text-fg-3">=</span>
            <span className="min-w-0 break-all text-fg-2">{c.value}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {c.domain && <Badge color="var(--sys-indigo)">Domain {c.domain}</Badge>}
            {c.path && <Badge color="var(--sys-indigo)">Path {c.path}</Badge>}
            {c.expires && <Badge color="var(--sys-teal)">Expires {c.expires}</Badge>}
            {c.maxAge !== undefined && <Badge color="var(--sys-teal)">Max-Age {c.maxAge}</Badge>}
            {c.httpOnly && <Badge color="var(--sys-orange)">HttpOnly</Badge>}
            {c.secure && <Badge color="var(--sys-green)">Secure</Badge>}
            {c.sameSite && <Badge color="var(--sys-purple)">SameSite={c.sameSite}</Badge>}
            {c.partitioned && <Badge color="var(--sys-pink)">Partitioned</Badge>}
          </div>
        </div>
      ))}
    </div>
  )
}
