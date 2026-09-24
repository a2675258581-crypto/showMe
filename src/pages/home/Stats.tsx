import { CountUp } from '@/components/motion/CountUp'
import { Reveal } from '@/components/motion/Reveal'
import { CATEGORIES } from '@/tools/categories'
import { TOOLS } from '@/tools/registry'

const STATS = [
  { value: TOOLS.length, suffix: '', label: '款实用工具', gradient: 'from-sys-blue to-sys-indigo' },
  {
    value: CATEGORIES.length,
    suffix: '',
    label: '大分类，覆盖日常开发',
    gradient: 'from-sys-purple to-sys-pink',
  },
  { value: 0, suffix: '', label: '字节上传到服务器', gradient: 'from-sys-green to-sys-mint' },
  { value: 100, suffix: '%', label: '浏览器本地计算', gradient: 'from-sys-orange to-sys-pink' },
]

export function Stats() {
  return (
    <section className="mx-auto max-w-[1080px] px-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-12 border-y border-line py-14 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.1} className="text-center">
            <div
              className={`headline bg-gradient-to-br ${s.gradient} bg-clip-text text-[56px] text-transparent tabular-nums sm:text-[72px]`}
            >
              <CountUp to={s.value} />
              {s.suffix}
            </div>
            <div className="mt-1 text-[15px] text-fg-2">{s.label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
