import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Braces, ClipboardPaste, Plus, Sparkles, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  CopyButton,
  ErrorNotice,
  Notice,
  Panel,
  PanelHeader,
  Switch,
  TextArea,
} from '@/components/ui'
import { readClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { parseUrl, rebuildUrl, safeDecode, urlToJson, type UrlParts } from '@/lib/url-codec'
import { ParamsTable, type ParamRowData } from './ParamsTable'
import type { SetPref, UrlPrefs } from './prefs'

const SAMPLE_URL =
  'https://zhang:pa%24%24@shop.例子.cn:8443/zh-CN/%E5%95%86%E5%93%81/list?q=%E6%89%8B%E6%9C%BA+%E5%A3%B3&page=2&sort=price_asc&tags=new&tags=hot&debug#reviews'

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const

type PartKey = 'protocol' | 'auth' | 'host' | 'port' | 'path' | 'search' | 'hash'

const COLORS: Record<PartKey | 'origin', string> = {
  protocol: 'var(--sys-purple)',
  auth: 'var(--sys-orange)',
  host: 'var(--sys-blue)',
  port: 'var(--sys-teal)',
  path: 'var(--sys-green)',
  search: 'var(--sys-pink)',
  hash: 'var(--sys-indigo)',
  origin: 'var(--fg-2)',
}

/**
 * 从 URL 重新解析参数行。按位置沿用上一轮的 id：
 * 在上方输入框打字时参数行不会被整批卸载重建（避免闪烁和丢失焦点）。
 */
function toRows(input: string, prev: ParamRowData[], gen: string): ParamRowData[] {
  const r = parseUrl(input)
  return r.ok ? r.params.map((p, i) => ({ ...p, id: prev[i]?.id ?? `${gen}-${i}` })) : []
}

/** 按顺序拼起来正好是规范化后的 href */
function segments(u: UrlParts): { key: PartKey; text: string }[] {
  const out: { key: PartKey; text: string }[] = []
  if (u.protocol)
    out.push({
      key: 'protocol',
      text: u.protocol + (u.href.startsWith(u.protocol + '//') ? '//' : ''),
    })
  if (u.username || u.password)
    out.push({ key: 'auth', text: `${u.username}${u.password ? `:${u.password}` : ''}@` })
  if (u.hostname) out.push({ key: 'host', text: u.hostname })
  if (u.port) out.push({ key: 'port', text: `:${u.port}` })
  if (u.pathname) out.push({ key: 'path', text: u.pathname })
  if (u.search) out.push({ key: 'search', text: u.search })
  if (u.hash) out.push({ key: 'hash', text: u.hash })
  return out
}

export function UrlParser({ prefs, set }: { prefs: UrlPrefs; set: SetPref }) {
  const { spaceAsPlus, showEncoded } = prefs
  const [input, setInput] = useState(SAMPLE_URL)
  const [rows, setRows] = useState<ParamRowData[]>(() => toRows(SAMPLE_URL, [], 'init'))
  const seq = useRef(0)
  const parsed = useMemo(() => parseUrl(input), [input])

  const changeInput = (v: string) => {
    setInput(v)
    seq.current += 1
    const gen = `g${seq.current}`
    setRows((prev) => toRows(v, prev, gen))
  }

  const changeRows = (next: ParamRowData[], plus = spaceAsPlus) => {
    setRows(next)
    setInput(
      rebuildUrl(
        input,
        next.filter((r) => r.key || r.value),
        plus,
      ),
    )
  }

  const addRow = () => {
    seq.current += 1
    changeRows([...rows, { id: `n${seq.current}`, key: '', value: '', hasValue: true, raw: null }])
  }

  const url = parsed.ok ? parsed.url : null
  const relative = parsed.ok && parsed.relative
  const segs = url ? segments(url) : []
  const decodedPath = url ? safeDecode(url.pathname) : ''
  const decodedHash = url ? safeDecode(url.hash) : ''

  const fields: { key: PartKey | 'origin'; label: string; value: string; sub?: string }[] = url
    ? [
        { key: 'protocol', label: '协议', value: url.protocol },
        {
          key: 'host',
          label: '主机',
          value: url.hostname,
          sub: url.hostUnicode && `Unicode：${url.hostUnicode}`,
        },
        {
          key: 'port',
          label: '端口',
          value: url.port,
          sub: !url.port && url.defaultPort ? `省略，默认 ${url.defaultPort}` : undefined,
        },
        { key: 'auth', label: '用户名', value: safeDecode(url.username) },
        { key: 'auth', label: '密码', value: safeDecode(url.password) },
        {
          key: 'path',
          label: '路径',
          value: url.pathname,
          sub: decodedPath !== url.pathname ? `解码：${decodedPath}` : undefined,
        },
        {
          key: 'search',
          label: '查询',
          value: url.search,
          sub: parsed.ok && parsed.params.length ? `${parsed.params.length} 个参数` : undefined,
        },
        {
          key: 'hash',
          label: '片段',
          value: url.hash,
          sub: decodedHash !== url.hash ? `解码：${decodedHash}` : undefined,
        },
        { key: 'origin', label: '源（origin）', value: url.origin === 'null' ? '' : url.origin },
      ]
    : []

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title="URL">
          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles />}
            onClick={() => changeInput(SAMPLE_URL)}
          >
            示例
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ClipboardPaste />}
            onClick={async () => {
              const t = await readClipboard()
              if (t !== null) changeInput(t.trim())
            }}
          >
            粘贴
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<Trash2 />}
            aria-label="清空"
            title="清空"
            disabled={!input}
            onClick={() => changeInput('')}
          />
          <CopyButton text={input.trim()} disabled={!input.trim()} label="复制 URL" />
        </PanelHeader>
        <TextArea
          mono
          rows={3}
          value={input}
          onChange={(e) => changeInput(e.target.value)}
          placeholder="粘贴一条链接，例如 https://example.com/path?a=1#top"
          aria-label="要解析的 URL"
          autoGrow
          className="max-h-60 min-h-20 leading-relaxed break-all"
        />

        <AnimatePresence initial={false}>
          {url && (
            <motion.div
              key="anatomy"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              className="overflow-hidden"
            >
              <LayoutGroup>
                <div className="mt-4 rounded-2xl bg-fill-2 px-4 py-3 font-mono text-[13px] leading-7 break-all">
                  {segs.map((s) => (
                    <motion.span
                      key={s.key}
                      layout="position"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={spring}
                      className="rounded-md px-0.5 py-0.5 [box-decoration-break:clone]"
                      style={{
                        color: COLORS[s.key],
                        background: `color-mix(in srgb, ${COLORS[s.key]} 10%, transparent)`,
                      }}
                    >
                      {s.text}
                    </motion.span>
                  ))}
                </div>
              </LayoutGroup>
            </motion.div>
          )}
        </AnimatePresence>

        <ErrorNotice error={!parsed.ok && input.trim() ? parsed.error : null} className="mt-3" />
        <AnimatePresence initial={false}>
          {parsed.ok && parsed.assumedScheme && (
            <Notice key="scheme" tone="info" className="mt-3">
              没有写协议，已按 https:// 补全后解析。
            </Notice>
          )}
          {relative && (
            <Notice key="relative" tone="info" className="mt-3">
              这是相对地址，只拆分路径、查询参数与片段；协议和主机由所在页面决定。
            </Notice>
          )}
        </AnimatePresence>
      </Panel>

      {url && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields
            // 用户名、密码、查询、片段等为空时不占位置
            .filter(
              (f) =>
                f.value ||
                f.sub ||
                f.key === 'path' ||
                (!relative && (f.key === 'protocol' || f.key === 'host')),
            )
            .map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: i * 0.03 }}
                className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4 shadow-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-fg-2">
                    <span className="size-2 rounded-full" style={{ background: COLORS[f.key] }} />
                    {f.label}
                  </span>
                  <CopyButton
                    text={f.value}
                    label={`复制${f.label}`}
                    iconOnly
                    variant="ghost"
                    disabled={!f.value}
                  />
                </div>
                <motion.div
                  key={f.value}
                  initial={{ opacity: 0.35 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.35 }}
                  className={cn(
                    'font-mono text-[13px] leading-relaxed break-all',
                    f.value ? 'text-fg' : 'text-fg-3',
                  )}
                >
                  {f.value || '—'}
                </motion.div>
                {f.sub && <div className="text-xs break-all text-fg-3">{f.sub}</div>}
              </motion.div>
            ))}
        </div>
      )}

      {url && (
        <Panel>
          <PanelHeader
            title={
              <span className="inline-flex items-center gap-2">
                查询参数
                <Badge color="var(--sys-pink)">{rows.length}</Badge>
              </span>
            }
          >
            <Switch
              checked={showEncoded}
              onChange={(v) => set('showEncoded', v)}
              label={<span className="text-[13px] text-fg-2">显示编码后</span>}
            />
            <Switch
              checked={spaceAsPlus}
              onChange={(v) => {
                set('spaceAsPlus', v)
                changeRows(rows, v)
              }}
              label={<span className="text-[13px] text-fg-2">空格写成 +</span>}
            />
            <CopyButton
              text={() => (parsed.ok ? urlToJson(parsed.url, parsed.params) : '')}
              label="复制 JSON"
            />
          </PanelHeader>

          {rows.length > 0 ? (
            <ParamsTable
              rows={rows}
              onChange={(next) => changeRows(next)}
              spaceAsPlus={spaceAsPlus}
              showEncoded={showEncoded}
            />
          ) : (
            <p className="rounded-2xl bg-fill-2 px-4 py-6 text-center text-sm text-fg-2">
              这条链接没有查询参数
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-3">
              值以解码后的形式编辑，修改会实时写回上方的 URL；未改动的参数保持原有编码
            </p>
            <div className="flex gap-2">
              {rows.length > 0 && (
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => changeRows([])}>
                  清空参数
                </Button>
              )}
              <Button size="sm" variant="secondary" icon={<Plus />} onClick={addRow}>
                添加参数
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {url && (
        <details className="group rounded-3xl border border-line bg-surface shadow-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-[15px] font-semibold text-fg sm:px-6 [&::-webkit-details-marker]:hidden">
            <Braces className="size-4 text-accent" />
            JSON 结构
            <span className="ml-auto text-xs font-normal text-fg-3 group-open:hidden">展开</span>
          </summary>
          <pre className="thin-scrollbar mx-5 mb-5 max-h-80 overflow-auto rounded-2xl bg-fill-2 p-4 font-mono text-xs leading-relaxed text-fg sm:mx-6">
            {parsed.ok ? urlToJson(parsed.url, parsed.params) : ''}
          </pre>
        </details>
      )}
    </div>
  )
}
