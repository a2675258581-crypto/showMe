import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Braces,
  CircleCheck,
  ClipboardPaste,
  Code,
  CornerUpLeft,
  Download,
  FolderOpen,
  ListTree,
  LocateFixed,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EditorPane } from '@/components/editor/IOPanel'
import {
  Badge,
  Button,
  CopyButton,
  ErrorNotice,
  Notice,
  SegmentedControl,
  Select,
  Switch,
  useToast,
  type SegmentOption,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { readClipboard } from '@/lib/clipboard'
import { downloadText, formatBytes } from '@/lib/file'
import {
  DEFAULT_JSON_OPTIONS,
  formatIssue,
  LENIENT_FIX_LABELS,
  processJson,
  utf8Length,
  type IndentOption,
  type JsonIssue,
  type JsonMode,
  type JsonToolOptions,
  type JsonToolResult,
  type LenientFix,
} from '@/lib/json-formatter'
import {
  ALL_SAMPLES,
  SAMPLE_ESCAPE,
  SAMPLE_JSON,
  SAMPLE_JSON5,
  SAMPLE_UNESCAPE,
} from '@/lib/json-formatter-samples'
import { CodeFrameView } from '@/components/editor/CodeFrameView'
import { createEditorHandle, errorExtensions, jumpToMark, showErrorMark } from './editorError'
import { JsonTree } from './JsonTree'

type View = 'code' | 'tree'

/** 输出编辑器的 props 都是原始值：memo 后，输入框打字时不会连带重配置（可能很大的）输出编辑器 */
const OutputEditor = memo(CodeEditor)

interface Options extends JsonToolOptions {
  view: View
}

const DEFAULTS: Options = { ...DEFAULT_JSON_OPTIONS, view: 'code' }

const MODES: SegmentOption<JsonMode>[] = [
  { value: 'format', label: '格式化', title: '美化缩进' },
  { value: 'minify', label: '压缩', title: '去掉所有空白，压成一行' },
  { value: 'escape', label: '转义', title: '把内容转成 JSON 字符串字面量' },
  { value: 'unescape', label: '去转义', title: '还原被转义的 JSON 字符串，支持多层转义' },
]

const VIEWS: SegmentOption<View>[] = [
  {
    value: 'code',
    label: (
      <>
        <Code />
        代码
      </>
    ),
  },
  {
    value: 'tree',
    label: (
      <>
        <ListTree />
        树形
      </>
    ),
  },
]

const INDENTS = [
  { value: '2', label: '2 空格' },
  { value: '4', label: '4 空格' },
  { value: 'tab', label: 'Tab' },
]

/** 超过这个长度才防抖；小输入即时计算 */
const INSTANT_LIMIT = 50_000

const BOOL_KEYS = ['sortKeys', 'lenient', 'escapeUnicode', 'quotes', 'compactBeforeEscape'] as const

function sanitize(raw: unknown): Options {
  const o: Options = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (!MODES.some((m) => m.value === o.mode)) o.mode = DEFAULTS.mode
  if (o.indent !== 2 && o.indent !== 4 && o.indent !== 'tab') o.indent = DEFAULTS.indent
  if (o.view !== 'code' && o.view !== 'tree') o.view = DEFAULTS.view
  for (const k of BOOL_KEYS) if (typeof o[k] !== 'boolean') o[k] = DEFAULTS[k]
  return o
}

function sampleFor(o: Pick<Options, 'mode' | 'lenient'>): string {
  if (o.mode === 'escape') return SAMPLE_ESCAPE
  if (o.mode === 'unescape') return SAMPLE_UNESCAPE
  return o.lenient ? SAMPLE_JSON5 : SAMPLE_JSON
}

function safeProcess(input: string, opts: Options): JsonToolResult {
  try {
    return processJson(input, opts)
  } catch (e) {
    return {
      status: 'error',
      error: {
        message: `处理失败：${e instanceof Error ? e.message : String(e)}`,
        line: 1,
        column: 1,
        offset: 0,
      },
      source: input,
      inInput: false,
    }
  }
}

/**
 * 拖入文件时应「替换」输入（由 EditorPane 的 onDropFile 处理）。CodeMirror 自己也处理文件拖放，
 * 会把文件内容插到光标处、和原内容混在一起；它会跳过 defaultPrevented 的事件，
 * 所以在捕获阶段先 preventDefault，事件照常冒泡到 EditorPane。
 */
function keepFileDropForPane(e: DragEvent) {
  if (e.dataTransfer.files.length > 0) e.preventDefault()
}

function lineCount(s: string): number {
  if (!s) return 0
  let n = 1
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++
  return n
}

export default function JsonFormatter() {
  const toast = useToast()
  const [stored, setStored] = useLocalStorage<Partial<Options>>('json-formatter.options.v1', {})
  const opts = useMemo(() => sanitize(stored), [stored])
  const patch = useCallback(
    (p: Partial<Options>) => setStored((prev) => ({ ...sanitize(prev), ...p })),
    [setStored],
  )

  const [input, setInput] = useState(() => sampleFor(opts))
  const debounced = useDebounced(input, 250)
  const source = input.length <= INSTANT_LIMIT ? input : debounced
  const busy = source !== input
  const result = useMemo(() => safeProcess(source, opts), [source, opts])

  // 输入框里的错误高亮与「定位到错误」
  const [handle] = useState(createEditorHandle)
  const extensions = useMemo(() => errorExtensions(handle), [handle])
  // 每次结果变化都重新标记（即使行列号没变，编辑也可能把旧标记映射到别处或删掉）
  useEffect(() => {
    showErrorMark(
      handle,
      result.status === 'error' && result.inInput
        ? { line: result.error.line, column: result.error.column }
        : null,
    )
  }, [handle, result])

  const ok = result.status === 'ok' ? result : null
  const output = ok?.output ?? ''
  const canTree = !!ok?.value
  const view: View = canTree ? opts.view : 'code'

  // 大输入时字节数 / 行数跟着防抖后的 source 更新，避免每敲一个字都全文扫描
  const inBytes = useMemo(() => utf8Length(source), [source])
  const inLines = useMemo(() => lineCount(source), [source])
  const outBytes = useMemo(() => utf8Length(output), [output])

  const setMode = (mode: JsonMode) => {
    // 还是示例内容时，顺手换成对应模式的示例
    if (ALL_SAMPLES.includes(input)) setInput(sampleFor({ mode, lenient: opts.lenient }))
    patch({ mode })
  }

  const openFile = () => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.json,.json5,.jsonc,.geojson,.txt,.log,application/json,text/plain'
    el.onchange = async () => {
      const f = el.files?.[0]
      if (f) setInput(await f.text())
    }
    el.click()
  }

  const paste = async () => {
    const t = await readClipboard()
    if (t === null) toast('无法读取剪贴板，请直接在输入框里粘贴', 'error')
    else setInput(t)
  }

  const downloadName =
    opts.mode === 'minify'
      ? 'minified.json'
      : opts.mode === 'escape'
        ? 'escaped.txt'
        : ok?.outputIsJson
          ? 'formatted.json'
          : 'output.txt'

  const fixes = ok
    ? (Object.entries(ok.fixes) as [LenientFix, number][]).filter(([, n]) => n > 0)
    : []

  return (
    <div className="flex flex-col gap-4" onDropCapture={keepFileDropForPane}>
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card">
        <SegmentedControl options={MODES} value={opts.mode} onChange={setMode} aria-label="模式" />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          {(opts.mode === 'format' || opts.mode === 'unescape') && (
            <Select
              size="sm"
              value={String(opts.indent)}
              options={INDENTS}
              onChange={(v) => patch({ indent: (v === 'tab' ? 'tab' : Number(v)) as IndentOption })}
              aria-label="缩进"
            />
          )}
          {opts.mode === 'escape' ? (
            <>
              <Switch
                checked={opts.compactBeforeEscape}
                onChange={(v) => patch({ compactBeforeEscape: v })}
                label={<span className="text-[13px]">先压缩</span>}
              />
              <Switch
                checked={opts.quotes}
                onChange={(v) => patch({ quotes: v })}
                label={<span className="text-[13px]">外层引号</span>}
              />
            </>
          ) : (
            <Switch
              checked={opts.sortKeys}
              onChange={(v) => patch({ sortKeys: v })}
              label={<span className="text-[13px]">键排序</span>}
            />
          )}
          <span
            className="flex"
            title="允许注释、尾随逗号、单引号、无引号键名、十六进制、NaN / Infinity（JSON5 风格），输出仍是标准 JSON"
          >
            <Switch
              checked={opts.lenient}
              onChange={(v) => patch({ lenient: v })}
              label={<span className="text-[13px]">宽松模式</span>}
            />
          </span>
          <span className="flex" title="把中文等非 ASCII 字符写成 \uXXXX 形式">
            <Switch
              checked={opts.escapeUnicode}
              onChange={(v) => patch({ escapeUnicode: v })}
              label={<span className="text-[13px]">非 ASCII 转义</span>}
            />
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 输入 */}
        <EditorPane
          title="输入"
          onDropFile={async (f) => setInput(await f.text())}
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles />}
                onClick={() => setInput(sampleFor(opts))}
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
                icon={<Trash2 />}
                iconOnly
                title="清空"
                aria-label="清空"
                disabled={!input}
                onClick={() => setInput('')}
              />
            </>
          }
          footer={
            <>
              <span>
                {formatBytes(inBytes)} · {input.length.toLocaleString()} 字符
              </span>
              <span className="flex items-center gap-2">
                {busy && <span className="animate-pulse text-accent">计算中…</span>}
                {inLines.toLocaleString()} 行
              </span>
            </>
          }
        >
          <CodeEditor
            value={input}
            onChange={setInput}
            lang={opts.lenient ? 'javascript' : 'json'}
            placeholder={
              opts.mode === 'unescape'
                ? '粘贴被转义的 JSON 字符串，例如 "{\\"a\\":1}"'
                : opts.mode === 'escape'
                  ? '输入要转义的文本或 JSON…'
                  : '在此粘贴 JSON，或拖入 .json 文件…'
            }
            extensions={extensions}
            aria-label="输入"
          />
        </EditorPane>

        {/* 输出 */}
        <EditorPane
          title={
            <span className="flex items-center gap-2">
              输出
              <StatusBadge result={result} />
            </span>
          }
          actions={
            <>
              {canTree && (
                <SegmentedControl
                  size="sm"
                  options={VIEWS}
                  value={view}
                  onChange={(v) => patch({ view: v })}
                  aria-label="输出视图"
                  // sm 分段控件比标题栏按钮高 2px：抵消掉，免得输出栏标题比输入栏高、两侧正文错开
                  className="mr-1"
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<CornerUpLeft />}
                iconOnly
                title="将结果作为输入"
                aria-label="将结果作为输入"
                disabled={!output}
                onClick={() => {
                  setInput(output)
                  if (opts.mode === 'unescape' && ok?.outputIsJson) patch({ mode: 'format' })
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Download />}
                iconOnly
                title="下载"
                aria-label="下载"
                disabled={!output}
                onClick={() =>
                  downloadText(
                    downloadName,
                    output,
                    ok?.outputIsJson ? 'application/json;charset=utf-8' : undefined,
                  )
                }
              />
              <CopyButton text={output} disabled={!output} />
            </>
          }
          footer={
            <OutputFooter result={result} inBytes={inBytes} outBytes={outBytes} mode={opts.mode} />
          }
        >
          {/* presenceAffectsLayout=false：否则每次重渲染都会生成新的 PresenceContext，
              输入框每敲一个字都会让整棵树里的 motion 组件跟着重渲染（大文档下打字明显卡顿） */}
          <AnimatePresence mode="wait" initial={false} presenceAffectsLayout={false}>
            <motion.div
              key={result.status === 'ok' ? `ok-${view}` : result.status}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {result.status === 'empty' && (
                <EmptyState onSample={() => setInput(sampleFor(opts))} />
              )}
              {result.status === 'error' && (
                <CodeFrameView
                  source={result.source}
                  line={result.error.line}
                  column={result.error.column}
                  message={result.error.message}
                  hint={result.error.hint}
                  actions={
                    <>
                      {result.inInput && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<LocateFixed />}
                          onClick={() =>
                            jumpToMark(handle, {
                              line: result.error.line,
                              column: result.error.column,
                            })
                          }
                        >
                          定位到错误
                        </Button>
                      )}
                      {result.error.lenientFixable && !opts.lenient && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Wand2 />}
                          onClick={() => patch({ lenient: true })}
                        >
                          开启宽松模式
                        </Button>
                      )}
                    </>
                  }
                />
              )}
              {ok &&
                (view === 'tree' && ok.value ? (
                  <JsonTree value={ok.value} sortKeys={opts.sortKeys} />
                ) : (
                  <OutputEditor
                    value={output}
                    lang={ok.outputIsJson ? 'json' : 'text'}
                    readOnly
                    aria-label="输出"
                  />
                ))}
            </motion.div>
          </AnimatePresence>
        </EditorPane>
      </div>

      {/* 提示区 */}
      <div className="flex flex-col gap-3 empty:hidden">
        <ErrorNotice
          error={
            result.status === 'error'
              ? formatIssue(result.error) + (result.error.hint ? `\n${result.error.hint}` : '')
              : null
          }
        />
        <AnimatePresence initial={false}>
          {ok?.suggestUnescape && opts.mode !== 'unescape' && (
            <Notice key="suggest" tone="info">
              根值是一个字符串，里面装着转义过的 JSON。
              <button
                type="button"
                onClick={() => setMode('unescape')}
                className="ml-1 font-semibold underline underline-offset-2"
              >
                切换到「去转义」
              </button>
            </Notice>
          )}
          {ok && ok.notes.length > 0 && (
            <Notice key={`notes-${ok.notes.join('|')}`} tone="info">
              {ok.notes.join('\n')}
            </Notice>
          )}
          {fixes.length > 0 && (
            <Notice key="fixes" tone="info">
              宽松模式已自动处理：
              {fixes.map(([k, n]) => `${LENIENT_FIX_LABELS[k]} ×${n}`).join(' · ')}
              。输出为标准 JSON{ok?.fixes.comment ? '，注释已移除' : ''}。
            </Notice>
          )}
          {ok?.stats && ok.stats.bigNumbers > 0 && (
            <Notice key="big" tone="success">
              {`检测到 ${ok.stats.bigNumbers} 个超出 JavaScript 精度的数字，已按原文完整保留。用 JSON.parse 处理时，12345678901234567890 会被悄悄改成 12345678901234567000。`}
            </Notice>
          )}
          {ok && ok.warnings.length > 0 && (
            <Notice key="warnings" tone="warning">
              <WarningList warnings={ok.warnings} />
            </Notice>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function StatusBadge({ result }: { result: JsonToolResult }) {
  let node: ReactNode = null
  let key = ''
  if (result.status === 'ok' && result.outputIsJson && result.value) {
    key = 'ok'
    node = (
      <Badge color="var(--success)" className="[&_svg]:size-3">
        <CircleCheck />
        合法 JSON
      </Badge>
    )
  } else if (result.status === 'error') {
    key = 'err'
    node = <Badge color="var(--danger)">第 {result.error.line} 行出错</Badge>
  }
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {node && (
        <motion.span
          key={key}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          className="inline-flex"
        >
          {node}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function OutputFooter({
  result,
  inBytes,
  outBytes,
  mode,
}: {
  result: JsonToolResult
  inBytes: number
  outBytes: number
  mode: JsonMode
}) {
  if (result.status !== 'ok') {
    return (
      <>
        <span>{result.status === 'error' ? '修正错误后会实时显示结果' : '等待输入'}</span>
        <span />
      </>
    )
  }
  const delta = inBytes > 0 ? Math.round(((outBytes - inBytes) / inBytes) * 100) : 0
  const st = result.stats
  return (
    <>
      <span className="flex items-center gap-1.5">
        {formatBytes(outBytes)}
        {mode === 'minify' && delta < 0 && (
          <span className="rounded-full bg-success/10 px-1.5 font-medium text-success">
            体积 −{Math.abs(delta)}%
          </span>
        )}
      </span>
      {st ? (
        <span className="flex items-center gap-2.5">
          <span title="对象键的总数">{st.keys.toLocaleString()} 个键</span>
          <span title="最大嵌套深度">深度 {st.maxDepth}</span>
          <span className="hidden sm:inline" title="值节点总数">
            {st.nodes.toLocaleString()} 个节点
          </span>
        </span>
      ) : (
        <span>{lineCount(result.output).toLocaleString()} 行</span>
      )}
    </>
  )
}

function WarningList({ warnings }: { warnings: JsonIssue[] }) {
  const shown = warnings.slice(0, 5)
  return (
    <div>
      <div className="font-semibold">发现 {warnings.length} 处可疑内容（不影响输出）</div>
      <ul className="mt-1 space-y-0.5">
        {shown.map((w, i) => (
          <li key={i}>
            {formatIssue(w)}
            {w.hint && <span className="opacity-75"> —— {w.hint}</span>}
          </li>
        ))}
      </ul>
      {warnings.length > shown.length && (
        <div className="mt-1 opacity-75">…还有 {warnings.length - shown.length} 处</div>
      )}
    </div>
  )
}

function EmptyState({ onSample }: { onSample: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <motion.span
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"
      >
        <Braces className="size-6" />
      </motion.span>
      <div>
        <div className="text-[15px] font-semibold text-fg">粘贴 JSON 开始</div>
        <div className="mt-1 text-[13px] text-fg-2">
          支持拖入文件；格式化、校验、树形浏览都在浏览器本地完成
        </div>
      </div>
      <Button size="sm" variant="secondary" icon={<Sparkles />} onClick={onSample}>
        载入示例
      </Button>
    </div>
  )
}
