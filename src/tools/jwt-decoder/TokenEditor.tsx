import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { segmentRanges, type SegmentKind } from '@/lib/jwt-decoder'

export const SEGMENT_COLORS: Record<SegmentKind, string> = {
  header: 'text-sys-pink',
  payload: 'text-sys-purple',
  signature: 'text-sys-blue',
  extra: 'text-danger',
}

/** 按 Header / Payload / Signature 着色的 token 片段（jwt.io 风格） */
export function ColoredToken({ value, errorPos }: { value: string; errorPos?: number }) {
  return useMemo(() => {
    const { segments, dots } = segmentRanges(value)
    const out: ReactNode[] = []
    const first = segments[0]?.start ?? 0
    if (first > 0) {
      out.push(
        <span key="prefix" className="text-fg-3">
          {value.slice(0, first)}
        </span>,
      )
    }
    segments.forEach((seg, i) => {
      const cls = SEGMENT_COLORS[seg.kind]
      if (errorPos !== undefined && errorPos >= seg.start && errorPos < seg.end) {
        out.push(
          <span key={`s${i}a`} className={cls}>
            {value.slice(seg.start, errorPos)}
          </span>,
          <mark
            key={`s${i}e`}
            className="rounded-sm bg-danger/20 text-danger underline decoration-danger decoration-wavy underline-offset-2"
          >
            {value[errorPos]}
          </mark>,
          <span key={`s${i}b`} className={cls}>
            {value.slice(errorPos + 1, seg.end)}
          </span>,
        )
      } else {
        out.push(
          <span key={`s${i}`} className={cls}>
            {value.slice(seg.start, seg.end)}
          </span>,
        )
      }
      if (dots[i] !== undefined) {
        out.push(
          <span key={`d${i}`} className="font-bold text-fg-2">
            .
          </span>,
        )
      }
    })
    return <>{out}</>
  }, [value, errorPos])
}

const TYPO =
  'm-0 w-full border-0 p-4 font-mono text-[13px] leading-[1.7] tracking-normal whitespace-pre-wrap break-all'

interface Props {
  value: string
  onChange: (v: string) => void
  errorPos?: number
  placeholder?: string
  className?: string
  'aria-label'?: string
}

/**
 * 可编辑的彩色 token：透明 textarea 叠在着色的 <pre> 上，
 * <pre> 在文档流里决定高度，两者排版完全一致，无需同步滚动。
 */
export function TokenEditor({
  value,
  onChange,
  errorPos,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: Props) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-line bg-surface-2 transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15',
        className,
      )}
    >
      <pre aria-hidden className={cn(TYPO, 'pointer-events-none min-h-36 text-fg')}>
        <ColoredToken value={value} errorPos={errorPos} />
        {/* 让末尾换行也占一行高度 */}
        {'\n​'}
      </pre>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        className={cn(
          TYPO,
          'absolute inset-0 h-full resize-none overflow-hidden bg-transparent text-transparent caret-fg outline-none placeholder:text-fg-3 selection:bg-accent/25 selection:text-transparent',
        )}
      />
    </div>
  )
}
