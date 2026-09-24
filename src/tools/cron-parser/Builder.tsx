import { motion } from 'motion/react'
import { Wand2 } from 'lucide-react'
import { Input, Panel, PanelHeader, SegmentedControl, Select, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  FIELD_ORDER,
  FIELD_SPECS,
  WEEK_ZH,
  builderRange,
  type BuilderMode,
  type FieldBuilder,
  type FieldKey,
} from '@/lib/cron-parser'

const MODE_OPTIONS: { value: BuilderMode; label: string }[] = [
  { value: 'every', label: '任意' },
  { value: 'step', label: '间隔' },
  { value: 'range', label: '范围' },
  { value: 'specific', label: '指定' },
  { value: 'custom', label: '自定义' },
]

const UNIT: Record<FieldKey, string> = {
  second: '秒',
  minute: '分钟',
  hour: '小时',
  dayOfMonth: '天',
  month: '个月',
  dayOfWeek: '天',
}

const EVERY_TEXT: Record<FieldKey, string> = {
  second: '每一秒都匹配',
  minute: '每一分钟都匹配',
  hour: '每个小时都匹配',
  dayOfMonth: '每一天都匹配',
  month: '每个月都匹配',
  dayOfWeek: '不限星期几',
}

export function valueLabel(key: FieldKey, n: number): string {
  switch (key) {
    case 'hour':
      return `${n} 点`
    case 'dayOfMonth':
      return `${n} 号`
    case 'month':
      return `${n} 月`
    case 'dayOfWeek':
      return WEEK_ZH[n % 7]
    default:
      return String(n)
  }
}

function options(key: FieldKey) {
  const { min, max } = builderRange(key)
  return Array.from({ length: max - min + 1 }, (_, i) => ({
    value: String(min + i),
    label: valueLabel(key, min + i),
  }))
}

interface Props {
  builders: Record<FieldKey, FieldBuilder>
  modes: Record<FieldKey, BuilderMode>
  tokens: Record<FieldKey, string>
  withSeconds: boolean
  onSeconds: (v: boolean) => void
  onMode: (key: FieldKey, mode: BuilderMode) => void
  onChange: (key: FieldKey, b: FieldBuilder) => void
  disabled?: boolean
}

/** 逐字段的可视化构建器 */
export function Builder({
  builders,
  modes,
  tokens,
  withSeconds,
  onSeconds,
  onMode,
  onChange,
  disabled,
}: Props) {
  const keys = withSeconds ? FIELD_ORDER : FIELD_ORDER.slice(1)
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Wand2 className="size-4 text-accent" />
            可视化构建
          </span>
        }
      >
        <Switch
          checked={withSeconds}
          onChange={onSeconds}
          label={<span className="text-[13px] text-fg-2">包含秒（6 段）</span>}
        />
      </PanelHeader>
      <div className={cn('transition-opacity', disabled && 'pointer-events-none opacity-50')}>
        {keys.map((key) => {
          const spec = FIELD_SPECS[key]
          const b = builders[key]
          const mode = modes[key]
          const { min, max } = builderRange(key)
          const set = (patch: Partial<FieldBuilder>) => onChange(key, { ...b, ...patch, mode })
          return (
            <div
              key={key}
              className="grid gap-3 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
            >
              <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
                <span className="text-sm font-semibold text-fg">{spec.name}</span>
                <code className="rounded-md bg-fill px-1.5 py-0.5 font-mono text-[12px] text-accent">
                  {tokens[key]}
                </code>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <SegmentedControl
                  options={MODE_OPTIONS}
                  value={mode}
                  onChange={(m) => onMode(key, m)}
                  size="sm"
                  className="self-start"
                  aria-label={`${spec.name}的取值方式`}
                />
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2"
                >
                  {mode === 'every' && <span className="text-fg-3">{EVERY_TEXT[key]}</span>}
                  {mode === 'step' && (
                    <>
                      从
                      <Select
                        value={String(b.start)}
                        onChange={(v) => set({ start: Number(v) })}
                        options={options(key)}
                        size="sm"
                        aria-label={`${spec.name}起始值`}
                      />
                      开始，每隔
                      <Input
                        type="number"
                        min={1}
                        max={max - min + 1}
                        value={b.step}
                        onChange={(e) => {
                          const n = Math.max(1, Math.floor(Number(e.target.value) || 1))
                          set({ step: n })
                        }}
                        className="w-20 text-center"
                        style={{ height: 32 }}
                        aria-label={`${spec.name}间隔`}
                      />
                      {UNIT[key]}
                    </>
                  )}
                  {mode === 'range' && (
                    <>
                      从
                      <Select
                        value={String(b.from)}
                        onChange={(v) => set({ from: Number(v) })}
                        options={options(key)}
                        size="sm"
                        aria-label={`${spec.name}范围起点`}
                      />
                      到
                      <Select
                        value={String(b.to)}
                        onChange={(v) => set({ to: Number(v) })}
                        options={options(key)}
                        size="sm"
                        aria-label={`${spec.name}范围终点`}
                      />
                    </>
                  )}
                  {mode === 'specific' && (
                    <div
                      className={cn(
                        'grid w-full gap-1',
                        max - min + 1 > 31
                          ? 'grid-cols-8 sm:grid-cols-12'
                          : max - min + 1 > 12
                            ? 'grid-cols-7 sm:grid-cols-11'
                            : 'grid-cols-4 sm:grid-cols-7',
                      )}
                      role="group"
                      aria-label={`选择${spec.name}`}
                    >
                      {Array.from({ length: max - min + 1 }, (_, i) => {
                        const n = min + i
                        const on = b.values.includes(n)
                        return (
                          <motion.button
                            key={n}
                            type="button"
                            whileTap={{ scale: 0.9 }}
                            aria-pressed={on}
                            onClick={() => {
                              const values = on ? b.values.filter((x) => x !== n) : [...b.values, n]
                              set({ values: values.length ? values : [n] })
                            }}
                            className={cn(
                              'h-7 rounded-lg font-mono text-[11px] font-medium transition-colors',
                              on ? 'bg-accent text-white' : 'bg-fill text-fg-2 hover:bg-fill-3',
                            )}
                          >
                            {key === 'month' || key === 'dayOfWeek' ? valueLabel(key, n) : n}
                          </motion.button>
                        )
                      })}
                    </div>
                  )}
                  {mode === 'custom' && (
                    <Input
                      value={b.custom}
                      onChange={(e) => set({ custom: e.target.value })}
                      mono
                      className="max-w-xs"
                      style={{ height: 32 }}
                      placeholder={key === 'dayOfWeek' ? '如 1-5、5L、1#2' : '如 1,15,30 或 1-10/2'}
                      aria-label={`${spec.name}自定义表达式`}
                    />
                  )}
                </motion.div>
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
