import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ClipboardPaste,
  Download,
  FileDown,
  FileUp,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  Button,
  CopyButton,
  DropZone,
  ErrorNotice,
  Input,
  Notice,
  Panel,
  PanelHeader,
  Switch,
  TextArea,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { base64ToBytes, bytesToBase64, overheadPercent } from '@/lib/base64'
import { detectFileType, resolveFileType, type FileTypeInfo } from '@/lib/base64-filetype'
import { readClipboard } from '@/lib/clipboard'
import { downloadBlob, downloadText, formatBytes } from '@/lib/file'
import { imageSize } from '@/lib/image-base64'
import { BlobImage, BlobMedia, CHECKER, KindIcon, previewZoom } from './FilePreview'
import { SAMPLE_PNG_BASE64, type Base64Prefs } from './prefs'

type Setter = <K extends keyof Base64Prefs>(k: K, v: Base64Prefs[K]) => void

/** 文本框里最多显示的字符数（复制 / 下载仍是完整内容） */
const PREVIEW_CHARS = 100_000
const BIG_FILE = 10 * 1024 * 1024

const spring = { type: 'spring', stiffness: 380, damping: 32 } as const

interface Loaded {
  file: File
  bytes: Uint8Array
  type: FileTypeInfo | null
}

export function FileMode({ prefs, set }: { prefs: Base64Prefs; set: Setter }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <EncodeFile dataUrl={prefs.dataUrl} wrap={prefs.fileWrap} set={set} />
      <DecodeFile />
    </div>
  )
}

function EncodeFile({ dataUrl, wrap, set }: { dataUrl: boolean; wrap: boolean; set: Setter }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const onFiles = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setLoaded({ file, bytes, type: detectFileType(bytes) })
    } catch {
      setError(`无法读取文件“${file.name}”，可能已被移动或没有读取权限`)
    } finally {
      setBusy(false)
    }
  }

  const base64 = useMemo(
    () => (loaded ? bytesToBase64(loaded.bytes, { lineWidth: wrap && !dataUrl ? 76 : 0 }) : ''),
    [loaded, wrap, dataUrl],
  )
  const mime = loaded
    ? loaded.file.type || loaded.type?.mime || 'application/octet-stream'
    : 'application/octet-stream'
  const full = loaded ? (dataUrl ? `data:${mime};base64,${base64}` : base64) : ''
  const truncated = full.length > PREVIEW_CHARS
  const preview = truncated ? full.slice(0, PREVIEW_CHARS) + '…' : full
  const encodedChars = base64.replace(/\n/g, '').length

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FileUp className="size-4 text-accent" />
            文件 → Base64
          </span>
        }
      >
        {loaded && (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw />}
              onClick={() => picker.current?.click()}
            >
              更换
            </Button>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={<X />}
              aria-label="移除文件"
              title="移除文件"
              onClick={() => setLoaded(null)}
            />
          </>
        )}
      </PanelHeader>
      <input
        ref={picker}
        type="file"
        hidden
        onChange={(e) => {
          void onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />

      <AnimatePresence mode="wait" initial={false}>
        {!loaded ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={spring}
          >
            <DropZone
              onFiles={(f) => void onFiles(f)}
              title={busy ? '正在读取…' : '拖入任意文件，或点击选择'}
              hint="图片、PDF、字体、压缩包……文件只在浏览器本地读取，不会上传"
              className="min-h-56"
            />
          </motion.div>
        ) : (
          <motion.div
            key={`${loaded.file.name}-${loaded.file.size}-${loaded.file.lastModified}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
            className="flex flex-col gap-4"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3">
              {loaded.type?.kind === 'image' ? (
                <div
                  className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line"
                  style={CHECKER}
                >
                  <BlobImage
                    bytes={loaded.bytes}
                    mime={mime}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <KindIcon kind={loaded.type?.kind} className="size-14" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-fg" title={loaded.file.name}>
                  {loaded.file.name}
                </div>
                <div className="text-xs text-fg-3 tabular-nums">
                  {formatBytes(loaded.bytes.length)} · {loaded.type?.label ?? mime}
                </div>
              </div>
              {busy && <Loader2 className="size-4 animate-spin text-fg-3" aria-label="正在读取" />}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Switch
                checked={dataUrl}
                onChange={(v) => set('dataUrl', v)}
                label={<span className="text-[13px] text-fg-2">带 data: 前缀（Data URL）</span>}
              />
              <Switch
                checked={wrap && !dataUrl}
                disabled={dataUrl}
                onChange={(v) => set('fileWrap', v)}
                label={<span className="text-[13px] text-fg-2">每 76 字符换行</span>}
              />
            </div>

            <TextArea
              readOnly
              mono
              value={preview}
              aria-label="Base64 结果"
              className="min-h-44 max-h-80 text-xs break-all"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-fg-2 tabular-nums">
                {formatBytes(loaded.bytes.length)} → {encodedChars.toLocaleString()} 字符
                <span className="ml-1.5 text-fg-3">
                  （+{overheadPercent(loaded.bytes.length, encodedChars)}%）
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Download />}
                  onClick={() => downloadText(`${loaded.file.name}.base64.txt`, full)}
                >
                  下载 .txt
                </Button>
                <CopyButton text={() => full} label="复制全部" variant="primary" />
              </div>
            </div>

            {truncated && (
              <p className="text-xs text-fg-3">
                文本框只显示前 {PREVIEW_CHARS.toLocaleString()} 个字符，复制或下载会得到完整的{' '}
                {full.length.toLocaleString()} 个字符。
              </p>
            )}
            {loaded.bytes.length > BIG_FILE && (
              <Notice tone="warning">
                文件超过 {formatBytes(BIG_FILE)}，复制到剪贴板可能失败或让页面变慢，建议直接下载
                .txt。
              </Notice>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <ErrorNotice error={error} className="mt-3" />
    </Panel>
  )
}

function DecodeFile() {
  const [text, setText] = useState('')
  const [name, setName] = useState<string | null>(null)
  const debounced = useDebounced(text, text.length > 200_000 ? 300 : 100)

  const decoded = useMemo(() => {
    if (!debounced.trim()) return null
    const r = base64ToBytes(debounced)
    if (!r.ok) return { ok: false as const, error: r.error }
    if (r.bytes.length === 0) return { ok: false as const, error: '解码结果为空' }
    const type = resolveFileType(detectFileType(r.bytes), r.variant.dataUrlMime)
    return {
      ok: true as const,
      bytes: r.bytes,
      type,
      size: type?.kind === 'image' ? imageSize(r.bytes) : null,
    }
  }, [debounced])

  const update = (v: string) => {
    setText(v)
    setName(null)
  }

  const ok = decoded?.ok ? decoded : null
  const mime = ok?.type?.mime ?? 'application/octet-stream'
  const fileName = name ?? `decoded.${ok?.type?.ext ?? 'bin'}`
  const textPreview = useMemo(
    () =>
      ok?.type?.kind === 'text'
        ? new TextDecoder().decode(ok.bytes.subarray(0, 4000)) + (ok.bytes.length > 4000 ? '…' : '')
        : '',
    [ok],
  )

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <FileDown className="size-4 text-accent" />
            Base64 → 文件
          </span>
        }
      >
        <Button
          size="sm"
          variant="ghost"
          icon={<Sparkles />}
          onClick={() => update(`data:image/png;base64,${SAMPLE_PNG_BASE64}`)}
        >
          示例
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
        placeholder="粘贴 Base64，或 data:image/png;base64,… 形式的 Data URL"
        aria-label="Base64 输入"
        className="min-h-44 max-h-80 text-xs break-all"
      />
      <ErrorNotice error={decoded && !decoded.ok ? decoded.error : null} className="mt-3" />

      <AnimatePresence initial={false}>
        {ok && (
          <motion.div
            key="result"
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring}
            className="mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-surface-2 p-4"
          >
            <div className="flex items-center gap-3">
              <KindIcon kind={ok.type?.kind} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-fg">
                  {ok.type?.label ?? '未能识别的二进制数据'}
                </div>
                <div className="truncate text-xs text-fg-3 tabular-nums">
                  {mime} · {formatBytes(ok.bytes.length)}
                  {ok.size && ` · ${ok.size.width} × ${ok.size.height}`}
                </div>
              </div>
            </div>

            {ok.type?.kind === 'image' && (
              <div
                className="flex max-h-72 items-center justify-center overflow-hidden rounded-xl border border-line p-3"
                style={CHECKER}
              >
                <BlobImage
                  bytes={ok.bytes}
                  mime={mime}
                  className="max-h-64 max-w-full object-contain"
                  style={
                    ok.size && previewZoom(ok.size) > 1
                      ? {
                          width: ok.size.width * previewZoom(ok.size),
                          height: ok.size.height * previewZoom(ok.size),
                          imageRendering: mime === 'image/svg+xml' ? 'auto' : 'pixelated',
                        }
                      : undefined
                  }
                />
              </div>
            )}
            {(ok.type?.kind === 'audio' || ok.type?.kind === 'video') && (
              <BlobMedia
                bytes={ok.bytes}
                mime={mime}
                kind={ok.type.kind}
                className="max-h-64 w-full rounded-xl"
              />
            )}
            {textPreview && (
              <pre className="thin-scrollbar max-h-48 overflow-auto rounded-xl bg-fill-2 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-fg">
                {textPreview}
              </pre>
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
                    fileName.trim() || `decoded.${ok.type?.ext ?? 'bin'}`,
                    new Blob([ok.bytes as BlobPart], { type: mime }),
                  )
                }
              >
                下载文件
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}
