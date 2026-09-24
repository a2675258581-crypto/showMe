import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const base =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-fg placeholder:text-fg-3 outline-none transition-[border-color,box-shadow] duration-200 focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:opacity-50'

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
>(function Input({ className, mono, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(base, 'h-10', mono && 'font-mono text-[13px]', className)}
      {...rest}
    />
  )
})

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }
>(function TextArea({ className, mono, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      spellCheck={false}
      className={cn(
        base,
        'thin-scrollbar min-h-32 resize-y py-3 leading-relaxed',
        mono && 'font-mono text-[13px]',
        className,
      )}
      {...rest}
    />
  )
})
