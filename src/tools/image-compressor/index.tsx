import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Download, Loader2, Sparkles, Trash2 } from 'lucide-react'
import {
  Button,
  DropZone,
  Field,
  Input,
  Kbd,
  Panel,
  PanelHeader,
  SegmentedControl,
  Slider,
  Switch,
  useToast,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { modKey } from '@/hooks/useHotkey'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import { downloadBlob, formatBytes } from '@/lib/file'
import {
  dedupeNames,
  formatSavings,
  normalizeMime,
  parseDimension,
  savings,
  type OutputChoice,
} from '@/lib/image-compressor'
import { CompareModal, type CompareData } from './CompareModal'
import { compressImage, detectEncodeSupport, type CompressOptions } from './encode'
import { ImageCard, type Item } from './ImageCard'
import { makeSampleImage } from './sample'

interface Options {
  format: OutputChoice
  quality: number
  /** 输入框原文，空 = 不限 */
  maxWidth: string
  maxHeight: string
  keepAspect: boolean
}

const DEFAULTS: Options = {
  format: 'keep',
  quality: 80,
  maxWidth: '',
  maxHeight: '',
  keepAspect: true,
}

const FORMATS: { value: OutputChoice; label: string }[] = [
  { value: 'keep', label: '原格式' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/avif', label: 'AVIF' },
]

const LONG_SIDE_PRESETS = [3840, 1920, 1280, 800]

function sanitize(raw: Partial<Options> | null): Options {
  const r: Partial<Options> = raw && typeof raw === 'object' ? raw : {}
  return {
    format: FORMATS.some((f) => f.value === r.format)
      ? (r.format as OutputChoice)
      : DEFAULTS.format,
    quality:
      typeof r.quality === 'number' && Number.isFinite(r.quality)
        ? Math.min(100, Math.max(1, Math.round(r.quality)))
        : DEFAULTS.quality,
    maxWidth: typeof r.maxWidth === 'string' ? r.maxWidth : '',
    maxHeight: typeof r.maxHeight === 'string' ? r.maxHeight : '',
    keepAspect: typeof r.keepAspect === 'boolean' ? r.keepAspect : true,
  }
}

let idSeq = 0
const isImage = (f: File) =>
  f.type.startsWith('image/') || normalizeMime('', f.name).startsWith('image/')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function ImageCompressor() {
  const toast = useToast()
  const [stored, setStored] = useLocalStorage<Partial<Options>>(
    'image-compressor.options.v1',
    DEFAULTS,
  )
  const opts = useMemo(() => sanitize(stored), [stored])
  const set = <K extends keyof Options>(k: K, v: Options[K]) =>
    setStored((prev) => ({ ...sanitize(prev), [k]: v }))

  const [items, setItems] = useState<Item[]>([])
  const [support, setSupport] = useState<string[] | null>(null)
  const [compare, setCompare] = useState<CompareData | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [tick, setTick] = useState(0)

  // 之前在别的浏览器选了 AVIF、当前浏览器不支持时按原格式处理
  const effectiveFormat: OutputChoice =
    opts.format === 'image/avif' && support && !support.includes('image/avif')
      ? 'keep'
      : opts.format

  // 选项变化后稍等再重新压缩
  const compressOpts: CompressOptions = useMemo(
    () => ({
      format: effectiveFormat,
      quality: opts.quality,
      maxWidth: parseDimension(opts.maxWidth),
      maxHeight: parseDimension(opts.maxHeight),
      keepAspect: opts.keepAspect,
    }),
    [effectiveFormat, opts.quality, opts.maxWidth, opts.maxHeight, opts.keepAspect],
  )
  const applied = useDebounced(compressOpts, 400)
  const optsKey = JSON.stringify(applied)

  useEffect(() => {
    let alive = true
    detectEncodeSupport().then((s) => alive && setSupport(s))
    return () => {
      alive = false
    }
  }, [])

  /* ── object URL 管理：所有创建的 URL 都登记，移除 / 清空 / 卸载时回收 ── */
  const urls = useRef(new Set<string>())
  const track = (u: string) => {
    urls.current.add(u)
    return u
  }
  const revoke = (u?: string) => {
    if (u && urls.current.delete(u)) URL.revokeObjectURL(u)
  }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const set = urls.current
    return () => {
      mounted.current = false
      set.forEach((u) => URL.revokeObjectURL(u))
      set.clear()
    }
  }, [])

  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  })

  /* ── 串行压缩队列：每次只处理一张，完成后 items 变化会再次触发 ── */
  const busy = useRef(false)
  useEffect(() => {
    if (!support || busy.current) return
    const next = items.find((i) => i.key !== optsKey)
    if (!next) return
    busy.current = true
    const key = optsKey
    const options = applied
    void (async () => {
      await Promise.resolve()
      setItems((list) => list.map((i) => (i.id === next.id ? { ...i, status: 'working' } : i)))
      let patch: Partial<Item>
      try {
        const r = await compressImage(next.file, options, support)
        // 离开页面时仍在压缩的那张：不再创建 object URL，避免泄漏
        if (!mounted.current) return
        patch = {
          status: 'done',
          key,
          error: undefined,
          out: {
            ...r,
            url: r.kept ? next.url : track(URL.createObjectURL(r.blob)),
            size: r.blob.size,
          },
        }
      } catch (e) {
        patch = {
          status: 'error',
          key,
          out: undefined,
          error: e instanceof Error ? e.message : '压缩失败',
        }
      }
      busy.current = false
      const current = itemsRef.current.find((i) => i.id === next.id)
      if (!current) {
        // 处理期间被移除了
        if (patch.out && patch.out.url !== next.url) revoke(patch.out.url)
        setTick((t) => t + 1)
        return
      }
      if (current.out && current.out.url !== current.url) revoke(current.out.url)
      setItems((list) => list.map((i) => (i.id === next.id ? { ...i, ...patch } : i)))
    })()
    // track / revoke 只读写 ref，不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, optsKey, support, tick])

  const addFiles = (files: File[]) => {
    const images = files.filter(isImage)
    const skipped = files.length - images.length
    if (skipped) toast(`已忽略 ${skipped} 个非图片文件`, 'info')
    if (!images.length) return
    setItems((list) => [
      ...list,
      ...images.map((file): Item => ({
        id: `img-${++idSeq}`,
        file,
        name: file.name || `粘贴的图片-${idSeq}.png`,
        mime: normalizeMime(file.type, file.name),
        size: file.size,
        url: track(URL.createObjectURL(file)),
        status: 'queued',
      })),
    ])
  }

  const addRef = useRef(addFiles)
  useEffect(() => {
    addRef.current = addFiles
  })

  // 粘贴截图
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      addRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const remove = (id: string) => {
    const it = items.find((i) => i.id === id)
    if (it) {
      if (it.out && it.out.url !== it.url) revoke(it.out.url)
      revoke(it.url)
    }
    setItems((list) => list.filter((i) => i.id !== id))
  }

  const clear = () => {
    for (const it of items) {
      if (it.out && it.out.url !== it.url) revoke(it.out.url)
      revoke(it.url)
    }
    setItems([])
  }

  const done = items.filter((i) => i.status === 'done' && i.out && i.key === optsKey)
  const pending = items.some((i) => i.key !== optsKey)
  const totalIn = done.reduce((n, i) => n + i.size, 0)
  const totalOut = done.reduce((n, i) => n + (i.out?.size ?? 0), 0)
  const total = savings(totalIn, totalOut)

  const downloadAll = async () => {
    const list = done.filter((i) => i.out)
    if (!list.length) return
    setDownloading(true)
    const names = dedupeNames(list.map((i) => i.out!.name))
    try {
      for (let k = 0; k < list.length; k++) {
        downloadBlob(names[k], list[k].out!.blob)
        // 连续触发下载时浏览器可能拦截，间隔一下
        if (k < list.length - 1) await sleep(350)
      }
    } finally {
      setDownloading(false)
    }
  }

  const openCompare = (it: Item) => {
    if (!it.out || it.out.kept) return
    setCompare({
      name: it.name,
      before: {
        url: it.url,
        size: it.size,
        mime: it.mime,
        width: it.out.srcWidth,
        height: it.out.srcHeight,
      },
      after: {
        url: it.out.url,
        size: it.out.size,
        mime: it.out.mime,
        width: it.out.width,
        height: it.out.height,
      },
    })
  }

  const trySample = async () => {
    try {
      addFiles([await makeSampleImage()])
    } catch {
      toast('生成示例图片失败', 'error')
    }
  }

  const formats = FORMATS.filter((f) => f.value !== 'image/avif' || support?.includes('image/avif'))
  const qualityUseless = effectiveFormat === 'image/png'
  const maxW = parseDimension(opts.maxWidth)
  const maxH = parseDimension(opts.maxHeight)
  const longSide = maxW && maxW === maxH ? maxW : undefined

  return (
    <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
      {/* 图片列表 */}
      <div className="flex min-w-0 flex-col gap-4">
        <DropZone
          multiple
          accept="image/*"
          onFiles={addFiles}
          className={cn(items.length ? 'p-5' : 'min-h-64')}
          title={items.length ? '继续添加图片' : '拖入图片，或点击选择（可多选）'}
          hint={
            <span className="inline-flex flex-wrap items-center justify-center gap-1">
              支持 JPEG / PNG / WebP / AVIF / GIF 等 · 也可按 <Kbd>{modKey}</Kbd>
              <Kbd>V</Kbd> 粘贴截图 · 全程本地处理
            </span>
          }
        />

        {items.length === 0 ? (
          <div className="flex justify-center">
            <Button variant="ghost" icon={<Sparkles />} onClick={trySample}>
              没有图片？用示例图片试试
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card">
              <div className="min-w-0 text-[13px] text-fg-2 tabular-nums">
                <span className="font-medium text-fg">{items.length} 张</span>
                {done.length > 0 && (
                  <>
                    {' · '}
                    {formatBytes(totalIn)} →{' '}
                    <span className="font-medium text-fg">{formatBytes(totalOut)}</span>
                    <span
                      className={cn(
                        'ml-2 font-semibold',
                        total.percent > 0 ? 'text-success' : 'text-warning',
                      )}
                    >
                      {formatSavings(total.percent)}
                    </span>
                    {total.saved > 0 && (
                      <span className="ml-1 text-fg-3">（省下 {formatBytes(total.saved)}）</span>
                    )}
                  </>
                )}
                {pending && (
                  <span className="ml-2 inline-flex items-center gap-1 text-fg-3">
                    <Loader2 className="size-3 animate-spin" /> 处理中
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 />}
                  onClick={clear}
                  className="hover:text-danger"
                >
                  清空
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={downloading ? <Loader2 className="animate-spin" /> : <Download />}
                  disabled={!done.length || downloading}
                  onClick={downloadAll}
                >
                  全部下载{done.length > 1 ? `（${done.length}）` : ''}
                </Button>
              </div>
            </div>

            <ul className="grid gap-3 xl:grid-cols-2">
              <AnimatePresence initial={false}>
                {items.map((it) => (
                  <ImageCard
                    key={it.id}
                    item={it}
                    stale={it.status === 'done' && it.key !== optsKey}
                    onCompare={() => openCompare(it)}
                    onDownload={() => it.out && downloadBlob(it.out.name, it.out.blob)}
                    onRemove={() => remove(it.id)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </>
        )}
      </div>

      {/* 选项 */}
      <Panel className="min-w-0 lg:sticky lg:top-20">
        <PanelHeader title="压缩选项">
          <AnimatePresence>
            {compressOpts !== applied && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[11px] text-fg-3"
              >
                即将应用…
              </motion.span>
            )}
          </AnimatePresence>
        </PanelHeader>
        <div className="flex flex-col gap-5">
          <Field
            label="输出格式"
            hint={
              support && !support.includes('image/avif')
                ? '当前浏览器不支持编码 AVIF'
                : effectiveFormat === 'keep'
                  ? 'GIF / BMP 等无法原样输出的格式会转为 PNG'
                  : undefined
            }
          >
            <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
              <SegmentedControl<OutputChoice>
                size="sm"
                block
                value={effectiveFormat}
                onChange={(v) => set('format', v)}
                aria-label="输出格式"
                options={formats}
                className="min-w-max"
              />
            </div>
          </Field>

          <div className="flex flex-col gap-1.5">
            {/* PNG 时质量无效 */}
            <Slider
              label="质量"
              value={opts.quality}
              min={1}
              max={100}
              onChange={(v) => set('quality', v)}
              format={(v) => `${v}%`}
              disabled={qualityUseless}
              className="transition-opacity"
            />
            <span className="text-xs text-fg-3">
              {qualityUseless
                ? 'PNG 为无损格式，质量参数不起作用'
                : '仅对 JPEG / WebP / AVIF 生效，70–85 通常肉眼难辨'}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="最大宽度">
                <Input
                  inputMode="numeric"
                  value={opts.maxWidth}
                  onChange={(e) => set('maxWidth', e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="不限"
                  aria-label="最大宽度（像素）"
                  mono
                />
              </Field>
              <Field label="最大高度">
                <Input
                  inputMode="numeric"
                  value={opts.maxHeight}
                  onChange={(e) => set('maxHeight', e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="不限"
                  aria-label="最大高度（像素）"
                  mono
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="长边预设">
              {[undefined, ...LONG_SIDE_PRESETS].map((n) => {
                const active = n === undefined ? !maxW && !maxH : longSide === n
                return (
                  <button
                    key={n ?? 'none'}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setStored((prev) => ({
                        ...sanitize(prev),
                        maxWidth: n ? String(n) : '',
                        maxHeight: n ? String(n) : '',
                      }))
                    }
                    className={cn(
                      'h-7 rounded-full px-2.5 text-xs transition-colors',
                      active ? 'bg-accent-soft text-accent' : 'bg-fill-2 text-fg-2 hover:text-fg',
                    )}
                  >
                    {n ? `长边 ${n}` : '原尺寸'}
                  </button>
                )
              })}
            </div>
            <Switch
              checked={opts.keepAspect}
              onChange={(v) => set('keepAspect', v)}
              label="保持宽高比"
            />
            <span className="text-xs text-fg-3">只缩小不放大；关闭比例锁定时宽高分别限制。</span>
          </div>
        </div>
      </Panel>

      <AnimatePresence>
        {compare && <CompareModal key="compare" data={compare} onClose={() => setCompare(null)} />}
      </AnimatePresence>
    </div>
  )
}
