import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { CopyButton, TextArea } from '@/components/ui'
import { cn } from '@/lib/cn'

interface Props {
  label: ReactNode
  /** 标签旁的前缀提示，如 0x */
  prefix?: string
  value: string
  onChange: (v: string) => void
  /** 复制的文本（不含分组空格） */
  copyText: string
  copyLabel: string
  invalid?: number[]
  /** 当前正在编辑的栏出错时，其余栏显示上一次的有效值（变淡） */
  stale?: boolean
  active?: boolean
  placeholder?: string
  /** 标签右侧额外内容（如进制选择） */
  extra?: ReactNode
}

const MIRROR_LIMIT = 400

/** 一栏数值输入：自动增高、回车不换行、出错时在下方高亮无效字符 */
export function NumberField({
  label,
  prefix,
  value,
  onChange,
  copyText,
  copyLabel,
  invalid,
  stale,
  active,
  placeholder,
  extra,
}: Props) {
  const hasError = !!invalid
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-fg-2">{label}</span>
          {prefix && (
            <span className="rounded-md bg-fill px-1.5 font-mono text-[11px] text-fg-3">
              {prefix}
            </span>
          )}
          {extra}
        </div>
        <CopyButton
          text={copyText}
          iconOnly
          variant="ghost"
          label={copyLabel}
          disabled={!copyText}
        />
      </div>
      <TextArea
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        placeholder={placeholder}
        mono
        autoGrow
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={hasError}
        aria-label={typeof label === 'string' ? label : copyLabel.replace(/^复制/, '')}
        className={cn(
          'min-h-[46px] py-2.5 text-[14px] leading-6 break-all transition-opacity',
          hasError && 'border-danger focus:border-danger focus:ring-danger/15',
          stale && !active && 'opacity-50',
        )}
      />
      {invalid && invalid.length > 0 && <InvalidMirror text={value} invalid={invalid} />}
    </div>
  )
}

function InvalidMirror({ text, invalid }: { text: string; invalid: number[] }) {
  const bad = new Set(invalid)
  const parts: { ch: string; bad: boolean }[] = []
  let idx = 0
  for (const ch of text) {
    if (idx >= MIRROR_LIMIT) break
    parts.push({ ch, bad: bad.has(idx) })
    idx += ch.length
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-danger/5 px-3 py-2 font-mono text-[13px] leading-6 break-all text-fg-2"
      aria-hidden
    >
      {parts.map((p, i) =>
        p.bad ? (
          <mark
            key={i}
            className="rounded bg-danger/15 px-px text-danger underline decoration-danger decoration-wavy underline-offset-4"
          >
            {p.ch}
          </mark>
        ) : (
          <span key={i}>{p.ch}</span>
        ),
      )}
      {text.length > MIRROR_LIMIT && <span className="text-fg-3">…</span>}
    </motion.div>
  )
}
