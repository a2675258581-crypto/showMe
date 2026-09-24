import { useEffect, useMemo, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, RefreshCw, RotateCcw, Sparkles, WandSparkles } from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { CodeEditor } from '@/components/editor/CodeEditor'
import type { EditorLang } from '@/components/editor/languages'
import { Badge, Button, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import {
  DEFAULT_CODE_OPTIONS,
  LANGS,
  LANG_MAP,
  detectLanguage,
  formatCode,
  isLangLoaded,
  type CodeFormatOptions,
  type CodeLang,
  type FormatResult,
  type OptionKey,
} from '@/lib/code-formatter'
import { CODE_SAMPLES } from '@/lib/code-formatter-samples'
import { ErrorPanel, StaleOverlay } from '@/components/editor/ErrorPanel'

type LangChoice = CodeLang | 'auto'

interface Prefs extends CodeFormatOptions {
  lang: LangChoice
}

const DEFAULT_PREFS: Prefs = { lang: 'auto', ...DEFAULT_CODE_OPTIONS }

const EDITOR_LANG: Record<CodeLang, EditorLang> = {
  javascript: 'javascript',
  jsx: 'jsx',
  typescript: 'typescript',
  tsx: 'tsx',
  json: 'json',
  json5: 'javascript',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  angular: 'html',
  markdown: 'markdown',
  yaml: 'yaml',
  graphql: 'graphql',
}

const LANG_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  ...LANGS.map((l) => ({ value: l.id, label: l.label })),
]

const SAMPLE_VALUES = new Set(Object.values(CODE_SAMPLES))

const ACCEPT =
  '.js,.mjs,.cjs,.jsx,.ts,.mts,.cts,.tsx,.json,.json5,.jsonc,.css,.scss,.less,.html,.htm,.vue,.md,.markdown,.yaml,.yml,.graphql,.gql,text/*'

const spring = { type: 'spring', stiffness: 500, damping: 36 } as const

/** 读回来的偏好可能来自旧版本或被手动改坏，逐项校验 */
function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  const v = { ...DEFAULT_PREFS, ...(p ?? {}) }
  return {
    lang: v.lang === 'auto' || v.lang in LANG_MAP ? v.lang : 'auto',
    printWidth: [80, 100, 120].includes(v.printWidth) ? v.printWidth : 80,
    tabWidth: v.tabWidth === 4 ? 4 : 2,
    useTabs: v.useTabs === true,
    semi: v.semi !== false,
    singleQuote: v.singleQuote === true,
    trailingComma: ['all', 'es5', 'none'].includes(v.trailingComma) ? v.trailingComma : 'all',
    bracketSpacing: v.bracketSpacing !== false,
  }
}

function formatMs(ms: number) {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
}

export default function CodeFormatter() {
  const [input, setInput] = useState(CODE_SAMPLES.typescript)
  const [stored, setStored] = useLocalStorage<Prefs>('code-formatter.options.v1', DEFAULT_PREFS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setStored((p) => ({ ...sanitize(p), [k]: v }))

  // 只把真正影响输出的选项序列化成 key，避免无关渲染触发重新格式化
  const optionsKey = JSON.stringify({
    printWidth: prefs.printWidth,
    tabWidth: prefs.tabWidth,
    useTabs: prefs.useTabs,
    semi: prefs.semi,
    singleQuote: prefs.singleQuote,
    trailingComma: prefs.trailingComma,
    bracketSpacing: prefs.bracketSpacing,
  } satisfies CodeFormatOptions)

  // 语言选择与输入一起防抖：切换语言并换成新示例时，不会拿旧输入按新语言去解析而闪出错误
  const live = `${prefs.lang}\u0000${input}`
  const settled = useDebounced(live, 250)
  const cut = settled.indexOf('\u0000')
  const langChoice = settled.slice(0, cut) as LangChoice
  const debounced = settled.slice(cut + 1)
  const detected = useMemo(() => detectLanguage(debounced), [debounced])
  const lang: CodeLang = langChoice === 'auto' ? (detected ?? 'typescript') : langChoice
  const def = LANG_MAP[lang]

  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; res: FormatResult } | null>(null)
  const [lastOutput, setLastOutput] = useState('')

  useEffect(() => {
    let alive = true
    const key = `${lang}|${optionsKey}|${retry}|${debounced}`
    formatCode(debounced, lang, JSON.parse(optionsKey) as CodeFormatOptions).then((res) => {
      if (!alive) return // 输入或选项又变了，丢弃过时的结果
      setResult({ key, res })
      if (res.ok) setLastOutput(res.output)
    })
    return () => {
      alive = false
    }
  }, [debounced, lang, optionsKey, retry])

  const jobKey = `${lang}|${optionsKey}|${retry}|${debounced}`
  const current = result?.key === jobKey ? result.res : null
  const pending = !current || live !== settled
  const error = current && !current.ok ? current.error : null
  const output = error ? '' : current?.ok ? current.output : lastOutput
  const unchanged = !pending && !!current?.ok && !!input.trim() && current.output === input
  const loadingEngine = pending && !isLangLoaded(lang, debounced)
  const placeholder = loadingEngine ? '正在加载格式化器…' : '格式化后的代码会显示在这里'

  const visible = new Set<OptionKey>(def.options)

  const onLangChange = (v: string) => {
    const next = v as LangChoice
    set('lang', next)
    // 输入为空或仍是某个示例时，顺便换成新语言的示例，方便直接对比效果
    if (next !== 'auto' && (!input.trim() || SAMPLE_VALUES.has(input))) setInput(CODE_SAMPLES[next])
  }

  const ext = def.filename.split('.').pop() ?? 'txt'

  const resetButton = (
    <Button
      size="sm"
      variant="ghost"
      iconOnly
      icon={<RotateCcw />}
      title="恢复默认选项"
      aria-label="恢复默认选项"
      onClick={() => setStored((p) => ({ ...DEFAULT_PREFS, lang: sanitize(p).lang }))}
    />
  )

  const toolbar = (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Select
          value={prefs.lang}
          onChange={onLangChange}
          options={LANG_OPTIONS}
          aria-label="语言"
          className="min-w-32"
        />
        <AnimatePresence mode="popLayout" initial={false}>
          {prefs.lang === 'auto' && (
            <motion.span
              key={langChoice === 'auto' ? (detected ?? 'none') : 'wait'}
              initial={{ opacity: 0, scale: 0.85, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={spring}
              className="inline-flex"
            >
              <Badge color={detected ? undefined : 'var(--fg-3)'}>
                <Sparkles className="size-3" />
                {langChoice === 'auto' && detected
                  ? `自动识别：${LANG_MAP[detected].label}`
                  : '等待输入'}
              </Badge>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />

      <AnimatePresence mode="popLayout" initial={false}>
        <Opt key="printWidth" label="行宽">
          <SegmentedControl
            size="sm"
            aria-label="行宽"
            value={String(prefs.printWidth) as '80' | '100' | '120'}
            onChange={(v) => set('printWidth', Number(v) as 80 | 100 | 120)}
            options={[
              { value: '80', label: '80' },
              { value: '100', label: '100' },
              { value: '120', label: '120' },
            ]}
          />
        </Opt>
        <Opt key="tabWidth" label="缩进">
          <SegmentedControl
            size="sm"
            aria-label="缩进宽度"
            value={String(prefs.tabWidth) as '2' | '4'}
            onChange={(v) => set('tabWidth', v === '4' ? 4 : 2)}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
            ]}
          />
        </Opt>
        <Opt key="useTabs">
          <Switch
            checked={prefs.useTabs}
            onChange={(v) => set('useTabs', v)}
            label={<span className="text-[13px]">Tab 缩进</span>}
          />
        </Opt>
        {visible.has('semi') && (
          <Opt key="semi">
            <Switch
              checked={prefs.semi}
              onChange={(v) => set('semi', v)}
              label={<span className="text-[13px]">分号</span>}
            />
          </Opt>
        )}
        {visible.has('singleQuote') && (
          <Opt key="singleQuote">
            <Switch
              checked={prefs.singleQuote}
              onChange={(v) => set('singleQuote', v)}
              label={<span className="text-[13px]">单引号</span>}
            />
          </Opt>
        )}
        {visible.has('bracketSpacing') && (
          <Opt key="bracketSpacing">
            <Switch
              checked={prefs.bracketSpacing}
              onChange={(v) => set('bracketSpacing', v)}
              label={<span className="text-[13px]">括号内空格</span>}
            />
          </Opt>
        )}
        {visible.has('trailingComma') && (
          <Opt key="trailingComma" label="尾随逗号">
            <Select
              size="sm"
              aria-label="尾随逗号"
              value={prefs.trailingComma}
              onChange={(v) => set('trailingComma', v as CodeFormatOptions['trailingComma'])}
              options={[
                { value: 'all', label: '全部' },
                { value: 'es5', label: 'ES5' },
                { value: 'none', label: '不加' },
              ]}
            />
          </Opt>
        )}
      </AnimatePresence>
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputLang={EDITOR_LANG[lang]}
        outputLang={EDITOR_LANG[lang]}
        inputTitle={
          <span className="inline-flex items-center gap-2">
            输入<span className="font-normal text-fg-3">{def.label}</span>
          </span>
        }
        outputTitle={
          <span className="inline-flex items-center gap-2">
            格式化结果
            <AnimatePresence mode="popLayout" initial={false}>
              {pending ? (
                <motion.span
                  key="spin"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  className="inline-flex items-center gap-1 text-[11px] font-normal text-fg-3"
                  role="status"
                  aria-label="正在格式化"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  {loadingEngine && <span>正在加载 {def.label} 格式化器…</span>}
                </motion.span>
              ) : unchanged ? (
                <motion.span
                  key="same"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={spring}
                  className="inline-flex"
                >
                  <Badge color="var(--sys-green)">已是规范格式</Badge>
                </motion.span>
              ) : null}
            </AnimatePresence>
          </span>
        }
        inputPlaceholder="粘贴代码，自动识别语言并实时格式化…"
        sample={CODE_SAMPLES[prefs.lang === 'auto' ? lang : prefs.lang]}
        acceptFile={ACCEPT}
        downloadName={`formatted.${ext}`}
        toolbar={toolbar}
        toolbarEnd={resetButton}
        outputSlot={
          <div className="relative h-full">
            <div
              className={cn(
                'h-full transition-opacity duration-300',
                error ? 'opacity-35' : pending && output ? 'opacity-70' : 'opacity-100',
              )}
            >
              <CodeEditor
                value={error ? lastOutput : output}
                lang={EDITOR_LANG[lang]}
                readOnly
                placeholder={placeholder}
                aria-label="格式化结果"
              />
            </div>
            <StaleOverlay show={!!error}>
              {error?.line !== undefined ? `第 ${error.line} 行有错误` : '格式化失败'}
              {lastOutput ? '，显示的是上一次的结果' : '，修正后自动格式化'}
            </StaleOverlay>
          </div>
        }
        outputFooter={
          <>
            <span>
              {error
                ? '—'
                : `${output ? output.split('\n').length.toLocaleString() : 0} 行 · ${output.length.toLocaleString()} 字符`}
            </span>
            <span className="inline-flex items-center gap-1">
              <WandSparkles className="size-3" />
              {current?.ok && current.ms > 0 ? `Prettier · ${formatMs(current.ms)}` : 'Prettier'}
            </span>
          </>
        }
      />
      <ErrorPanel
        error={error}
        action={
          error?.kind === 'load' ? (
            <Button
              size="sm"
              variant="danger"
              icon={<RefreshCw />}
              onClick={() => setRetry((n) => n + 1)}
            >
              重试
            </Button>
          ) : prefs.lang !== 'auto' && detected && detected !== prefs.lang ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Sparkles />}
              onClick={() => set('lang', 'auto')}
            >
              看起来是 {LANG_MAP[detected].label}，改用自动识别
            </Button>
          ) : undefined
        }
      />
    </div>
  )
}

/** 工具条里的一项：可带小标签，出现 / 消失时带弹簧动画 */
function Opt({
  label,
  children,
  className,
  ref,
}: {
  label?: string
  children: ReactNode
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={spring}
      className={cn('flex items-center gap-2', className)}
    >
      {label && <span className="text-[13px] text-fg-2">{label}</span>}
      {children}
    </motion.div>
  )
}
