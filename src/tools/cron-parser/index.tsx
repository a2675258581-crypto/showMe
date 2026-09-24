import { useMemo, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Timer, X } from 'lucide-react'
import { Badge, CopyButton, ErrorNotice, Input, Notice, Panel } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import {
  CRON_PRESETS,
  FIELD_ORDER,
  FIELD_SPECS,
  analyzeCron,
  builderRange,
  builderToToken,
  normalizeCron,
  tokenToBuilder,
  type BuilderMode,
  type FieldBuilder,
  type FieldKey,
  type NormalizedCron,
} from '@/lib/cron-parser'
import {
  formatDateTime,
  formatRelative,
  normalizeTimeZone,
  zonedParts,
  WEEKDAY_ZH,
} from '@/lib/timestamp'
import { useNow } from '@/tools/timestamp/useNow'
import { Builder } from './Builder'
import { FieldTable } from './FieldTable'
import { RunsList } from './RunsList'

const DEFAULT_EXPR = '0 9 * * 1-5'
const MAX_RUNS = 50

/** 切换到「范围」时的默认值 */
const RANGE_DEFAULT: Record<FieldKey, [number, number]> = {
  second: [0, 30],
  minute: [0, 30],
  hour: [9, 18],
  dayOfMonth: [1, 15],
  month: [1, 6],
  dayOfWeek: [1, 5],
}

interface Options {
  tz: string
}
const DEFAULTS: Options = { tz: 'Asia/Shanghai' }

function initialNormalized(): NormalizedCron {
  const n = normalizeCron(DEFAULT_EXPR)
  if (!n.ok) throw new Error(n.error)
  return n.value
}

export default function CronParser() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('cron-parser.options.v1', DEFAULTS)
  const tz = normalizeTimeZone(stored && typeof stored.tz === 'string' ? stored.tz : DEFAULTS.tz)

  const [expr, setExpr] = useState(DEFAULT_EXPR)
  const [lastValid, setLastValid] = useState<NormalizedCron>(initialNormalized)
  const [modes, setModes] = useState<Partial<Record<FieldKey, BuilderMode>>>({})
  const [drafts, setDrafts] = useState<Partial<Record<FieldKey, string>>>({})
  const [count, setCount] = useState(10)
  const [hovered, setHovered] = useState<FieldKey | null>(null)

  const debounced = useDebounced(expr, 150)
  const now = useNow(1000)
  const result = useMemo(
    () => analyzeCron(debounced, { tz, from: now, count }),
    [debounced, tz, now, count],
  )
  const analysis = result.ok ? result.value : null
  const error = !result.ok && debounced === expr && expr.trim() ? result.error : null

  /** 更新表达式文本，并在合法时同步构建器 */
  const apply = (text: string) => {
    setExpr(text)
    const n = normalizeCron(text)
    if (n.ok) setLastValid(n.value)
  }

  const typeExpr = (text: string) => {
    setModes({})
    setDrafts({})
    apply(text)
  }

  const derived = useMemo(
    () =>
      Object.fromEntries(
        FIELD_ORDER.map((k) => [k, tokenToBuilder(lastValid.fields[k], k)]),
      ) as Record<FieldKey, FieldBuilder>,
    [lastValid],
  )
  const tokens = Object.fromEntries(
    FIELD_ORDER.map((k) => [k, drafts[k] ?? lastValid.fields[k]]),
  ) as Record<FieldKey, string>
  const builders = Object.fromEntries(
    FIELD_ORDER.map((k) => [k, { ...derived[k], custom: tokens[k] }]),
  ) as Record<FieldKey, FieldBuilder>
  const modesFull = Object.fromEntries(
    FIELD_ORDER.map((k) => [k, modes[k] ?? derived[k].mode]),
  ) as Record<FieldKey, BuilderMode>

  const rebuild = (
    patch: Partial<Record<FieldKey, string>>,
    withSeconds = lastValid.hasSeconds,
  ) => {
    const fields = { ...tokens, ...patch }
    if (!withSeconds) fields.second = '0'
    const keys = withSeconds ? FIELD_ORDER : FIELD_ORDER.slice(1)
    apply(keys.map((k) => fields[k]).join(' '))
  }

  const onBuilder = (key: FieldKey, b: FieldBuilder) => {
    const token = builderToToken(b, key)
    if (b.mode === 'custom') setDrafts((d) => ({ ...d, [key]: b.custom }))
    else
      setDrafts((d) => {
        const next = { ...d }
        delete next[key]
        return next
      })
    rebuild({ [key]: b.mode === 'custom' ? b.custom : token })
  }

  const onMode = (key: FieldKey, mode: BuilderMode) => {
    setModes((m) => ({ ...m, [key]: mode }))
    const cur = builders[key]
    const { min } = builderRange(key)
    const b: FieldBuilder = { ...cur, mode }
    if (mode === 'specific' && !cur.values.length) b.values = [key === 'dayOfWeek' ? 1 : min]
    if (mode === 'range' && cur.mode !== 'range') [b.from, b.to] = RANGE_DEFAULT[key]
    if (mode === 'custom') b.custom = tokens[key]
    onBuilder(key, b)
  }

  const next = analysis?.runs[0]
  const nextParts = next ? zonedParts(next.getTime(), tz) : null
  const shape = analysis
    ? analysis.normalized.macro
      ? `${analysis.normalized.macro} = ${analysis.normalized.expression}`
      : analysis.normalized.hasSeconds
        ? '6 段 · 含秒'
        : '5 段 · 标准 crontab'
    : null
  const activePreset = analysis?.normalized.expression

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Panel className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-accent/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-4">
          {/* 窄屏时让徽标换到标题下方，复制按钮始终留在标题右侧 */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-2">
                <Timer className="size-4 text-accent" />
                <span className="text-[15px] font-semibold text-fg">Cron 表达式</span>
              </span>
              {shape && <Badge>{shape}</Badge>}
            </div>
            <CopyButton text={expr.trim()} label="复制表达式" disabled={!expr.trim()} />
          </div>

          <div className="relative">
            <Input
              value={expr}
              onChange={(e) => typeExpr(e.target.value)}
              placeholder="分 时 日 月 周，例如 */5 * * * *"
              mono
              spellCheck={false}
              autoCapitalize="off"
              className={cn(
                'h-14 pr-11 text-lg tracking-wide sm:text-xl',
                error && 'border-danger focus:border-danger focus:ring-danger/15',
              )}
              aria-label="Cron 表达式"
              aria-invalid={!!error}
            />
            {expr && (
              <button
                type="button"
                onClick={() => typeExpr('')}
                aria-label="清空表达式"
                className="absolute top-1/2 right-3.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-fill text-fg-2 hover:bg-fill-3 hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {analysis && (
            <LayoutGroup>
              <div
                className="grid gap-1.5 sm:flex sm:flex-wrap"
                style={{
                  gridTemplateColumns: `repeat(${analysis.normalized.hasSeconds ? 6 : 5}, minmax(0, 1fr))`,
                }}
              >
                {analysis.fields
                  .filter((f) => !f.implicit)
                  .map((f) => (
                    <motion.div
                      layout
                      key={f.key}
                      onMouseEnter={() => setHovered(f.key)}
                      onMouseLeave={() => setHovered(null)}
                      className={cn(
                        'flex min-w-0 flex-col items-center rounded-xl px-2 py-1.5 transition-colors sm:min-w-14 sm:px-2.5',
                        hovered === f.key ? 'bg-accent-soft' : 'bg-fill-2',
                      )}
                    >
                      <span className="max-w-full font-mono text-[13px] font-semibold break-all text-fg">
                        {f.raw}
                      </span>
                      <span className="text-[10px] text-fg-3">{FIELD_SPECS[f.key].label}</span>
                    </motion.div>
                  ))}
              </div>
            </LayoutGroup>
          )}

          <div className="min-h-16">
            <AnimatePresence mode="wait" initial={false}>
              {analysis ? (
                <motion.div
                  key={analysis.description}
                  initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                  transition={{ duration: 0.28 }}
                >
                  <p className="text-xl leading-snug font-semibold tracking-tight text-fg sm:text-2xl">
                    {analysis.description}
                  </p>
                  {next && nextParts && (
                    <p className="mt-1.5 text-[13px] text-fg-2">
                      下次执行：
                      <span className="font-mono text-fg tabular-nums">
                        {formatDateTime(nextParts, 0, false)}
                      </span>{' '}
                      {WEEKDAY_ZH[nextParts.weekday]} · {formatRelative(next.getTime(), now)}
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[13px] text-fg-3"
                >
                  {!expr.trim()
                    ? '输入表达式，或从下面的常用预设开始'
                    : error
                      ? '表达式有误，按下方提示修改后即可看到解释'
                      : '正在解析…'}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <ErrorNotice error={error} />
          {analysis?.notes.map((n) => (
            <Notice key={n} tone="info">
              {n}
            </Notice>
          ))}

          <div className="flex flex-wrap gap-1.5 border-t border-line pt-4">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.expr}
                type="button"
                onClick={() => typeExpr(p.expr)}
                title={p.expr}
                className={cn(
                  'h-8 rounded-full px-3 text-[13px] font-medium transition-colors',
                  activePreset === p.expr
                    ? 'bg-accent text-white'
                    : 'bg-fill text-fg-2 hover:bg-fill-3 hover:text-fg',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
        <RunsList
          runs={analysis?.runs ?? null}
          tz={tz}
          onTz={(v) => setStored((prev) => ({ ...(prev ?? {}), tz: v }))}
          now={now}
          canMore={count < MAX_RUNS && (analysis?.runs.length ?? 0) >= count}
          onMore={() => setCount((c) => Math.min(MAX_RUNS, c + 10))}
          emptyText={expr.trim() ? undefined : '输入表达式后在这里列出执行时间'}
        />
        <FieldTable
          fields={analysis?.fields ?? null}
          hovered={hovered}
          onHover={setHovered}
          emptyText={expr.trim() ? undefined : '输入表达式后在这里逐段解释'}
        />
      </div>

      <Builder
        builders={builders}
        modes={modesFull}
        tokens={tokens}
        withSeconds={lastValid.hasSeconds}
        onSeconds={(v) => rebuild({}, v)}
        onMode={onMode}
        onChange={onBuilder}
        disabled={!!error && !Object.keys(drafts).length}
      />
    </div>
  )
}
