import type { ReactNode, Ref } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, ExternalLink, Lightbulb, MapPin, Text } from 'lucide-react'
import { Badge, CopyButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { STATUS_LABELS, classInfo, type HttpStatus } from '@/lib/http-status'

const spring = { type: 'spring', stiffness: 420, damping: 38 } as const

export const detailId = (code: number) => `status-${code}-detail`

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-2 text-fg-2 [&_svg]:size-3.5">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-fg-2">{title}</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-fg">{children}</p>
      </div>
    </div>
  )
}

/** 状态码卡片：点击后在所在行下方展开详情（见 StatusDetail），卡片本身保持在网格里的位置 */
export function StatusCard({
  status: s,
  expanded,
  onToggle,
  ref,
}: {
  status: HttpStatus
  expanded: boolean
  onToggle: () => void
  /** AnimatePresence popLayout 需要拿到 DOM 节点 */
  ref?: Ref<HTMLElement>
}) {
  const color = classInfo(s.code).color
  return (
    <motion.article
      ref={ref}
      layout
      transition={spring}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      id={`status-${s.code}`}
      className={cn(
        'relative overflow-hidden rounded-3xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-300',
        expanded ? 'border-transparent' : 'border-line',
      )}
      style={{
        borderRadius: 24,
        boxShadow: expanded
          ? `0 0 0 2px color-mix(in srgb, ${color} 55%, transparent), var(--shadow-card)`
          : undefined,
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 transition-opacity duration-300"
        style={{ background: color, opacity: expanded ? 1 : 0.55 }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? detailId(s.code) : undefined}
        className="flex h-full w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-fill-2/60"
      >
        <span
          className="font-mono text-3xl leading-none font-bold tracking-tight tabular-nums"
          style={{ color }}
        >
          {s.code}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold text-fg">{s.name}</span>
            {s.status && (
              <Badge color={s.status === 'unofficial' ? 'var(--sys-purple)' : 'var(--fg-2)'}>
                {s.vendor ?? STATUS_LABELS[s.status]}
              </Badge>
            )}
          </span>
          <span className="truncate font-mono text-xs text-fg-2">{s.phrase}</span>
          <span className="mt-1 line-clamp-2 text-[13px] leading-snug text-fg-2">{s.desc}</span>
        </span>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={spring}
          className="mt-1 text-fg-3"
        >
          <ChevronDown className="size-4" />
        </motion.span>
      </button>
    </motion.article>
  )
}

/**
 * 详情面板：占满整行，插在被展开卡片所在行的末尾，
 * 顶部小三角指向该卡片所在的列，这样网格不会留下空洞，顺序也不变。
 */
export function StatusDetail({
  status: s,
  column,
  columns,
  ref,
}: {
  status: HttpStatus
  /** 被展开卡片所在的列（从 0 开始） */
  column: number
  columns: number
  ref?: Ref<HTMLElement>
}) {
  const color = classInfo(s.code).color
  return (
    <motion.section
      ref={ref}
      layout
      id={detailId(s.code)}
      aria-label={`${s.code} ${s.name} 详情`}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.15 } }}
      transition={spring}
      className="relative col-span-full rounded-3xl border border-line bg-surface shadow-card"
      style={{ borderRadius: 24 }}
    >
      {columns > 1 && (
        <span
          aria-hidden
          className="absolute -top-[7px] size-3 -translate-x-1/2 rotate-45 border-t border-l border-line bg-surface"
          style={{ left: `${((column + 0.5) / columns) * 100}%` }}
        />
      )}
      <div className="px-5 pt-4 pb-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="font-mono text-lg font-bold tabular-nums" style={{ color }}>
            {s.code}
          </span>
          <span className="text-[15px] font-semibold text-fg">{s.name}</span>
          <span className="font-mono text-xs text-fg-2">{s.phrase}</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Section icon={<Text />} title="含义">
            {s.desc}
          </Section>
          <Section icon={<MapPin />} title="典型场景">
            {s.scenario}
          </Section>
          <Section icon={<Lightbulb />} title="开发建议">
            {s.tip}
          </Section>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {s.headers && s.headers.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-fg-2">相关头</span>
              {s.headers.map((h) => (
                <code
                  key={h}
                  className="rounded-md bg-fill-2 px-1.5 py-0.5 font-mono text-[12px] text-fg"
                >
                  {h}
                </code>
              ))}
            </span>
          )}
          {s.cacheable && (
            <span title="RFC 9110 §15.1：未显式声明缓存策略时也可被缓存">
              <Badge color="var(--sys-green)">默认可缓存</Badge>
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-1">
            {s.specUrl ? (
              <a
                href={s.specUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-link hover:bg-fill-2"
              >
                {s.spec}
                <ExternalLink className="size-3.5" />
              </a>
            ) : (
              <span className="px-3 text-[13px] text-fg-3">{s.spec}</span>
            )}
            <CopyButton text={String(s.code)} label="复制状态码" iconOnly variant="ghost" />
            <CopyButton text={`${s.code} ${s.phrase}`} label="复制状态行" />
          </span>
        </div>
      </div>
    </motion.section>
  )
}
