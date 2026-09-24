import { useRef } from 'react'
import { motion, useInView } from 'motion/react'
import { CloudOff, UserRoundX, Zap } from 'lucide-react'
import { Reveal } from '@/components/motion/Reveal'

const POINTS = [
  {
    icon: CloudOff,
    title: '零上传',
    text: '格式化、加密、转换都在你的设备上完成，内容不会发往任何服务器。',
  },
  {
    icon: UserRoundX,
    title: '无需注册',
    text: '没有账号、没有追踪。收藏和历史只保存在本机浏览器里。',
  },
  { icon: Zap, title: '即开即用', text: '工具按需加载，打开就能用；大文件哈希也能分块流式计算。' },
]

/** 隐私板块：深色背景 + 锁扣合上的动画 */
export function Privacy() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  return (
    <section className="px-4 py-12 sm:px-6">
      <div className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[36px] bg-[#0b0b0d] px-6 py-20 text-center text-white sm:px-12 sm:py-28">
        {/* 背景光晕 */}
        <div className="pointer-events-none absolute top-1/3 left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 animate-pulse-glow rounded-full bg-[radial-gradient(circle,rgb(48_209_88/0.35),transparent_65%)] blur-2xl" />

        <div ref={ref} className="relative mx-auto mb-10 size-28 sm:size-32">
          <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
            <defs>
              <linearGradient id="lock-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#30d158" />
                <stop offset="1" stopColor="#00c7be" />
              </linearGradient>
            </defs>
            <motion.path
              d="M38 56V40a22 22 0 0 1 44 0v16"
              fill="none"
              stroke="url(#lock-g)"
              strokeWidth="9"
              strokeLinecap="round"
              initial={{ y: -16, pathLength: 0.3 }}
              animate={inView ? { y: 0, pathLength: 1 } : {}}
              transition={{
                y: { delay: 0.6, type: 'spring', stiffness: 300, damping: 12 },
                pathLength: { duration: 0.8 },
              }}
            />
            <motion.rect
              x="24"
              y="54"
              width="72"
              height="56"
              rx="16"
              fill="url(#lock-g)"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={inView ? { scale: 1, opacity: 1 } : {}}
              style={{ transformOrigin: '60px 82px' }}
              transition={{ type: 'spring', stiffness: 200, damping: 14 }}
            />
            <motion.circle
              cx="60"
              cy="80"
              r="7"
              fill="#0b0b0d"
              initial={{ scale: 0 }}
              animate={inView ? { scale: 1 } : {}}
              style={{ transformOrigin: '60px 80px' }}
              transition={{ delay: 0.9, type: 'spring', stiffness: 400, damping: 12 }}
            />
            <motion.rect
              x="57"
              y="82"
              width="6"
              height="14"
              rx="3"
              fill="#0b0b0d"
              initial={{ scaleY: 0 }}
              animate={inView ? { scaleY: 1 } : {}}
              style={{ transformOrigin: '60px 82px' }}
              transition={{ delay: 1, duration: 0.3 }}
            />
          </svg>
        </div>

        <Reveal>
          <h2 className="headline mx-auto max-w-3xl text-[40px] sm:text-[64px]">
            你的数据，
            <br />
            <span className="bg-gradient-to-r from-[#30d158] to-[#64d2ff] bg-clip-text text-transparent">
              从不离开浏览器。
            </span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-white/65 sm:text-[21px]">
            密钥、令牌、接口返回、公司代码——这些不该出现在别人的服务器上。在这里，它们不会。
          </p>
        </Reveal>

        <div className="mt-16 grid gap-6 text-left sm:grid-cols-3">
          {POINTS.map((p, i) => (
            <Reveal key={p.title} delay={0.15 + i * 0.1}>
              <div className="h-full rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
                <p.icon className="size-7 text-[#30d158]" strokeWidth={1.8} />
                <h3 className="mt-4 text-[19px] font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{p.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
