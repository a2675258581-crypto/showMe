import type { ReactNode } from 'react'
import { motion, type Variants } from 'motion/react'

interface Props {
  children: ReactNode
  delay?: number
  /** 位移距离（px） */
  y?: number
  className?: string
  /** 进入视口多少比例后触发 */
  amount?: number
  as?: 'div' | 'section' | 'li' | 'span'
}

/** 进入视口时淡入上移（苹果官网滚动出现的效果） */
export function Reveal({
  children,
  delay = 0,
  y = 32,
  className,
  amount = 0.3,
  as = 'div',
}: Props) {
  const Comp = motion[as]
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Comp>
  )
}

/** 子元素依次出现的容器 */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
}
