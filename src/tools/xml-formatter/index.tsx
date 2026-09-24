import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EditorView } from '@codemirror/view'
import { CircleCheck, LocateFixed } from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import {
  Badge,
  Button,
  Notice,
  SegmentedControl,
  Select,
  Switch,
  type SegmentOption,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { formatBytes } from '@/lib/file'
import { columnToUtf16, utf8Length } from '@/lib/text-position'
import {
  DEFAULT_XML_OPTIONS,
  formatXml,
  formatXmlIssue,
  type AttrWrap,
  type XmlFormatResult,
  type XmlIssue,
} from '@/lib/xml-formatter'
import { XML_SAMPLES, type XmlSampleId } from '@/lib/xml-formatter-samples'
import { CodeFrameView } from '@/components/editor/CodeFrameView'

type Mode = 'format' | 'minify'

interface Options {
  mode: Mode
  indent: 2 | 4 | 'tab'
  keepComments: boolean
  selfClose: boolean
  attrWrap: AttrWrap
  sample: XmlSampleId
}

const DEFAULTS: Options = {
  mode: 'format',
  indent: DEFAULT_XML_OPTIONS.indent,
  keepComments: DEFAULT_XML_OPTIONS.keepComments,
  selfClose: DEFAULT_XML_OPTIONS.selfClose,
  attrWrap: DEFAULT_XML_OPTIONS.attrWrap,
  sample: 'rss',
}

const MODES: SegmentOption<Mode>[] = [
  { value: 'format', label: '格式化', title: '美化缩进' },
  { value: 'minify', label: '压缩', title: '去掉标签之间的空白，压成一行' },
]

const INDENTS = [
  { value: '2', label: '2 空格' },
  { value: '4', label: '4 空格' },
  { value: 'tab', label: 'Tab' },
]

const ATTR_WRAPS: { value: AttrWrap; label: string }[] = [
  { value: 'auto', label: '属性过长时换行' },
  { value: 'always', label: '每个属性一行' },
  { value: 'never', label: '属性不换行' },
]

const SAMPLE_OPTIONS = (Object.keys(XML_SAMPLES) as XmlSampleId[]).map((id) => ({
  value: id,
  label: `示例：${XML_SAMPLES[id].label}`,
}))

const INSTANT_LIMIT = 60_000

function sanitize(raw: unknown): Options {
  const o: Options = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (o.mode !== 'format' && o.mode !== 'minify') o.mode = DEFAULTS.mode
  if (o.indent !== 2 && o.indent !== 4 && o.indent !== 'tab') o.indent = DEFAULTS.indent
  if (!ATTR_WRAPS.some((a) => a.value === o.attrWrap)) o.attrWrap = DEFAULTS.attrWrap
  if (!(o.sample in XML_SAMPLES)) o.sample = DEFAULTS.sample
  if (typeof o.keepComments !== 'boolean') o.keepComments = DEFAULTS.keepComments
  if (typeof o.selfClose !== 'boolean') o.selfClose = DEFAULTS.selfClose
  return o
}

function safeFormat(input: string, o: Options): XmlFormatResult | null {
  if (!input.trim()) return null
  try {
    return formatXml(input, {
      indent: o.indent,
      minify: o.mode === 'minify',
      keepComments: o.keepComments,
      selfClose: o.selfClose,
      attrWrap: o.attrWrap,
    })
  } catch (e) {
    return {
      ok: false,
      error: {
        message: `处理失败：${e instanceof Error ? e.message : String(e)}`,
        line: 1,
        column: 1,
        offset: 0,
      },
    }
  }
}

/**
 * 在输入编辑器里选中出错字符并滚动到视野中央。
 * IOPanel 不暴露编辑器实例，这里通过 CodeMirror 的 findFromDOM 取到第一个（输入）编辑器。
 */
function jumpToError(container: HTMLElement | null, line: number, column: number) {
  const el = container?.querySelector<HTMLElement>('.cm-editor')
  const view = el ? EditorView.findFromDOM(el) : null
  if (!view) return
  const doc = view.state.doc
  const ln = doc.line(Math.min(Math.max(1, line), doc.lines))
  const from = ln.from + Math.min(columnToUtf16(ln.text, column), ln.length)
  const c = doc.sliceString(from, from + 1).charCodeAt(0)
  const to = Math.min(ln.to, from + (c >= 0xd800 && c <= 0xdbff ? 2 : 1))
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  })
  view.focus()
  view.dom.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

export default function XmlFormatter() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('xml-formatter.options.v1', {})
  const opts = useMemo(() => sanitize(stored), [stored])
  const patch = useCallback(
    (p: Partial<Options>) => setStored((prev) => ({ ...sanitize(prev), ...p })),
    [setStored],
  )

  const [input, setInput] = useState<string>(() => XML_SAMPLES[opts.sample].text)
  const debounced = useDebounced(input, 250)
  const source = input.length <= INSTANT_LIMIT ? input : debounced
  const result = useMemo(() => safeFormat(source, opts), [source, opts])

  const output = result?.ok ? result.output : ''
  const inBytes = useMemo(() => utf8Length(source), [source])
  const outBytes = useMemo(() => utf8Length(output), [output])
  const error = result && !result.ok ? result.error : null
  const wrap = useRef<HTMLDivElement>(null)

  const toolbar = (
    <>
      <SegmentedControl
        options={MODES}
        value={opts.mode}
        onChange={(mode) => patch({ mode })}
        aria-label="模式"
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        {opts.mode === 'format' && (
          <>
            <Select
              size="sm"
              value={String(opts.indent)}
              options={INDENTS}
              onChange={(v) => patch({ indent: v === 'tab' ? 'tab' : v === '4' ? 4 : 2 })}
              aria-label="缩进"
            />
            <Select
              size="sm"
              value={opts.attrWrap}
              options={ATTR_WRAPS}
              onChange={(v) => patch({ attrWrap: v as AttrWrap })}
              aria-label="属性换行"
            />
          </>
        )}
        <Switch
          checked={opts.keepComments}
          onChange={(v) => patch({ keepComments: v })}
          label={<span className="text-[13px]">保留注释</span>}
        />
        <span title="没有内容的元素写成 <tag/>；关闭时保持原来的写法">
          <Switch
            checked={opts.selfClose}
            onChange={(v) => patch({ selfClose: v })}
            label={<span className="text-[13px]">自闭合空元素</span>}
          />
        </span>
      </div>
      <Select
        size="sm"
        className="sm:ml-auto"
        value={opts.sample}
        options={SAMPLE_OPTIONS}
        onChange={(v) => {
          const id = v as XmlSampleId
          patch({ sample: id })
          setInput(XML_SAMPLES[id].text)
        }}
        aria-label="选择示例"
      />
    </>
  )

  return (
    <div
      ref={wrap}
      className="flex flex-col gap-4"
      onDropCapture={(e) => {
        // 拖入文件应替换输入（IOPanel 处理）；阻止 CodeMirror 把文件内容插到原文中间
        if (e.dataTransfer.files.length > 0) e.preventDefault()
      }}
    >
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputLang="xml"
        outputLang="xml"
        inputPlaceholder="在此粘贴 XML、SVG、RSS、SOAP、Maven POM…"
        outputPlaceholder="格式化结果会显示在这里"
        outputTitle={
          <span className="flex items-center gap-2">
            输出
            <StatusBadge result={result} />
          </span>
        }
        sample={XML_SAMPLES[opts.sample].text}
        error={error ? formatXmlIssue(error) + (error.hint ? `\n${error.hint}` : '') : null}
        downloadName={opts.mode === 'minify' ? 'minified.xml' : 'formatted.xml'}
        acceptFile=".xml,.svg,.xsd,.xsl,.xslt,.wsdl,.rss,.atom,.plist,.pom,.config,.csproj,.resx,.kml,.gpx,text/xml,application/xml"
        toolbar={toolbar}
        outputSlot={
          error ? (
            <CodeFrameView
              source={source}
              line={error.line}
              column={error.column}
              message={error.message}
              hint={error.hint}
              actions={
                source === input && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<LocateFixed />}
                    onClick={() => jumpToError(wrap.current, error.line, error.column)}
                  >
                    定位到错误
                  </Button>
                )
              }
            />
          ) : undefined
        }
        outputFooter={
          result?.ok ? (
            <>
              <span className="flex items-center gap-1.5">
                {formatBytes(outBytes)}
                {opts.mode === 'minify' && outBytes < inBytes && inBytes > 0 && (
                  <span className="rounded-full bg-success/10 px-1.5 font-medium text-success">
                    体积 −{Math.round((1 - outBytes / inBytes) * 100)}%
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2.5">
                <span>{result.stats.elements.toLocaleString()} 个元素</span>
                <span>{result.stats.attributes.toLocaleString()} 个属性</span>
                <span>深度 {result.stats.maxDepth}</span>
              </span>
            </>
          ) : (
            <>
              <span>{error ? '修正错误后会实时显示结果' : '等待输入'}</span>
              <span />
            </>
          )
        }
      />

      <AnimatePresence initial={false}>
        {result?.ok && result.warnings.length > 0 && (
          <Notice key="warnings" tone="warning">
            <WarningList warnings={result.warnings} />
          </Notice>
        )}
      </AnimatePresence>
    </div>
  )
}

function StatusBadge({ result }: { result: XmlFormatResult | null }) {
  let node: ReactNode = null
  let key = ''
  if (result?.ok) {
    key = result.warnings.length ? 'warn' : 'ok'
    node = result.warnings.length ? (
      <Badge color="var(--warning)">结构正确 · {result.warnings.length} 条提醒</Badge>
    ) : (
      <Badge color="var(--success)" className="[&_svg]:size-3">
        <CircleCheck />
        结构正确
      </Badge>
    )
  } else if (result) {
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

function WarningList({ warnings }: { warnings: XmlIssue[] }) {
  const shown = warnings.slice(0, 5)
  return (
    <div>
      <div className="font-semibold">发现 {warnings.length} 处需要留意的地方（不影响格式化）</div>
      <ul className="mt-1 space-y-0.5">
        {shown.map((w, i) => (
          <li key={i}>
            {formatXmlIssue(w)}
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
