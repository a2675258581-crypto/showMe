import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ClipboardPaste, Download, ImageOff, Sparkles, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  CopyButton,
  ErrorNotice,
  Input,
  Notice,
  Panel,
  PanelHeader,
  TextArea,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { bytesToBase64 } from '@/lib/base64'
import { readClipboard } from '@/lib/clipboard'
import { downloadBlob, formatBytes } from '@/lib/file'
import { imageSize, parseImageInput, type ImageSize, type ParsedImage } from '@/lib/image-base64'
import { BlobImage, CHECKER, previewZoom, zoomStyle } from './ImagePreview'
import { SAMPLE_PNG_DATA_URL, SAMPLE_SVG } from './samples'

const spring = { type: 'spring', stiffness: 380, damping: 30 } as const

const SOURCE_LABEL: Record<ParsedImage['source'], string> = {
  'data-url': 'Data URL',
  base64: '原始 Base64（已按文件头识别类型）',
  svg: 'SVG 源码',
}

interface Props {
  text: string
  onText: (t: string) => void
}

export function DecodePanel({ text, onText }: Props) {
  const [name, setName] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ bytes: Uint8Array; size: ImageSize } | null>(null)
  const [broken, setBroken] = useState<Uint8Array | null>(null)
  const debounced = useDebounced(text, text.length > 200_000 ? 300 : 120)

  const parsed = useMemo(() => (debounced.trim() ? parseImageInput(debounced) : null), [debounced])
  const image = parsed?.ok ? parsed.image : null
  const size = useMemo(() => (image ? imageSize(image.bytes) : null), [image])
  const shownSize = size ?? (natural && natural.bytes === image?.bytes ? natural.size : null)
  const isBroken = !!image && broken === image.bytes
  const fileName = name ?? `image.${image?.ext ?? 'png'}`
  const zoom = previewZoom(shownSize)

  const update = (t: string) => {
    onText(t)
    setName(null)
  }

  /** 原始 Base64 输入时，给出补全后的 Data URL */
  const dataUrl = useMemo(
    () =>
      image && image.source !== 'data-url'
        ? `data:${image.mime};base64,${bytesToBase64(image.bytes)}`
        : '',
    [image],
  )

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="Data URL / Base64">
          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles />}
            onClick={() => update(SAMPLE_PNG_DATA_URL)}
          >
            PNG 示例
          </Button>
          <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => update(SAMPLE_SVG)}>
            SVG 示例
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ClipboardPaste />}
            onClick={async () => {
              const t = await readClipboard()
              if (t !== null) update(t)
            }}
          >
            粘贴
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<Trash2 />}
            aria-label="清空"
            title="清空"
            disabled={!text}
            onClick={() => update('')}
          />
        </PanelHeader>
        <TextArea
          mono
          value={text}
          onChange={(e) => update(e.target.value)}
          placeholder={
            '粘贴 data:image/png;base64,…、原始 Base64、SVG 源码，\n或带 url("…") / <img src="…"> / ![](…) 包裹的写法'
          }
          aria-label="Data URL 或 Base64"
          className="min-h-72 text-xs break-all"
        />
        <p className="mt-2 text-xs text-fg-3">
          {text
            ? `${text.length.toLocaleString()} 字符`
            : '会自动识别 MIME 类型；声明的类型与实际内容不符时以实际内容为准'}
        </p>
        <ErrorNotice error={parsed && !parsed.ok ? parsed.error : null} className="mt-3" />
      </Panel>

      <AnimatePresence mode="popLayout" initial={false}>
        {image ? (
          <motion.div
            key="preview"
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={spring}
          >
            <Panel padded={false} className="overflow-hidden">
              <div
                className="relative flex min-h-64 items-center justify-center border-b border-line p-6"
                style={CHECKER}
              >
                {zoom > 1 && image.isImage && !isBroken && <ZoomTag zoom={zoom} />}
                {image.isImage && !isBroken ? (
                  <motion.div
                    key={image.bytes.length + image.mime}
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                    className="flex max-w-full items-center justify-center"
                  >
                    <BlobImage
                      bytes={image.bytes}
                      mime={image.mime}
                      alt="解码后的图片"
                      className="max-h-80 max-w-full rounded-lg object-contain"
                      style={zoomStyle(shownSize, zoom, image.mime === 'image/svg+xml')}
                      onLoad={(e) => {
                        const el = e.currentTarget
                        if (el.naturalWidth)
                          setNatural({
                            bytes: image.bytes,
                            size: { width: el.naturalWidth, height: el.naturalHeight },
                          })
                      }}
                      onError={() => setBroken(image.bytes)}
                    />
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-fg-3">
                    <ImageOff className="size-10" />
                    <span className="text-xs">无法预览</span>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-4 p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge>{image.mime}</Badge>
                  <Badge color="var(--sys-teal)">{SOURCE_LABEL[image.source]}</Badge>
                  {image.declaredMime && image.declaredMime !== image.mime && (
                    <Badge color="var(--warning)">声明为 {image.declaredMime}</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Info
                    label="尺寸"
                    value={shownSize ? `${shownSize.width} × ${shownSize.height}` : '—'}
                  />
                  <Info label="文件大小" value={formatBytes(image.bytes.length)} />
                  <Info label="类型" value={image.detected?.label ?? image.mime} />
                </dl>

                {image.warnings.map((w) => (
                  <Notice key={w} tone="warning">
                    {w}
                  </Notice>
                ))}
                {!image.isImage && (
                  <Notice tone="warning">
                    解码成功，但这不是图片
                    {image.detected
                      ? `，而是 ${image.detected.label}（${image.detected.mime}）`
                      : ''}
                    。仍然可以下载后用对应的程序打开。
                  </Notice>
                )}
                {isBroken && image.isImage && (
                  <Notice tone="error">
                    浏览器无法显示这张图片：数据可能不完整或已损坏，也可能是浏览器不支持的格式。
                  </Notice>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    mono
                    value={fileName}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="下载文件名"
                    className="sm:flex-1"
                  />
                  <Button
                    variant="primary"
                    icon={<Download />}
                    onClick={() =>
                      downloadBlob(
                        fileName.trim() || `image.${image.ext}`,
                        new Blob([image.bytes as BlobPart], { type: image.mime }),
                      )
                    }
                  >
                    下载
                  </Button>
                </div>
                {dataUrl && (
                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-fill-2 px-3.5 py-2.5">
                    <span className="min-w-0 text-xs text-fg-2">
                      已补全为 Data URL（{dataUrl.length.toLocaleString()} 字符）
                    </span>
                    <CopyButton text={dataUrl} label="复制 Data URL" size="sm" />
                  </div>
                )}
              </div>
            </Panel>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="hidden min-h-72 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-line-strong bg-surface-2 p-8 text-center lg:flex"
          >
            <ImageOff className="size-8 text-fg-3" />
            <p className="text-sm text-fg-2">粘贴内容后，这里会显示图片预览</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-fill-2 px-3.5 py-2.5">
      <dt className="text-[11px] font-semibold text-fg-3">{label}</dt>
      <dd className="truncate text-sm font-medium text-fg tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  )
}

function ZoomTag({ zoom }: { zoom: number }) {
  return (
    <span className="glass absolute right-3 bottom-3 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium text-fg-2">
      已放大 {zoom}× 显示
    </span>
  )
}
