import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import { SpotlightCard } from '@/components/motion/SpotlightCard'
import { Reveal } from '@/components/motion/Reveal'
import { ToolIcon } from '@/components/ToolIcon'
import { cn } from '@/lib/cn'
import { TOOL_MAP } from '@/tools/registry'
import {
  ApiPreview,
  ColorPreview,
  DiffPreview,
  HashPreview,
  JsonPreview,
  JwtPreview,
  PasswordPreview,
  QrPreview,
  RegexPreview,
  TimestampPreview,
} from './BentoPreviews'

interface TileDef {
  id: string
  title: string
  blurb: string
  preview: ReactNode
  className?: string
  dark?: boolean
}

const TILES: TileDef[] = [
  {
    id: 'json-formatter',
    title: 'JSON 格式化',
    blurb: '一键美化、压缩、校验。精确到行列的错误提示，大数字也不丢精度。',
    preview: <JsonPreview />,
    className: 'md:col-span-2 lg:row-span-2',
  },
  {
    id: 'api-client',
    title: 'API 调试',
    blurb: '浏览器里的 Postman。环境变量、历史记录、cURL 导入导出。',
    preview: <ApiPreview />,
    className: 'md:col-span-2',
    dark: true,
  },
  { id: 'hash', title: '哈希计算', blurb: 'MD5、SHA、SM3……', preview: <HashPreview /> },
  {
    id: 'timestamp',
    title: '时间戳',
    blurb: '秒、毫秒、时区，一眼换算。',
    preview: <TimestampPreview />,
  },
  {
    id: 'regex-tester',
    title: '正则测试',
    blurb: '边写边高亮，分组、替换、解释一目了然。',
    preview: <RegexPreview />,
    className: 'md:col-span-2',
  },
  {
    id: 'color-converter',
    title: '颜色转换',
    blurb: 'HEX、RGB、OKLCH 自由切换。',
    preview: <ColorPreview />,
  },
  { id: 'qrcode', title: '二维码', blurb: '生成与识别，样式随心。', preview: <QrPreview /> },
  {
    id: 'password-generator',
    title: '密码生成',
    blurb: '真随机，强度看得见。',
    preview: <PasswordPreview />,
  },
  { id: 'text-diff', title: '文本对比', blurb: '差异逐行逐词高亮。', preview: <DiffPreview /> },
  {
    id: 'jwt-decoder',
    title: 'JWT 解析',
    blurb: '三段式着色，声明解释，签名校验。',
    preview: <JwtPreview />,
    className: 'md:col-span-2',
  },
]

export function Bento() {
  return (
    <section className="mx-auto max-w-[1180px] px-4 py-28 sm:px-6">
      <Reveal className="mb-14 text-center">
        <h2 className="headline text-[40px] text-fg sm:text-[64px]">精选工具。</h2>
        <p className="mx-auto mt-4 max-w-xl text-[19px] text-fg-2 sm:text-[21px]">
          最常用的那几个，我们做得最用心。
        </p>
      </Reveal>
      <div className="grid auto-rows-[minmax(250px,auto)] gap-4 md:grid-cols-2 lg:auto-rows-[260px] lg:grid-cols-4">
        {TILES.map((t, i) => (
          <motion.div
            key={t.id}
            className={cn('min-w-0', t.className)}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.8, delay: (i % 4) * 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            <Tile {...t} />
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function Tile({ id, title, blurb, preview, dark }: TileDef) {
  const tool = TOOL_MAP[id]
  return (
    <SpotlightCard
      tilt={3}
      glow={dark ? 'rgb(10 132 255 / 0.25)' : 'rgb(10 132 255 / 0.12)'}
      className={cn(
        'h-full rounded-[28px] border shadow-card',
        dark ? 'border-white/10 bg-[#0b0b0d] text-white' : 'border-line bg-surface',
      )}
    >
      <Link
        to={`/t/${id}`}
        className="flex h-full flex-col gap-4 p-6 outline-none"
        aria-label={`打开${title}`}
      >
        <div className="min-h-0 flex-1">{preview}</div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {tool && <ToolIcon tool={tool} size="sm" />}
              <h3
                className={cn(
                  'text-[19px] font-semibold tracking-tight',
                  dark ? 'text-white' : 'text-fg',
                )}
              >
                {title}
              </h3>
            </div>
            <p
              className={cn(
                'mt-1.5 text-[13px] leading-relaxed',
                dark ? 'text-white/60' : 'text-fg-2',
              )}
            >
              {blurb}
            </p>
          </div>
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-300',
              dark ? 'bg-white/10 text-white' : 'bg-fill text-fg',
            )}
          >
            <ArrowUpRight className="size-4 rotate-45 transition-transform duration-300 ease-apple group-hover:rotate-0" />
          </span>
        </div>
      </Link>
    </SpotlightCard>
  )
}
