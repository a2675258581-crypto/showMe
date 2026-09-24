import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftToLine, ArrowRightToLine, Eraser, FlipHorizontal2 } from 'lucide-react'
import { Button, Notice, Panel, PanelHeader, SegmentedControl, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { autoWidth, getBit, toggleBit, twosComplement, type Width } from '@/lib/base-converter'

export type WidthChoice = 'auto' | '8' | '16' | '32' | '64'

const WIDTH_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: '8', label: '8' },
  { value: '16', label: '16' },
  { value: '32', label: '32' },
  { value: '64', label: '64' },
] as const

interface Props {
  value: bigint | null
  onChange: (v: bigint) => void
  width: WidthChoice
  onWidth: (w: WidthChoice) => void
  signed: boolean
  onSigned: (s: boolean) => void
}

/** 可点击的位网格：点击翻转某一位，按字节分组 */
export function BitGrid({ value, onChange, width, onWidth, signed, onSigned }: Props) {
  const v = value ?? 0n
  const w: Width = width === 'auto' ? autoWidth(v) : (Number(width) as Width)
  const signedEff = signed || v < 0n
  const info = twosComplement(v, w)
  const bytes = Array.from({ length: w / 8 }, (_, i) => w / 8 - 1 - i)

  const wrap = (x: bigint) => (signedEff ? BigInt.asIntN(w, x) : BigInt.asUintN(w, x))
  const ops = [
    { label: '清零', icon: <Eraser />, run: () => 0n },
    { label: '取反', icon: <FlipHorizontal2 />, run: () => wrap(~v) },
    { label: '左移', icon: <ArrowLeftToLine />, run: () => wrap(v << 1n) },
    {
      label: '右移',
      icon: <ArrowRightToLine />,
      run: () => (signedEff ? BigInt.asIntN(w, v) >> 1n : BigInt.asUintN(w, v) >> 1n),
    },
  ]

  return (
    <Panel>
      <PanelHeader title="位网格">
        <SegmentedControl
          options={WIDTH_OPTIONS}
          value={width}
          onChange={onWidth}
          size="sm"
          aria-label="位宽"
        />
        <Switch
          checked={signedEff}
          onChange={onSigned}
          disabled={v < 0n}
          label={<span className="text-[13px] text-fg-2">有符号</span>}
        />
      </PanelHeader>

      {info.overflow && (
        <Notice tone="warning" className="mb-4">
          数值超出 {w} 位范围，网格只显示低 {w} 位；点击任意位会按 {w} 位
          {signedEff ? '有符号' : '无符号'}
          整数重新计算。
        </Notice>
      )}

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-4 sm:justify-start">
        {bytes.map((byte) => {
          const byteVal = Number((BigInt.asUintN(w, v) >> BigInt(byte * 8)) & 0xffn)
          return (
            <div key={`${w}-${byte}`} className="flex flex-col gap-1.5">
              <div className="grid grid-cols-8 gap-1">
                {Array.from({ length: 8 }, (_, j) => {
                  const bit = byte * 8 + 7 - j
                  const on = getBit(v, bit, w)
                  const isSign = signedEff && bit === w - 1
                  return (
                    <motion.button
                      key={bit}
                      type="button"
                      whileTap={{ scale: 0.8 }}
                      transition={{ type: 'spring', stiffness: 700, damping: 30 }}
                      onClick={() => onChange(toggleBit(v, bit, w, signedEff))}
                      aria-label={`第 ${bit} 位${isSign ? '（符号位）' : ''}`}
                      aria-pressed={on}
                      title={`第 ${bit} 位 · 2^${bit}${isSign ? ' · 符号位' : ''}`}
                      className={cn(
                        'relative flex size-7 items-center justify-center overflow-hidden rounded-lg font-mono text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-200 sm:size-[30px]',
                        on
                          ? 'bg-accent text-white shadow-sm shadow-accent/30'
                          : 'bg-fill text-fg-3 hover:bg-fill-3 hover:text-fg-2',
                        isSign && 'ring-2 ring-sys-orange/70 ring-offset-1 ring-offset-surface',
                      )}
                    >
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.span
                          key={on ? 'on' : 'off'}
                          initial={{ y: on ? -12 : 12, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: on ? 12 : -12, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 600, damping: 32 }}
                        >
                          {on ? 1 : 0}
                        </motion.span>
                      </AnimatePresence>
                    </motion.button>
                  )
                })}
              </div>
              <div className="flex justify-between px-0.5 font-mono text-[10px] text-fg-3 tabular-nums">
                <span>{byte * 8 + 7}</span>
                <span className="text-fg-2">
                  0x{byteVal.toString(16).toUpperCase().padStart(2, '0')}
                </span>
                <span>{byte * 8}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {ops.map((op) => (
          <Button
            key={op.label}
            size="sm"
            variant="secondary"
            icon={op.icon}
            onClick={() => onChange(op.run())}
          >
            {op.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-fg-3">
          {w} 位{signedEff ? '有符号' : '无符号'} · 点击方块翻转该位
          {signedEff && <span className="text-sys-orange"> · 橙框为符号位</span>}
        </span>
      </div>
    </Panel>
  )
}
