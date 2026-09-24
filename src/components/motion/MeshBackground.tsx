import { cn } from '@/lib/cn'

const BLOBS = [
  { color: '#0a84ff', className: 'left-[-10%] top-[-20%] h-[60vmax] w-[60vmax]', delay: '0s' },
  { color: '#bf5af2', className: 'right-[-15%] top-[-10%] h-[55vmax] w-[55vmax]', delay: '-6s' },
  { color: '#ff375f', className: 'left-[20%] bottom-[-30%] h-[50vmax] w-[50vmax]', delay: '-12s' },
  { color: '#ff9f0a', className: 'right-[5%] bottom-[-25%] h-[35vmax] w-[35vmax]', delay: '-18s' },
]

/** 缓慢漂移的模糊彩色光斑背景 */
export function MeshBackground({
  className,
  intensity = 1,
}: {
  className?: string
  intensity?: number
}) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className={cn(
            'absolute animate-blob rounded-full blur-[90px] will-change-transform',
            b.className,
          )}
          style={{
            background: `radial-gradient(circle at center, ${b.color} 0%, transparent 65%)`,
            opacity: 0.35 * intensity,
            animationDelay: b.delay,
          }}
        />
      ))}
      {/* 细噪点，让渐变更有质感 */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
}
