import { useRef, type ReactNode } from 'react'
import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react'
import { cn } from '@/lib/cn'

interface Props {
  children: ReactNode
  className?: string
  /** 聚光颜色 */
  glow?: string
  /** 3D 倾斜幅度（度），0 关闭 */
  tilt?: number
}

/** 悬停时跟随鼠标的聚光高光 + 轻微 3D 倾斜 + 微抬 */
export function SpotlightCard({
  children,
  className,
  glow = 'rgb(10 132 255 / 0.18)',
  tilt = 6,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mx = useMotionValue(-999)
  const my = useMotionValue(-999)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const spring = { stiffness: 220, damping: 22, mass: 0.6 }
  const rotateX = useSpring(useTransform(py, [0, 1], [tilt, -tilt]), spring)
  const rotateY = useSpring(useTransform(px, [0, 1], [-tilt, tilt]), spring)
  const background = useMotionTemplate`radial-gradient(420px circle at ${mx}px ${my}px, ${glow}, transparent 65%)`

  return (
    <motion.div
      ref={ref}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        const r = ref.current!.getBoundingClientRect()
        mx.set(e.clientX - r.left)
        my.set(e.clientY - r.top)
        px.set((e.clientX - r.left) / r.width)
        py.set((e.clientY - r.top) / r.height)
      }}
      onPointerLeave={() => {
        mx.set(-999)
        my.set(-999)
        px.set(0.5)
        py.set(0.5)
      }}
      style={{
        rotateX: tilt ? rotateX : 0,
        rotateY: tilt ? rotateY : 0,
        transformPerspective: 900,
      }}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={cn('group relative overflow-hidden', className)}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      <div className="relative z-[1] h-full">{children}</div>
    </motion.div>
  )
}
