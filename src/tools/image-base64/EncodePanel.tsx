import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ClipboardPaste, ImagePlus, RefreshCw, Sparkles, X } from 'lucide-react'
import {
  Badge,
  Button,
  CopyButton,
  DropZone,
  ErrorNotice,
  Kbd,
  Notice,
  Panel,
  SegmentedControl,
  useToast,
} from '@/components/ui'
import { modKey } from '@/hooks/useHotkey'
import { bytesToBase64 } from '@/lib/base64'
import { detectFileType } from '@/lib/base64-filetype'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/file'
import { buildSnippets, growth, imageSize, svgToDataUrl, type ImageSize } from '@/lib/image-base64'
import { BlobImage, CHECKER, previewZoom, zoomStyle } from './ImagePreview'
import { SAMPLE_SVG } from './samples'

const spring = { type: 'spring', stiffness: 380, damping: 30 } as const
/** 超过这个大小提示不适合内联 */
const INLINE_LIMIT = 100 * 1024
/** 代码预览最多显示的字符 */
const SNIPPET_PREVIEW = 280

export interface LoadedImage {
  name: string
  mime: string
  bytes: Uint8Array
  size: ImageSize | null
  /** SVG 源码（仅 SVG） */
  svg: string | null
  /** 每次载入不同，用作动画 key */
  id: number
}

let loadSeq = 0

/** 读取图片文件：成功返回 LoadedImage，失败返回中文错误 */
export async function readImage(
  blob: Blob,
  name: string,
): Promise<{ ok: true; image: LoadedImage } | { ok: false; error: string }> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await blob.arrayBuffer())
  } catch {
    return { ok: false, error: `无法读取“${name}”，可能已被移动或没有读取权限` }
  }
  if (bytes.length === 0) return { ok: false, error: `“${name}”是空文件` }
  const type = detectFileType(bytes)
  if (type?.kind !== 'image' && !blob.type.startsWith('image/')) {
    return {
      ok: false,
      error: `“${name}”不是图片${type ? `（识别为 ${type.label}）` : ''}。其他类型的文件请使用「Base64 编解码」工具的文件模式。`,
    }
  }
  const mime = type?.kind === 'image' ? type.mime : blob.type
  const svg = mime === 'image/svg+xml' ? new TextDecoder().decode(bytes) : null
  return { ok: true, image: { name, mime, bytes, size: imageSize(bytes), svg, id: ++loadSeq } }
}

interface Props {
  img: LoadedImage | null
  error: string | null
  /** 载入图片（文件、剪贴板、示例） */
  onLoad: (blob: Blob, name: string) => void
  onClear: () => void
  onError: (error: string | null) => void
  svgMode: 'base64' | 'url'
  onSvgMode: (m: 'base64' | 'url') => void
}

export function EncodePanel({ img, error, onLoad, onClear, onError, svgMode, onSvgMode }: Props) {
  const [natural, setNatural] = useState<{ id: number; size: ImageSize } | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const load = onLoad

  const readClipboardImage = async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          load(blob, `剪贴板图片.${type.split('/')[1]?.replace('svg+xml', 'svg') ?? 'png'}`)
          return
        }
      }
      toast('剪贴板里没有图片', 'info')
    } catch {
      toast(`浏览器不允许直接读取剪贴板，请按 ${modKey}+V 粘贴`, 'error')
    }
  }

  const isSvg = img?.mime === 'image/svg+xml' && img.svg !== null
  const base64 = useMemo(() => (img ? bytesToBase64(img.bytes) : ''), [img])
  const svgUrl = useMemo(() => (img?.svg ? svgToDataUrl(img.svg) : ''), [img])
  const dataUrl = img
    ? isSvg && svgMode === 'url'
      ? svgUrl
      : `data:${img.mime};base64,${base64}`
    : ''
  const size = img?.size ?? (natural && img && natural.id === img.id ? natural.size : null)
  const zoom = previewZoom(size)
  const baseName = img ? img.name.replace(/\.[^.]+$/, '') || '图片' : '图片'
  const snippets = useMemo(
    () =>
      dataUrl
        ? buildSnippets(dataUrl, { alt: baseName, width: size?.width, height: size?.height })
        : null,
    [dataUrl, baseName, size?.width, size?.height],
  )

  const outputs: { key: string; label: string; hint: string; text: string }[] = snippets
    ? [
        {
          key: 'dataUrl',
          label: 'Data URL',
          hint: '可直接用于 src / href',
          text: snippets.dataUrl,
        },
        { key: 'base64', label: '原始 Base64', hint: '不含 data: 前缀', text: base64 },
        { key: 'css', label: 'CSS', hint: 'background-image', text: snippets.css },
        { key: 'html', label: 'HTML', hint: '<img> 标签', text: snippets.html },
        { key: 'markdown', label: 'Markdown', hint: '图片语法', text: snippets.markdown },
      ]
    : []

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={picker}
        type="file"
        accept="image/*,.svg,.ico,.avif,.heic"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) load(f, f.name)
          e.target.value = ''
        }}
      />

      <AnimatePresence mode="wait" initial={false}>
        {!img ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={spring}
            className="flex flex-col gap-3"
          >
            <DropZone
              accept="image/*,.svg,.ico,.avif,.heic"
              onFiles={([f]) => load(f, f.name)}
              className="min-h-64"
            >
              <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent transition-transform duration-300 group-hover:-translate-y-1">
                <ImagePlus className="size-6" />
              </span>
              <div className="text-base font-semibold text-fg">拖入图片、点击选择，或直接粘贴</div>
              <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-fg-3">
                在页面任意位置按 <Kbd>{modKey}</Kbd>
                <Kbd>V</Kbd> 粘贴截图 · 支持 PNG、JPEG、GIF、WebP、SVG、AVIF、ICO
              </div>
            </DropZone>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<ClipboardPaste />}
                onClick={readClipboardImage}
              >
                读取剪贴板图片
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Sparkles />}
                onClick={() =>
                  load(new Blob([SAMPLE_SVG], { type: 'image/svg+xml' }), '示例图标.svg')
                }
              >
                使用示例图片
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={img.id}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={spring}
          >
            <Panel padded={false} className="overflow-hidden">
              <div className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div
                  className="relative flex min-h-56 items-center justify-center border-b border-line p-6 md:border-r md:border-b-0"
                  style={CHECKER}
                >
                  {zoom > 1 && (
                    <span className="glass absolute right-3 bottom-3 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium text-fg-2">
                      已放大 {zoom}× 显示
                    </span>
                  )}
                  <motion.div
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.08 }}
                    className="flex max-h-72 max-w-full items-center justify-center"
                  >
                    <BlobImage
                      bytes={img.bytes}
                      mime={img.mime}
                      alt={img.name}
                      className="max-h-72 max-w-full rounded-lg object-contain drop-shadow-sm"
                      style={zoomStyle(size, zoom, isSvg)}
                      onLoad={(e) => {
                        const el = e.currentTarget
                        if (el.naturalWidth)
                          setNatural({
                            id: img.id,
                            size: { width: el.naturalWidth, height: el.naturalHeight },
                          })
                      }}
                      onError={() =>
                        onError('浏览器无法显示这张图片，数据可能已损坏或格式不受支持')
                      }
                    />
                  </motion.div>
                </div>
                <div className="flex flex-col gap-4 p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-fg" title={img.name}>
                        {img.name}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge>{img.mime}</Badge>
                        {isSvg && <Badge color="var(--sys-purple)">矢量图</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<RefreshCw />}
                        aria-label="更换图片"
                        title="更换图片"
                        onClick={() => picker.current?.click()}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={<X />}
                        aria-label="移除图片"
                        title="移除图片"
                        onClick={onClear}
                      />
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2">
                    <Stat label="尺寸" value={size ? `${size.width} × ${size.height}` : '—'} />
                    <Stat label="原始大小" value={formatBytes(img.bytes.length)} />
                    <Stat
                      label="Base64 长度"
                      value={`${base64.length.toLocaleString()} 字符`}
                      extra={growth(img.bytes.length, base64.length)}
                    />
                    <Stat label="Data URL 长度" value={`${dataUrl.length.toLocaleString()} 字符`} />
                  </dl>
                  {isSvg && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-fg-2">SVG 编码方式</span>
                      <SegmentedControl
                        size="sm"
                        block
                        aria-label="SVG 编码方式"
                        value={svgMode}
                        onChange={onSvgMode}
                        options={[
                          {
                            value: 'base64',
                            label: `Base64 · ${formatBytes(`data:image/svg+xml;base64,${base64}`.length)}`,
                          },
                          { value: 'url', label: `URL 编码 · ${formatBytes(svgUrl.length)}` },
                        ]}
                      />
                      <span className="text-[11px] text-fg-3">
                        URL 编码的 SVG 通常更短、gzip 后更小，且在 CSS 里可读
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorNotice error={error} />

      <AnimatePresence>
        {img && img.bytes.length > INLINE_LIMIT && (
          <Notice key="big" tone="warning">
            图片有 {formatBytes(img.bytes.length)}。内联成 Base64 会让 HTML / CSS
            变大约三分之一，且无法被浏览器单独缓存，通常只建议用于几 KB 的小图标。
          </Notice>
        )}
      </AnimatePresence>

      {img && (
        <div className="grid gap-3">
          {outputs.map((o, i) => (
            <motion.div
              key={`${img.id}-${o.key}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.05 + i * 0.04 }}
              className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-card"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-fg">{o.label}</span>
                  <span className="truncate text-xs text-fg-3">{o.hint}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] whitespace-nowrap text-fg-3 tabular-nums">
                    {o.text.length.toLocaleString()} 字符
                  </span>
                  <CopyButton text={o.text} label={`复制 ${o.label}`} iconOnly variant="ghost" />
                </div>
              </div>
              <Snippet text={o.text} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, extra }: { label: string; value: ReactNode; extra?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-fill-2 px-3.5 py-2.5">
      <dt className="text-[11px] font-semibold text-fg-3">{label}</dt>
      <dd className="truncate text-sm font-medium text-fg tabular-nums">
        {value}
        {extra && <span className="ml-1 text-xs font-normal text-fg-3">{extra}</span>}
      </dd>
    </div>
  )
}

/** 长文本只显示开头（底部渐隐表示未完），完整内容通过复制获得 */
function Snippet({ text }: { text: string }) {
  const long = text.length > SNIPPET_PREVIEW
  return (
    <pre
      className={cn(
        'max-h-24 overflow-hidden rounded-xl bg-fill-2 px-3 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-fg-2',
        long && '[mask-image:linear-gradient(to_bottom,#000_55%,transparent)]',
      )}
    >
      {long ? `${text.slice(0, SNIPPET_PREVIEW)}…` : text}
    </pre>
  )
}
