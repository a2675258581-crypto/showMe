import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeftToLine,
  ClipboardPaste,
  Download,
  FolderOpen,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react'
import { EditorPane } from '@/components/editor/IOPanel'
import { Button, CopyButton, ErrorNotice, Kbd, Panel, useToast } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { modKey, useHotkey } from '@/hooks/useHotkey'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { readClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { downloadText, formatBytes } from '@/lib/file'
import { countLines, formatReadingTime, textStats } from '@/lib/text-toolkit'
import { AnimatedNumber } from '@/components/motion/AnimatedNumber'
import { OpOptions } from './OpOptions'
import {
  ALL_OPS,
  OP_GROUPS,
  safeRunOp,
  sanitizeOptions,
  SAMPLE_TEXT,
  type OpId,
  type ToolkitOptions,
} from './operations'

/** 超过这个长度才防抖 */
const INSTANT_LIMIT = 50_000
const PANE_HEIGHT = 'clamp(240px, 46vh, 520px)'
const HISTORY_MAX = 50

const TILES = [
  { key: 'chars', label: '字符数', color: 'var(--sys-blue)' },
  { key: 'charsNoSpace', label: '不含空白', color: 'var(--sys-indigo)' },
  { key: 'chinese', label: '中文字数', color: 'var(--sys-red)' },
  { key: 'words', label: '英文单词', color: 'var(--sys-orange)' },
  { key: 'lines', label: '行数', color: 'var(--sys-green)' },
  { key: 'paragraphs', label: '段落数', color: 'var(--sys-teal)' },
  { key: 'bytes', label: 'UTF-8 字节', color: 'var(--sys-purple)' },
  { key: 'readingSeconds', label: '预计阅读', color: 'var(--sys-pink)' },
] as const

/** 文本框只能保存 \n 换行：读入的文件 / 剪贴板先统一，统计与显示才一致 */
const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n')

const textareaCls =
  'thin-scrollbar block h-full w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-3'

export default function TextToolkit() {
  const toast = useToast()
  const [stored, setStored] = useLocalStorage<Partial<ToolkitOptions>>(
    'text-toolkit.options.v1',
    {},
  )
  const o = useMemo(() => sanitizeOptions(stored), [stored])
  const patch = useCallback(
    (p: Partial<ToolkitOptions>) => setStored((prev) => ({ ...sanitizeOptions(prev), ...p })),
    [setStored],
  )

  const [input, setInput] = useState(SAMPLE_TEXT)
  const [history, setHistory] = useState<string[]>([])
  const [seed, setSeed] = useState(1)

  const debounced = useDebounced(input, 200)
  const source = input.length <= INSTANT_LIMIT ? input : debounced
  const busy = source !== input
  const stats = useMemo(() => textStats(source), [source])
  const result = useMemo(() => safeRunOp(source, o, seed), [source, o, seed])
  const op = ALL_OPS.find((x) => x.id === o.op) ?? ALL_OPS[0]
  const output = result.error ? '' : result.output

  /** 程序性修改输入时记入历史，便于撤销 */
  const commit = (next: string) => {
    if (next === input) return
    setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), input])
    setInput(next)
  }

  const undo = () => {
    const last = history[history.length - 1]
    if (last === undefined) return
    setHistory(history.slice(0, -1))
    setInput(last)
    toast('已撤销', 'info')
  }

  const apply = () => {
    if (result.error || output === input) return
    commit(output)
    toast('已应用到输入', 'success')
  }

  useHotkey('mod+enter', (e) => {
    e.preventDefault()
    apply()
  })

  const paste = async () => {
    const t = await readClipboard()
    if (t === null) toast('无法读取剪贴板，请直接在输入框里粘贴', 'error')
    else commit(normalizeEol(t))
  }

  const openFile = () => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.txt,.md,.csv,.log,.json,.sql,text/*'
    el.onchange = async () => {
      const f = el.files?.[0]
      if (f) commit(normalizeEol(await f.text()))
    }
    el.click()
  }

  const selectOp = (id: OpId) => patch({ op: id })

  return (
    <div className="flex flex-col gap-4">
      {/* 实时统计 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((t, i) => (
          <motion.div
            key={t.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, type: 'spring', stiffness: 380, damping: 30 }}
            className="relative min-w-0 overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-card"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-fg-2">
              <span className="size-1.5 rounded-full" style={{ background: t.color }} aria-hidden />
              {t.label}
            </div>
            <div className="mt-1 truncate text-[22px] font-semibold tracking-tight text-fg sm:text-2xl">
              {t.key === 'readingSeconds' ? (
                <AnimatedNumber value={stats.readingSeconds} format={fmtReading} />
              ) : (
                <AnimatedNumber value={stats[t.key]} />
              )}
            </div>
            {t.key === 'bytes' && stats.bytes >= 1024 && (
              <div className="text-[11px] text-fg-3 tabular-nums">{formatBytes(stats.bytes)}</div>
            )}
          </motion.div>
        ))}
      </div>

      {/* 操作 */}
      <Panel className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {OP_GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
              <div className="shrink-0 pt-1.5 text-xs font-semibold tracking-wide text-fg-3 sm:w-20">
                {g.title}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.ops.map((x) => {
                  const active = x.id === o.op
                  const Icon = x.icon
                  return (
                    <motion.button
                      key={x.id}
                      type="button"
                      onClick={() => selectOp(x.id)}
                      whileTap={{ scale: 0.95 }}
                      aria-pressed={active}
                      className={cn(
                        'relative isolate inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                        active ? 'text-white' : 'bg-fill text-fg hover:bg-fill-3',
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="text-toolkit-active-op"
                          className="absolute inset-0 -z-10 rounded-full bg-accent shadow-sm shadow-accent/30"
                          transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                        />
                      )}
                      <Icon className="size-3.5" />
                      {x.label}
                    </motion.button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-line pt-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={op.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-fg">
                <op.icon className="size-4 text-accent" />
                {op.label}
              </div>
              <OpOptions op={op} o={o} patch={patch} onReshuffle={() => setSeed((s) => s + 1)} />
            </motion.div>
          </AnimatePresence>
        </div>
        <ErrorNotice error={result.error} />
      </Panel>

      {/* 输入 / 输出 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <EditorPane
          title="输入"
          height={PANE_HEIGHT}
          onDropFile={async (f) => commit(normalizeEol(await f.text()))}
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles />}
                onClick={() => commit(SAMPLE_TEXT)}
              >
                示例
              </Button>
              <Button size="sm" variant="ghost" icon={<ClipboardPaste />} onClick={paste}>
                粘贴
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<FolderOpen />}
                iconOnly
                title="打开文件"
                aria-label="打开文件"
                onClick={openFile}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Undo2 />}
                iconOnly
                title="撤销上一次修改"
                aria-label="撤销"
                disabled={!history.length}
                onClick={undo}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 />}
                iconOnly
                title="清空"
                aria-label="清空"
                disabled={!input}
                onClick={() => commit('')}
              />
            </>
          }
          footer={
            <>
              <span>
                {stats.chars.toLocaleString()} 字符 · {stats.lines.toLocaleString()} 行
              </span>
              <span>{busy ? '计算中…' : history.length ? `可撤销 ${history.length} 步` : ''}</span>
            </>
          }
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="在此输入或粘贴文本，也可以把文件拖进来…"
            aria-label="输入文本"
            className={textareaCls}
          />
        </EditorPane>

        <EditorPane
          title={
            <span className="flex items-center gap-2">
              结果
              <AnimatePresence mode="popLayout" initial={false}>
                {result.info && !result.error && (
                  <motion.span
                    key={result.info}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent"
                  >
                    {result.info}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          }
          height={PANE_HEIGHT}
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                icon={<ArrowLeftToLine />}
                onClick={apply}
                disabled={!!result.error || output === input}
                title={`把结果作为新的输入，继续叠加其它操作（${modKey}+Enter）`}
              >
                应用到输入
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Download />}
                iconOnly
                title="下载"
                aria-label="下载结果"
                disabled={!output}
                onClick={() => downloadText('result.txt', output)}
              />
              <CopyButton text={output} disabled={!output} />
            </>
          }
          footer={
            <>
              <span>
                {output.length.toLocaleString()} 字符 · {countLines(output).toLocaleString()} 行
              </span>
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Kbd>{modKey}</Kbd>
                <Kbd>↵</Kbd> 应用到输入
              </span>
            </>
          }
        >
          <textarea
            value={output}
            readOnly
            spellCheck={false}
            placeholder={input ? '没有输出' : '输入文本后，选择上方的操作即可看到结果'}
            aria-label="处理结果"
            className={textareaCls}
          />
        </EditorPane>
      </div>
    </div>
  )
}

function fmtReading(v: number) {
  return formatReadingTime(Math.round(v))
}
