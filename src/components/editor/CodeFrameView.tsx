import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { CircleAlert } from 'lucide-react'
import { codeFrame, type CodeFrameLine } from '@/lib/json-formatter-position'
import { cn } from '@/lib/cn'

interface Props {
  /** 错误位置对应的文本 */
  source: string
  line: number
  column: number
  message: string
  hint?: string
  /** 底部操作按钮（如「定位到错误」） */
  actions?: ReactNode
  className?: string
}

const ACTIVE_TINT =
  'linear-gradient(color-mix(in srgb, var(--danger) 8%, transparent), color-mix(in srgb, var(--danger) 8%, transparent))'

function Gutter({ n, width, active }: { n?: number; width: number; active?: boolean }) {
  return (
    <span
      className={cn(
        'sticky left-0 z-[1] inline-block shrink-0 bg-surface-2 pr-3 pl-3 text-right tabular-nums select-none',
        active ? 'font-semibold text-danger' : 'text-fg-3',
      )}
      style={{
        minWidth: `calc(${width}ch + 1.5rem)`,
        // 横向滚动时行号固定在左侧；出错行叠加同样的淡红底色
        backgroundImage: active ? ACTIVE_TINT : undefined,
      }}
      aria-hidden
    >
      {n ?? ''}
    </span>
  )
}

function Row({ l, width }: { l: CodeFrameLine; width: number }) {
  return (
    <div className="flex">
      <Gutter n={l.number} width={width} />
      <span className="pr-4 whitespace-pre text-fg-2">{l.text || ' '}</span>
    </div>
  )
}

/** 出错位置的代码片段：行号 + 出错行高亮 + 对齐的插入符 */
export function CodeFrameView({ source, line, column, message, hint, actions, className }: Props) {
  const frame = useMemo(() => codeFrame(source, line, column), [source, line, column])
  const scroller = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLSpanElement>(null)

  // 窄屏下出错行可能很长：把出错字符横向滚动到可视区域中间
  useEffect(() => {
    const box = scroller.current
    const el = marker.current
    if (!box || !el) return
    const target = el.offsetLeft - box.clientWidth / 2
    box.scrollLeft = Math.max(0, target)
  }, [frame])

  const last = frame.after.length ? frame.after[frame.after.length - 1].number : frame.line.number
  const width = String(last).length

  return (
    <div className={cn('flex flex-col gap-4 p-4 sm:p-5', className)}>
      <div className="flex items-start gap-3">
        <motion.span
          initial={{ scale: 0.6, rotate: -20, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-danger/10 text-danger"
        >
          <CircleAlert className="size-5" />
        </motion.span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-danger tabular-nums">
            第 {line} 行第 {column} 列
          </div>
          <div className="mt-0.5 text-[15px] leading-snug font-semibold break-words text-fg">
            {message}
          </div>
          {hint && <div className="mt-1 text-[13px] leading-relaxed text-fg-2">{hint}</div>}
        </div>
      </div>

      <div
        ref={scroller}
        role="group"
        className="thin-scrollbar relative overflow-x-auto rounded-2xl border border-line bg-surface-2 py-2.5 font-mono text-[12.5px] leading-6 [tab-size:2]"
        aria-label={`第 ${line} 行附近的代码`}
      >
        <div className="min-w-max">
          {frame.before.map((l) => (
            <Row key={l.number} l={l} width={width} />
          ))}
          <div className="flex bg-danger/8">
            <Gutter n={frame.line.number} width={width} active />
            <span className="pr-4 whitespace-pre text-fg">
              {frame.line.prefix}
              <span
                ref={marker}
                className="rounded-[3px] bg-danger/20 text-danger underline decoration-danger decoration-wavy underline-offset-4"
              >
                {frame.line.char || ' '}
              </span>
              {frame.line.suffix}
            </span>
          </div>
          <div className="flex" aria-hidden>
            <Gutter width={width} />
            <span className="whitespace-pre">
              <span className="invisible">{frame.line.prefix}</span>
              <motion.span
                className="inline-block font-bold text-danger"
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.1 }}
              >
                ^
              </motion.span>
            </span>
          </div>
          {frame.after.map((l) => (
            <Row key={l.number} l={l} width={width} />
          ))}
        </div>
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
