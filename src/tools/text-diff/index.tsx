import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Columns2,
  FileDown,
  FolderOpen,
  Rows2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EditorPane } from '@/components/editor/IOPanel'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Kbd,
  Notice,
  SegmentedControl,
  Switch,
  useToast,
  type SegmentOption,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useHotkey } from '@/hooks/useHotkey'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { readClipboard } from '@/lib/clipboard'
import { downloadText } from '@/lib/file'
import { createUnifiedPatch, type DiffGranularity } from '@/lib/text-diff'
import { AnimatedNumber } from './AnimatedNumber'
import { DiffView, type DiffViewMode } from './DiffView'
import { SAMPLE_NEW, SAMPLE_OLD } from './samples'
import { useDiffRunner, type DiffInput } from './useDiffRunner'

interface Options {
  granularity: DiffGranularity
  view: DiffViewMode
  ignoreWhitespace: boolean
  ignoreCase: boolean
  collapse: boolean
}

/** 手机上并排两栏太窄：没选过视图时默认用行内视图 */
const NARROW =
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches === true

const DEFAULTS: Options = {
  granularity: 'word',
  view: NARROW ? 'unified' : 'split',
  ignoreWhitespace: false,
  ignoreCase: false,
  collapse: true,
}

function sanitize(raw: unknown): Options {
  const o: Options = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (!['line', 'word', 'char'].includes(o.granularity)) o.granularity = DEFAULTS.granularity
  if (o.view !== 'split' && o.view !== 'unified') o.view = DEFAULTS.view
  for (const k of ['ignoreWhitespace', 'ignoreCase', 'collapse'] as const) {
    if (typeof o[k] !== 'boolean') o[k] = DEFAULTS[k]
  }
  return o
}

const GRANULARITIES: SegmentOption<DiffGranularity>[] = [
  { value: 'line', label: '行', title: '只标出改动的行' },
  { value: 'word', label: '单词', title: '在改动的行内标出变化的单词' },
  { value: 'char', label: '字符', title: '在改动的行内标出变化的字符' },
]

const VIEWS: SegmentOption<DiffViewMode>[] = [
  {
    value: 'split',
    label: (
      <>
        <Columns2 />
        并排
      </>
    ),
  },
  {
    value: 'unified',
    label: (
      <>
        <Rows2 />
        行内
      </>
    ),
  },
]

const EDITOR_HEIGHT = 'clamp(200px, 34vh, 380px)'
/** 两侧合计超过这个长度才防抖 */
const INSTANT_LIMIT = 40_000

/** 读入的文件 / 剪贴板统一成 \n 换行（编辑器内部也是这样存的） */
const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n')

const lineCount = (s: string) => (s ? s.split('\n').length : 0)

export default function TextDiff() {
  const toast = useToast()
  const [stored, setStored] = useLocalStorage<Partial<Options>>('text-diff.options.v1', {})
  const o = useMemo(() => sanitize(stored), [stored])
  const patch = useCallback(
    (p: Partial<Options>) => setStored((prev) => ({ ...sanitize(prev), ...p })),
    [setStored],
  )

  const [left, setLeft] = useState(SAMPLE_OLD)
  const [right, setRight] = useState(SAMPLE_NEW)
  const [spin, setSpin] = useState(0)

  const pair = useMemo(() => ({ left, right }), [left, right])
  const debounced = useDebounced(pair, 300)
  const src = left.length + right.length <= INSTANT_LIMIT ? pair : debounced
  const { granularity, ignoreWhitespace, ignoreCase } = o
  const req = useMemo<DiffInput>(
    () => ({
      left: src.left,
      right: src.right,
      opts: { granularity, ignoreWhitespace, ignoreCase },
    }),
    [src, granularity, ignoreWhitespace, ignoreCase],
  )
  const { result, pending } = useDiffRunner(req)
  // Worker 通常几毫秒就返回：超过 200ms 还没结果才提示「计算中」，避免每次按键都闪
  const [slowFor, setSlowFor] = useState<DiffInput | null>(null)
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => setSlowFor(req), 200)
    return () => clearTimeout(t)
  }, [pending, req])
  const busy = src !== pair || (pending && slowFor === req)
  const ok = result.ok ? result : null
  const blocks = ok?.blocks ?? []
  const empty = !src.left && !src.right

  // 当前定位到的差异块（跟随结果重置）
  const [cur, setCur] = useState<{ result: unknown; i: number }>({ result: null, i: -1 })
  const current = cur.result === result ? cur.i : -1
  const scrollRef = useRef<HTMLDivElement>(null)

  const goTo = (i: number) => {
    if (!blocks.length) return
    const n = ((i % blocks.length) + blocks.length) % blocks.length
    setCur({ result, i: n })
    // 等渲染更新后再滚动
    requestAnimationFrame(() => {
      const box = scrollRef.current
      const el = box?.querySelector<HTMLElement>(`[data-block-start="${n}"]`)
      if (!box || !el) return
      box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight / 3), behavior: 'smooth' })
      const rect = box.getBoundingClientRect()
      if (rect.top < 64 || rect.top > window.innerHeight * 0.6) {
        window.scrollBy({ top: rect.top - 140, behavior: 'smooth' })
      }
    })
  }
  const next = () => goTo(current + 1)
  const prev = () => goTo(current < 0 ? blocks.length - 1 : current - 1)

  useHotkey('f7', (e) => {
    e.preventDefault()
    next()
  })
  useHotkey('shift+f7', (e) => {
    e.preventDefault()
    prev()
  })

  const swap = () => {
    setSpin((s) => s + 180)
    setLeft(right)
    setRight(left)
  }

  const loadSample = () => {
    setLeft(SAMPLE_OLD)
    setRight(SAMPLE_NEW)
  }

  // 补丁总是逐字生成（忽略选项只影响显示），保证能用 git apply / patch 应用回原文
  const makePatch = () => createUnifiedPatch(left, right)
  const noPatch = left === right

  const downloadPatch = () => {
    downloadText('changes.patch', makePatch(), 'text/x-diff;charset=utf-8')
    toast('已下载 changes.patch', 'success')
  }

  const paneActions = (setter: (v: string) => void, value: string) => (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<ClipboardPaste />}
        iconOnly
        title="粘贴"
        aria-label="粘贴"
        onClick={async () => {
          const t = await readClipboard()
          if (t === null) toast('无法读取剪贴板，请直接在编辑器里粘贴', 'error')
          else setter(normalizeEol(t))
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<FolderOpen />}
        iconOnly
        title="打开文件"
        aria-label="打开文件"
        onClick={() => {
          const el = document.createElement('input')
          el.type = 'file'
          el.onchange = async () => {
            const f = el.files?.[0]
            if (f) setter(normalizeEol(await f.text()))
          }
          el.click()
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 />}
        iconOnly
        title="清空"
        aria-label="清空"
        disabled={!value}
        onClick={() => setter('')}
      />
    </>
  )

  const maxLineNo = Math.max(ok?.stats.oldLines ?? 0, ok?.stats.newLines ?? 0)
  const ignoredNote = [ignoreWhitespace && '忽略空白', ignoreCase && '忽略大小写'].filter(Boolean)

  return (
    <div className="flex flex-col gap-4">
      {/* 输入 */}
      <div className="relative grid gap-4 lg:grid-cols-2">
        <EditorPane
          title="原文"
          height={EDITOR_HEIGHT}
          onDropFile={async (f) => setLeft(normalizeEol(await f.text()))}
          actions={
            <>
              <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={loadSample}>
                示例
              </Button>
              {paneActions(setLeft, left)}
            </>
          }
          footer={
            <>
              <span>{left.length.toLocaleString()} 字符</span>
              <span>{lineCount(left).toLocaleString()} 行</span>
            </>
          }
        >
          <CodeEditor
            value={left}
            onChange={setLeft}
            placeholder="粘贴原始文本…"
            aria-label="原文"
          />
        </EditorPane>

        <motion.button
          type="button"
          aria-label="交换左右文本"
          title="交换左右文本"
          onClick={swap}
          animate={{ rotate: spin }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          className="glass absolute top-1/2 left-1/2 z-10 hidden size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line text-fg shadow-float lg:flex"
        >
          <ArrowLeftRight className="size-4" />
        </motion.button>

        <EditorPane
          title="修改后"
          height={EDITOR_HEIGHT}
          onDropFile={async (f) => setRight(normalizeEol(await f.text()))}
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowLeftRight />}
                onClick={swap}
                className="lg:hidden"
              >
                交换
              </Button>
              {paneActions(setRight, right)}
            </>
          }
          footer={
            <>
              <span>{right.length.toLocaleString()} 字符</span>
              <span>{lineCount(right).toLocaleString()} 行</span>
            </>
          }
        >
          <CodeEditor
            value={right}
            onChange={setRight}
            placeholder="粘贴修改后的文本…"
            aria-label="修改后"
          />
        </EditorPane>
      </div>

      {/* 选项 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card">
        <Labeled label="粒度">
          <SegmentedControl
            options={GRANULARITIES}
            value={o.granularity}
            onChange={(v) => patch({ granularity: v })}
            size="sm"
            aria-label="对比粒度"
          />
        </Labeled>
        <Labeled label="视图">
          <SegmentedControl
            options={VIEWS}
            value={o.view}
            onChange={(v) => patch({ view: v })}
            size="sm"
            aria-label="视图"
          />
        </Labeled>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Switch
            checked={o.ignoreWhitespace}
            onChange={(v) => patch({ ignoreWhitespace: v })}
            label="忽略空白"
          />
          <Switch
            checked={o.ignoreCase}
            onChange={(v) => patch({ ignoreCase: v })}
            label="忽略大小写"
          />
          <Switch
            checked={o.collapse}
            onChange={(v) => patch({ collapse: v })}
            label="折叠未改动"
          />
        </div>
      </div>

      {/* 结果 */}
      <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-baseline gap-3 font-semibold tabular-nums">
              <span className="text-lg text-success">
                +<AnimatedNumber value={ok?.stats.added ?? 0} />
              </span>
              <span className="text-lg text-danger">
                −<AnimatedNumber value={ok?.stats.removed ?? 0} />
              </span>
              <span className="text-xs font-medium text-fg-3">{ok?.stats.unit ?? '行'}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-fg-2">相似度</span>
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-fill sm:w-32">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  initial={false}
                  animate={{ width: `${(ok?.stats.similarity ?? 0) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 160, damping: 26 }}
                />
              </div>
              <AnimatedNumber
                value={(ok?.stats.similarity ?? 0) * 100}
                format={fmtPct}
                className="min-w-12 text-sm font-semibold text-fg"
              />
            </div>
            {ok && !ok.stats.identical && (
              <span className="text-xs text-fg-3">
                {ok.stats.linesRemoved} 行删除 · {ok.stats.linesAdded} 行新增 · {blocks.length}{' '}
                处改动
              </span>
            )}
            {busy && <span className="text-xs text-fg-3">计算中…</span>}
          </div>

          <div className="flex items-center gap-1">
            <div className="mr-1 flex items-center gap-0.5 rounded-full bg-fill p-0.5">
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<ChevronUp />}
                onClick={prev}
                disabled={!blocks.length}
                title="上一处改动（Shift+F7）"
                aria-label="上一处改动"
                className="h-7 w-7"
              />
              <span className="min-w-12 text-center text-xs font-medium text-fg-2 tabular-nums">
                {blocks.length ? `${current >= 0 ? current + 1 : '–'} / ${blocks.length}` : '0 / 0'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<ChevronDown />}
                onClick={next}
                disabled={!blocks.length}
                title="下一处改动（F7）"
                aria-label="下一处改动"
                className="h-7 w-7"
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<FileDown />}
              onClick={downloadPatch}
              disabled={noPatch}
              title="下载统一格式（unified diff）补丁，可用 git apply / patch 应用；补丁逐字记录全部改动，不受忽略选项影响"
              aria-label="下载 .patch 补丁"
            >
              .patch
            </Button>
            <CopyButton
              text={makePatch}
              label="复制补丁"
              iconOnly
              variant="ghost"
              disabled={noPatch}
            />
          </div>
        </div>

        {!result.ok ? (
          <div className="p-4">
            <ErrorNotice error={result.error} />
          </div>
        ) : empty ? (
          <div className="px-6 py-16 text-center text-sm text-fg-3">
            在上方输入两段文本，差异会实时显示在这里
          </div>
        ) : (
          <>
            {result.stats.identical && (
              <div className="p-4 pb-3">
                <Notice tone="success">
                  两段文本完全相同{ignoredNote.length ? `（已${ignoredNote.join('、')}）` : ''}
                </Notice>
              </div>
            )}
            <DiffView
              stale={busy}
              view={o.view}
              split={result.split}
              unified={result.unified}
              collapse={o.collapse}
              current={current}
              scrollRef={scrollRef}
              maxLineNo={maxLineNo}
            />
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[11px] text-fg-3">
          <span className="flex items-center gap-3">
            <Legend className="bg-sys-red/30">删除</Legend>
            <Legend className="bg-sys-green/35">新增</Legend>
          </span>
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Kbd>F7</Kbd> 下一处 · <Kbd>Shift</Kbd>
            <Kbd>F7</Kbd> 上一处
          </span>
        </div>
      </div>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-fg-2">{label}</span>
      {children}
    </div>
  )
}

function Legend({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-2.5 rounded-sm ${className}`} aria-hidden />
      {children}
    </span>
  )
}

function fmtPct(v: number) {
  return `${v.toFixed(v >= 99.95 || v < 0.05 ? 0 : 1)}%`
}
