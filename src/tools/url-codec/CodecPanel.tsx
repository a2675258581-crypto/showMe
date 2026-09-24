import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { IOPanel } from '@/components/editor/IOPanel'
import { Panel, PanelHeader, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'
import { URL_CODEC_MODES, urlDecode, urlEncode, type UrlCodecMode } from '@/lib/url-codec'
import { IssueList } from './IssueList'
import type { Direction, SetPref, UrlPrefs } from './prefs'

const ENCODE_SAMPLE = '你好，世界！ a+b=c&d=e/f?g#h 😀'
const ENCODE_BATCH_SAMPLE =
  '北京 天安门\nprice=¥100 & tax=5%\nhttps://example.com/?q=中文\n😀 emoji'
const DECODE_SAMPLE =
  '%E4%BD%A0%E5%A5%BD%EF%BC%8C%E4%B8%96%E7%95%8C%EF%BC%81%20a%2Bb%3Dc%26d%3De%2Ff%3Fg%23h%20%F0%9F%98%80'
const DECODE_BATCH_SAMPLE =
  '%E5%8C%97%E4%BA%AC+%E5%A4%A9%E5%AE%89%E9%97%A8\nprice%3D%C2%A5100%20%26%20tax%3D5%25\n100% 残缺的 %E4%B8 序列\n%F0%9F%98%80'

const sampleFor = (d: Direction, batch: boolean) =>
  d === 'encode'
    ? batch
      ? ENCODE_BATCH_SAMPLE
      : ENCODE_SAMPLE
    : batch
      ? DECODE_BATCH_SAMPLE
      : DECODE_SAMPLE
const ALL_SAMPLES = [ENCODE_SAMPLE, ENCODE_BATCH_SAMPLE, DECODE_SAMPLE, DECODE_BATCH_SAMPLE]

/** 对照表里展示的字符 */
const COMPARE_CHARS = [
  ' ',
  '中',
  '😀',
  '/',
  '?',
  '#',
  '&',
  '=',
  '+',
  ':',
  '@',
  '~',
  "'",
  '(',
  '*',
  '%',
]

export function CodecPanel({ prefs, set }: { prefs: UrlPrefs; set: SetPref }) {
  const { direction, mode, perLine, strict, keepEscapes } = prefs
  const [input, setInput] = useState(() => sampleFor(direction, perLine))

  const live = `${direction}\u0000${input}`
  const settled = useDebounced(live, input.length > 50_000 ? 250 : 60)
  const cut = settled.indexOf('\u0000')
  const dDir = settled.slice(0, cut) as Direction
  const dInput = settled.slice(cut + 1)

  const result = useMemo(
    () =>
      dDir === 'encode'
        ? urlEncode(dInput, { mode, perLine, strict, keepEscapes })
        : urlDecode(dInput, { mode, perLine }),
    [dDir, dInput, mode, perLine, strict, keepEscapes],
  )

  const changeDirection = (next: Direction) => {
    if (next === direction) return
    set('direction', next)
    if (!input.trim() || ALL_SAMPLES.includes(input)) setInput(sampleFor(next, perLine))
  }

  const hint = URL_CODEC_MODES.find((m) => m.id === mode)?.hint

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
      <Select
        aria-label="编码方式"
        value={mode}
        onChange={(v) => set('mode', v as UrlCodecMode)}
        options={URL_CODEC_MODES.map((m) => ({ value: m.id, label: m.label }))}
      />
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Switch
          checked={perLine}
          onChange={(v) => {
            set('perLine', v)
            if (ALL_SAMPLES.includes(input)) setInput(sampleFor(direction, v))
          }}
          label={<span className="text-[13px] text-fg-2">逐行处理</span>}
        />
        {direction === 'encode' && mode === 'component' && (
          <Switch
            checked={strict}
            onChange={(v) => set('strict', v)}
            label={
              <span className="text-[13px] text-fg-2">RFC 3986 严格（编码 ! &apos; ( ) *）</span>
            }
          />
        )}
        {direction === 'encode' && (
          <Switch
            checked={keepEscapes}
            onChange={(v) => set('keepEscapes', v)}
            label={<span className="text-[13px] text-fg-2">保留已有的 %XX（防二次编码）</span>}
          />
        )}
      </div>
      {hint && <p className="basis-full text-xs leading-relaxed text-fg-3">{hint}</p>}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={result.output}
        inputTitle={direction === 'encode' ? '原文' : '编码文本'}
        outputTitle={direction === 'encode' ? '编码结果' : '解码结果'}
        inputPlaceholder={
          direction === 'encode'
            ? perLine
              ? '每行一段要编码的文本…'
              : '输入要编码的文本或链接…'
            : '粘贴含 %XX 的文本…'
        }
        sample={sampleFor(direction, perLine)}
        toolbar={toolbar}
        onSwap={() => {
          set('direction', direction === 'encode' ? 'decode' : 'encode')
          setInput(result.output)
        }}
        height="clamp(240px, 42vh, 480px)"
        acceptFile=".txt,.csv,.log,text/plain"
        downloadName={direction === 'encode' ? 'encoded.txt' : 'decoded.txt'}
      />
      <IssueList
        issues={result.issues}
        title={direction === 'decode' ? '有些内容无法解码，已原样保留' : '有些字符无法编码'}
      />
      <CompareTable current={mode === 'component' && strict ? 'strict' : mode} />
    </div>
  )
}

type CompareCol = 'component' | 'strict' | 'uri' | 'form'

function CompareTable({ current }: { current: CompareCol }) {
  const rows = useMemo(
    () =>
      COMPARE_CHARS.map((c) => ({
        c,
        component: urlEncode(c, { mode: 'component' }).output,
        strict: urlEncode(c, { mode: 'component', strict: true }).output,
        uri: urlEncode(c, { mode: 'uri' }).output,
        form: urlEncode(c, { mode: 'form' }).output,
      })),
    [],
  )
  const cols: { id: CompareCol; label: string }[] = [
    { id: 'component', label: 'encodeURIComponent' },
    { id: 'strict', label: 'RFC 3986 严格' },
    { id: 'uri', label: 'encodeURI' },
    { id: 'form', label: '表单（+）' },
  ]
  return (
    <Panel>
      <PanelHeader title="三种编码方式对照">
        <span className="text-xs text-fg-3">灰色表示原样保留</span>
      </PanelHeader>
      <div className="thin-scrollbar -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left text-[13px]">
          <thead>
            <tr className="text-xs text-fg-2">
              <th className="border-b border-line py-2 pr-3 font-semibold whitespace-nowrap">
                字符
              </th>
              {cols.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    'border-b border-line px-3 py-2 font-semibold whitespace-nowrap',
                    col.id === current && 'text-accent',
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <motion.tr
                key={r.c}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.015 }}
                className="hover:bg-fill-2"
              >
                <td className="border-b border-line py-1.5 pr-3 font-mono whitespace-nowrap text-fg">
                  {r.c === ' ' ? <span className="text-xs text-fg-2">空格</span> : r.c}
                </td>
                {cols.map((col) => {
                  const v = r[col.id]
                  return (
                    <td
                      key={col.id}
                      className={cn(
                        'border-b border-line px-3 py-1.5 font-mono whitespace-nowrap',
                        v === r.c ? 'text-fg-3' : 'text-fg',
                        col.id === current && 'bg-accent-soft',
                      )}
                    >
                      {v}
                    </td>
                  )
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
