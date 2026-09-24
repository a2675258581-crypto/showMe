import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { IOPanel } from '@/components/editor/IOPanel'
import { Badge, Notice, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  ESCAPE_FORMATS,
  ESCAPE_KIND_LABEL,
  escapeText,
  unescapeText,
  type EscapeFormat,
  type EscapeIssue,
  type EscapeKind,
} from '@/lib/unicode-escape'
import { CharInspector } from './CharInspector'
import { FormatGrid } from './FormatGrid'

type Direction = 'encode' | 'decode'

interface Prefs {
  direction: Direction
  format: EscapeFormat
  onlyNonAscii: boolean
  upper: boolean
  simple: boolean
  css: boolean
}

const DEFAULTS: Prefs = {
  direction: 'encode',
  format: 'js',
  onlyNonAscii: true,
  upper: true,
  simple: true,
  css: true,
}

function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  const v = { ...DEFAULTS, ...(p ?? {}) }
  return {
    direction: v.direction === 'decode' ? 'decode' : 'encode',
    format: ESCAPE_FORMATS.some((f) => f.id === v.format) ? v.format : 'js',
    onlyNonAscii: v.onlyNonAscii !== false,
    upper: v.upper !== false,
    simple: v.simple !== false,
    css: v.css !== false,
  }
}

const ENCODE_SAMPLE =
  '你好，世界！Hello 😀\n一家人：\u{1F468}‍\u{1F469}‍\u{1F467} · café · Ω ≈ 3.14'
const DECODE_SAMPLE =
  '\\u4f60\\u597d\\uff0c\\u{1F600} &#x4E16;&#30028; %E4%B8%AD%E6%96%87\nU+2764 U+FE0F \\xE2\\x9C\\x85 \\U0001F389 \\5FEB\\4E50\\n（混合转义自动识别）'

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const

const KIND_COLOR: Partial<Record<EscapeKind, string>> = {
  js: 'var(--sys-blue)',
  es6: 'var(--sys-indigo)',
  python: 'var(--sys-green)',
  perl: 'var(--sys-mint)',
  'html-hex': 'var(--sys-orange)',
  'html-dec': 'var(--sys-orange)',
  'utf8-hex': 'var(--sys-pink)',
  'utf8-url': 'var(--sys-purple)',
  codepoint: 'var(--sys-teal)',
  css: 'var(--sys-cyan)',
  simple: 'var(--fg-2)',
}

export default function UnicodeEscape() {
  const [stored, setStored] = useLocalStorage<Prefs>('unicode-escape.options.v1', DEFAULTS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setStored((p) => ({ ...sanitize(p), [k]: v }))
  const { direction, format, onlyNonAscii, upper, simple, css } = prefs

  const [input, setInput] = useState(() => (direction === 'encode' ? ENCODE_SAMPLE : DECODE_SAMPLE))
  const live = `${direction}\u0000${input}`
  const settled = useDebounced(live, input.length > 50_000 ? 250 : 60)
  const cut = settled.indexOf('\u0000')
  const dDir = settled.slice(0, cut) as Direction
  const dInput = settled.slice(cut + 1)

  const result = useMemo(() => {
    if (dDir === 'encode') {
      const r = escapeText(dInput, { format, onlyNonAscii, upper })
      return { output: r.output, issues: r.issues, counts: null, plain: dInput }
    }
    const r = unescapeText(dInput, { simple, css })
    return { output: r.output, issues: r.issues, counts: r.counts, plain: r.output }
  }, [dDir, dInput, format, onlyNonAscii, upper, simple, css])

  const changeDirection = (next: Direction) => {
    if (next === direction) return
    set('direction', next)
    if (!input.trim() || input === ENCODE_SAMPLE || input === DECODE_SAMPLE)
      setInput(next === 'encode' ? ENCODE_SAMPLE : DECODE_SAMPLE)
  }

  const kinds = result.counts
    ? (Object.entries(result.counts) as [EscapeKind, number][]).filter(([, n]) => n > 0)
    : []
  const hint = ESCAPE_FORMATS.find((f) => f.id === format)?.hint

  const toolbar = (
    <>
      <SegmentedControl
        aria-label="方向"
        value={direction}
        onChange={changeDirection}
        options={[
          { value: 'encode', label: '转义' },
          { value: 'decode', label: '还原' },
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
              aria-label="转义格式"
              value={format}
              onChange={(v) => set('format', v as EscapeFormat)}
              options={ESCAPE_FORMATS.map((f) => ({ value: f.id, label: f.label }))}
            />
            <Switch
              checked={onlyNonAscii}
              onChange={(v) => set('onlyNonAscii', v)}
              label={<span className="text-[13px] text-fg-2">只转义非 ASCII</span>}
            />
            <Switch
              checked={upper}
              onChange={(v) => set('upper', v)}
              label={<span className="text-[13px] text-fg-2">大写十六进制</span>}
            />
          </motion.div>
        ) : (
          <motion.div
            key="dec"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={spring}
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <Switch
              checked={simple}
              onChange={(v) => set('simple', v)}
              label={<span className="text-[13px] text-fg-2">解析 \n \t \\ 等简单转义</span>}
            />
            <Switch
              checked={css}
              onChange={(v) => set('css', v)}
              label={<span className="text-[13px] text-fg-2">识别 CSS 转义 \4E2D</span>}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <p className="basis-full text-xs leading-relaxed text-fg-3">
        {direction === 'encode'
          ? hint
          : '自动识别混合出现的 \\uXXXX（含代理对）、\\u{…}、\\UXXXXXXXX、\\x{…}、\\xHH 字节、%HH 字节、&#x…; / &#…;、U+XXXX 与 CSS 转义'}
      </p>
    </>
  )

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={result.output}
        inputTitle={direction === 'encode' ? '文本' : '转义文本'}
        outputTitle={
          direction === 'encode' ? (
            <span className="inline-flex items-center gap-2">
              转义结果
              <Badge>{ESCAPE_FORMATS.find((f) => f.id === format)?.label}</Badge>
            </span>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              还原结果
              {kinds.slice(0, 4).map(([k, n]) => (
                <Badge key={k} color={KIND_COLOR[k]}>
                  {ESCAPE_KIND_LABEL[k]} ×{n}
                </Badge>
              ))}
              {kinds.length > 4 && <Badge color="var(--fg-2)">+{kinds.length - 4}</Badge>}
            </span>
          )
        }
        inputPlaceholder={
          direction === 'encode'
            ? '输入中文、Emoji 等任意文本…'
            : '粘贴 \\u4e2d、&#x4E2D;、%E4%B8%AD 等转义文本…'
        }
        sample={direction === 'encode' ? ENCODE_SAMPLE : DECODE_SAMPLE}
        toolbar={toolbar}
        onSwap={() => {
          set('direction', direction === 'encode' ? 'decode' : 'encode')
          setInput(result.output)
        }}
        acceptFile=".txt,.json,.properties,.js,.css,.html,text/*"
        downloadName={direction === 'encode' ? 'escaped.txt' : 'unescaped.txt'}
        height="clamp(220px, 38vh, 440px)"
      />
      <IssueNotice
        issues={result.issues}
        title={direction === 'encode' ? '有些字符无法按所选格式表示' : '有些转义无法还原'}
      />

      <FormatGrid
        text={result.plain}
        onlyNonAscii={onlyNonAscii}
        upper={upper}
        current={direction === 'encode' ? format : null}
        onPick={(f) => {
          if (direction === 'decode') {
            set('direction', 'encode')
            setInput(result.output)
          }
          set('format', f)
        }}
      />
      <CharInspector text={result.plain} />
    </div>
  )
}

function IssueNotice({ issues, title }: { issues: EscapeIssue[]; title: string }) {
  if (!issues.length) return null
  const shown = issues.slice(0, 5)
  const more = issues.length - shown.length
  return (
    <Notice tone="warning">
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
