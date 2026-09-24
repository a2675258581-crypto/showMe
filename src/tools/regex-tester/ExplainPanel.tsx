import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import type { ExplainKind, ExplainNode } from '@/lib/regex-tester-explain'

const KIND_STYLE: Record<ExplainKind, { color: string; label: string }> = {
  literal: { color: 'var(--fg-2)', label: '文本' },
  escape: { color: 'var(--sys-blue)', label: '字符类' },
  class: { color: 'var(--sys-indigo)', label: '字符集' },
  quantifier: { color: 'var(--sys-orange)', label: '量词' },
  group: { color: 'var(--sys-green)', label: '分组' },
  groupEnd: { color: 'var(--sys-green)', label: '分组' },
  anchor: { color: 'var(--sys-purple)', label: '位置' },
  alternation: { color: 'var(--sys-pink)', label: '或' },
  backref: { color: 'var(--sys-teal)', label: '引用' },
  dot: { color: 'var(--sys-blue)', label: '任意' },
  error: { color: 'var(--danger)', label: '错误' },
}

/** 逐个记号的中文解释 */
export function ExplainPanel({ nodes }: { nodes: ExplainNode[] }) {
  if (!nodes.length) {
    return (
      <p className="px-2 py-10 text-center text-sm text-fg-3">
        输入正则表达式后，这里会逐项解释它的含义
      </p>
    )
  }
  return (
    <ol className="flex flex-col">
      {nodes.map((n, i) => {
        const s = KIND_STYLE[n.kind]
        return (
          <motion.li
            key={`${n.pos}-${n.token}-${i}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: Math.min(i, 20) * 0.012 }}
            className="relative flex items-start gap-3 py-1.5"
            style={{ paddingLeft: n.depth * 18 }}
          >
            {n.depth > 0 && (
              <span
                aria-hidden
                className="absolute top-0 bottom-0 border-l border-dashed border-line-strong"
                style={{ left: n.depth * 18 - 10 }}
              />
            )}
            <code
              className={cn(
                'max-w-[45%] shrink-0 rounded-lg px-2 py-0.5 font-mono text-[12.5px] break-all',
                n.kind === 'error' && 'ring-1 ring-danger/40',
              )}
              style={{
                color: s.color,
                background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
              }}
            >
              {n.token || '∅'}
            </code>
            <span
              className={cn(
                'min-w-0 pt-0.5 text-[13px] leading-relaxed',
                n.kind === 'error' ? 'text-danger' : 'text-fg',
              )}
            >
              {n.desc}
            </span>
          </motion.li>
        )
      })}
    </ol>
  )
}
