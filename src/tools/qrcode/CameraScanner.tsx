import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CameraOff, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { decodeRgba, type DecodeResult } from '@/lib/qrcode-decode'

export interface CameraHit {
  blob: Blob
  width: number
  height: number
  result: DecodeResult
}

const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '摄像头权限被拒绝。请在浏览器地址栏的网站设置里允许使用摄像头，然后重试。'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '没有找到可用的摄像头。'
  if (name === 'NotReadableError' || name === 'AbortError') {
    return '摄像头被其它应用占用或无法启动，请关闭占用摄像头的程序后重试。'
  }
  return `无法打开摄像头：${e instanceof Error ? e.message : String(e)}`
}

/** 摄像头逐帧扫描（约每 120ms 一帧），识别到后自动停止并回传快照 */
export function CameraScanner({
  onHit,
  onClose,
}: {
  onHit: (hit: CameraHit) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const onHitRef = useRef(onHit)
  const [status, setStatus] = useState<'starting' | 'scanning'>('starting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onHitRef.current = onHit
  })

  const insecure = typeof window !== 'undefined' && !window.isSecureContext
  const unsupportedMessage = insecure
    ? '摄像头只能在 HTTPS 或 localhost 页面中使用。'
    : !cameraSupported
      ? '当前浏览器不支持调用摄像头，请改用上传图片。'
      : null

  useEffect(() => {
    if (unsupportedMessage) return
    const el = video.current
    if (!el) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const stop = () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      el.srcObject = null
    }

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        el.srcObject = stream
        await el.play()
        if (stopped) return
        setStatus('scanning')
        let last = 0
        const tick = (t: number) => {
          if (stopped) return
          raf = requestAnimationFrame(tick)
          if (t - last < 120 || el.readyState < 2 || !ctx) return
          last = t
          const vw = el.videoWidth
          const vh = el.videoHeight
          if (!vw || !vh) return
          const k = Math.min(1, 720 / Math.max(vw, vh))
          canvas.width = Math.round(vw * k)
          canvas.height = Math.round(vh * k)
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const result = decodeRgba(
            { data: img.data, width: img.width, height: img.height },
            { fast: true },
          )
          if (!result) return
          const { width, height } = canvas
          stop()
          canvas.toBlob((blob) => {
            if (blob) onHitRef.current({ blob, width, height, result })
          }, 'image/jpeg')
        }
        raf = requestAnimationFrame(tick)
      } catch (e) {
        if (!stopped) setError(cameraError(e))
      }
    }
    void start()
    return stop
  }, [unsupportedMessage])

  const message = unsupportedMessage ?? error

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-surface-3">
      <div className="relative aspect-[4/3] w-full sm:aspect-video">
        <video
          ref={video}
          playsInline
          muted
          className="absolute inset-0 size-full object-cover"
          aria-label="摄像头画面"
        />
        {message ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="size-8 text-fg-3" />
            <p className="max-w-sm text-sm text-fg-2">{message}</p>
          </div>
        ) : (
          <>
            {/* 取景框 + 扫描线 */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative aspect-square h-[62%] rounded-3xl shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]">
                {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                  <span
                    key={c}
                    className={
                      'absolute size-7 border-accent ' +
                      {
                        tl: 'top-0 left-0 rounded-tl-3xl border-t-4 border-l-4',
                        tr: 'top-0 right-0 rounded-tr-3xl border-t-4 border-r-4',
                        bl: 'bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4',
                        br: 'right-0 bottom-0 rounded-br-3xl border-r-4 border-b-4',
                      }[c]
                    }
                  />
                ))}
                {status === 'scanning' && (
                  <motion.span
                    className="absolute inset-x-4 h-0.5 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]"
                    initial={{ top: '8%' }}
                    animate={{ top: ['8%', '92%', '8%'] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </div>
            </div>
            <div className="glass absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-xs font-medium whitespace-nowrap text-fg">
              {status === 'starting' ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  正在打开摄像头…
                </>
              ) : (
                '将二维码放进取景框'
              )}
            </div>
          </>
        )}
        <Button
          size="sm"
          variant="secondary"
          iconOnly
          icon={<X />}
          aria-label="关闭摄像头"
          title="关闭摄像头"
          onClick={onClose}
          className="glass absolute top-3 right-3 border border-line"
        />
      </div>
    </div>
  )
}
