import { useState } from 'react'
import { Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/qrcode'

/** 颜色：系统取色器 + 可手输的 HEX */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  // 正在输入的草稿；为 null 时显示真实值
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && normalizeHex(draft) === null

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-fg-2">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {/* ring-line-strong：深色模式下深色色块也能看清边界 */}
        <span className="relative size-10 shrink-0 overflow-hidden rounded-full shadow-sm ring-1 ring-line-strong">
          <span className="absolute inset-0" style={{ background: value }} />
          <input
            type="color"
            value={value}
            onChange={(e) => {
              setDraft(null)
              onChange(e.target.value)
            }}
            aria-label={`${label}取色器`}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </span>
        <Input
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value)
            const hex = normalizeHex(e.target.value)
            if (hex) onChange(hex)
          }}
          onBlur={() => setDraft(null)}
          aria-label={`${label} HEX`}
          aria-invalid={invalid}
          spellCheck={false}
          mono
          className={cn(
            // 手机上两列并排空间很窄：收窄内边距保证 #RRGGBB 完整显示
            'min-w-0 flex-1 px-2! uppercase sm:w-28! sm:flex-none sm:px-3.5!',
            invalid && 'border-danger! focus:border-danger!',
          )}
        />
      </span>
    </div>
  )
}
