import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { RotateCcw } from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { Badge, Button, Notice, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  ENTITY_ENCODE_MODES,
  decodeEntities,
  encodeEntities,
  type EntityEncodeMode,
  type EntityIssue,
} from '@/lib/html-entities'
import { EntityGrid } from './EntityGrid'

type Direction = 'encode' | 'decode'

interface Prefs {
  direction: Direction
  mode: EntityEncodeMode
  quotes: boolean
  fallback: 'decimal' | 'hex'
}

const DEFAULTS: Prefs = { direction: 'encode', mode: 'special', quotes: true, fallback: 'decimal' }

function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  const v = { ...DEFAULTS, ...(p ?? {}) }
  return {
    direction: v.direction === 'decode' ? 'decode' : 'encode',
    mode: ENTITY_ENCODE_MODES.some((m) => m.id === v.mode) ? v.mode : 'special',
    quotes: v.quotes !== false,
    fallback: v.fallback === 'hex' ? 'hex' : 'decimal',
  }
}

const ENCODE_SAMPLE = `<p class="note">Tom & Jerry's "猫和老鼠" © 2024 — 价格 ≈ ¥99 → 立即购买 ✓ 😀</p>`
const DECODE_SAMPLE =
  '&lt;p class=&quot;note&quot;&gt;Tom &amp; Jerry&#39;s &ldquo;猫和老鼠&rdquo; &copy 2024 &mdash; &#20215;&#x683C; &asymp; &yen;99 &rarr; 立即购买 &check; &#x1F600;&lt;/p&gt;'

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const

export default function HtmlEntities() {
  const [stored, setStored] = useLocalStorage<Prefs>('html-entities.options.v1', DEFAULTS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setStored((p) => ({ ...sanitize(p), [k]: v }))
  const { direction, mode, quotes, fallback } = prefs

  const [input, setInput] = useState(() => (direction === 'encode' ? ENCODE_SAMPLE : DECODE_SAMPLE))
  const live = `${direction}\u0000${input}`
  const settled = useDebounced(live, input.length > 50_000 ? 250 : 60)
  const cut = settled.indexOf('\u0000')
  const dDir = settled.slice(0, cut) as Direction
  const dInput = settled.slice(cut + 1)

  const result = useMemo(() => {
    if (dDir === 'encode')
      return { output: encodeEntities(dInput, { mode, quotes, fallback }), decode: null }
    const r = decodeEntities(dInput)
    return { output: r.output, decode: r }
  }, [dDir, dInput, mode, quotes, fallback])

  const changeDirection = (next: Direction) => {
    if (next === direction) return
    set('direction', next)
    if (!input.trim() || input === ENCODE_SAMPLE || input === DECODE_SAMPLE)
      setInput(next === 'encode' ? ENCODE_SAMPLE : DECODE_SAMPLE)
  }

  const dec = result.decode
  const warnings = dec?.issues.filter((i) => i.level === 'warning') ?? []
  const infos = dec?.issues.filter((i) => i.level === 'info') ?? []

  const toolbar = (
    <>
      <SegmentedControl
        aria-label="方向"
        value={direction}
        onChange={changeDirection}
        options={[
          { value: 'encode', label: '编码' },
          { value: 'decode', label: '解码' },
        ]}
      />
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
      <AnimatePresence mode="popLayout" initial={false}>
        {direction === 'encode' ? (
          <motion.div
            key="enc"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={spring}
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <Select
              aria-label="编码范围"
              value={mode}
              onChange={(v) => set('mode', v as EntityEncodeMode)}
              options={ENTITY_ENCODE_MODES.map((m) => ({
                value: m.id,
                label: `${m.label}（${m.example}）`,
              }))}
            />
            {mode === 'named' && (
              <SegmentedControl
                size="sm"
                aria-label="没有命名实体时"
                value={fallback}
                onChange={(v) => set('fallback', v)}
                options={[
                  { value: 'decimal', label: '回退 &#十进制;' },
                  { value: 'hex', label: '回退 &#x十六进制;' },
                ]}
              />
            )}
            <Switch
              checked={quotes}
              onChange={(v) => set('quotes', v)}
              label={
                <span className="text-[13px] text-fg-2">转义引号 &quot; &apos;（属性值）</span>
              }
            />
          </motion.div>
        ) : (
          <motion.p
            key="dec"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={spring}
            className="text-xs leading-relaxed text-fg-3"
          >
            支持全部 2125 个 HTML5 命名实体、&amp;#十进制; 与 &amp;#x十六进制;，旧式实体可省略分号
          </motion.p>
        )}
      </AnimatePresence>
    </>
  )

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={result.output}
        inputLang="html"
        outputLang="html"
        inputTitle={direction === 'encode' ? '原文' : '含实体的文本'}
        outputTitle={
          direction === 'encode' ? (
            '编码结果'
          ) : (
            <span className="inline-flex items-center gap-2">
              解码结果
              {dec && dec.counts.named + dec.counts.numeric > 0 && (
                <>
                  <Badge color="var(--sys-blue)">命名 {dec.counts.named}</Badge>
                  <Badge color="var(--sys-purple)">数字 {dec.counts.numeric}</Badge>
                </>
              )}
            </span>
          )
        }
        sample={direction === 'encode' ? ENCODE_SAMPLE : DECODE_SAMPLE}
        toolbar={toolbar}
        onSwap={() => {
          set('direction', direction === 'encode' ? 'decode' : 'encode')
          setInput(result.output)
        }}
        acceptFile=".html,.htm,.xml,.txt,text/*"
        downloadName={direction === 'encode' ? 'encoded.html' : 'decoded.txt'}
        height="clamp(240px, 42vh, 480px)"
      />

      <AnimatePresence initial={false}>
        {dec?.stillEncoded && (
          <Notice key="again" tone="info">
            <span>
              解码结果里仍有实体（例如 &amp;amp;lt; 被解成了 &amp;lt;），原文可能被重复编码过。
            </span>
            <span className="mt-2 flex">
              <Button
                size="sm"
                variant="secondary"
                icon={<RotateCcw />}
                onClick={() => setInput(result.output)}
              >
                再解码一次
              </Button>
            </span>
          </Notice>
        )}
      </AnimatePresence>
      <IssueNotice issues={warnings} tone="warning" title="以下内容无法识别，已原样保留" />
      <IssueNotice issues={infos} tone="info" title="已按浏览器的宽松规则解码，但写法不规范" />

      <EntityGrid />
    </div>
  )
}

function IssueNotice({
  issues,
  tone,
  title,
}: {
  issues: EntityIssue[]
  tone: 'warning' | 'info'
  title: string
}) {
  if (!issues.length) return null
  const shown = issues.slice(0, 5)
  const more = issues.length - shown.length
  return (
    <Notice tone={tone}>
      <div className="font-medium">
        {title}（{issues.length >= 200 ? '200+' : issues.length} 处）
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {shown.map((i) => (
          <li key={i.index} className="flex flex-wrap gap-x-1.5">
            <span className="font-mono tabular-nums">
              第 {i.line} 行第 {i.column} 列
            </span>
            <span className="opacity-90">{i.message}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <div className="mt-1 opacity-80">…还有 {more} 处</div>}
    </Notice>
  )
}
