import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bold,
  Code,
  Columns2,
  Eye,
  FileCode2,
  FileDown,
  FolderOpen,
  Heading,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  PencilLine,
  Quote,
  Sparkles,
  Strikethrough,
  Table,
  Trash2,
} from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EditorPane } from '@/components/editor/IOPanel'
import {
  Button,
  CopyButton,
  ErrorNotice,
  SegmentedControl,
  Switch,
  useToast,
  type SegmentOption,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { modKey } from '@/hooks/useHotkey'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { downloadText } from '@/lib/file'
import {
  buildStandaloneHtml,
  documentTitle,
  exportFileName,
  headingLines,
  markdownStats,
  renderMarkdown,
} from '@/lib/markdown-preview'
import type { FormatAction } from '@/lib/markdown-preview-format'
import { MARKDOWN_SAMPLE } from '@/lib/markdown-preview-sample'
import {
  bridgeExtensions,
  createBridge,
  revealLine,
  runFormat,
  setScrollListener,
} from './editorBridge'
import { PROSE } from './prose'
import { ID_PREFIX, sanitizeHtml } from './sanitize'
import { Toc } from './Toc'

type ViewMode = 'edit' | 'split' | 'preview'

interface Options {
  view: ViewMode
  toc: boolean
  sync: boolean
}

const DEFAULTS: Options = { view: 'split', toc: true, sync: true }

function sanitizeOptions(raw: unknown): Options {
  const o: Options = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (!['edit', 'split', 'preview'].includes(o.view)) o.view = DEFAULTS.view
  if (typeof o.toc !== 'boolean') o.toc = DEFAULTS.toc
  if (typeof o.sync !== 'boolean') o.sync = DEFAULTS.sync
  return o
}

const VIEWS: SegmentOption<ViewMode>[] = [
  {
    value: 'edit',
    label: (
      <>
        <PencilLine />
        编辑
      </>
    ),
  },
  {
    value: 'split',
    label: (
      <>
        <Columns2 />
        分栏
      </>
    ),
  },
  {
    value: 'preview',
    label: (
      <>
        <Eye />
        预览
      </>
    ),
  },
]

const TOOLS: { action: FormatAction; icon: ReactNode; label: string; keys?: string }[] = [
  { action: 'bold', icon: <Bold />, label: '粗体', keys: `${modKey}+B` },
  { action: 'italic', icon: <Italic />, label: '斜体', keys: `${modKey}+I` },
  { action: 'strike', icon: <Strikethrough />, label: '删除线', keys: `${modKey}+Shift+X` },
  { action: 'heading', icon: <Heading />, label: '标题（连续点击切换级别）' },
  { action: 'link', icon: <Link />, label: '链接', keys: `${modKey}+Shift+K` },
  { action: 'image', icon: <Image />, label: '图片' },
  { action: 'code', icon: <Code />, label: '代码（多行选区生成代码块）' },
  { action: 'ul', icon: <List />, label: '无序列表' },
  { action: 'ol', icon: <ListOrdered />, label: '有序列表' },
  { action: 'task', icon: <ListChecks />, label: '任务列表' },
  { action: 'table', icon: <Table />, label: '表格（可把逗号分隔的选区转成表格）' },
  { action: 'quote', icon: <Quote />, label: '引用' },
  { action: 'hr', icon: <Minus />, label: '分隔线' },
]

const PANE_HEIGHT = 'clamp(380px, 72vh, 860px)'

/** 打开的文件统一成 \n 换行（编辑器内部也是这样存的） */
const normalizeEol = (s: string) => s.replace(/\r\n?/g, '\n')

/** 预览里的 id 都带 user-content- 前缀（见 sanitize.ts）；也兼容原样的 id */
function findAnchor(box: HTMLElement, id: string): HTMLElement | null {
  return (
    box.querySelector<HTMLElement>(`#${CSS.escape(ID_PREFIX + id)}`) ??
    box.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
  )
}
/** 超过这个长度才防抖渲染 */
const INSTANT_LIMIT = 30_000

export default function MarkdownPreview() {
  const toast = useToast()
  const [stored, setStored] = useLocalStorage<Partial<Options>>('markdown-preview.options.v1', {})
  const o = useMemo(() => sanitizeOptions(stored), [stored])
  const patch = useCallback(
    (p: Partial<Options>) => setStored((prev) => ({ ...sanitizeOptions(prev), ...p })),
    [setStored],
  )

  const [md, setMd] = useState(MARKDOWN_SAMPLE)
  const debounced = useDebounced(md, 250)
  const src = md.length <= INSTANT_LIMIT ? md : debounced
  const rendered = useMemo(() => renderMarkdown(src, { copyButtons: true }), [src])
  const html = useMemo(() => sanitizeHtml(rendered.html, true), [rendered])
  const stats = useMemo(() => markdownStats(src), [src])
  const lines = useMemo(() => headingLines(src), [src])
  const toc = rendered.toc

  const [bridge] = useState(createBridge)
  const extensions = useMemo(() => bridgeExtensions(bridge), [bridge])
  const previewRef = useRef<HTMLDivElement>(null)
  const [activeHeading, setActiveHeading] = useState(-1)

  const showEditor = o.view !== 'preview'
  const showPreview = o.view !== 'edit'

  // ───── 同步滚动（按比例） ─────
  const lock = useRef<{ who: string; until: number } | null>(null)
  const syncScroll = useCallback(
    (from: HTMLElement, to: HTMLElement | null | undefined, who: string) => {
      if (!to) return
      const now = performance.now()
      const l = lock.current
      if (l && l.who !== who && now < l.until) return
      lock.current = { who, until: now + 120 }
      const max = from.scrollHeight - from.clientHeight
      const ratio = max > 0 ? from.scrollTop / max : 0
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
    },
    [],
  )

  useEffect(() => {
    if (o.view !== 'split' || !o.sync) {
      setScrollListener(bridge, null)
      return
    }
    setScrollListener(bridge, (el) => syncScroll(el, previewRef.current, 'editor'))
    return () => setScrollListener(bridge, null)
  }, [bridge, o.view, o.sync, syncScroll])

  // ───── 当前阅读位置 → 目录高亮 ─────
  const frame = useRef(0)
  const updateActive = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const box = previewRef.current
      if (!box) return
      // 刚点过目录：平滑滚动途中不改高亮（靠近文末的标题滚不到顶部，否则会跳到上一个标题）
      const l = lock.current
      if (l && l.who === 'toc' && performance.now() < l.until) return
      let idx = -1
      for (let i = 0; i < toc.length; i++) {
        const el = findAnchor(box, toc[i].id)
        if (!el) continue
        if (el.offsetTop - box.scrollTop <= 32) idx = i
        else break
      }
      if (idx === -1 && toc.length) idx = 0
      // 已滚到底：最后一个标题也算读到了
      const scrollable = box.scrollHeight > box.clientHeight + 4
      if (scrollable && box.scrollTop + box.clientHeight >= box.scrollHeight - 4 && toc.length) {
        idx = toc.length - 1
      }
      setActiveHeading(idx)
    })
  }, [toc])
  useEffect(() => {
    updateActive()
    return () => cancelAnimationFrame(frame.current)
  }, [updateActive, html, o.view])

  const onPreviewScroll = () => {
    if (o.view === 'split' && o.sync)
      syncScroll(previewRef.current!, bridge.view?.scrollDOM, 'preview')
    updateActive()
  }

  const scrollPreviewTo = (id: string) => {
    const box = previewRef.current
    const el = box ? findAnchor(box, id) : null
    if (!box || !el) return
    box.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: 'smooth' })
    el.animate(
      [
        { backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
        { backgroundColor: 'transparent' },
      ],
      { duration: 1400, easing: 'ease-out' },
    )
  }

  const pickHeading = (i: number) => {
    // 暂停同步，避免两边互相拉扯
    lock.current = { who: 'toc', until: performance.now() + 900 }
    setActiveHeading(i)
    if (showPreview) scrollPreviewTo(toc[i].id)
    if (showEditor && lines.length === toc.length) revealLine(bridge, lines[i])
  }

  const onPreviewClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    const copyBtn = t.closest('[data-md-copy]')
    if (copyBtn) {
      const code = copyBtn.closest('.md-code')?.querySelector('code')?.textContent ?? ''
      copyText(code.replace(/\n$/, '')).then((ok) =>
        toast(ok ? '代码已复制' : '复制失败', ok ? 'success' : 'error'),
      )
      return
    }
    const a = t.closest('a')
    const href = a?.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      e.preventDefault()
      let id = href.slice(1)
      try {
        id = decodeURIComponent(id)
      } catch {
        /* 保持原样 */
      }
      scrollPreviewTo(id)
    }
  }

  const format = (action: FormatAction) => {
    if (!runFormat(bridge, action)) toast('请先切换到「编辑」或「分栏」视图', 'info')
  }

  // ───── 导出 ─────
  const title = documentTitle(toc)
  const exportBody = () => sanitizeHtml(renderMarkdown(md).html)
  const downloadHtml = () => {
    downloadText(
      exportFileName(title, 'html'),
      buildStandaloneHtml(exportBody(), title),
      'text/html;charset=utf-8',
    )
    toast('已导出 HTML', 'success')
  }
  const downloadMd = () => {
    downloadText(exportFileName(title, 'md'), md, 'text/markdown;charset=utf-8')
    toast('已下载 .md', 'success')
  }

  const openFile = () => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.md,.markdown,.mdx,.txt,text/markdown,text/plain'
    el.onchange = async () => {
      const f = el.files?.[0]
      if (f) setMd(normalizeEol(await f.text()))
    }
    el.click()
  }

  const cols =
    o.view === 'split'
      ? o.toc
        ? 'lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_15rem]'
        : 'lg:grid-cols-2'
      : o.toc
        ? 'lg:grid-cols-[minmax(0,1fr)_15rem]'
        : ''

  return (
    <div className="flex flex-col gap-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-3xl border border-line bg-surface px-3 py-2.5 shadow-card">
        <SegmentedControl
          options={VIEWS}
          value={o.view}
          onChange={(v) => patch({ view: v })}
          aria-label="视图"
        />
        <div
          className={cn(
            'flex max-w-full min-w-0 flex-wrap items-center gap-0.5 transition-opacity',
            !showEditor && 'pointer-events-none opacity-40',
          )}
          role="toolbar"
          aria-label="格式"
        >
          {TOOLS.map((t) => (
            <Button
              key={t.action}
              size="sm"
              variant="ghost"
              iconOnly
              icon={t.icon}
              title={t.keys ? `${t.label}（${t.keys}）` : t.label}
              aria-label={t.label}
              disabled={!showEditor}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => format(t.action)}
            />
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {o.view === 'split' && (
            <Switch
              checked={o.sync}
              onChange={(v) => patch({ sync: v })}
              label={<span className="text-[13px]">同步滚动</span>}
              className="mr-2"
            />
          )}
          <Button
            size="sm"
            variant={o.toc ? 'secondary' : 'ghost'}
            icon={<ListTree />}
            aria-pressed={o.toc}
            onClick={() => patch({ toc: !o.toc })}
          >
            目录
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<FileCode2 />}
            onClick={downloadHtml}
            disabled={!md.trim()}
            title="下载带样式的独立 HTML 文件（浅色主题）"
          >
            HTML
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<FileDown />}
            onClick={downloadMd}
            disabled={!md}
            title="下载 Markdown 源文件"
          >
            .md
          </Button>
          <CopyButton text={exportBody} label="复制 HTML" disabled={!md.trim()} />
        </div>
      </div>

      <ErrorNotice error={rendered.error} />

      <div className={cn('grid gap-4', cols)}>
        <AnimatePresence initial={false} mode="popLayout">
          {showEditor && (
            <motion.div
              key="editor"
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="min-w-0"
            >
              <EditorPane
                title="Markdown"
                height={PANE_HEIGHT}
                onDropFile={async (f) => setMd(normalizeEol(await f.text()))}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Sparkles />}
                      onClick={() => setMd(MARKDOWN_SAMPLE)}
                    >
                      示例
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<FolderOpen />}
                      iconOnly
                      title="打开 .md 文件"
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
                      disabled={!md}
                      onClick={() => setMd('')}
                    />
                  </>
                }
                footer={
                  <StatsLine words={stats.words} lines={stats.lines} reading={stats.readingText} />
                }
              >
                <CodeEditor
                  value={md}
                  onChange={setMd}
                  lang="markdown"
                  extensions={extensions}
                  placeholder="在这里输入 Markdown…"
                  aria-label="Markdown 编辑器"
                />
              </EditorPane>
            </motion.div>
          )}

          {showPreview && (
            <motion.div
              key="preview"
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card"
            >
              <div className="flex min-h-12 items-center justify-between gap-2 border-b border-line px-4 py-2">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
                  预览
                  {md !== src && <span className="text-[11px] font-normal text-fg-3">渲染中…</span>}
                </div>
                {!showEditor && (
                  <StatsLine words={stats.words} lines={stats.lines} reading={stats.readingText} />
                )}
              </div>
              <div
                ref={previewRef}
                onScroll={onPreviewScroll}
                onClick={onPreviewClick}
                data-lenis-prevent
                className="thin-scrollbar relative min-h-0 overflow-auto"
                style={{ height: PANE_HEIGHT }}
              >
                {html ? (
                  <article
                    className={cn(
                      PROSE,
                      'mx-auto px-6 py-6 sm:px-9 sm:py-8',
                      o.view === 'preview' && 'max-w-3xl',
                    )}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-fg-3">
                    <Eye className="size-6" />
                    在左侧输入 Markdown，这里会实时显示排版效果
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {o.toc && (
            <motion.div
              key="toc"
              layout
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className={cn(
                'flex max-h-80 min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card lg:max-h-none',
                o.view === 'split' && 'lg:col-span-2 lg:max-h-72 xl:col-span-1 xl:max-h-none',
              )}
            >
              <Toc items={toc} active={activeHeading} onPick={pickHeading} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function StatsLine({ words, lines, reading }: { words: number; lines: number; reading: string }) {
  return (
    <span className="flex items-center gap-3 text-[11px] text-fg-3 tabular-nums">
      <span>{words.toLocaleString()} 字</span>
      <span>{lines.toLocaleString()} 行</span>
      <span>阅读 {reading}</span>
    </span>
  )
}
