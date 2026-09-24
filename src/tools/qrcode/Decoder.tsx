import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Camera,
  ClipboardPaste,
  ExternalLink,
  Loader2,
  QrCode,
  RotateCcw,
  ScanLine,
} from 'lucide-react'
import {
  Badge,
  Button,
  CopyButton,
  DropZone,
  Kbd,
  Notice,
  Panel,
  PanelHeader,
  useToast,
} from '@/components/ui'
import { modKey } from '@/hooks/useHotkey'
import { decodeRgba, parsePayload, type DecodeResult } from '@/lib/qrcode-decode'
import { blobToRgba, readClipboardImage } from './canvas'
import { CameraScanner, type CameraHit } from './CameraScanner'

interface Scan {
  status: 'working' | 'done' | 'error'
  url: string
  name: string
  width?: number
  height?: number
  result?: DecodeResult | null
  error?: string
}

const NOT_FOUND =
  '没有识别到二维码。请确认图片清晰、二维码完整且没有严重变形；可以裁剪到只剩二维码后再试。'

export function Decoder({ onUseText }: { onUseText: (text: string) => void }) {
  const toast = useToast()
  const [scan, setScan] = useState<Scan | null>(null)
  const [camera, setCamera] = useState(false)
  const seq = useRef(0)
  const resultRef = useRef<HTMLDivElement>(null)
  // 手机上结果面板在上传区下方：开始识别时把它滚进视野（桌面端已可见则不动）
  const revealResult = () =>
    requestAnimationFrame(() =>
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    )

  // 当前预览图的 object URL：换图或卸载时回收
  const url = scan?.url
  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  const decodeBlob = async (blob: Blob, name: string) => {
    if (!blob.type.startsWith('image/') && blob.type !== '') {
      toast('请选择图片文件', 'error')
      return
    }
    const token = ++seq.current
    setCamera(false)
    setScan({ status: 'working', url: URL.createObjectURL(blob), name })
    revealResult()
    // 让「识别中」先渲染出来再做较重的计算
    await new Promise((r) => setTimeout(r, 30))
    try {
      const rgba = await blobToRgba(blob, 2000)
      const result = decodeRgba(rgba)
      if (token !== seq.current) return
      setScan(
        (s) =>
          s && {
            ...s,
            status: result ? 'done' : 'error',
            width: rgba.width,
            height: rgba.height,
            result,
            error: result ? undefined : NOT_FOUND,
          },
      )
    } catch {
      if (token !== seq.current) return
      setScan(
        (s) =>
          s && {
            ...s,
            status: 'error',
            error: '无法读取这张图片：格式可能不受当前浏览器支持（如 HEIC），或文件已损坏。',
          },
      )
    }
  }

  const decodeRef = useRef(decodeBlob)
  useEffect(() => {
    decodeRef.current = decodeBlob
  })

  // 全局粘贴图片
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      void decodeRef.current(file, '粘贴的图片')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const pasteFromClipboard = async () => {
    try {
      const blob = await readClipboardImage()
      if (blob) void decodeBlob(blob, '剪贴板图片')
      else toast(`剪贴板里没有图片，也可以直接按 ${modKey}+V 粘贴`, 'info')
    } catch {
      toast(`无法读取剪贴板，请直接按 ${modKey}+V 粘贴图片`, 'info')
    }
  }

  const onCameraHit = (hit: CameraHit) => {
    seq.current++
    setCamera(false)
    setScan({
      status: 'done',
      url: URL.createObjectURL(hit.blob),
      name: '摄像头快照',
      width: hit.width,
      height: hit.height,
      result: hit.result,
    })
    revealResult()
  }

  const parsed = scan?.result ? parsePayload(scan.result.text) : null

  return (
    <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <AnimatePresence mode="wait" initial={false}>
          {camera ? (
            <motion.div
              key="camera"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <CameraScanner onHit={onCameraHit} onClose={() => setCamera(false)} />
            </motion.div>
          ) : (
            <motion.div
              key="drop"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <DropZone
                accept="image/*"
                onFiles={(files) => files[0] && void decodeBlob(files[0], files[0].name)}
                className="min-h-64"
                title="拖入二维码图片，或点击选择"
                hint={
                  <span className="inline-flex flex-wrap items-center justify-center gap-1">
                    也可以直接按 <Kbd>{modKey}</Kbd>
                    <Kbd>V</Kbd> 粘贴截图 · 图片只在本地识别，不会上传
                  </span>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={camera ? 'secondary' : 'primary'}
            icon={<Camera />}
            onClick={() => setCamera((v) => !v)}
          >
            {camera ? '关闭摄像头' : '摄像头扫码'}
          </Button>
          <Button variant="secondary" icon={<ClipboardPaste />} onClick={pasteFromClipboard}>
            从剪贴板粘贴
          </Button>
        </div>
      </div>

      <div ref={resultRef} className="min-w-0 scroll-mt-20">
        <Panel className="min-w-0">
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                识别结果
                {parsed && <Badge>{parsed.label}</Badge>}
              </span>
            }
          >
            {scan && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw />}
                onClick={() => {
                  seq.current++
                  setScan(null)
                }}
              >
                清除
              </Button>
            )}
          </PanelHeader>

          {!scan ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-fg-3">
              <ScanLine className="size-10" />
              <p className="text-sm">上传、粘贴图片或打开摄像头，识别结果会显示在这里</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex justify-center rounded-2xl bg-fill-2 p-3">
                <div className="relative inline-block max-w-full">
                  <img
                    src={scan.url}
                    alt={scan.name}
                    className="block max-h-72 max-w-full rounded-lg object-contain"
                  />
                  {scan.result && scan.width && scan.height && (
                    <svg
                      viewBox={`0 0 ${scan.width} ${scan.height}`}
                      preserveAspectRatio="none"
                      className="pointer-events-none absolute inset-0 size-full"
                      aria-hidden
                    >
                      <motion.path
                        d={`M${scan.result.corners.map((p) => `${p.x} ${p.y}`).join('L')}Z`}
                        fill="color-mix(in srgb, var(--sys-green) 18%, transparent)"
                        stroke="var(--sys-green)"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    </svg>
                  )}
                  {scan.status === 'working' && (
                    <div className="glass absolute inset-0 flex items-center justify-center rounded-lg">
                      <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        <Loader2 className="size-4 animate-spin" /> 识别中…
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <AnimatePresence mode="wait">
                {scan.status === 'error' && (
                  <Notice key="err" tone="error">
                    {scan.error}
                  </Notice>
                )}
                {scan.result && parsed && (
                  <motion.div
                    key={scan.result.text}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    className="flex flex-col gap-3"
                  >
                    <pre className="thin-scrollbar max-h-48 overflow-auto rounded-2xl border border-line bg-surface-2 px-4 py-3 font-mono text-[13px] leading-relaxed break-all whitespace-pre-wrap text-fg">
                      {scan.result.text}
                    </pre>
                    {parsed.fields.length > 0 && parsed.kind !== 'url' && (
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-2xl bg-fill-2 px-4 py-3 text-[13px]">
                        {parsed.fields.map(([k, v], i) => (
                          <div key={i} className="contents">
                            <dt className="text-fg-2">{k}</dt>
                            <dd className="break-all whitespace-pre-wrap text-fg">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton text={scan.result.text} size="md" variant="primary" />
                      {parsed.href && (
                        <Button
                          variant="secondary"
                          icon={<ExternalLink />}
                          onClick={() => window.open(parsed.href, '_blank', 'noopener,noreferrer')}
                          title={parsed.href}
                        >
                          打开链接
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        icon={<QrCode />}
                        onClick={() => onUseText(scan.result!.text)}
                      >
                        用此内容生成
                      </Button>
                      <span className="ml-auto text-xs text-fg-3">
                        版本 {scan.result.version} · {scan.result.text.length.toLocaleString()} 字符
                      </span>
                    </div>
                    {parsed.href && (
                      <p className="text-xs text-fg-3">
                        打开前请确认域名{' '}
                        <span className="font-mono text-fg-2">{parsed.fields[0]?.[1]}</span>{' '}
                        可信，二维码常被用于钓鱼。
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
