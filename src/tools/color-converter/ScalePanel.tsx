import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Layers } from 'lucide-react'
import { CopyButton, Panel, PanelHeader, useToast } from '@/components/ui'
import { copyText } from '@/lib/clipboard'
import { generateScale, readableOn, type RGBA } from '@/lib/color-converter'
import { EASE_APPLE } from './ColorSwatch'

/** 50–950 色阶，点击复制 */
export function ScalePanel({ color, uppercase }: { color: RGBA; uppercase: boolean }) {
  const toast = useToast()
  const scale = useMemo(() => generateScale(color), [color])
  const hex = (h: string) => (uppercase ? h.toUpperCase() : h)

  const copy = async (text: string) => {
    const ok = await copyText(text)
    toast(ok ? `已复制 ${text}` : '复制失败', ok ? 'success' : 'error')
  }

  const cssVars = () => scale.map((s) => `--color-brand-${s.step}: ${hex(s.hex)};`).join('\n')
  const tailwind = () =>
    `@theme {\n${scale.map((s) => `  --color-brand-${s.step}: ${s.oklch};`).join('\n')}\n}`

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Layers className="size-4 text-accent" />
            色阶 50–950
          </span>
        }
      >
        <CopyButton text={cssVars} label="复制 CSS 变量" />
        <CopyButton text={tailwind} label="复制 Tailwind @theme" />
      </PanelHeader>
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:grid-cols-11">
        {scale.map((s, i) => (
          <motion.button
            key={s.step}
            type="button"
            onClick={() => copy(hex(s.hex))}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.94 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30, delay: i * 0.025 }}
            className="group flex min-w-0 flex-col gap-1.5 text-left"
            aria-label={`复制 ${s.step}：${hex(s.hex)}`}
            title={`${s.oklch}\n点击复制 ${hex(s.hex)}`}
          >
            <motion.span
              className="relative block h-14 w-full rounded-2xl ring-1 ring-line ring-inset sm:h-16"
              initial={false}
              animate={{ backgroundColor: s.hex }}
              transition={{ duration: 0.5, ease: EASE_APPLE }}
            >
              {s.isBase && (
                <span
                  className="absolute top-2 right-2 size-2 rounded-full"
                  style={{ background: readableOn(s.rgb) === 'white' ? '#fff' : '#000' }}
                  aria-hidden
                />
              )}
            </motion.span>
            <span className="flex items-center gap-1 text-xs font-semibold text-fg">
              {s.step}
              {s.isBase && <span className="text-[10px] font-medium text-accent">原色</span>}
            </span>
            <span className="truncate font-mono text-[11px] text-fg-3 group-hover:text-fg-2">
              {hex(s.hex)}
            </span>
          </motion.button>
        ))}
      </div>
      <p className="mt-4 text-xs text-fg-3">
        在 OKLCH 空间中按 Tailwind 调色板的亮度曲线生成，原色放在亮度最接近的档位；超出 sRGB
        的档位会自动压缩色度。
      </p>
    </Panel>
  )
}
