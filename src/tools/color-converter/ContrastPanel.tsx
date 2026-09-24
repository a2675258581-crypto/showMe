import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpDown, Check, Contrast, X } from 'lucide-react'
import { Button, ErrorNotice, Input, Panel, PanelHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { BLACK, WHITE, composite, fmt, toHex, wcag, type RGBA } from '@/lib/color-converter'
import { CHECKER, rgbaCss } from './ColorSwatch'

function Level({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors',
        ok ? 'bg-success/12 text-success' : 'bg-danger/10 text-danger',
      )}
    >
      {ok ? <Check className="size-3" /> : <X className="size-3" />}
      {label}
    </span>
  )
}

function ContrastCard({
  title,
  fg,
  bg,
  children,
}: {
  title: string
  fg: RGBA
  bg: RGBA
  children?: ReactNode
}) {
  const r = wcag(fg, bg)
  const ratio = `${fmt(Math.floor(r.ratio * 100) / 100, 2)}`
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-fill-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg-2">{title}</span>
        <span
          className="flex h-8 items-center rounded-lg px-2.5 text-sm font-bold ring-1 ring-line ring-inset"
          style={{ background: rgbaCss(bg), color: rgbaCss(fg) }}
          aria-hidden
        >
          Aa 字
        </span>
      </div>
      {children}
      <div className="flex items-baseline gap-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={ratio}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className="text-3xl font-semibold tracking-tight text-fg tabular-nums"
          >
            {ratio}
          </motion.span>
        </AnimatePresence>
        <span className="text-sm text-fg-3">: 1</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Level ok={r.aaNormal} label="AA 正文" />
        <Level ok={r.aaLarge} label="AA 大字" />
        <Level ok={r.aaaNormal} label="AAA 正文" />
        <Level ok={r.aaaLarge} label="AAA 大字" />
        <Level ok={r.ui} label="图形 / UI" />
      </div>
    </div>
  )
}

interface Props {
  color: RGBA
  bgInput: string
  onBgInput: (v: string) => void
  bg: RGBA
  bgError: string | null
  onSwap: () => void
}

/** WCAG 2.1 对比度检查 */
export function ContrastPanel({ color, bgInput, onBgInput, bg, bgError, onSwap }: Props) {
  const solidBg = bg.alpha < 1 ? composite(bg, WHITE) : bg
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Contrast className="size-4 text-accent" />
            对比度检查（WCAG 2.1）
          </span>
        }
      >
        <Button size="sm" variant="ghost" icon={<ArrowUpDown />} onClick={onSwap}>
          交换前景与背景
        </Button>
      </PanelHeader>

      <div className="grid gap-3 md:grid-cols-3">
        <ContrastCard title="文字色 · 白色背景" fg={color} bg={WHITE} />
        <ContrastCard title="文字色 · 黑色背景" fg={color} bg={BLACK} />
        <ContrastCard title="文字色 · 自定义背景" fg={color} bg={bg}>
          <div className="flex items-center gap-2">
            <label
              className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-line focus-within:ring-2 focus-within:ring-accent"
              style={{ background: CHECKER }}
            >
              <span className="absolute inset-0" style={{ background: rgbaCss(bg) }} />
              <input
                type="color"
                value={toHex(solidBg)}
                onChange={(e) => onBgInput(e.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label="选择背景色"
              />
            </label>
            <Input
              value={bgInput}
              onChange={(e) => onBgInput(e.target.value)}
              mono
              placeholder="#ffffff"
              aria-label="背景色"
            />
          </div>
          <ErrorNotice error={bgError} />
        </ContrastCard>
      </div>

      <div
        className="mt-4 overflow-hidden rounded-2xl ring-1 ring-line ring-inset"
        style={{ background: CHECKER }}
      >
        <motion.div
          initial={false}
          animate={{ backgroundColor: rgbaCss(bg), color: rgbaCss(color) }}
          transition={{ duration: 0.45 }}
          className="flex flex-col gap-3 p-5 sm:p-7"
        >
          <p className="text-[24px] leading-tight font-bold tracking-tight">
            大号文字 · 24px 粗体 Large Text
          </p>
          <p className="max-w-3xl text-base leading-relaxed">
            正文文字 16px：敏捷的棕色狐狸跳过了懒狗。The quick brown fox jumps over the lazy dog.
            对比度不足时，弱视用户和强光下的屏幕会很难看清这段文字。
          </p>
          <p className="text-[13px] opacity-90">小号说明文字 13px · 0123456789</p>
        </motion.div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-fg-3">
        标准：正文 AA ≥ 4.5、AAA ≥ 7；大字（≥ 24px，或 ≥ 18.66px 粗体）AA ≥ 3、AAA ≥
        4.5；图标与控件边框 ≥ 3。 半透明颜色会先叠加到背景上再计算。
      </p>
    </Panel>
  )
}
