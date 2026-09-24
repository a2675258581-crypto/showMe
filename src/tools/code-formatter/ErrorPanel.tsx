import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import type { CodeFrame } from '@/lib/code-formatter-frame'
import { cn } from '@/lib/cn'

/** 三个格式化 / 转换工具共用的错误结构 */
export interface ErrorInfo {
  message: string
  /** 原始英文信息 */
  detail?: string
  /** 补充建议 */
  hint?: string
  line?: number
  column?: number
  frame?: CodeFrame
}

/**
 * 带源码摘录的错误提示（外观与 Notice 一致，但内容区撑满宽度）：
 * 出错行高亮，箭头用「隐形的原文前缀」对齐，中文、emoji、Tab 都不会错位。
 */
export function ErrorPanel({
  error,
  action,
  className,
}: {
  error: ErrorInfo | null | undefined
  /** 右侧的操作（如「重试」「切换方向」） */
  action?: ReactNode
  className?: string
}) {
  const key = error ? `${error.message}|${error.line}|${error.column}` : 'none'
  // 外层 key 固定：边输入边出错时原地更新内容，而不是新旧两块同时出现、页面跳动
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          key="error"
          role="alert"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.4 }}
          className={cn(
            'flex items-start gap-2 rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-[13px] leading-relaxed text-danger',
            className,
          )}
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <motion.div
            key={key}
            initial={{ opacity: 0.35 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="min-w-0 flex-1"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {error.line !== undefined && (
                <span className="rounded-md bg-danger/10 px-1.5 py-px text-[11px] font-semibold tabular-nums">
                  第 {error.line} 行{error.column !== undefined && `，第 ${error.column} 列`}
                </span>
              )}
              <span className="font-medium break-words">{error.message}</span>
              {action && <span className="ml-auto">{action}</span>}
            </div>
            {error.detail && (
              <div className="mt-0.5 font-mono text-[11px] break-all opacity-70">
                {error.detail}
              </div>
            )}
            {error.frame && <FrameView frame={error.frame} />}
            {error.hint && <div className="mt-2 text-xs opacity-80">{error.hint}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FrameView({ frame }: { frame: CodeFrame }) {
  const gutter = String(frame.lines[frame.lines.length - 1]?.no ?? frame.line).length
  const gutterWidth = `calc(${gutter}ch + 1.5rem)`
  const preRef = useRef<HTMLPreElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)

  // 出错列在窄屏上可能超出可视区域：自动横向滚动，让箭头落在中间
  useLayoutEffect(() => {
    const pre = preRef.current
    const caret = caretRef.current
    if (!pre || !caret) return
    const x = caret.getBoundingClientRect().left - pre.getBoundingClientRect().left + pre.scrollLeft
    pre.scrollLeft = x > pre.clientWidth - 48 ? x - pre.clientWidth / 2 : 0
  }, [frame])

  return (
    <pre
      ref={preRef}
      className="thin-scrollbar mt-2.5 overflow-x-auto rounded-xl border border-line bg-surface py-2 font-mono text-[12px] leading-5 whitespace-pre text-fg"
      aria-label={`出错位置：第 ${frame.line} 行，第 ${frame.column} 列`}
    >
      <div className="w-max min-w-full">
        {frame.lines.map((l) => (
          <div key={l.no}>
            <div className={cn('flex pr-3', l.error && 'bg-danger/10')}>
              <span
                className={cn(
                  // 行号横向滚动时固定在左侧；出错行用不透明的混合色，免得透出下面的代码
                  'sticky left-0 shrink-0 pr-3 pl-3 text-right tabular-nums select-none',
                  l.error
                    ? 'bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))] font-semibold text-danger'
                    : 'bg-surface text-fg-3',
                )}
                style={{ width: gutterWidth }}
              >
                {l.no}
              </span>
              <span>{l.text || ' '}</span>
            </div>
            {l.error && (
              <div className="flex pr-3" aria-hidden>
                <span className="shrink-0" style={{ width: gutterWidth }} />
                <span>
                  <span className="invisible">{frame.caretPrefix}</span>
                  <motion.span
                    ref={caretRef}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.15 }}
                    className="inline-block font-bold text-danger"
                  >
                    {'^'.repeat(frame.caretWidth)}
                  </motion.span>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </pre>
  )
}

/** 非致命提醒（精度丢失、未闭合的字符串等） */
export function WarningList({ warnings }: { warnings: readonly string[] }) {
  return (
    <AnimatePresence>
      {warnings.length > 0 && (
        <motion.div
          key="warnings"
          role="status"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
          className="flex items-start gap-2 rounded-2xl border border-warning/20 bg-warning/8 px-4 py-3 text-[13px] leading-relaxed text-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {warnings.length === 1 ? (
            <div className="min-w-0 flex-1 break-words">{warnings[0]}</div>
          ) : (
            <ul className="min-w-0 flex-1 list-disc space-y-0.5 pl-4 break-words">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 出错时浮在（变淡的）旧输出上方的小提示 */
export function StaleOverlay({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3"
        >
          <span className="glass inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-danger shadow-float">
            <CircleAlert className="size-3.5" />
            {children}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
