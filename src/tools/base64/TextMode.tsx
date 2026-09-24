import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Binary, Download } from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { Badge, Button, Notice, SegmentedControl, Switch, useToast } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import {
  base64ToBytes,
  decodeUtf8,
  encodeText,
  hexDump,
  overheadPercent,
  utf8Encode,
  type Base64Variant,
} from '@/lib/base64'
import { detectFileType, resolveFileType, type FileTypeInfo } from '@/lib/base64-filetype'
import { downloadBlob, formatBytes } from '@/lib/file'
import type { Base64Prefs, Direction } from './prefs'

const TEXT_SAMPLE =
  '你好，showMe！👋\nBase64 把任意字节变成 64 个可打印字符，\n常见于 Data URL、JWT、邮件附件与 HTTP Basic 认证。'
const B64_SAMPLE = encodeText(TEXT_SAMPLE)
/** 十六进制视图最多显示的字节数 */
const HEX_LIMIT = 64 * 1024

type Setter = <K extends keyof Base64Prefs>(k: K, v: Base64Prefs[K]) => void

type Result =
  | { kind: 'empty' }
  | { kind: 'encode'; output: string; byteLength: number }
  | { kind: 'error'; error: string }
  | {
      kind: 'decode'
      bytes: Uint8Array
      text: string
      invalidAt: number
      bom: boolean
      variant: Base64Variant
      type: FileTypeInfo | null
    }

function compute(
  direction: Direction,
  input: string,
  opts: { urlSafe: boolean; padding: boolean; wrap: boolean },
): Result {
  if (direction === 'encode') {
    const bytes = utf8Encode(input)
    return {
      kind: 'encode',
      output: encodeText(input, {
        urlSafe: opts.urlSafe,
        padding: opts.padding,
        lineWidth: opts.wrap ? 76 : 0,
      }),
      byteLength: bytes.length,
    }
  }
  if (!input.trim()) return { kind: 'empty' }
  const r = base64ToBytes(input)
  if (!r.ok) return { kind: 'error', error: r.error }
  const utf8 = decodeUtf8(r.bytes)
  return {
    kind: 'decode',
    bytes: r.bytes,
    text: utf8.text,
    invalidAt: utf8.invalidAt,
    bom: utf8.bom,
    variant: r.variant,
    type: resolveFileType(detectFileType(r.bytes), r.variant.dataUrlMime),
  }
}

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const

export function TextMode({ prefs, set }: { prefs: Base64Prefs; set: Setter }) {
  const { direction, urlSafe, padding, wrap, view } = prefs
  const toast = useToast()
  const [input, setInput] = useState(() => (direction === 'encode' ? TEXT_SAMPLE : B64_SAMPLE))

  // 方向与输入一起防抖：切换方向 / 交换时不会拿旧输入按新方向计算而闪出错误
  const live = `${direction}\u0000${input}`
  const settled = useDebounced(live, input.length > 50_000 ? 250 : 60)
  const cut = settled.indexOf('\u0000')
  const dDir = settled.slice(0, cut) as Direction
  const dInput = settled.slice(cut + 1)

  const result = useMemo(
    () => compute(dDir, dInput, { urlSafe, padding, wrap }),
    [dDir, dInput, urlSafe, padding, wrap],
  )
  const binary = result.kind === 'decode' && result.invalidAt >= 0
  const hex = useMemo(
    () => (result.kind === 'decode' && view === 'hex' ? hexDump(result.bytes, HEX_LIMIT) : ''),
    [result, view],
  )
  const output =
    result.kind === 'encode'
      ? result.output
      : result.kind === 'decode'
        ? view === 'hex'
          ? hex
          : result.text
        : ''

  const changeDirection = (next: Direction) => {
    if (next === direction) return
    set('direction', next)
    const t = input.trim()
    if (!t || input === TEXT_SAMPLE || input === B64_SAMPLE)
      setInput(next === 'encode' ? TEXT_SAMPLE : B64_SAMPLE)
  }

  const swap = () => {
    if (result.kind === 'encode') {
      set('direction', 'decode')
      setInput(result.output)
    } else if (result.kind === 'decode' && !binary) {
      set('direction', 'encode')
      setInput(result.text)
    } else if (result.kind === 'decode') {
      // 二进制内容当成文本再编码会被 U+FFFD 替换而损坏，不做交换
      toast('解码结果是二进制数据，不能作为文本交换；请下载文件或切到「文件」模式', 'info')
    } else {
      set('direction', direction === 'encode' ? 'decode' : 'encode')
    }
  }

  const decoded = result.kind === 'decode' ? result : null
  const ext = decoded?.type?.ext ?? (binary ? 'bin' : 'txt')
  const mime = decoded?.type?.mime ?? (binary ? 'application/octet-stream' : 'text/plain')

  const downloadBytes = () => {
    if (!decoded) return
    downloadBlob(`decoded.${ext}`, new Blob([decoded.bytes as BlobPart], { type: mime }))
  }

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
            className="flex flex-wrap items-center gap-x-5 gap-y-2"
          >
            <Switch
              checked={urlSafe}
              onChange={(v) => set('urlSafe', v)}
              label={<span className="text-[13px] text-fg-2">URL 安全（- _）</span>}
            />
            <Switch
              checked={!padding}
              onChange={(v) => set('padding', !v)}
              label={<span className="text-[13px] text-fg-2">省略 = 填充</span>}
            />
            <Switch
              checked={wrap}
              onChange={(v) => set('wrap', v)}
              label={<span className="text-[13px] text-fg-2">每 76 字符换行（MIME）</span>}
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
            自动识别标准与 URL 安全字符、缺失的填充、空白换行以及 data: 前缀
          </motion.p>
        )}
      </AnimatePresence>
    </>
  )

  const outputTitle =
    direction === 'encode' ? (
      'Base64'
    ) : (
      <span className="inline-flex items-center gap-2">
        {view === 'hex' ? '十六进制' : '文本'}
        {decoded &&
          (binary ? (
            <Badge color="var(--warning)">二进制</Badge>
          ) : (
            <Badge color="var(--sys-green)">UTF-8</Badge>
          ))}
      </span>
    )

  const footer =
    result.kind === 'encode' ? (
      <>
        <span>
          {formatBytes(result.byteLength)} →{' '}
          {result.output.replace(/\n/g, '').length.toLocaleString()} 字符
        </span>
        <span>
          体积 +{overheadPercent(result.byteLength, result.output.replace(/\n/g, '').length)}%
        </span>
      </>
    ) : decoded ? (
      <>
        <span>
          解码得到 {formatBytes(decoded.bytes.length)}
          {!binary && ` · ${Array.from(decoded.text).length.toLocaleString()} 个字符`}
        </span>
        {view === 'hex' && decoded.bytes.length > HEX_LIMIT && (
          <span>仅显示前 {formatBytes(HEX_LIMIT)}</span>
        )}
      </>
    ) : (
      <span>—</span>
    )

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputTitle={direction === 'encode' ? '文本' : 'Base64'}
        outputTitle={outputTitle}
        inputPlaceholder={
          direction === 'encode' ? '输入要编码的文本（按 UTF-8）…' : '粘贴 Base64 或 data: URL…'
        }
        sample={direction === 'encode' ? TEXT_SAMPLE : B64_SAMPLE}
        error={result.kind === 'error' ? result.error : null}
        onSwap={swap}
        acceptFile={direction === 'decode' ? '.txt,.b64,.base64,text/plain' : undefined}
        toolbar={toolbar}
        height="clamp(260px, 50vh, 560px)"
        outputActions={
          direction === 'decode' && (
            <>
              <SegmentedControl
                size="sm"
                aria-label="显示方式"
                value={view}
                onChange={(v) => set('view', v)}
                options={[
                  { value: 'text', label: '文本' },
                  { value: 'hex', label: 'Hex' },
                ]}
              />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Download />}
                title="下载为文件"
                aria-label="下载解码后的文件"
                disabled={!decoded}
                onClick={downloadBytes}
              />
            </>
          )
        }
        outputFooter={footer}
      />

      <AnimatePresence initial={false}>
        {decoded && (
          <motion.div
            key="variant"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
            className="flex flex-wrap items-center gap-2 px-1"
          >
            <span className="text-xs text-fg-3">识别到</span>
            {decoded.variant.standard && decoded.variant.urlSafe ? (
              <Badge color="var(--warning)">混用了 + / 与 - _</Badge>
            ) : decoded.variant.urlSafe ? (
              <Badge color="var(--sys-purple)">URL 安全字符集</Badge>
            ) : (
              <Badge color="var(--sys-blue)">标准字符集</Badge>
            )}
            {decoded.variant.padded && <Badge color="var(--sys-teal)">有 = 填充</Badge>}
            {decoded.variant.missingPadding && <Badge color="var(--sys-orange)">省略了填充</Badge>}
            {decoded.variant.whitespace && <Badge color="var(--sys-cyan)">含空白 / 换行</Badge>}
            {decoded.variant.dataUrlMime && (
              <Badge color="var(--sys-indigo)">data: {decoded.variant.dataUrlMime}</Badge>
            )}
            {decoded.bom && <Badge color="var(--sys-mint)">UTF-8 BOM</Badge>}
            {decoded.type && decoded.type.kind !== 'text' && (
              <Badge color="var(--sys-pink)">{decoded.type.label}</Badge>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {decoded && binary && (
          <Notice key="binary" tone="warning">
            <span>
              解码得到 {formatBytes(decoded.bytes.length)} 的二进制数据，从第{' '}
              {(decoded.invalidAt + 1).toLocaleString()} 个字节起不是有效的 UTF-8 文本
              {decoded.type ? `，看起来是 ${decoded.type.label}（${decoded.type.mime}）` : ''}。
            </span>
            <span className="mt-2 flex flex-wrap gap-2">
              {view === 'text' && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Binary />}
                  onClick={() => set('view', 'hex')}
                >
                  查看十六进制
                </Button>
              )}
              <Button size="sm" variant="secondary" icon={<Download />} onClick={downloadBytes}>
                下载为 .{ext}
              </Button>
            </span>
          </Notice>
        )}
      </AnimatePresence>
    </div>
  )
}
