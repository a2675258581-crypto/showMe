import { forwardRef, useRef, type InputHTMLAttributes } from 'react'
import { splitVarSegments } from '@/lib/api-client'
import { cn } from '@/lib/cn'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: string
  onChange: (v: string) => void
  /** 当前环境的变量，用于区分已定义 / 未定义 */
  vars: Record<string, string>
  size?: 'sm' | 'md'
  mono?: boolean
}

/**
 * 支持 {{变量}} 高亮的单行输入框：
 * 输入框文字透明，背后叠一层同样排版的高亮文本，滚动位置在事件里同步。
 */
export const VarInput = forwardRef<HTMLInputElement, Props>(function VarInput(
  { value, onChange, vars, size = 'md', mono = true, className, onScroll, ...rest },
  ref,
) {
  const inner = useRef<HTMLSpanElement>(null)
  const hasVars = value.includes('{{')
  const sync = (el: HTMLInputElement) => {
    if (inner.current) inner.current.style.transform = `translateX(${-el.scrollLeft}px)`
  }
  const text = cn(mono && 'font-mono', size === 'sm' ? 'text-[12.5px]' : 'text-[13px]')
  const box = size === 'sm' ? 'h-8 px-2.5' : 'h-10 px-3.5'

  return (
    <div className={cn('relative min-w-0 rounded-xl bg-surface', className)}>
      {hasVars && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-xl border border-transparent whitespace-pre text-fg',
            box,
            text,
          )}
        >
          <span ref={inner} className="inline-block">
            {splitVarSegments(value, vars).map((s, i) =>
              s.name === undefined ? (
                <span key={i}>{s.text}</span>
              ) : (
                <span
                  key={i}
                  className={cn(
                    'rounded-[4px]',
                    s.known ? 'bg-accent-soft text-accent' : 'bg-danger/10 text-danger',
                  )}
                >
                  {s.text}
                </span>
              ),
            )}
          </span>
        </div>
      )}
      <input
        ref={ref}
        value={value}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onChange={(e) => {
          onChange(e.target.value)
          sync(e.target)
        }}
        onScroll={(e) => {
          sync(e.currentTarget)
          onScroll?.(e)
        }}
        onSelect={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => sync(e.currentTarget)}
        className={cn(
          'relative w-full rounded-xl border border-line bg-transparent text-fg placeholder:text-fg-3 outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent focus:ring-4 focus:ring-accent/15',
          box,
          text,
          hasVars && 'text-transparent caret-[var(--fg)] selection:bg-accent/25',
        )}
        {...rest}
      />
    </div>
  )
})
