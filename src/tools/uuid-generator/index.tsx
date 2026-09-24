import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Download, RefreshCw, ScanSearch } from 'lucide-react'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Input,
  Notice,
  Panel,
  Select,
  Slider,
  Switch,
  useToast,
} from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { downloadText } from '@/lib/file'
import {
  COUNT_MAX,
  COUNT_MIN,
  ID_KINDS,
  NANOID_ALPHABETS,
  NANOID_DEFAULT_SIZE,
  NANOID_SIZE_MAX,
  NANOID_SIZE_MIN,
  clampCount,
  collisionLog10,
  formatLog10Count,
  formatUuid,
  generateIds,
  normalizeAlphabet,
  randomBits,
  type IdKind,
} from '@/lib/uuid-generator'
import { IdParser } from './IdParser'

interface Options {
  kind: IdKind
  count: number
  uppercase: boolean
  noHyphens: boolean
  braces: boolean
  ulidLowercase: boolean
  nanoidSize: number
  nanoidAlphabet: string
}

const DEFAULTS: Options = {
  kind: 'v4',
  count: 10,
  uppercase: false,
  noHyphens: false,
  braces: false,
  ulidLowercase: false,
  nanoidSize: NANOID_DEFAULT_SIZE,
  nanoidAlphabet: NANOID_ALPHABETS[0].chars,
}

const PRESET_OPTIONS = [
  ...NANOID_ALPHABETS.map((a) => ({ value: a.id as string, label: a.label })),
  { value: 'custom', label: '自定义' },
]

/** 只有前 N 行做入场动画，1000 行时不拖慢 */
const ANIMATED_ROWS = 24

/** 生成原始 ID（UUID 小写带连字符、ULID 大写）；格式选项在展示时再套用，切换大小写不会换一批 */
function run(
  kind: IdKind,
  count: number,
  nanoidSize: number,
  nanoidAlphabet: string,
  generation: number,
): { ids: string[]; error: string | null; generation: number } {
  try {
    const ids = generateIds({
      kind,
      count,
      uuid: { uppercase: false, noHyphens: false, braces: false },
      ulidLowercase: false,
      nanoidSize,
      nanoidAlphabet,
    })
    return { ids, error: null, generation }
  } catch (e) {
    return { ids: [], error: e instanceof Error ? e.message : String(e), generation }
  }
}

export default function UuidGenerator() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>(
    'uuid-generator.options.v1',
    DEFAULTS,
  )
  const merged: Options = { ...DEFAULTS, ...stored }
  // 防御被改坏的 localStorage：未知类型回退到 v4
  const o: Options = ID_KINDS.some((k) => k.id === merged.kind)
    ? merged
    : { ...merged, kind: DEFAULTS.kind }
  const set = (patch: Partial<Options>) => setStored((prev) => ({ ...DEFAULTS, ...prev, ...patch }))
  const count = clampCount(o.count)
  const nanoidSize = Math.min(
    NANOID_SIZE_MAX,
    Math.max(NANOID_SIZE_MIN, Math.round(o.nanoidSize) || NANOID_DEFAULT_SIZE),
  )

  const [generation, setGeneration] = useState(0)
  const [spin, setSpin] = useState(0)
  const [countDraft, setCountDraft] = useState<string | null>(null)
  const [parseInput, setParseInput] = useState('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')
  const [copied, setCopied] = useState<number | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const parserRef = useRef<HTMLDivElement>(null)
  const alphabetRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const result = useMemo(
    () => run(o.kind, count, nanoidSize, o.nanoidAlphabet, generation),
    [o.kind, count, nanoidSize, o.nanoidAlphabet, generation],
  )
  const isUuid = o.kind === 'v4' || o.kind === 'v7'
  const fmt = { uppercase: o.uppercase, noHyphens: o.noHyphens, braces: o.braces }
  const ids = result.ids.map((id) =>
    isUuid ? formatUuid(id, fmt) : o.kind === 'ulid' && o.ulidLowercase ? id.toLowerCase() : id,
  )

  const alphabet = normalizeAlphabet(o.nanoidAlphabet)
  const preset = NANOID_ALPHABETS.find((a) => a.chars === o.nanoidAlphabet)?.id ?? 'custom'
  const bits = randomBits({ kind: o.kind, nanoidSize, nanoidAlphabet: o.nanoidAlphabet })
  const kindInfo = ID_KINDS.find((k) => k.id === o.kind)!
  const text = ids.join('\n')

  const regenerate = () => {
    setCopied(null)
    setSpin((s) => s + 360)
    setGeneration((g) => g + 1)
  }

  const copyRow = async (value: string, i: number) => {
    const ok = await copyText(value)
    toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
    if (ok) {
      setCopied(i)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(null), 1400)
    }
  }

  const parseRow = (value: string) => {
    setParseInput(value)
    parserRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const statLine =
    bits > 0
      ? o.kind === 'v7' || o.kind === 'ulid'
        ? `每毫秒 ${bits} 位随机数（同一生成器内严格递增，不会重复）`
        : `${bits.toFixed(bits % 1 ? 1 : 0)} 位随机数 · 生成约 ${formatLog10Count(collisionLog10(bits))} 个后才有 1% 的概率出现重复`
      : ''

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        {/* 类型选择 */}
        <div
          role="radiogroup"
          aria-label="ID 类型"
          className="grid grid-cols-2 gap-2 md:grid-cols-4"
        >
          {ID_KINDS.map((k) => {
            const active = k.id === o.kind
            return (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ kind: k.id })}
                className={cn(
                  'relative flex flex-col items-start gap-1 rounded-2xl border px-3.5 py-3 text-left transition-colors duration-200',
                  active ? 'border-accent/40' : 'border-line hover:bg-fill-2',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="uuid-kind"
                    className="absolute inset-0 rounded-2xl bg-accent-soft"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <span
                  className={cn(
                    'relative text-sm font-semibold',
                    active ? 'text-accent' : 'text-fg',
                  )}
                >
                  {k.label}
                </span>
                <span className="relative text-[11px] leading-snug text-fg-2">{k.desc}</span>
              </button>
            )
          })}
        </div>

        {/* 选项 */}
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="flex items-end gap-3">
            <Slider
              className="min-w-0 flex-1"
              label="数量"
              min={COUNT_MIN}
              max={COUNT_MAX}
              value={count}
              onChange={(v) => set({ count: v })}
              format={(v) => `${v} 个`}
            />
            <div className="w-20 shrink-0">
              <Input
                type="number"
                inputMode="numeric"
                aria-label="生成数量"
                min={COUNT_MIN}
                max={COUNT_MAX}
                className="h-9 text-center tabular-nums"
                value={countDraft ?? String(count)}
                onChange={(e) => {
                  setCountDraft(e.target.value)
                  const n = Number(e.target.value)
                  if (e.target.value && n >= COUNT_MIN && n <= COUNT_MAX)
                    set({ count: Math.round(n) })
                }}
                onBlur={() => {
                  if (countDraft !== null) set({ count: clampCount(Number(countDraft)) })
                  setCountDraft(null)
                }}
              />
            </div>
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={isUuid ? 'uuid' : o.kind}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="flex flex-wrap items-center gap-x-5 gap-y-3 md:pt-6"
            >
              {isUuid && (
                <>
                  <Switch
                    checked={o.uppercase}
                    onChange={(v) => set({ uppercase: v })}
                    label="大写"
                  />
                  <Switch
                    checked={o.noHyphens}
                    onChange={(v) => set({ noHyphens: v })}
                    label="去掉连字符"
                  />
                  <Switch
                    checked={o.braces}
                    onChange={(v) => set({ braces: v })}
                    label="{ } 花括号"
                  />
                </>
              )}
              {o.kind === 'ulid' && (
                <Switch
                  checked={o.ulidLowercase}
                  onChange={(v) => set({ ulidLowercase: v })}
                  label="小写输出"
                />
              )}
              {o.kind === 'nanoid' && (
                <Slider
                  className="w-full"
                  label="长度"
                  min={NANOID_SIZE_MIN}
                  max={64}
                  value={Math.min(nanoidSize, 64)}
                  onChange={(v) => set({ nanoidSize: v })}
                  format={() => `${nanoidSize} 个字符`}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {o.kind === 'nanoid' && (
            <motion.div
              key="alphabet"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 36 }}
              className="overflow-hidden"
            >
              <Field
                className="mt-5"
                label={`字母表 · ${alphabet.chars.length} 个字符`}
                action={
                  <Select
                    size="sm"
                    aria-label="字母表预设"
                    value={preset}
                    options={PRESET_OPTIONS}
                    onChange={(v) => {
                      const p = NANOID_ALPHABETS.find((a) => a.id === v)
                      if (p) set({ nanoidAlphabet: p.chars })
                      else alphabetRef.current?.select()
                    }}
                  />
                }
                hint={
                  alphabet.duplicates.length
                    ? `已忽略重复字符：${alphabet.duplicates.join(' ')}`
                    : undefined
                }
              >
                <Input
                  ref={alphabetRef}
                  mono
                  value={o.nanoidAlphabet}
                  onChange={(e) => set({ nanoidAlphabet: e.target.value })}
                  aria-label="NanoID 字母表"
                  placeholder="至少 2 个不同字符"
                />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 操作 */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <Button
            variant="primary"
            onClick={regenerate}
            icon={
              <motion.span
                animate={{ rotate: spin }}
                transition={{ type: 'spring', stiffness: 170, damping: 15 }}
                className="inline-flex"
              >
                <RefreshCw />
              </motion.span>
            }
          >
            重新生成
          </Button>
          <CopyButton text={text} size="md" label={`复制全部 ${ids.length} 个`} disabled={!text} />
          <Button
            icon={<Download />}
            disabled={!text}
            onClick={() =>
              downloadText(
                `${o.kind === 'nanoid' ? 'nanoid' : o.kind === 'ulid' ? 'ulid' : `uuid-${o.kind}`}.txt`,
                text + '\n',
              )
            }
          >
            下载 .txt
          </Button>
          <span className="w-full text-xs text-fg-3 sm:ml-auto sm:w-auto">{statLine}</span>
        </div>
        <ErrorNotice error={result.error} className="mt-4" />
        {o.kind === 'v4' && typeof globalThis.crypto?.randomUUID !== 'function' && (
          <Notice tone="info" className="mt-4">
            当前页面不是安全上下文，已改用 crypto.getRandomValues 生成 v4，结果同样安全。
          </Notice>
        )}
      </Panel>

      {/* 结果列表 */}
      <Panel padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="text-[15px] font-semibold text-fg">
            {kindInfo.label} · {ids.length.toLocaleString()} 个
          </h3>
          <span className="hidden text-xs text-fg-3 sm:inline">点击任意一行即可复制</span>
        </div>
        <ol className="thin-scrollbar max-h-[480px] overflow-y-auto py-1" data-lenis-prevent>
          {ids.map((id, i) => {
            const row = (
              <>
                <span className="hidden w-9 shrink-0 text-right text-[11px] text-fg-3 tabular-nums sm:inline">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => copyRow(id, i)}
                  title="点击复制"
                  className="min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left font-mono text-[12px] text-fg transition-colors hover:bg-fill-2 sm:text-[13px]"
                >
                  {id}
                </button>
                <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button
                    type="button"
                    aria-label={`解析第 ${i + 1} 个`}
                    title="解析"
                    onClick={() => parseRow(id)}
                    className="hidden size-8 items-center justify-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg sm:inline-flex"
                  >
                    <ScanSearch className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`复制第 ${i + 1} 个`}
                    title="复制"
                    onClick={() => copyRow(id, i)}
                    className="inline-flex size-8 items-center justify-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
                  >
                    {copied === i ? (
                      <Check className="size-4 text-sys-green" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </span>
              </>
            )
            const cls = 'group flex items-center gap-1 px-2 py-0.5 sm:gap-2 sm:px-4'
            return i < ANIMATED_ROWS ? (
              <motion.li
                key={`${result.generation}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.018, type: 'spring', stiffness: 420, damping: 32 }}
                className={cls}
              >
                {row}
              </motion.li>
            ) : (
              <li key={`${result.generation}-${i}`} className={cls}>
                {row}
              </li>
            )
          })}
        </ol>
      </Panel>

      <div ref={parserRef} className="scroll-mt-20">
        <IdParser input={parseInput} onInput={setParseInput} />
      </div>
    </div>
  )
}
