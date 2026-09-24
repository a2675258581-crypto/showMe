import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  /** 只有图标的圆形按钮 */
  iconOnly?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm shadow-accent/20',
  secondary: 'bg-fill text-fg hover:bg-fill-3',
  ghost: 'text-fg-2 hover:text-fg hover:bg-fill-2',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15',
  outline: 'border border-line-strong text-fg hover:bg-fill-2',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
}

const iconSizes: Record<Size, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
}

/** 苹果式胶囊按钮，按下时轻微缩小 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconOnly,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium whitespace-nowrap',
        'transition-[background-color,color,transform,box-shadow] duration-200 ease-apple active:scale-[0.96]',
        'disabled:pointer-events-none disabled:opacity-40',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        iconOnly ? iconSizes[size] : sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
    </button>
  )
})
