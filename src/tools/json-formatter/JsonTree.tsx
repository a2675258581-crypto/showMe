import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, MousePointerClick } from 'lucide-react'
import { Button, Select, useToast } from '@/components/ui'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import {
  isLossyNumber,
  printJson,
  quoteJsonString,
  toJsonPath,
  type JsonArray,
  type JsonObject,
  type JsonProperty,
  type JsonValue,
  type PathSegment,
} from '@/lib/json-formatter'

/** 每次最多渲染的子节点数，超出部分按需加载 */
const CHUNK = 100
/** 超过这个长度的字符串先截断显示 */
const LONG_STRING = 240
const spring = { type: 'spring', stiffness: 520, damping: 34 } as const

type Path = readonly PathSegment[]
type Leaf = Exclude<JsonValue, JsonObject | JsonArray>

/* ───────── 悬停路径：独立的小 store，悬停时只重渲染底部路径栏 ───────── */

function createHoverStore() {
  let current: Path | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(p: Path | null) {
      if (p === current) return
      current = p
      listeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

type HoverStore = ReturnType<typeof createHoverStore>

interface TreeContext {
  openDepth: number
  /** 与代码视图一致：按键名排序显示 */
  sortKeys: boolean
  hover: HoverStore
  copyPath: (path: Path) => void
  copyValue: (v: JsonValue) => void
}

const Ctx = createContext<TreeContext>({
  openDepth: 3,
  sortKeys: false,
  hover: createHoverStore(),
  copyPath: () => {},
  copyValue: () => {},
})

const DEPTH_OPTIONS = [
  { value: '0', label: '全部折叠' },
  { value: '1', label: '展开 1 层' },
  { value: '2', label: '展开 2 层' },
  { value: '3', label: '展开 3 层' },
  { value: '4', label: '展开 4 层' },
  { value: '5', label: '展开 5 层' },
  { value: 'all', label: '全部展开' },
]

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function shorten(s: string, max = 48): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * 可折叠的 JSON 树：类型着色、子项计数、点击复制 JSONPath。
 * memo：大文档防抖计算期间，输入框每敲一个字都会让父组件重渲染，树不应跟着整体重渲染。
 */
export const JsonTree = memo(function JsonTree({
  value,
  sortKeys = false,
}: {
  value: JsonValue
  sortKeys?: boolean
}) {
  const toast = useToast()
  const [hover] = useState(createHoverStore)
  // 数据变了，旧的悬停路径可能已不存在
  useEffect(() => hover.set(null), [hover, value])
  const [depth, setDepth] = useState(3)
  // 改变展开层级时整体重挂载，让每个节点按新层级重新初始化
  const [generation, setGeneration] = useState(0)

  const expand = (d: number) => {
    setDepth(d)
    setGeneration((g) => g + 1)
  }

  const ctx = useMemo<TreeContext>(
    () => ({
      openDepth: depth,
      sortKeys,
      hover,
      copyPath: (path) => {
        hover.set(path)
        const p = toJsonPath(path)
        void copyText(p).then((ok) =>
          toast(ok ? `已复制 ${shorten(p)}` : '复制失败', ok ? 'success' : 'error'),
        )
      },
      copyValue: (v) => {
        const text = v.type === 'string' ? v.value : printJson(v, { indent: 2 })
        void copyText(text).then((ok) =>
          toast(ok ? '已复制值' : '复制失败', ok ? 'success' : 'error'),
        )
      },
    }),
    [depth, sortKeys, hover, toast],
  )

  return (
    <div className="flex min-h-full flex-col">
      <div className="glass sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={<ChevronsUpDown />}
          onClick={() => expand(Infinity)}
        >
          全部展开
        </Button>
        <Button size="sm" variant="ghost" icon={<ChevronsDownUp />} onClick={() => expand(0)}>
          全部折叠
        </Button>
        <Select
          size="sm"
          value={depth === Infinity ? 'all' : String(Math.min(depth, 5))}
          options={DEPTH_OPTIONS}
          onChange={(v) => expand(v === 'all' ? Infinity : Number(v))}
          aria-label="展开层级"
        />
        <span className="ml-auto hidden items-center gap-1 pr-1 text-[11px] text-fg-3 sm:inline-flex">
          <MousePointerClick className="size-3.5" />
          点击节点复制 JSONPath
        </span>
      </div>

      <div
        role="tree"
        aria-label="JSON 树形视图"
        className="flex-1 px-2 py-2 font-mono text-[13px] leading-6"
        onMouseLeave={() => hover.set(null)}
      >
        <Ctx.Provider value={ctx}>
          <Node key={generation} value={value} path={[]} level={0} />
        </Ctx.Provider>
      </div>

      <PathBar hover={hover} />
    </div>
  )
})

function PathBar({ hover }: { hover: HoverStore }) {
  const path = useSyncExternalStore(hover.subscribe, hover.get, hover.get)
  return (
    <div className="glass sticky bottom-0 z-10 flex h-8 min-w-0 items-center gap-2 border-t border-line px-3">
      <span className="shrink-0 text-[11px] font-semibold text-fg-3">路径</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={path ? toJsonPath(path) : ''}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12 }}
          className={cn(
            'min-w-0 truncate',
            path ? 'font-mono text-[12px] text-fg' : 'text-[11px] text-fg-3',
          )}
        >
          {path ? toJsonPath(path) : '悬停节点查看 JSONPath，点击即可复制'}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

interface NodeProps {
  name?: PathSegment
  value: JsonValue
  path: Path
  level: number
}

const Node = memo(function Node(props: NodeProps) {
  return props.value.type === 'object' || props.value.type === 'array' ? (
    <Branch {...props} value={props.value} />
  ) : (
    <LeafRow {...props} value={props.value} />
  )
})

function KeyLabel({ name }: { name?: PathSegment }) {
  if (name === undefined) return null
  if (typeof name === 'number')
    return (
      <>
        <span className="text-fg-3 tabular-nums">{name}</span>
        <span className="text-fg-3">: </span>
      </>
    )
  return (
    <>
      <span className="font-semibold text-fg">{name === '' ? '""' : name}</span>
      <span className="text-fg-3">: </span>
    </>
  )
}

function CopyValueButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="复制值"
      title="复制值"
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-3 opacity-0 transition-[opacity,background-color,color] group-hover/row:opacity-100 hover:bg-fill hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
    >
      <Copy className="size-3.5" />
    </button>
  )
}

function Row({
  children,
  path,
  className,
}: {
  children: ReactNode
  path: Path
  className?: string
}) {
  const { hover } = useContext(Ctx)
  return (
    <div
      className={cn(
        'group/row flex items-start rounded-lg transition-colors duration-150 hover:bg-fill-2',
        className,
      )}
      onMouseEnter={() => hover.set(path)}
      onFocus={() => hover.set(path)}
    >
      {children}
    </div>
  )
}

const byKey = (a: JsonProperty, b: JsonProperty) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

function Branch({ name, value, path, level }: NodeProps & { value: JsonObject | JsonArray }) {
  const { openDepth, sortKeys, copyPath, copyValue } = useContext(Ctx)
  const isObj = value.type === 'object'
  const entries = useMemo(
    () =>
      value.type !== 'object' ? [] : sortKeys ? [...value.entries].sort(byKey) : value.entries,
    [value, sortKeys],
  )
  const count = isObj ? value.entries.length : value.items.length
  const empty = count === 0
  const [open, setOpen] = useState(level < openDepth)
  const [limit, setLimit] = useState(CHUNK)
  const [l, r] = isObj ? ['{', '}'] : ['[', ']']
  const expanded = open && !empty
  const shown = Math.min(limit, count)
  const toggle = () => {
    if (!empty) setOpen((o) => !o)
  }

  return (
    <div role="treeitem" aria-expanded={empty ? undefined : open} aria-level={level + 1}>
      <Row path={path} className="peer">
        <button
          type="button"
          onClick={toggle}
          disabled={empty}
          aria-label={`${open ? '折叠' : '展开'} ${name === undefined ? '根节点' : name}`}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:text-fg disabled:invisible"
        >
          <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={spring} className="flex">
            <ChevronRight className="size-3.5" />
          </motion.span>
        </button>
        <button
          type="button"
          onClick={() => copyPath(path)}
          onDoubleClick={toggle}
          title="点击复制 JSONPath · 双击展开 / 折叠"
          className="min-w-0 flex-1 cursor-pointer text-left [overflow-wrap:anywhere]"
        >
          <KeyLabel name={name} />
          <span className="text-fg-2">{l}</span>
          {!expanded && (
            <>
              {!empty && <span className="px-0.5 text-fg-3">…</span>}
              <span className="text-fg-2">{r}</span>
            </>
          )}
          {!empty && (
            <span className="ml-2 inline-block rounded-full bg-fill px-1.5 align-[1px] font-sans text-[11px] leading-4 text-fg-3">
              {count.toLocaleString()} {isObj ? '个键' : '项'}
            </span>
          )}
        </button>
        <CopyValueButton onClick={() => copyValue(value)} />
      </Row>

      <AnimatePresence initial={false} presenceAffectsLayout={false}>
        {expanded && (
          <motion.div
            key="children"
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.28, 0.11, 0.32, 1] }}
            className="overflow-hidden [--guide:var(--line)] peer-hover:[--guide:color-mix(in_srgb,var(--accent)_55%,transparent)]"
          >
            <div className="ml-2.5 border-l border-[color:var(--guide)] pl-1.5 transition-[border-color] duration-200">
              {isObj
                ? (() => {
                    // 以键名作 key：切换键排序、编辑输入时各节点的展开状态都能保持（重复键加序号）
                    const seen = new Map<string, number>()
                    return entries.slice(0, shown).map((e) => {
                      const n = seen.get(e.key) ?? 0
                      seen.set(e.key, n + 1)
                      return (
                        <Node
                          key={n ? `${e.key}\u0000${n}` : e.key}
                          name={e.key}
                          value={e.value}
                          path={[...path, e.key]}
                          level={level + 1}
                        />
                      )
                    })
                  })()
                : value.items
                    .slice(0, shown)
                    .map((v, i) => (
                      <Node key={i} name={i} value={v} path={[...path, i]} level={level + 1} />
                    ))}
              {count > shown && (
                <div className="flex flex-wrap items-center gap-1.5 py-1 pl-5 font-sans">
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + CHUNK)}
                    className="inline-flex h-7 items-center rounded-full bg-fill px-3 text-xs font-medium text-fg transition-colors hover:bg-fill-3"
                  >
                    再显示 {Math.min(CHUNK, count - shown)} 项
                  </button>
                  {count - shown <= 5000 && (
                    <button
                      type="button"
                      onClick={() => setLimit(Infinity)}
                      className="inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
                    >
                      全部显示
                    </button>
                  )}
                  <span className="text-[11px] text-fg-3">
                    已显示 {shown.toLocaleString()} / {count.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
            <div className="pl-5 text-fg-2">{r}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LeafRow({ name, value, path, level }: NodeProps & { value: Leaf }) {
  const { copyPath, copyValue } = useContext(Ctx)
  const [full, setFull] = useState(false)
  const quoted = value.type === 'string' ? quoteJsonString(value.value) : ''
  const cps = value.type === 'string' && quoted.length > LONG_STRING ? Array.from(quoted) : null
  const truncated = !!cps && cps.length > LONG_STRING && !full

  return (
    <div role="treeitem" aria-level={level + 1}>
      <Row path={path}>
        <span className="w-5 shrink-0" aria-hidden />
        <button
          type="button"
          onClick={() => copyPath(path)}
          title="点击复制 JSONPath"
          className="min-w-0 flex-1 cursor-pointer text-left [overflow-wrap:anywhere]"
        >
          <KeyLabel name={name} />
          {value.type === 'string' ? (
            <span className="text-warning">
              {HEX_COLOR.test(value.value) && (
                <span
                  aria-hidden
                  className="mr-1.5 inline-block size-3 rounded-[4px] border border-line align-[-1px]"
                  style={{ background: value.value }}
                />
              )}
              {truncated ? cps.slice(0, LONG_STRING).join('') + '…' : quoted}
            </span>
          ) : (
            <Primitive v={value} />
          )}
        </button>
        {cps && cps.length > LONG_STRING && (
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            className="mt-0.5 shrink-0 rounded-full bg-fill px-2 font-sans text-[11px] leading-5 text-fg-2 transition-colors hover:bg-fill-3 hover:text-fg"
          >
            {full ? '收起' : `全文 ${cps.length.toLocaleString()} 字`}
          </button>
        )}
        <CopyValueButton onClick={() => copyValue(value)} />
      </Row>
    </div>
  )
}

function Primitive({ v }: { v: Exclude<Leaf, { type: 'string' }> }) {
  switch (v.type) {
    case 'number':
      if (v.nonFinite)
        return (
          <span className="text-danger" title="标准 JSON 不支持，输出时已转为 null">
            {v.raw}
          </span>
        )
      return (
        <span className="text-accent">
          {v.raw}
          {isLossyNumber(v.raw) && (
            <span
              title="超出 JavaScript 数字精度，已按原文保留"
              className="ml-1.5 inline-block rounded-full bg-accent-soft px-1.5 align-[1px] font-sans text-[10px] leading-4 font-semibold text-accent"
            >
              大数
            </span>
          )}
        </span>
      )
    case 'boolean':
      return <span className="text-sys-purple">{v.value ? 'true' : 'false'}</span>
    case 'null':
      return <span className="text-fg-3 italic">null</span>
  }
}
