import { extendTailwindMerge } from 'tailwind-merge'

/** 让 tailwind-merge 认识项目里自定义的主题值，避免把它们误判为别的工具类 */
const twMerge = extendTailwindMerge({
  // Tailwind v4 里 leading-* 总会覆盖字号自带的行高，两者并不冲突；
  // 默认规则会让后出现的 text-[13px] 吞掉前面的 leading-relaxed
  override: { conflictingClassGroups: { 'font-size': [] } },
  extend: {
    theme: {
      shadow: ['card', 'float'],
      ease: ['apple', 'spring'],
      animate: [
        'gradient-pan',
        'blob',
        'shimmer',
        'float',
        'marquee',
        'marquee-reverse',
        'pulse-glow',
      ],
    },
  },
})

/**
 * 拼接 className，忽略假值；冲突的 Tailwind 类以后出现的为准，
 * 所以调用方传入的 className 能覆盖组件的默认样式（如 `w-24` 覆盖 `w-full`）。
 */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  return twMerge(parts.filter(Boolean).join(' '))
}
