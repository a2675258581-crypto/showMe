import { cn } from '@/lib/cn'

interface Props {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  label?: string
  /** 右侧显示的数值格式 */
  format?: (v: number) => string
  className?: string
}

export function Slider({ value, onChange, min, max, step = 1, label, format, className }: Props) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {(label || format) && (
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold tracking-wide text-fg-2">{label}</span>
          <span className="font-mono tabular-nums text-fg">{format ? format(value) : value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-fill [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgb(0_0_0/0.3),0_0_0_0.5px_rgb(0_0_0/0.06)]"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, var(--fill) ${pct}%)`,
        }}
      />
    </div>
  )
}
