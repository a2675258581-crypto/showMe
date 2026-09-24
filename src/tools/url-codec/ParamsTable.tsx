import { useId } from 'react'
import { AnimatePresence, Reorder, useDragControls } from 'motion/react'
import { GripVertical, X } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { serializeParam, type QueryParam } from '@/lib/url-codec'

export interface ParamRowData extends QueryParam {
  id: string
}

interface Props {
  rows: ParamRowData[]
  onChange: (rows: ParamRowData[]) => void
  spaceAsPlus: boolean
  showEncoded: boolean
}

/** 可编辑、可拖动排序的查询参数表（值以解码后的形式显示） */
export function ParamsTable({ rows, onChange, spaceAsPlus, showEncoded }: Props) {
  const prefix = useId()
  const gripId = (id: string) => `${prefix}-grip-${id}`

  const move = (id: string, delta: number) => {
    const i = rows.findIndex((r) => r.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= rows.length) return
    const next = rows.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
    // DOM 节点被移动后焦点会丢失，挪完再把焦点放回把手上
    requestAnimationFrame(() => document.getElementById(gripId(id))?.focus())
  }

  const patch = (id: string, p: Partial<QueryParam>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p, raw: null } : r)))

  return (
    <Reorder.Group
      as="ul"
      axis="y"
      values={rows}
      onReorder={onChange}
      className="flex flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {rows.map((row, index) => (
          <ParamRow
            key={row.id}
            row={row}
            index={index}
            gripId={gripId(row.id)}
            encoded={showEncoded ? serializeParam(row, spaceAsPlus) : null}
            onPatch={(p) => patch(row.id, p)}
            onRemove={() => onChange(rows.filter((r) => r.id !== row.id))}
            onMove={(d) => move(row.id, d)}
          />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  )
}

interface RowProps {
  row: ParamRowData
  index: number
  gripId: string
  encoded: string | null
  onPatch: (p: Partial<QueryParam>) => void
  onRemove: () => void
  onMove: (delta: number) => void
}

function ParamRow({ row, index, gripId, encoded, onPatch, onRemove, onMove }: RowProps) {
  const controls = useDragControls()
  const n = index + 1
  return (
    <Reorder.Item
      as="li"
      value={row}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
      whileDrag={{ scale: 1.015 }}
      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
      className="relative flex items-start gap-1.5 rounded-2xl border border-line bg-surface-2 p-2 sm:gap-2"
    >
      <button
        id={gripId}
        type="button"
        aria-label={`第 ${n} 个参数：拖动或按 ↑ ↓ 调整顺序`}
        title="拖动排序（也可聚焦后按 ↑ ↓）"
        onPointerDown={(e) => {
          e.preventDefault()
          controls.start(e)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onMove(e.key === 'ArrowUp' ? -1 : 1)
          }
        }}
        className="mt-0.5 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-2">
        <Input
          mono
          value={row.key}
          onChange={(e) => onPatch({ key: e.target.value })}
          placeholder="参数名"
          aria-label={`第 ${n} 个参数名`}
          className="h-9"
        />
        <Input
          mono
          value={row.value}
          onChange={(e) => onPatch({ value: e.target.value, hasValue: true })}
          placeholder={row.hasValue ? '值' : '（无值的标志参数）'}
          aria-label={`第 ${n} 个参数值`}
          className="h-9"
        />
        {encoded !== null && (
          <code className="px-1 font-mono text-[11px] break-all text-fg-3 sm:col-span-2">
            {encoded || '（空）'}
          </code>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon={<X />}
        aria-label={`删除第 ${n} 个参数`}
        title="删除"
        onClick={onRemove}
        className="mt-0.5"
      />
    </Reorder.Item>
  )
}
