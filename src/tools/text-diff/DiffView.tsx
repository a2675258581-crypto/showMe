import { memo, useMemo, useState, type CSSProperties, type Ref } from 'react'
import { UnfoldVertical } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  foldUnchanged,
  type FoldItem,
  type Segment,
  type SplitRow,
  type UnifiedRow,
} from '@/lib/text-diff'

export type DiffViewMode = 'split' | 'unified'

/** 改动附近保留的上下文行数 */
const CONTEXT = 3
/** 一次最多渲染的行数，避免超大文本卡顿 */
const RENDER_STEP = 3000
const EMPTY = new Set<number>()

interface Props {
  /** 结果已过期（新结果还在计算）时淡化显示 */
  stale?: boolean
  view: DiffViewMode
  split: SplitRow[]
  unified: UnifiedRow[]
  collapse: boolean
  current: number
  scrollRef: Ref<HTMLDivElement>
  maxLineNo: number
}

type Item = { type: 'row'; index: number } | { type: 'fold'; start: number; end: number }

/** 差异结果：并排或行内，可折叠未改动的行 */
export function DiffView({
  stale,
  view,
  split,
  unified,
  collapse,
  current,
  scrollRef,
  maxLineNo,
}: Props) {
  const rows: (SplitRow | UnifiedRow)[] = view === 'split' ? split : unified

  // 展开的折叠块与渲染上限都跟随当前结果，结果一变就自动重置
  const [expandedState, setExpanded] = useState<{ rows: unknown; set: Set<number> }>({
    rows: null,
    set: EMPTY,
  })
  const expanded = expandedState.rows === rows ? expandedState.set : EMPTY
  const [limitState, setLimit] = useState<{ rows: unknown; n: number }>({ rows: null, n: 0 })
  const limit = limitState.rows === rows ? limitState.n : RENDER_STEP

  const items = useMemo<Item[]>(() => {
    const base: FoldItem[] = collapse
      ? foldUnchanged(
          rows.map((r) => r.block >= 0),
          CONTEXT,
          CONTEXT * 2,
        )
      : rows.map((_, index) => ({ type: 'row', index }))
    const out: Item[] = []
    for (const it of base) {
      if (it.type === 'fold' && expanded.has(it.start)) {
        for (let k = it.start; k < it.end; k++) out.push({ type: 'row', index: k })
      } else out.push(it)
    }
    return out
  }, [rows, collapse, expanded])

  const expand = (start: number) =>
    setExpanded((prev) => ({
      rows,
      set: new Set(prev.rows === rows ? prev.set : []).add(start),
    }))

  const numW = `${Math.max(2, String(maxLineNo).length) + 1.5}ch`
  const gridStyle: CSSProperties =
    view === 'split'
      ? { gridTemplateColumns: `${numW} minmax(0,1fr) ${numW} minmax(0,1fr)` }
      : { gridTemplateColumns: `${numW} ${numW} 1.5rem minmax(0,1fr)` }

  const blockStarts = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of rows.keys()) {
      const b = rows[r].block
      if (b >= 0 && !m.has(b)) m.set(b, r)
    }
    return new Set(m.values())
  }, [rows])

  // 用「上一处 / 下一处」跳到还没渲染出来的改动时，自动放宽渲染上限，保证能滚动到它
  const needed = useMemo(() => {
    if (current < 0) return 0
    const at = items.findIndex((it) => it.type === 'row' && rows[it.index].block === current)
    return at < 0 ? 0 : at + 200
  }, [items, rows, current])
  const shownCount = Math.max(limit, needed)
  const shown = items.slice(0, shownCount)

  return (
    <div
      ref={scrollRef}
      data-lenis-prevent
      aria-busy={stale || undefined}
      className={cn(
        'thin-scrollbar relative max-h-[72vh] min-h-40 overflow-auto font-mono text-[11.5px] leading-[1.65] transition-opacity duration-200 sm:text-[12.5px]',
        stale && 'opacity-60',
      )}
    >
      {view === 'split' && (
        <div
          className="glass sticky top-0 z-10 grid border-b border-line text-[11px] font-semibold text-fg-2"
          style={gridStyle}
        >
          <div className="col-span-2 px-3 py-2 font-sans">原文</div>
          <div className="col-span-2 border-l border-line px-3 py-2 font-sans">修改后</div>
        </div>
      )}
      {shown.map((it) =>
        it.type === 'fold' ? (
          <button
            key={`f${it.start}`}
            type="button"
            onClick={() => expand(it.start)}
            className="flex w-full items-center justify-center gap-2 border-y border-line bg-fill-2 py-1.5 font-sans text-xs text-fg-2 transition-colors hover:bg-fill hover:text-fg"
          >
            <UnfoldVertical className="size-3.5" />
            展开 {(it.end - it.start).toLocaleString()} 行未改动的内容
          </button>
        ) : view === 'split' ? (
          <SplitLine
            key={it.index}
            row={split[it.index]}
            style={gridStyle}
            active={split[it.index].block === current && current >= 0}
            start={blockStarts.has(it.index) ? split[it.index].block : undefined}
          />
        ) : (
          <UnifiedLine
            key={it.index}
            row={unified[it.index]}
            style={gridStyle}
            active={unified[it.index].block === current && current >= 0}
            start={blockStarts.has(it.index) ? unified[it.index].block : undefined}
          />
        ),
      )}
      {items.length > shownCount && (
        <div className="flex items-center justify-center gap-3 border-t border-line py-3 font-sans text-xs text-fg-2">
          还有 {(items.length - shownCount).toLocaleString()} 行未显示
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLimit({ rows, n: shownCount + RENDER_STEP })}
          >
            继续显示
          </Button>
        </div>
      )}
    </div>
  )
}

function Segments({ segments, tone }: { segments: Segment[]; tone: 'del' | 'add' }) {
  if (!segments.length) return <>{'​'}</>
  return (
    <>
      {segments.map((s, i) =>
        s.changed ? (
          <mark
            key={i}
            className={cn(
              'rounded-[3px] text-inherit',
              tone === 'del'
                ? 'bg-sys-red/30 dark:bg-sys-red/40'
                : 'bg-sys-green/35 dark:bg-sys-green/40',
            )}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

const numCls = 'select-none px-2 text-right text-fg-3 tabular-nums'
const textCls = 'min-w-0 whitespace-pre-wrap px-3 text-fg [overflow-wrap:anywhere]'

const SplitLine = memo(function SplitLine({
  row,
  style,
  active,
  start,
}: {
  row: SplitRow
  style: CSSProperties
  active: boolean
  start?: number
}) {
  const leftTone = row.left && (row.kind === 'removed' || row.kind === 'changed')
  const rightTone = row.right && (row.kind === 'added' || row.kind === 'changed')
  return (
    <div
      className={cn('grid transition-shadow', active && 'shadow-[inset_3px_0_0_var(--accent)]')}
      style={style}
      data-block-start={start}
    >
      <div className={cn(numCls, leftTone && 'bg-sys-red/15', !row.left && 'bg-fill-2')}>
        {row.left?.no ?? ''}
      </div>
      <div className={cn(textCls, leftTone && 'bg-sys-red/8', !row.left && 'bg-fill-2')}>
        {row.left ? <Segments segments={row.left.segments} tone="del" /> : null}
      </div>
      <div
        className={cn(
          numCls,
          'border-l border-line',
          rightTone && 'bg-sys-green/15',
          !row.right && 'bg-fill-2',
        )}
      >
        {row.right?.no ?? ''}
      </div>
      <div className={cn(textCls, rightTone && 'bg-sys-green/10', !row.right && 'bg-fill-2')}>
        {row.right ? <Segments segments={row.right.segments} tone="add" /> : null}
      </div>
    </div>
  )
})

const UnifiedLine = memo(function UnifiedLine({
  row,
  style,
  active,
  start,
}: {
  row: UnifiedRow
  style: CSSProperties
  active: boolean
  start?: number
}) {
  const del = row.kind === 'removed'
  const add = row.kind === 'added'
  return (
    <div
      className={cn(
        'grid transition-shadow',
        del && 'bg-sys-red/8',
        add && 'bg-sys-green/10',
        active && 'shadow-[inset_3px_0_0_var(--accent)]',
      )}
      style={style}
      data-block-start={start}
    >
      <div className={cn(numCls, del && 'bg-sys-red/10', add && 'bg-sys-green/10')}>
        {row.oldNo ?? ''}
      </div>
      <div className={cn(numCls, del && 'bg-sys-red/10', add && 'bg-sys-green/10')}>
        {row.newNo ?? ''}
      </div>
      <div
        className={cn(
          'select-none text-center font-semibold',
          del ? 'text-danger' : add ? 'text-success' : 'text-fg-3',
        )}
        aria-hidden
      >
        {del ? '−' : add ? '+' : ''}
      </div>
      <div className={textCls}>
        <Segments segments={row.segments} tone={del ? 'del' : 'add'} />
      </div>
    </div>
  )
})
