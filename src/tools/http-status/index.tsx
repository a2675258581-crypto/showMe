import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Search, SearchX, X } from 'lucide-react'
import { Panel, SegmentedControl, Switch } from '@/components/ui'
import { useHotkey } from '@/hooks/useHotkey'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  HTTP_STATUSES,
  STATUS_CLASSES,
  codeQueryPrefix,
  searchStatuses,
  statusClassOf,
  type HttpStatus,
  type StatusClass,
} from '@/lib/http-status'
import { StatusCard, StatusDetail } from './StatusCard'

type ClassFilter = 'all' | '1' | '2' | '3' | '4' | '5'

interface Options {
  includeUnofficial: boolean
  cls: ClassFilter
}

const DEFAULTS: Options = { includeUnofficial: true, cls: 'all' }

const QUICK = ['404', '5xx', '限流', '重定向', 'nginx', '缓存', 'websocket']

// 与网格的 sm:grid-cols-2 / lg:grid-cols-3 断点一致（Tailwind 默认 640px / 1024px）
const MQ_SM = '(min-width: 640px)'
const MQ_LG = '(min-width: 1024px)'

function subscribeColumns(cb: () => void) {
  const lists = [MQ_SM, MQ_LG].map((q) => window.matchMedia(q))
  lists.forEach((l) => l.addEventListener('change', cb))
  return () => lists.forEach((l) => l.removeEventListener('change', cb))
}

/** 当前网格列数（1 / 2 / 3） */
function useColumns(): number {
  return useSyncExternalStore(
    subscribeColumns,
    () => (window.matchMedia(MQ_LG).matches ? 3 : window.matchMedia(MQ_SM).matches ? 2 : 1),
    () => 1,
  )
}

/** 卡片网格：展开的卡片所在行末尾插入整行详情，网格不留空洞、顺序不变 */
function CardGrid({
  items,
  expanded,
  onToggle,
  columns,
}: {
  items: HttpStatus[]
  expanded: number | null
  onToggle: (code: number) => void
  columns: number
}) {
  const at = expanded === null ? -1 : items.findIndex((s) => s.code === expanded)
  const rowEnd =
    at < 0 ? -1 : Math.min(items.length - 1, Math.floor(at / columns) * columns + columns - 1)
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence mode="popLayout">
        {items.flatMap((s, i) => {
          const card = (
            <StatusCard
              key={s.code}
              status={s}
              expanded={i === at}
              onToggle={() => onToggle(s.code)}
            />
          )
          return i === rowEnd
            ? [
                card,
                <StatusDetail
                  key={`detail-${items[at].code}`}
                  status={items[at]}
                  column={at % columns}
                  columns={columns}
                />,
              ]
            : [card]
        })}
      </AnimatePresence>
    </div>
  )
}

export default function HttpStatusTool() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('http-status.options.v1', DEFAULTS)
  const merged: Options = { ...DEFAULTS, ...stored }
  const o: Options = /^(all|[1-5])$/.test(String(merged.cls)) ? merged : { ...merged, cls: 'all' }
  const set = (patch: Partial<Options>) => setStored((prev) => ({ ...DEFAULTS, ...prev, ...patch }))

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useHotkey('escape', () => setExpanded(null), { enabled: expanded !== null })

  const cls = o.cls === 'all' ? null : (Number(o.cls) as StatusClass)
  const results = useMemo(
    () => searchStatuses(query, { includeUnofficial: o.includeUnofficial, cls }),
    [query, o.includeUnofficial, cls],
  )
  const q = query.trim()
  // 纯文本搜索按匹配度排序，平铺展示；其余情况按类别分组
  const ranked = q !== '' && codeQueryPrefix(q) === null
  const groups = useMemo(
    () =>
      STATUS_CLASSES.map((c) => ({
        info: c,
        items: results.filter((s) => statusClassOf(s.code) === c.id),
      })).filter((g) => g.items.length > 0),
    [results],
  )

  const columns = useColumns()
  const toggle = (code: number) => setExpanded((cur) => (cur === code ? null : code))
  const total = HTTP_STATUSES.filter((s) => o.includeUnofficial || s.status !== 'unofficial').length

  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setExpanded(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length === 1) setExpanded(results[0].code)
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="输入状态码或关键词，如 404、限流、Retry-After"
            aria-label="搜索状态码"
            className="h-14 w-full rounded-2xl border border-line bg-surface-2 px-12 text-base text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-3 focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
          <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1.5">
            <AnimatePresence initial={false}>
              {query ? (
                <motion.button
                  key="clear"
                  type="button"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  onClick={() => {
                    setQuery('')
                    inputRef.current?.focus()
                  }}
                  aria-label="清空搜索"
                  className="flex size-7 items-center justify-center rounded-full bg-fill text-fg-2 hover:text-fg"
                >
                  <X className="size-3.5" />
                </motion.button>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="no-scrollbar -mx-1 max-w-full overflow-x-auto px-1">
            <SegmentedControl<ClassFilter>
              size="sm"
              aria-label="按类别筛选"
              value={o.cls}
              onChange={(v) => {
                set({ cls: v })
                setExpanded(null)
              }}
              options={[
                { value: 'all', label: '全部' },
                ...STATUS_CLASSES.map((c) => ({
                  value: String(c.id) as ClassFilter,
                  title: c.name,
                  label: (
                    <>
                      <i
                        className="hidden size-1.5 rounded-full sm:inline-block"
                        style={{ background: c.color }}
                      />
                      {c.range}
                    </>
                  ),
                })),
              ]}
            />
          </div>
          <Switch
            checked={o.includeUnofficial}
            onChange={(v) => set({ includeUnofficial: v })}
            label={<span className="text-[13px] text-fg-2">含 Nginx / Cloudflare 非标准码</span>}
          />
          <span className="text-xs text-fg-3 tabular-nums sm:ml-auto">
            {results.length === total ? `共 ${total} 个` : `${results.length} / ${total} 个`}
          </span>
        </div>

        {!q && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
            试试：
            {QUICK.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setQuery(k)}
                className="rounded-full bg-fill-2 px-2.5 py-1 text-fg-2 transition-colors hover:bg-fill hover:text-fg"
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <LayoutGroup>
        {results.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line-strong px-6 py-14 text-center"
          >
            <SearchX className="size-8 text-fg-3" />
            <div className="text-[15px] font-semibold text-fg">没有匹配「{q}」的状态码</div>
            <div className="text-[13px] text-fg-2">换个关键词试试，或者输入 3 位数字直接查找</div>
          </motion.div>
        ) : ranked ? (
          <motion.section layout>
            <CardGrid items={results} expanded={expanded} onToggle={toggle} columns={columns} />
          </motion.section>
        ) : (
          groups.map((g) => (
            <motion.section key={g.info.id} layout className="flex flex-col gap-3">
              <motion.header layout="position" className="flex items-baseline gap-2.5 px-1">
                <span
                  className="size-2.5 translate-y-[-1px] self-center rounded-full"
                  style={{ background: g.info.color }}
                />
                <h2 className="text-lg font-semibold tracking-tight text-fg">
                  <span className="font-mono">{g.info.range}</span> {g.info.name}
                </h2>
                <span className="hidden text-[13px] text-fg-2 sm:inline">{g.info.desc}</span>
                <span className="ml-auto text-xs text-fg-3 tabular-nums">{g.items.length} 个</span>
              </motion.header>
              <CardGrid items={g.items} expanded={expanded} onToggle={toggle} columns={columns} />
            </motion.section>
          ))
        )}
      </LayoutGroup>
    </div>
  )
}
