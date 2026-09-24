import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { ChevronsLeftRight, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { formatBytes } from '@/lib/file'
import { formatLabel, formatSavings, savings } from '@/lib/image-compressor'

export interface CompareData {
  name: string
  before: { url: string; size: number; mime: string; width: number; height: number }
  after: { url: string; size: number; mime: string; width: number; height: number }
}

/** 前后对比：拖动中间分隔线（或用方向键）查看压缩前后的差异 */
export function CompareModal({ data, onClose }: { data: CompareData; onClose: () => void }) {
  const [pos, setPos] = useState(50)
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  const dialog = useRef<HTMLDivElement>(null)
  // 渲染时（autoFocus 生效前）记下打开弹窗的元素，关闭后把焦点还给它
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )

  useEffect(() => {
    const node = dialog.current
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialog.current) return
      // 焦点困在弹窗内
      const nodes = Array.from(
        dialog.current.querySelectorAll<HTMLElement>('button, [tabindex="0"]'),
      ).filter((n) => !n.hasAttribute('disabled'))
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !dialog.current.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !dialog.current.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      // StrictMode 的模拟卸载不会移除节点；真正关闭后节点已脱离文档，这时才还焦点
      setTimeout(() => {
        if (!node?.isConnected) opener?.focus({ preventScroll: true })
      })
    }
  }, [opener])

  const moveTo = (clientX: number) => {
    const r = area.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    moveTo(e.clientX)
  }

  const { before, after } = data
  const ratio = before.width / before.height || 1
  const s = savings(before.size, after.size)

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 p-3 backdrop-blur-xl sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      data-lenis-prevent
    >
      <motion.div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`对比：${data.name}`}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-float"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">{data.name}</div>
            <div className="text-xs text-fg-2 tabular-nums">
              {formatBytes(before.size)} → {formatBytes(after.size)}
              <span className={s.percent >= 0 ? 'ml-1.5 text-success' : 'ml-1.5 text-warning'}>
                {formatSavings(s.percent)}
              </span>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            iconOnly
            icon={<X />}
            aria-label="关闭对比"
            title="关闭（Esc）"
            onClick={onClose}
            autoFocus
          />
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-2 p-3 sm:p-5">
          <div
            ref={area}
            className="relative cursor-ew-resize touch-none overflow-hidden rounded-xl bg-[conic-gradient(var(--fill)_25%,transparent_0_50%,var(--fill)_0_75%,transparent_0)] bg-[length:16px_16px] select-none"
            style={{
              width: `min(100%, calc((100dvh - 190px) * ${ratio}))`,
              aspectRatio: `${ratio}`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => dragging && moveTo(e.clientX)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
          >
            <img
              src={before.url}
              alt="原图"
              draggable={false}
              className="absolute inset-0 size-full object-contain"
            />
            <img
              src={after.url}
              alt="压缩后"
              draggable={false}
              className="absolute inset-0 size-full object-contain"
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
            />

            <span className="glass pointer-events-none absolute top-2.5 left-2.5 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-fg">
              原图 · {formatLabel(before.mime)} · {formatBytes(before.size)}
            </span>
            <span className="glass pointer-events-none absolute top-2.5 right-2.5 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-fg">
              压缩后 · {formatLabel(after.mime)} · {formatBytes(after.size)}
            </span>

            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-surface shadow-[0_0_0_1px_rgb(0_0_0/0.2),0_0_8px_rgb(0_0_0/0.35)] dark:bg-fg"
              style={{ left: `${pos}%` }}
            />
            <div
              role="slider"
              tabIndex={0}
              aria-label="对比分隔线"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pos)}
              aria-valuetext={`左侧原图 ${Math.round(pos)}%`}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 10 : 2
                if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - step))
                else if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + step))
                else if (e.key === 'Home') setPos(0)
                else if (e.key === 'End') setPos(100)
                else return
                e.preventDefault()
              }}
              className="glass absolute top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong text-fg shadow-float transition-transform active:scale-95"
              // 拖到两端时把手不被裁掉一半（分隔线本身仍在真实位置）
              style={{ left: `clamp(1.25rem, ${pos}%, calc(100% - 1.25rem))` }}
            >
              <ChevronsLeftRight className="size-4" />
            </div>
          </div>
        </div>
        <p className="border-t border-line px-4 py-2 text-center text-[11px] text-fg-3">
          拖动分隔线或用 ← → 键对比；原图 {before.width}×{before.height}，压缩后 {after.width}×
          {after.height}
        </p>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
