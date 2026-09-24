import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Download, History, KeyRound, RefreshCw, RotateCcw, Trash2, WholeWord } from 'lucide-react'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Input,
  Notice,
  Panel,
  PanelHeader,
  SegmentedControl,
  Slider,
  Switch,
} from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import { downloadText } from '@/lib/file'
import {
  BATCH_MAX,
  CHAR_CLASS_LABELS,
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  DEFAULT_SYMBOLS,
  LENGTH_MAX,
  LENGTH_MIN,
  LOOK_ALIKES,
  PASSPHRASE_WORDS_MAX,
  PASSPHRASE_WORDS_MIN,
  buildPool,
  clampInt,
  createRng,
  generatePassphrase,
  generatePassword,
  graphemes,
  passphraseEntropy,
  passwordEntropy,
  type PassphraseOptions,
  type PasswordOptions,
} from '@/lib/password-generator'
import { PASSPHRASE_WORDS } from '@/lib/password-generator-words'
import { ColoredText, PasswordDisplay } from './PasswordDisplay'
import { StrengthMeter } from './StrengthMeter'

type Mode = 'password' | 'passphrase'

interface Stored {
  mode: Mode
  password: PasswordOptions
  passphrase: PassphraseOptions
  count: number
}

const DEFAULTS: Stored = {
  mode: 'password',
  password: DEFAULT_PASSWORD_OPTIONS,
  passphrase: DEFAULT_PASSPHRASE_OPTIONS,
  count: 1,
}

interface HistoryItem {
  value: string
  bits: number
  at: number
}

const CLASS_TOGGLES: {
  key: 'upper' | 'lower' | 'digits' | 'symbols'
  sample: string
  label: string
  tint?: string
}[] = [
  { key: 'upper', sample: 'ABC', label: CHAR_CLASS_LABELS.upper },
  { key: 'lower', sample: 'abc', label: CHAR_CLASS_LABELS.lower },
  { key: 'digits', sample: '123', label: CHAR_CLASS_LABELS.digit, tint: 'text-sys-blue' },
  { key: 'symbols', sample: '#$&', label: CHAR_CLASS_LABELS.symbol, tint: 'text-sys-pink' },
]

const SEPARATORS = [
  { value: '-', label: '-' },
  { value: '_', label: '_' },
  { value: '.', label: '.' },
  { value: ' ', label: '空格' },
  { value: '', label: '无' },
  { value: 'custom', label: '自定义' },
] as const
type SepValue = (typeof SEPARATORS)[number]['value']
const isPresetSep = (s: string) => SEPARATORS.some((x) => x.value !== 'custom' && x.value === s)

const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const expand = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { type: 'spring', stiffness: 400, damping: 36 },
} as const

interface GenerateResult {
  list: string[]
  bits: number
  error: string | null
  /** 第几次「重新生成」，同样的选项也会得到新结果 */
  generation: number
}

function generateAll(
  mode: Mode,
  pwKey: string,
  ppKey: string,
  count: number,
  generation: number,
): GenerateResult {
  try {
    const rng = createRng()
    if (mode === 'password') {
      const o = JSON.parse(pwKey) as PasswordOptions
      const list = Array.from({ length: count }, () => generatePassword(o, rng))
      return { list, bits: passwordEntropy(o), error: null, generation }
    }
    const o = JSON.parse(ppKey) as PassphraseOptions
    const list = Array.from({ length: count }, () => generatePassphrase(o, rng))
    return { list, bits: passphraseEntropy(o), error: null, generation }
  } catch (e) {
    return { list: [], bits: 0, error: e instanceof Error ? e.message : String(e), generation }
  }
}

export default function PasswordGenerator() {
  const [rawStored, setStored] = useLocalStorage<Partial<Stored>>(
    'password-generator.options.v1',
    DEFAULTS,
  )
  // localStorage 里的值可能被手动改坏（null / 数组 / 字符串），渲染时不能因此抛错
  const stored: Partial<Stored> =
    rawStored && typeof rawStored === 'object' && !Array.isArray(rawStored) ? rawStored : {}
  const mode: Mode = stored.mode === 'passphrase' ? 'passphrase' : 'password'
  const pw: PasswordOptions = { ...DEFAULT_PASSWORD_OPTIONS, ...stored.password }
  const pp: PassphraseOptions = { ...DEFAULT_PASSPHRASE_OPTIONS, ...stored.passphrase }
  const count = clampInt(stored.count ?? 1, 1, BATCH_MAX)

  const update = (patch: Partial<Stored>) =>
    setStored((prev) => ({ ...DEFAULTS, ...prev, ...patch }))
  const setPw = (patch: Partial<PasswordOptions>) =>
    setStored((prev) => ({
      ...DEFAULTS,
      ...prev,
      password: { ...DEFAULT_PASSWORD_OPTIONS, ...prev.password, ...patch },
    }))
  const setPp = (patch: Partial<PassphraseOptions>) =>
    setStored((prev) => ({
      ...DEFAULTS,
      ...prev,
      passphrase: { ...DEFAULT_PASSPHRASE_OPTIONS, ...prev.passphrase, ...patch },
    }))

  const [generation, setGeneration] = useState(0)
  const [spin, setSpin] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [customSep, setCustomSep] = useState(() => !isPresetSep(pp.separator))
  const [lengthDraft, setLengthDraft] = useState<string | null>(null)

  const pool = buildPool(pw)
  // 模板字符串让 React Compiler 知道这是原始值
  const pwKey = `${JSON.stringify(pw)}`
  const ppKey = `${JSON.stringify(pp)}`
  const result = useMemo(
    () => generateAll(mode, pwKey, ppKey, count, generation),
    [mode, pwKey, ppKey, count, generation],
  )
  const current = result.list[0] ?? ''
  const symbolCount = pool.classes.find((c) => c.id === 'symbol')?.chars.length ?? 0

  const pushHistory = (value: string) => {
    if (!value) return
    setHistory((h) =>
      [{ value, bits: result.bits, at: Date.now() }, ...h.filter((x) => x.value !== value)].slice(
        0,
        10,
      ),
    )
  }

  const regenerate = () => {
    pushHistory(current)
    setSpin((s) => s + 360)
    setGeneration((g) => g + 1)
  }

  const warnings: string[] = []
  if (mode === 'password') {
    if (pool.ignoredSymbols.length) {
      warnings.push(`符号集中的「${pool.ignoredSymbols.join(' ')}」是字母或数字，已忽略`)
    }
    if (pool.emptyClasses.includes('symbol')) warnings.push('符号集为空，本次不包含符号')
  }

  const passwordOptions = (
    <div className="flex flex-col gap-5">
      <div className="flex items-end gap-3">
        <Slider
          className="min-w-0 flex-1"
          label="长度"
          min={LENGTH_MIN}
          max={LENGTH_MAX}
          value={clampInt(pw.length, LENGTH_MIN, LENGTH_MAX)}
          onChange={(v) => setPw({ length: v })}
          format={(v) => `${v} 位`}
        />
        <div className="w-[4.5rem] shrink-0">
          <Input
            type="number"
            inputMode="numeric"
            aria-label="密码长度"
            min={LENGTH_MIN}
            max={LENGTH_MAX}
            className="h-9 text-center tabular-nums"
            value={lengthDraft ?? String(pw.length)}
            onChange={(e) => {
              setLengthDraft(e.target.value)
              const n = Number(e.target.value)
              if (e.target.value && n >= LENGTH_MIN && n <= LENGTH_MAX) {
                setPw({ length: Math.round(n) })
              }
            }}
            onBlur={() => {
              if (lengthDraft !== null) {
                setPw({ length: clampInt(Number(lengthDraft), LENGTH_MIN, LENGTH_MAX) })
              }
              setLengthDraft(null)
            }}
          />
        </div>
      </div>

      <Field label="字符类型">
        <div className="grid grid-cols-4 gap-2">
          {CLASS_TOGGLES.map((t) => {
            const on = pw[t.key]
            return (
              <motion.button
                key={t.key}
                type="button"
                aria-pressed={on}
                aria-label={t.label}
                title={on ? `不使用${t.label}` : `使用${t.label}`}
                whileTap={{ scale: 0.94 }}
                onClick={() => setPw({ [t.key]: !on })}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-2xl border px-1 py-2.5 transition-colors duration-200',
                  on
                    ? 'border-accent/30 bg-accent-soft text-accent'
                    : 'border-line bg-fill-2 text-fg-3 hover:text-fg-2',
                )}
              >
                <span className={cn('font-mono text-[15px] font-semibold', on && t.tint)}>
                  {t.sample}
                </span>
                <span className="text-[11px] font-medium">{t.label}</span>
              </motion.button>
            )
          })}
        </div>
      </Field>

      <AnimatePresence initial={false}>
        {pw.symbols && (
          <motion.div key="symbols" {...expand} className="overflow-hidden">
            <Field
              label="符号集"
              hint={`${symbolCount} 个可用符号，支持中文与 emoji`}
              action={
                pw.symbolSet !== DEFAULT_SYMBOLS && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCcw />}
                    onClick={() => setPw({ symbolSet: DEFAULT_SYMBOLS })}
                  >
                    恢复默认
                  </Button>
                )
              }
            >
              <Input
                mono
                value={pw.symbolSet}
                onChange={(e) => setPw({ symbolSet: e.target.value })}
                aria-label="自定义符号集"
                placeholder={DEFAULT_SYMBOLS}
              />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-3">
        <Switch
          checked={pw.excludeLookAlikes}
          onChange={(v) => setPw({ excludeLookAlikes: v })}
          label={
            <span>
              排除易混淆字符 <span className="font-mono text-fg-3">{LOOK_ALIKES}</span>
            </span>
          }
        />
        <Switch
          checked={pw.requireEach}
          onChange={(v) => setPw({ requireEach: v })}
          label="每种选中的类型至少出现一次"
        />
      </div>
    </div>
  )

  const passphraseOptions = (
    <div className="flex flex-col gap-5">
      <Slider
        label="单词数"
        min={PASSPHRASE_WORDS_MIN}
        max={PASSPHRASE_WORDS_MAX}
        value={clampInt(pp.words, PASSPHRASE_WORDS_MIN, PASSPHRASE_WORDS_MAX)}
        onChange={(v) => setPp({ words: v })}
        format={(v) => `${v} 个`}
      />
      <Field label="分隔符">
        <div className="flex flex-col gap-2">
          <SegmentedControl<SepValue>
            size="sm"
            block
            aria-label="分隔符"
            value={customSep ? 'custom' : (pp.separator as SepValue)}
            onChange={(v) => {
              setCustomSep(v === 'custom')
              if (v !== 'custom') setPp({ separator: v })
            }}
            options={SEPARATORS}
          />
          <AnimatePresence initial={false}>
            {customSep && (
              <motion.div key="sep" {...expand} className="overflow-hidden">
                <Input
                  mono
                  value={pp.separator}
                  maxLength={8}
                  onChange={(e) => setPp({ separator: e.target.value })}
                  placeholder="输入分隔符，如 · 或 +"
                  aria-label="自定义分隔符"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Field>
      <div className="flex flex-col gap-3">
        <Switch
          checked={pp.capitalize}
          onChange={(v) => setPp({ capitalize: v })}
          label="单词首字母大写"
        />
        <Switch
          checked={pp.appendNumber}
          onChange={(v) => setPp({ appendNumber: v })}
          label="末尾追加随机数字（0–99）"
        />
      </div>
      <p className="text-xs leading-relaxed text-fg-3">
        从内置的 {PASSPHRASE_WORDS.length.toLocaleString()}{' '}
        个常用英文单词中均匀随机抽取，每个单词贡献 {Math.log2(PASSPHRASE_WORDS.length).toFixed(0)}{' '}
        位熵；大小写与分隔符是固定的，不增加熵。
      </p>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:grid-rows-[auto_auto_1fr] lg:items-start">
      {/* ───── 主展示 ───── */}
      <Panel className="relative min-w-0 overflow-hidden lg:col-start-1 lg:row-start-1">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl<Mode>
            aria-label="生成模式"
            value={mode}
            onChange={(v) => update({ mode: v })}
            options={[
              {
                value: 'password',
                label: (
                  <>
                    <KeyRound />
                    随机密码
                  </>
                ),
              },
              {
                value: 'passphrase',
                label: (
                  <>
                    <WholeWord />
                    助记口令
                  </>
                ),
              },
            ]}
          />
          <span className="text-xs text-fg-3">
            {mode === 'password'
              ? `${pool.all.length} 个候选字符`
              : `${PASSPHRASE_WORDS.length.toLocaleString()} 词词表`}
            {' · '}本地安全随机数
          </span>
        </div>

        <div className="flex min-h-28 items-center rounded-2xl bg-surface-2 px-4 py-5 sm:px-6">
          {current ? (
            <PasswordDisplay value={current} generation={generation} className="w-full" />
          ) : (
            <span className="text-sm text-fg-3">请至少选择一种字符类型</span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            onClick={regenerate}
            aria-label="重新生成"
            title="重新生成"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.9 }}
            className="inline-flex size-10 items-center justify-center rounded-full bg-fill text-fg transition-colors hover:bg-fill-3"
          >
            <motion.span
              animate={{ rotate: spin }}
              transition={{ type: 'spring', stiffness: 170, damping: 15 }}
              className="inline-flex"
            >
              <RefreshCw className="size-[18px]" />
            </motion.span>
          </motion.button>
          <span onClickCapture={() => pushHistory(current)}>
            <CopyButton
              text={current}
              size="md"
              variant="primary"
              label="复制"
              disabled={!current}
            />
          </span>
          <span className="ml-auto text-xs text-fg-3 tabular-nums">
            {current && `${graphemes(current).length} 个字符`}
          </span>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <StrengthMeter bits={result.bits} />
        </div>
        <ErrorNotice error={result.error} className="mt-4" />
      </Panel>

      {/* ───── 选项 ───── */}
      <Panel className="min-w-0 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-3 lg:row-start-1">
        <PanelHeader title={mode === 'password' ? '密码选项' : '口令选项'} />
        {mode === 'password' ? passwordOptions : passphraseOptions}
        <div className="mt-5 border-t border-line pt-5">
          <Slider
            label="批量生成"
            min={1}
            max={BATCH_MAX}
            value={count}
            onChange={(v) => update({ count: v })}
            format={(v) => `${v} 个`}
          />
        </div>
        <AnimatePresence>
          {warnings.map((w) => (
            <Notice key={w} tone="warning" className="mt-4">
              {w}
            </Notice>
          ))}
        </AnimatePresence>
      </Panel>

      {/* ───── 批量结果 ───── */}
      <AnimatePresence initial={false}>
        {result.list.length > 1 && (
          <motion.div
            key="batch"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="min-w-0 lg:col-start-1"
          >
            <Panel padded={false}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
                <h3 className="text-[15px] font-semibold text-fg">
                  批量结果 · {result.list.length} 个
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Download />}
                    onClick={() => downloadText('passwords.txt', result.list.join('\n') + '\n')}
                  >
                    下载
                  </Button>
                  <CopyButton text={() => result.list.join('\n')} label="复制全部" />
                </div>
              </div>
              <ul
                className="thin-scrollbar max-h-[420px] overflow-y-auto border-t border-line"
                data-lenis-prevent
              >
                {result.list.map((v, i) => (
                  <motion.li
                    key={`${generation}-${i}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i, 20) * 0.015 }}
                    className="flex items-center gap-3 border-b border-line px-5 py-2 last:border-b-0"
                  >
                    <span className="w-6 shrink-0 text-right text-[11px] text-fg-3 tabular-nums">
                      {i + 1}
                    </span>
                    <ColoredText value={v} className="min-w-0 flex-1 text-[13px]" />
                    <span onClickCapture={() => pushHistory(v)}>
                      <CopyButton text={v} iconOnly variant="ghost" label={`复制第 ${i + 1} 个`} />
                    </span>
                  </motion.li>
                ))}
              </ul>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───── 历史 ───── */}
      <Panel className="min-w-0 lg:col-start-1">
        <PanelHeader
          title={
            <span className="inline-flex items-center gap-2">
              <History className="size-4 text-fg-2" />
              最近生成
            </span>
          }
        >
          <span className="text-xs text-fg-3">仅保存在内存中，刷新即清空</span>
          {history.length > 0 && (
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setHistory([])}>
              清空
            </Button>
          )}
        </PanelHeader>
        {history.length === 0 ? (
          <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-[13px] text-fg-3">
            点击「重新生成」或复制后，最近 10 条会出现在这里
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {history.map((h) => (
                <motion.li
                  key={h.value}
                  layout
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="flex items-center gap-3 rounded-2xl bg-surface-2 py-1.5 pr-1.5 pl-3.5"
                >
                  <ColoredText value={h.value} className="min-w-0 flex-1 text-[13px]" />
                  <span className="hidden shrink-0 text-[11px] text-fg-3 tabular-nums sm:inline">
                    {h.bits.toFixed(0)} 位 · {timeFmt.format(h.at)}
                  </span>
                  <CopyButton text={h.value} iconOnly variant="ghost" label="复制这条" />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>
    </div>
  )
}
