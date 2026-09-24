import { Reorder, useDragControls } from 'motion/react'
import { GripVertical, Trash2 } from 'lucide-react'
import { Button, Input, Select, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  FIELD_TYPES,
  FIELD_TYPE_MAP,
  type Cell,
  type FieldDef,
  type FieldType,
  type OptionSpec,
  type OptionValue,
} from '@/lib/mock-data'

const GROUPS = Array.from(new Set(FIELD_TYPES.map((t) => t.group)))

interface Props {
  field: FieldDef
  index: number
  sample: Cell | undefined
  canRemove: boolean
  onChange: (next: FieldDef) => void
  onTypeChange: (type: FieldType) => void
  onRemove: () => void
  /** 键盘排序：-1 上移、1 下移 */
  onMove: (delta: -1 | 1) => void
}

/** 字段行：拖动把手 + 名称 + 类型 + 类型专属选项 + 示例值 */
export function FieldRow({
  field,
  index,
  sample,
  canRemove,
  onChange,
  onTypeChange,
  onRemove,
  onMove,
}: Props) {
  const controls = useDragControls()
  const meta = FIELD_TYPE_MAP[field.type]
  const opts = field.options ?? {}
  const setOpt = (key: string, value: OptionValue) =>
    onChange({ ...field, options: { ...opts, [key]: value } })

  const visible = meta.options.filter(
    (s) => !s.when || (opts[s.when.key] ?? defaultOf(meta.options, s.when.key)) === s.when.equals,
  )

  return (
    <Reorder.Item
      value={field}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      whileDrag={{ scale: 1.015, boxShadow: 'var(--shadow-float)', zIndex: 10 }}
      className="relative flex list-none flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3 sm:p-3.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={`调整顺序：${field.name || `第 ${index + 1} 个字段`}（拖动，或按 ↑ ↓ 键移动）`}
          title="拖动排序（也可聚焦后按 ↑ ↓ 键）"
          onPointerDown={(e) => {
            e.preventDefault()
            controls.start(e)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            e.preventDefault()
            onMove(e.key === 'ArrowUp' ? -1 : 1)
          }}
          className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <Input
          value={field.name}
          onChange={(e) => onChange({ ...field, name: e.target.value })}
          placeholder={`field_${index + 1}`}
          aria-label="字段名"
          mono
          className="h-9 min-w-0 flex-1 sm:max-w-48"
        />
        <div className="hidden shrink-0 sm:block">
          <TypeSelect value={field.type} onChange={onTypeChange} />
        </div>
        <div className="hidden min-w-0 flex-1 items-center sm:flex">
          <SampleValue value={sample} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<Trash2 />}
          aria-label={`删除字段 ${field.name}`}
          title="删除字段"
          disabled={!canRemove}
          onClick={onRemove}
          className="hover:text-danger"
        />
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 pl-8',
          visible.length === 0 && 'sm:hidden',
        )}
      >
        <div className="sm:hidden">
          <TypeSelect value={field.type} onChange={onTypeChange} />
        </div>
        {visible.map((spec) => (
          <OptionControl
            key={spec.key}
            spec={spec}
            value={opts[spec.key]}
            onChange={(v) => setOpt(spec.key, v)}
          />
        ))}
        <div className="w-full min-w-0 sm:hidden">
          <SampleValue value={sample} />
        </div>
      </div>
    </Reorder.Item>
  )
}

function defaultOf(specs: OptionSpec[], key: string): OptionValue | undefined {
  return specs.find((s) => s.key === key)?.default
}

function SampleValue({ value }: { value: Cell | undefined }) {
  if (value === undefined) return null
  const text = value === null ? 'null' : String(value)
  return (
    <span
      className="block min-w-0 truncate font-mono text-xs text-fg-3"
      title={text}
      aria-label={`示例值：${text}`}
    >
      {text}
    </span>
  )
}

/** 按分组列出字段类型（共享 Select 的 optgroup 分组） */
const TYPE_GROUPS = GROUPS.map((g) => ({
  label: g,
  options: FIELD_TYPES.filter((t) => t.group === g).map((t) => ({ value: t.type, label: t.label })),
}))

function TypeSelect({
  value,
  onChange,
  className,
}: {
  value: FieldType
  onChange: (t: FieldType) => void
  className?: string
}) {
  return (
    <Select
      value={value}
      groups={TYPE_GROUPS}
      onChange={(v) => onChange(v as FieldType)}
      aria-label="字段类型"
      className={cn('w-full shrink-0 sm:w-40', className)}
    />
  )
}

function OptionControl({
  spec,
  value,
  onChange,
}: {
  spec: OptionSpec
  value: OptionValue | undefined
  onChange: (v: OptionValue) => void
}) {
  const label = <span className="shrink-0 text-xs font-medium text-fg-2">{spec.label}</span>
  switch (spec.kind) {
    case 'select':
      return (
        <label className="flex items-center gap-1.5">
          {label}
          <Select
            size="sm"
            value={typeof value === 'string' ? value : spec.default}
            onChange={onChange}
            options={spec.choices}
            aria-label={spec.label}
          />
        </label>
      )
    case 'switch':
      return (
        <Switch
          checked={typeof value === 'boolean' ? value : spec.default}
          onChange={onChange}
          label={<span className="text-xs font-medium text-fg-2">{spec.label}</span>}
          className="[&>button]:scale-90"
        />
      )
    case 'number':
      return (
        <label className="flex items-center gap-1.5">
          {label}
          <Input
            type="number"
            inputMode="decimal"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={value === undefined ? spec.default : String(value)}
            onChange={(e) => onChange(e.target.value)}
            aria-label={spec.label}
            mono
            className="h-8 w-24 px-2.5"
          />
        </label>
      )
    case 'text':
      return (
        <label
          className={cn(
            'flex min-w-0 items-center gap-1.5',
            spec.wide && 'w-full sm:w-auto sm:flex-1',
          )}
        >
          {label}
          <Input
            value={typeof value === 'string' ? value : String(value ?? spec.default)}
            placeholder={spec.placeholder}
            onChange={(e) => onChange(e.target.value)}
            aria-label={spec.label}
            mono
            className={cn('h-8 px-2.5', spec.wide ? 'min-w-0 flex-1' : 'w-44')}
          />
        </label>
      )
  }
}
