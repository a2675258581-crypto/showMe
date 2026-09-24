import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  BookOpen,
  ClipboardPaste,
  LoaderCircle,
  Replace,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EditorPane } from '@/components/editor/IOPanel'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Input,
  Notice,
  Panel,
  SegmentedControl,
  Tabs,
  useToast,
  type SegmentOption,
  type TabItem,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { readClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import {
  captureGroups,
  compileRegex,
  MATCH_LIMIT,
  normalizeFlags,
  toggleFlag,
  type RegexFlag,
  type RegexMatch,
} from '@/lib/regex-tester'
import type { CodeLang } from '@/lib/regex-tester-codegen'
import { explainRegex } from '@/lib/regex-tester-explain'
import type { RegexPreset } from '@/lib/regex-tester-library'
import { CodePanel } from './CodePanel'
import { ExplainPanel } from './ExplainPanel'
import { createHighlightHandle, highlightExtensions, revealRange, showMatches } from './highlight'
import { LibraryPanel } from './LibraryPanel'
import { MatchList } from './MatchList'
import { PatternInput } from './PatternInput'
import { REGEX_TIMEOUT, useRegexRunner, type RegexInput } from './useRegexRunner'

type Mode = 'match' | 'replace'
type Tab = 'matches' | 'explain' | 'code'

interface Options {
  flags: string
  mode: Mode
  tab: Tab
  lang: CodeLang
}

const DEFAULTS: Options = { flags: 'g', mode: 'match', tab: 'matches', lang: 'javascript' }

function sanitize(raw: unknown): Options {
  const o: Options = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  o.flags = typeof o.flags === 'string' ? normalizeFlags(o.flags) : DEFAULTS.flags
  if (o.mode !== 'match' && o.mode !== 'replace') o.mode = DEFAULTS.mode
  if (!['matches', 'explain', 'code'].includes(o.tab)) o.tab = DEFAULTS.tab
  if (!['javascript', 'python', 'java', 'go', 'php'].includes(o.lang)) o.lang = DEFAULTS.lang
  return o
}

const MODES: SegmentOption<Mode>[] = [
  {
    value: 'match',
    label: (
      <>
        <Search />
        匹配
      </>
    ),
  },
  {
    value: 'replace',
    label: (
      <>
        <Replace />
        替换
      </>
    ),
  },
]

const SAMPLE_PATTERN = '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)'
const SAMPLE_TEXT = `联系我们：support@showme.dev（工作日 9:00-18:00）
市场合作请写信给 Marketing.Team+cn@example.com.cn，
个人邮箱 zhang_san@163.com 也可以。
无效地址：user@localhost、@example.com、邮箱@中文.com`
const SAMPLE_REPLACEMENT = '$<user> [at] $<domain>'

const EDITOR_HEIGHT = 'clamp(260px, 44vh, 480px)'
/** 超过这个长度才防抖 */
const INSTANT_LIMIT = 20_000
const EMPTY: RegexMatch[] = []

/**
 * 编辑器内部统一用 \n 换行：带 \r\n 的文件 / 剪贴板内容如果原样放进 state，
 * 匹配下标会和编辑器对不上，高亮一直不显示。
 */
const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n')

export default function RegexTester() {
  const toast = useToast()
  const rootRef = useRef<HTMLDivElement>(null)
  const [stored, setStored] = useLocalStorage<Partial<Options>>('regex-tester.options.v1', {})
  const o = useMemo(() => sanitize(stored), [stored])
  const patch = useCallback(
    (p: Partial<Options>) => setStored((prev) => ({ ...sanitize(prev), ...p })),
    [setStored],
  )

  const [pattern, setPattern] = useState(SAMPLE_PATTERN)
  const [text, setText] = useState(SAMPLE_TEXT)
  const [replacement, setReplacement] = useState(SAMPLE_REPLACEMENT)
  const [active, setActive] = useState(-1)
  const { flags, mode } = o

  const compiled = useMemo(() => compileRegex(pattern, flags), [pattern, flags])
  const compileError = compiled.ok ? null : compiled.error

  // 发送给 Worker 的请求（大文本防抖）
  const input = useMemo<RegexInput>(
    () => ({ pattern, flags, text, replacement: mode === 'replace' ? replacement : undefined }),
    [pattern, flags, text, replacement, mode],
  )
  const debounced = useDebounced(input, 150)
  const src = text.length <= INSTANT_LIMIT ? input : debounced
  const req = pattern && compiled.ok ? src : null
  const { res, timedOut, pending, resultReq } = useRegexRunner(req)

  const live = req !== null
  const okRes = live && res?.ok && !timedOut ? res : null
  const runError = live && res && !res.ok && !pending ? res.error : null
  const matches = okRes?.matches ?? EMPTY
  const resultText = resultReq?.text ?? ''
  const groupCount = useMemo(() => captureGroups(pattern, flags).length, [pattern, flags])

  // 编辑器高亮
  const [handle] = useState(createHighlightHandle)
  const extensions = useMemo(() => highlightExtensions(handle), [handle])
  useEffect(() => {
    showMatches(handle, okRes ? { matches: okRes.matches, active } : null, resultText)
  }, [handle, okRes, active, resultText])

  // 超过 150ms 仍未返回才显示「匹配中」，避免闪烁
  const [slowFor, setSlowFor] = useState<RegexInput | null>(null)
  useEffect(() => {
    if (!pending || !req) return
    const t = setTimeout(() => setSlowFor(req), 150)
    return () => clearTimeout(t)
  }, [pending, req])
  const showSpinner = pending && slowFor === req

  const nodes = useMemo(() => explainRegex(pattern, flags), [pattern, flags])

  const pick = (p: RegexPreset) => {
    setPattern(p.pattern)
    setText(p.sample)
    const next: Partial<Options> = { flags: normalizeFlags(p.flags) }
    if (p.replacement !== undefined) {
      setReplacement(p.replacement)
      next.mode = 'replace'
    }
    patch(next)
    toast(`已载入：${p.name}`, 'success')
    const top = rootRef.current?.getBoundingClientRect().top
    if (top !== undefined) window.scrollTo({ top: window.scrollY + top - 96, behavior: 'smooth' })
  }

  const loadSample = () => {
    setPattern(SAMPLE_PATTERN)
    setText(SAMPLE_TEXT)
    setReplacement(SAMPLE_REPLACEMENT)
  }

  const tabs: TabItem<Tab>[] = [
    { value: 'matches', label: '匹配结果', badge: okRes ? matches.length : undefined },
    { value: 'explain', label: '正则解释' },
    { value: 'code', label: '代码片段' },
  ]

  const status = !pattern
    ? '输入正则表达式开始匹配'
    : compileError
      ? '表达式有误'
      : timedOut && live
        ? '已中止'
        : okRes
          ? `${matches.length.toLocaleString()}${okRes.truncated ? '+' : ''} 个匹配 · ${groupCount} 个分组 · ${okRes.elapsed < 1 ? '<1' : Math.round(okRes.elapsed)} ms`
          : '匹配中…'

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {/* 表达式 */}
      <Panel className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            options={MODES}
            value={mode}
            onChange={(v) => patch({ mode: v })}
            aria-label="模式"
          />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={loadSample}>
              示例
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<BookOpen />}
              onClick={() =>
                document.getElementById('regex-library')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              常用正则
            </Button>
          </div>
        </div>

        <PatternInput
          pattern={pattern}
          flags={flags}
          invalid={!!compileError}
          onPattern={setPattern}
          onToggleFlag={(f: RegexFlag) => patch({ flags: toggleFlag(flags, f) })}
        />

        <AnimatePresence initial={false}>
          {mode === 'replace' && (
            <motion.div
              key="replace"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="overflow-hidden"
            >
              <Field
                label="替换为"
                hint={
                  <>
                    <code className="font-mono">$1</code> 第 1 组 ·{' '}
                    <code className="font-mono">$&lt;name&gt;</code> 命名组 ·{' '}
                    <code className="font-mono">$&amp;</code> 整个匹配 ·{' '}
                    <code className="font-mono">$`</code> / <code className="font-mono">$'</code>{' '}
                    匹配前 / 后的文本 · <code className="font-mono">$$</code> 美元符号
                  </>
                }
              >
                <Input
                  mono
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  placeholder="替换文本，留空表示删除匹配内容"
                  aria-label="替换为"
                />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>

        <ErrorNotice error={compileError ?? runError} />
        <AnimatePresence>
          {timedOut && live && (
            <Notice key="timeout" tone="warning">
              匹配超过 {REGEX_TIMEOUT / 1000} 秒已自动中止：表达式可能存在灾难性回溯（如
              (a+)+、(.*)*
              这类嵌套量词）。请尝试去掉嵌套的量词、使用更具体的字符类，或缩短测试文本。
            </Notice>
          )}
          {okRes?.truncated && (
            <Notice key="limit" tone="info">
              匹配数量超过 {MATCH_LIMIT.toLocaleString()} 个，只高亮和列出前{' '}
              {MATCH_LIMIT.toLocaleString()} 个。
            </Notice>
          )}
        </AnimatePresence>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <EditorPane
            title="测试文本"
            height={EDITOR_HEIGHT}
            onDropFile={async (f) => setText(normalizeEol(await f.text()))}
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ClipboardPaste />}
                  onClick={async () => {
                    const t = await readClipboard()
                    if (t === null) toast('无法读取剪贴板，请直接在编辑器里粘贴', 'error')
                    else setText(normalizeEol(t))
                  }}
                >
                  粘贴
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 />}
                  iconOnly
                  title="清空"
                  aria-label="清空测试文本"
                  disabled={!text}
                  onClick={() => setText('')}
                />
              </>
            }
            footer={
              <>
                <span
                  className={cn('flex items-center gap-1.5', timedOut && live && 'text-warning')}
                >
                  {showSpinner && <LoaderCircle className="size-3 animate-spin" />}
                  {status}
                </span>
                <span>{text.length.toLocaleString()} 字符</span>
              </>
            }
          >
            <CodeEditor
              value={text}
              onChange={setText}
              extensions={extensions}
              placeholder="在这里输入要测试的文本…"
              aria-label="测试文本"
            />
          </EditorPane>

          <AnimatePresence initial={false}>
            {mode === 'replace' && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              >
                <EditorPane
                  title={
                    <span className="flex items-center gap-2">
                      替换结果
                      {okRes?.replace && (
                        <span className="rounded-full bg-sys-green/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                          替换 {okRes.replace.count.toLocaleString()} 处
                        </span>
                      )}
                    </span>
                  }
                  height="auto"
                  actions={
                    <CopyButton text={okRes?.replace?.output ?? ''} disabled={!okRes?.replace} />
                  }
                >
                  <div className="thin-scrollbar max-h-[360px] overflow-auto" data-lenis-prevent>
                    {okRes?.replace ? (
                      <ReplacePreview output={okRes.replace.output} spans={okRes.replace.spans} />
                    ) : (
                      <p className="px-4 py-6 text-sm text-fg-3">
                        {pattern ? '等待匹配结果…' : '输入正则表达式后显示替换结果'}
                      </p>
                    )}
                  </div>
                </EditorPane>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
          <Tabs
            items={tabs}
            value={o.tab}
            onChange={(v) => {
              // 列表卸载时收不到 mouseleave，这里手动清掉悬停高亮
              setActive(-1)
              patch({ tab: v })
            }}
            className="px-3"
          />
          <div
            className="thin-scrollbar max-h-[clamp(360px,70vh,720px)] min-h-72 overflow-auto p-3 sm:p-4"
            data-lenis-prevent
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={o.tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
              >
                {o.tab === 'matches' &&
                  (!pattern ? (
                    <p className="px-2 py-14 text-center text-sm text-fg-3">
                      在上方输入正则表达式，或从「常用正则库」选一个
                    </p>
                  ) : compileError ? (
                    <p className="px-2 py-14 text-center text-sm text-fg-3">表达式有误，请先修正</p>
                  ) : timedOut ? (
                    <p className="px-2 py-14 text-center text-sm text-warning">匹配已中止</p>
                  ) : !res ? (
                    <p className="flex items-center justify-center gap-2 px-2 py-14 text-sm text-fg-3">
                      <LoaderCircle className="size-4 animate-spin" />
                      匹配中…
                    </p>
                  ) : (
                    <MatchList
                      matches={matches}
                      text={resultText}
                      stale={pending}
                      active={active}
                      onHover={setActive}
                      onReveal={(m) => revealRange(handle, m.start, m.end)}
                    />
                  ))}
                {o.tab === 'explain' && <ExplainPanel nodes={nodes} />}
                {o.tab === 'code' && (
                  <CodePanel
                    lang={o.lang}
                    onLang={(l) => patch({ lang: l })}
                    pattern={pattern}
                    flags={flags}
                    text={text}
                    replacement={mode === 'replace' ? replacement : undefined}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <LibraryPanel currentPattern={pattern} onPick={pick} />
    </div>
  )
}

function ReplacePreview({
  output,
  spans,
}: {
  output: string
  spans: { start: number; end: number }[]
}) {
  const parts = useMemo(() => {
    const out: { t: string; hl: boolean }[] = []
    let last = 0
    for (const s of spans) {
      if (s.start > last) out.push({ t: output.slice(last, s.start), hl: false })
      out.push({ t: output.slice(s.start, s.end), hl: true })
      last = s.end
    }
    if (last < output.length) out.push({ t: output.slice(last), hl: false })
    return out
  }, [output, spans])

  if (!output) return <p className="px-4 py-6 text-sm text-fg-3">（替换后为空）</p>
  return (
    <pre className="px-4 py-3 font-mono text-[13px] leading-[1.6] break-all whitespace-pre-wrap text-fg">
      {parts.map((p, i) =>
        p.hl ? (
          p.t ? (
            <mark key={i} className="rounded-[3px] bg-sys-green/25 text-fg">
              {p.t}
            </mark>
          ) : (
            <span
              key={i}
              aria-hidden
              className="mx-[-1px] inline-block h-[1.1em] w-[2px] rounded-sm bg-sys-green align-text-bottom"
            />
          )
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </pre>
  )
}
