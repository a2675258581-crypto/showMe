import { useMemo, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, Box, Loader2, RotateCcw, Tag } from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Badge, Button, Input, Notice, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import {
  DEFAULT_JSON_XML_OPTIONS,
  convertJsonXml,
  isXmlName,
  toXmlName,
  type JsonXmlOptions,
  type XmlDirection,
  type XmlIndent,
} from '@/lib/json-xml'
import { ErrorPanel, StaleOverlay, WarningList } from '@/tools/code-formatter/ErrorPanel'
import { JSON_SAMPLE, XML_SAMPLE } from './samples'

interface Prefs extends JsonXmlOptions {
  direction: XmlDirection
}

const DEFAULT_PREFS: Prefs = { direction: 'json2xml', ...DEFAULT_JSON_XML_OPTIONS }

const SAMPLE: Record<XmlDirection, string> = { json2xml: JSON_SAMPLE, xml2json: XML_SAMPLE }

const INDENTS = [
  { value: '2', label: '2 空格' },
  { value: '4', label: '4 空格' },
  { value: 'tab', label: 'Tab' },
  { value: '0', label: '压缩' },
]

const spring = { type: 'spring', stiffness: 500, damping: 38 } as const

const str = (v: unknown, fallback: string, max = 32) =>
  typeof v === 'string' ? v.slice(0, max) : fallback

function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  const v = { ...DEFAULT_PREFS, ...(p && typeof p === 'object' ? p : {}) }
  const indent: XmlIndent = v.indent === 4 || v.indent === 'tab' || v.indent === 0 ? v.indent : 2
  return {
    direction: v.direction === 'xml2json' ? 'xml2json' : 'json2xml',
    attrPrefix: str(v.attrPrefix, DEFAULT_PREFS.attrPrefix, 8),
    textKey: str(v.textKey, DEFAULT_PREFS.textKey, 16),
    rootName: str(v.rootName, DEFAULT_PREFS.rootName),
    indent,
    parseValues: v.parseValues !== false,
    ignoreDeclaration: v.ignoreDeclaration !== false,
    declaration: v.declaration !== false,
  }
}

const flip = (d: XmlDirection): XmlDirection => (d === 'json2xml' ? 'xml2json' : 'json2xml')
const LABEL: Record<XmlDirection, string> = { json2xml: 'JSON → XML', xml2json: 'XML → JSON' }

export default function JsonXml() {
  const [stored, setStored] = useLocalStorage<Prefs>('json-xml.options.v1', DEFAULT_PREFS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = (patch: Partial<Prefs>) => setStored((p) => ({ ...sanitize(p), ...patch }))
  const { direction } = prefs
  const toXml = direction === 'json2xml'

  const [input, setInput] = useState(() => SAMPLE[prefs.direction])
  // 方向与输入一起防抖：切换方向时不会用旧输入按新方向转换而闪出错误
  const live = `${direction}\u0000${input}`
  const settled = useDebounced(live, 200)
  const cut = settled.indexOf('\u0000')
  const dDirection = settled.slice(0, cut) as XmlDirection
  const debounced = settled.slice(cut + 1)
  const pending = live !== settled
  const outXml = dDirection === 'json2xml'

  const { direction: _d, ...options } = prefs
  const optionsKey = JSON.stringify(options)
  const result = useMemo(
    () => convertJsonXml(dDirection, debounced, JSON.parse(optionsKey) as JsonXmlOptions),
    [dDirection, debounced, optionsKey],
  )

  // 出错时保留上一次成功的结果（变淡），避免边输入边闪烁
  // 按方向记录：切换方向后出错时，不能把另一种格式的旧结果当成「上一次的结果」显示
  const [good, setGood] = useState({ dir: dDirection, output: '' })
  if (result.ok && (result.output !== good.output || good.dir !== dDirection))
    setGood({ dir: dDirection, output: result.output })
  const lastGood = good.dir === dDirection ? good.output : ''
  const output = result.ok ? result.output : ''

  /** 输入看起来是另一种格式时，提示切换方向 */
  const suggestion = useMemo((): XmlDirection | null => {
    const t = debounced.trimStart()
    if (!t) return null
    if (dDirection === 'json2xml' && t.startsWith('<')) return 'xml2json'
    if (dDirection === 'xml2json' && (t[0] === '{' || t[0] === '[')) return 'json2xml'
    return null
  }, [debounced, dDirection])

  const changeDirection = (next: XmlDirection) => {
    if (next === direction) return
    set({ direction: next })
    // 输入为空或仍是示例时，换成对应方向的示例
    if (!input.trim() || input === SAMPLE[direction]) setInput(SAMPLE[next])
  }

  const swap = () => {
    set({ direction: flip(direction) })
    if (output) setInput(output)
  }

  const badges: { key: string; node: ReactNode }[] = []
  if (result.ok && !pending && output) {
    badges.push({
      key: 'el',
      node: (
        <Badge>
          <Box className="size-3" />
          {result.elements.toLocaleString()} 个元素
        </Badge>
      ),
    })
    if (result.attributes > 0)
      badges.push({
        key: 'attr',
        node: (
          <Badge color="var(--sys-purple)">
            <Tag className="size-3" />
            {result.attributes.toLocaleString()} 个属性
          </Badge>
        ),
      })
    if (result.wrapped)
      badges.push({
        key: 'wrap',
        node: (
          <Badge color="var(--sys-orange)" className="font-mono">
            已包裹 &lt;{toXmlName(prefs.rootName.trim() || 'root')}&gt;
          </Badge>
        ),
      })
  }

  const rootInvalid = toXml && prefs.rootName.trim() !== '' && !isXmlName(prefs.rootName.trim())

  const toolbar = (
    <>
      <SegmentedControl<XmlDirection>
        aria-label="转换方向"
        value={direction}
        onChange={changeDirection}
        options={[
          { value: 'json2xml', label: LABEL.json2xml },
          { value: 'xml2json', label: LABEL.xml2json },
        ]}
      />
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
      <AnimatePresence mode="popLayout" initial={false}>
        <Opt key="indent" label="缩进">
          <Select
            size="sm"
            aria-label="缩进"
            value={String(prefs.indent)}
            onChange={(v) =>
              set({ indent: v === 'tab' ? 'tab' : v === '0' ? 0 : v === '4' ? 4 : 2 })
            }
            options={INDENTS}
          />
        </Opt>
        {toXml && (
          <Opt key="root" label="根元素">
            <div className="w-24">
              <Input
                value={prefs.rootName}
                onChange={(e) => set({ rootName: e.target.value })}
                placeholder="root"
                mono
                spellCheck={false}
                aria-label="根元素名"
                aria-invalid={rootInvalid}
                title="JSON 顶层有多个键、是数组或基本值时，用这个元素包裹"
                className={cn('h-8! px-2.5!', rootInvalid && 'border-danger!')}
              />
            </div>
          </Opt>
        )}
        <Opt key="prefix" label="属性前缀">
          <div className="w-16">
            <Input
              value={prefs.attrPrefix}
              onChange={(e) => set({ attrPrefix: e.target.value })}
              placeholder="无"
              mono
              spellCheck={false}
              aria-label="属性前缀"
              title={
                toXml
                  ? '以此前缀开头的键会成为 XML 属性，留空则不生成属性'
                  : 'XML 属性转成 JSON 键时加的前缀，留空则与子元素混在一起'
              }
              className="h-8! px-2.5!"
            />
          </div>
        </Opt>
        <Opt key="text" label="文本键">
          <div className="w-20">
            <Input
              value={prefs.textKey}
              onChange={(e) => set({ textKey: e.target.value })}
              placeholder="#text"
              mono
              spellCheck={false}
              aria-label="文本节点键名"
              title="元素同时有属性和文本时，文本放在这个键下"
              className="h-8! px-2.5!"
            />
          </div>
        </Opt>
        {toXml ? (
          <Opt key="decl">
            <Switch
              checked={prefs.declaration}
              onChange={(v) => set({ declaration: v })}
              label={
                <span className="text-[13px]" title='输出 <?xml version="1.0" encoding="UTF-8"?>'>
                  XML 声明
                </span>
              }
            />
          </Opt>
        ) : (
          <Opt key="values">
            <Switch
              checked={prefs.parseValues}
              onChange={(v) => set({ parseValues: v })}
              label={
                <span
                  className="text-[13px]"
                  title="把 42、-3.5、true 这类文本转成数字 / 布尔值；007、1.0 等会丢失原文的保持字符串"
                >
                  识别数字与布尔
                </span>
              }
            />
          </Opt>
        )}
        {!toXml && (
          <Opt key="ignore-decl">
            <Switch
              checked={prefs.ignoreDeclaration}
              onChange={(v) => set({ ignoreDeclaration: v })}
              label={<span className="text-[13px]">忽略 XML 声明</span>}
            />
          </Opt>
        )}
        <Opt key="reset" className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<RotateCcw />}
            title="恢复默认选项"
            aria-label="恢复默认选项"
            onClick={() =>
              setStored((p) => ({ ...DEFAULT_PREFS, direction: sanitize(p).direction }))
            }
          />
        </Opt>
      </AnimatePresence>
    </>
  )

  const switchButton = (to: XmlDirection) => (
    <Button
      size="sm"
      variant="secondary"
      icon={<ArrowLeftRight />}
      onClick={() => changeDirection(to)}
    >
      切换为 {LABEL[to]}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputLang={toXml ? 'json' : 'xml'}
        inputTitle={toXml ? 'JSON' : 'XML'}
        inputPlaceholder={
          toXml
            ? `粘贴 JSON，实时转换为 XML…${prefs.attrPrefix ? `（以 ${prefs.attrPrefix} 开头的键会成为属性）` : ''}`
            : '粘贴 XML，实时转换为 JSON…'
        }
        sample={SAMPLE[direction]}
        onSwap={swap}
        acceptFile=".json,.xml,.svg,.rss,.atom,.plist,text/*"
        downloadName={outXml ? 'converted.xml' : 'converted.json'}
        toolbar={toolbar}
        outputFooter={
          <>
            <span>
              {result.ok
                ? `${output ? output.split('\n').length.toLocaleString() : 0} 行 · ${output.length.toLocaleString()} 字符`
                : '—'}
            </span>
            <span>{outXml ? 'XML' : 'JSON'}</span>
          </>
        }
        outputTitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {toXml ? 'XML' : 'JSON'}
            <AnimatePresence mode="popLayout" initial={false}>
              {pending ? (
                <motion.span
                  key="spin"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  className="inline-flex text-fg-3"
                  role="status"
                  aria-label="正在转换"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                </motion.span>
              ) : (
                badges.map((b) => (
                  <motion.span
                    key={b.key}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={spring}
                    className="inline-flex"
                  >
                    {b.node}
                  </motion.span>
                ))
              )}
            </AnimatePresence>
          </span>
        }
        outputSlot={
          <div className="relative h-full">
            <div
              className={cn(
                'h-full transition-opacity duration-300',
                result.ok ? 'opacity-100' : 'opacity-35',
              )}
            >
              <CodeEditor
                value={result.ok ? result.output : lastGood}
                lang={outXml ? 'xml' : 'json'}
                readOnly
                placeholder={toXml ? 'XML 会显示在这里' : 'JSON 会显示在这里'}
                aria-label={toXml ? 'XML 输出' : 'JSON 输出'}
              />
            </div>
            <StaleOverlay show={!result.ok}>
              {!result.ok && result.error.line !== undefined
                ? `第 ${result.error.line} 行有错误`
                : '转换失败'}
              {lastGood ? '，显示的是上一次的结果' : ''}
            </StaleOverlay>
          </div>
        }
      />
      <AnimatePresence>
        {suggestion && result.ok && (
          <Notice key="suggest" tone="info">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                输入看起来是 {suggestion === 'xml2json' ? 'XML' : 'JSON'}，要反过来转换吗？
              </span>
              {switchButton(suggestion)}
            </div>
          </Notice>
        )}
      </AnimatePresence>
      <ErrorPanel
        error={result.ok ? null : result.error}
        action={!result.ok && suggestion ? switchButton(suggestion) : undefined}
      />
      <WarningList warnings={result.ok ? result.warnings : []} />
      <Tips toXml={toXml} prefix={prefs.attrPrefix} textKey={prefs.textKey} />
    </div>
  )
}

/** 映射规则速查：让第一次用的人知道 JSON 该怎么写 */
function Tips({ toXml, prefix, textKey }: { toXml: boolean; prefix: string; textKey: string }) {
  const text = textKey || '#text'
  const rows: [string, string][] = toXml
    ? [
        prefix ? [`"${prefix}id": "1"`, '属性 id="1"'] : ['（属性前缀为空）', '所有键都生成子元素'],
        [`"${text}": "内容"`, '元素的文本（与属性同时出现时）'],
        ['"item": [1, 2]', '重复的 <item> 元素'],
        ['"a": null', '空元素 <a/>'],
      ]
    : [
        ['<a id="1"/>', `{ "a": { "${prefix}id": "1" } }`],
        ['<a id="1">文本</a>', `"${text}": "文本"`],
        ['两个同名 <b>', '合并成数组 "b": [ … ]'],
        ['<![CDATA[…]]>', '按普通文本处理'],
      ]
  return (
    <motion.section
      layout
      transition={spring}
      className="rounded-3xl border border-line bg-surface p-5 shadow-card"
    >
      <h3 className="mb-3 text-[13px] font-semibold text-fg">映射规则</h3>
      <dl className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-2">
        {rows.map(([a, b]) => (
          <div key={a} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <dt className="rounded-md bg-fill-2 px-1.5 py-0.5 font-mono text-[12px] break-all text-fg">
              {a}
            </dt>
            <dd className="text-fg-2">→ {b}</dd>
          </div>
        ))}
      </dl>
    </motion.section>
  )
}

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
      {label && <span className="text-[13px] whitespace-nowrap text-fg-2">{label}</span>}
      {children}
    </motion.div>
  )
}
