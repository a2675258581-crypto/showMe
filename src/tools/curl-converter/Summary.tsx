import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Eye, EyeOff, FileText, Paperclip } from 'lucide-react'
import { Badge } from '@/components/ui'
import { prettyJson } from '@/lib/api-client-response'
import type { HttpRequest } from '@/lib/curl'
import { cn } from '@/lib/cn'
import { MethodBadge } from '../api-client/MethodBadge'

/** 解析结果摘要卡片：方法、URL、查询参数、请求头、认证、请求体与选项 */
export function Summary({ request }: { request: HttpRequest }) {
  const query = useMemo(() => {
    try {
      return [...new URL(request.url).searchParams.entries()]
    } catch {
      return []
    }
  }, [request.url])

  const chips: string[] = []
  if (request.followRedirects) chips.push('跟随重定向')
  if (request.insecure) chips.push('忽略证书校验')
  if (request.compressed) chips.push('压缩响应')
  if (request.timeout !== undefined) chips.push(`超时 ${request.timeout} s`)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <MethodBadge method={request.method} variant="pill" className="mt-0.5 text-xs" />
        <div className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all text-fg">
          {request.url}
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Badge key={c} color="var(--sys-indigo)">
              {c}
            </Badge>
          ))}
        </div>
      )}

      {query.length > 0 && (
        <Section title="查询参数" count={query.length}>
          <KVTable rows={query} />
        </Section>
      )}

      <Section title="请求头" count={request.headers.length}>
        {request.headers.length ? (
          <KVTable rows={request.headers} />
        ) : (
          <p className="text-[13px] text-fg-3">没有自定义请求头</p>
        )}
      </Section>

      {request.auth && (
        <Section title="Basic 认证">
          <AuthRow username={request.auth.username} password={request.auth.password} />
        </Section>
      )}

      <Section title="请求体" hint={bodyHint(request)}>
        <BodyView request={request} />
      </Section>
    </div>
  )
}

function bodyHint(r: HttpRequest): string {
  switch (r.body.kind) {
    case 'none':
      return '无'
    case 'text':
      return `${r.body.text.length.toLocaleString()} 字符`
    case 'multipart':
      return `multipart/form-data · ${r.body.parts.length} 个字段`
    case 'file':
      return '本地文件'
  }
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string
  count?: number
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-2">
        {title}
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-fill px-1.5 text-[11px] leading-4 font-medium">
            {count}
          </span>
        )}
        {hint && <span className="font-normal text-fg-3">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function KVTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="thin-scrollbar max-h-72 overflow-auto rounded-2xl border border-line">
      <table className="w-full table-fixed text-left text-[13px]">
        <tbody>
          {rows.map(([k, v], i) => (
            <motion.tr
              key={`${k}-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.015, 0.3) }}
              className="border-b border-line last:border-0 odd:bg-fill-2/40"
            >
              <td className="w-[38%] px-3 py-2 align-top font-mono font-medium break-all text-fg sm:w-[30%]">
                {k}
              </td>
              <td className="px-3 py-2 align-top font-mono break-all text-fg-2">
                {v === '' ? <span className="text-fg-3 italic">（空）</span> : v}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AuthRow({ username, password }: { username: string; password: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line px-3 py-2 font-mono text-[13px]">
      <span>
        <span className="text-fg-3">用户名 </span>
        <span className="text-fg">{username || '（空）'}</span>
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="text-fg-3">密码 </span>
        <span className="text-fg">
          {show ? password || '（空）' : '•'.repeat(Math.min(password.length || 4, 12))}
        </span>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded-full p-1 text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
          aria-label={show ? '隐藏密码' : '显示密码'}
          title={show ? '隐藏密码' : '显示密码'}
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </span>
    </div>
  )
}

function BodyView({ request }: { request: HttpRequest }) {
  const b = request.body
  // 只调整缩进，数字原样显示（JSON.parse 会让大整数丢精度）
  const pretty = useMemo(() => (b.kind === 'text' ? (prettyJson(b.text) ?? b.text) : ''), [b])

  if (b.kind === 'none') return <p className="text-[13px] text-fg-3">这个请求没有请求体</p>
  if (b.kind === 'file') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-line px-3 py-2 text-[13px]">
        <FileText className="size-4 text-fg-2" />
        <span className="font-mono break-all text-fg">{b.path}</span>
        <span className="text-fg-3">（发送时读取本地文件）</span>
      </div>
    )
  }
  if (b.kind === 'multipart') {
    return (
      <div className="overflow-hidden rounded-2xl border border-line">
        {b.parts.map((p, i) => (
          <div
            key={`${p.name}-${i}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-[13px] last:border-0"
          >
            <span className="font-mono font-medium text-fg">{p.name}</span>
            {p.kind === 'file' ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-2">
                <Paperclip className="size-3.5 shrink-0" />
                <span className="font-mono break-all">{p.value}</span>
                {p.filename !== undefined && <span className="text-fg-3">→ {p.filename}</span>}
              </span>
            ) : (
              <span className="min-w-0 font-mono break-all text-fg-2">{p.value}</span>
            )}
            {p.contentType && <Badge color="var(--sys-teal)">{p.contentType}</Badge>}
          </div>
        ))}
      </div>
    )
  }
  return (
    <pre
      className={cn(
        'thin-scrollbar max-h-80 overflow-auto rounded-2xl border border-line bg-surface-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-fg',
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={pretty.length} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}>
          {pretty || <span className="text-fg-3">（空字符串）</span>}
        </motion.span>
      </AnimatePresence>
    </pre>
  )
}
