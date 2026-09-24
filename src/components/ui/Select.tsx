import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectGroup {
  label: string
  options: readonly SelectOption[]
}

interface Props extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'size' | 'value'
> {
  options?: readonly SelectOption[]
  /** 分组选项，渲染为 <optgroup>（与 options 可同时使用，options 在前） */
  groups?: readonly SelectGroup[]
  value: string
  onChange: (v: string) => void
  size?: 'sm' | 'md'
}

/** 原生 select 套苹果外观（可访问性和移动端体验最好） */
export function Select({
  options = [],
  groups,
  value,
  onChange,
  size = 'md',
  className,
  ...rest
}: Props) {
  return (
    <div className={cn('relative inline-flex', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full cursor-pointer appearance-none rounded-full bg-fill pr-8 pl-4 font-medium text-fg outline-none transition-colors hover:bg-fill-3',
          size === 'sm' ? 'h-8 text-xs' : 'h-9 text-[13px]',
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-fg-2" />
    </div>
  )
}
