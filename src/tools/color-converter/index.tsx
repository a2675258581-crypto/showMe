import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Palette, Pipette, Shuffle } from 'lucide-react'
import {
  Badge,
  Button,
  CopyButton,
  ErrorNotice,
  Input,
  Notice,
  Panel,
  PanelHeader,
  Switch,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import {
  WHITE,
  describeColor,
  parseColor,
  randomColor,
  readableOn,
  toHex,
  type ColorFormat,
  type ColorFormats,
  type ParsedColor,
} from '@/lib/color-converter'
import { ColorSwatch } from './ColorSwatch'
import { ContrastPanel } from './ContrastPanel'
import { ScalePanel } from './ScalePanel'

const SAMPLES = [
  '#0071e3',
  'rebeccapurple',
  'hsl(340 82% 52%)',
  'oklch(72% 0.17 150)',
  'rgb(255 149 0 / 80%)',
  'lab(52% 40 -60)',
  'hwb(190 10% 20%)',
  'color(display-p3 1 0.3 0.1)',
]

const FORMAT_ROWS: { key: keyof ColorFormats; label: string; hint?: string }[] = [
  { key: 'hex', label: 'HEX' },
  { key: 'hex8', label: 'HEX8', hint: '含透明度' },
  { key: 'rgb', label: 'RGB' },
  { key: 'hsl', label: 'HSL' },
  { key: 'hsv', label: 'HSV / HSB', hint: '设计软件常用' },
  { key: 'hwb', label: 'HWB' },
  { key: 'oklch', label: 'OKLCH' },
  { key: 'oklab', label: 'OKLab' },
  { key: 'lab', label: 'CIE Lab' },
  { key: 'lch', label: 'CIE LCH' },
  { key: 'cmyk', label: 'CMYK', hint: '未经色彩管理的近似值' },
]

const FORMAT_NAME: Record<ColorFormat, string> = {
  hex: 'HEX',
  named: '颜色名',
  rgb: 'RGB',
  hsl: 'HSL',
  hwb: 'HWB',
  lab: 'CIE Lab',
  lch: 'CIE LCH',
  oklab: 'OKLab',
  oklch: 'OKLCH',
  color: 'color()',
  transparent: '透明',
}

const INPUT_ROW: Partial<Record<ColorFormat, keyof ColorFormats>> = {
  hex: 'hex',
  named: 'hex',
  rgb: 'rgb',
  hsl: 'hsl',
  hwb: 'hwb',
  lab: 'lab',
  lch: 'lch',
  oklab: 'oklab',
  oklch: 'oklch',
}

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> }
}
const EyeDropperApi =
  typeof window !== 'undefined'
    ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    : undefined

interface Options {
  uppercase: boolean
  legacy: boolean
  bg: string
}

const DEFAULTS: Options = { uppercase: false, legacy: false, bg: '#ffffff' }

/** localStorage 里的值逐项校验，类型不对就用默认值 */
function sanitize(stored: Partial<Options> | null): Options {
  const o = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) }
  return {
    uppercase: typeof o.uppercase === 'boolean' ? o.uppercase : DEFAULTS.uppercase,
    legacy: typeof o.legacy === 'boolean' ? o.legacy : DEFAULTS.legacy,
    // 背景色只存一小段文本
    bg: typeof o.bg === 'string' ? o.bg.slice(0, 200) : DEFAULTS.bg,
  }
}

function initialColor(): ParsedColor {
  const r = parseColor(SAMPLES[0])
  return r.ok ? r.value : { rgb: { r: 0, g: 0, b: 0, alpha: 1 }, format: 'hex' }
}

export default function ColorConverter() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>(
    'color-converter.options.v1',
    DEFAULTS,
  )
  const opts: Options = useMemo(() => sanitize(stored), [stored])
  const setOpt = <K extends keyof Options>(k: K, v: Options[K]) =>
    setStored((prev) => ({ ...sanitize(prev), [k]: v }))

  const [input, setInput] = useState(SAMPLES[0])
  const [color, setColor] = useState<ParsedColor>(initialColor)
  const debounced = useDebounced(input, 350)

  const live = useMemo(() => parseColor(input), [input])
  const error = !live.ok && input.trim() && debounced === input ? live.error : null

  const { uppercase, legacy, bg: bgInput } = opts
  const info = useMemo(
    () => describeColor(color, { uppercase, legacy }),
    [color, uppercase, legacy],
  )
  const bgParsed = useMemo(() => parseColor(bgInput), [bgInput])
  const bg = bgParsed.ok ? bgParsed.value.rgb : WHITE
  const textOnSwatch = readableOn(info.rgb) === 'white' ? '#ffffff' : '#000000'

  const change = (text: string) => {
    setInput(text)
    const r = parseColor(text)
    if (r.ok) setColor(r.value)
  }

  const fromPicker = (hex6: string) => {
    const a = info.rgb.alpha
    change(a < 1 ? toHex({ ...info.rgb, ...hexToRgb(hex6), alpha: a }, true) : hex6)
  }

  const pick = async () => {
    if (!EyeDropperApi) return
    try {
      const res = await new EyeDropperApi().open()
      change(res.sRGBHex)
    } catch {
      // 用户取消了取色
    }
  }

  const inputRow = color.format === 'hex' && color.rgb.alpha < 1 ? 'hex8' : INPUT_ROW[color.format]

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel className="flex min-w-0 flex-col gap-4">
          <ColorSwatch
            color={info.rgb}
            textColor={textOnSwatch}
            className="h-48 rounded-3xl sm:h-60 lg:h-auto lg:min-h-60 lg:flex-1"
          >
            <div className="flex h-full flex-col justify-between p-5">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold opacity-80">
                <span>输入：{FORMAT_NAME[color.format]}</span>
                {info.name && <span className="font-mono">{info.name}</span>}
              </div>
              <div>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={info.formats.hex}
                    initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="font-mono text-3xl font-semibold tracking-tight sm:text-4xl"
                  >
                    {info.rgb.alpha < 1 ? info.formats.hex8 : info.formats.hex}
                  </motion.div>
                </AnimatePresence>
                <div className="mt-1 text-xs opacity-75">
                  {info.name ? `CSS 颜色名 ${info.name}` : `最接近的颜色名：${info.nearest.name}`}
                </div>
              </div>
            </div>
          </ColorSwatch>

          <div className="flex items-center gap-2">
            <label
              className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-full shadow-sm ring-1 ring-line focus-within:ring-2 focus-within:ring-accent"
              title="打开取色器"
            >
              <motion.span
                className="absolute inset-0"
                initial={false}
                animate={{ backgroundColor: toHex(info.rgb) }}
                transition={{ duration: 0.4 }}
              />
              <input
                type="color"
                value={toHex(info.rgb)}
                onChange={(e) => fromPicker(e.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label="打开系统取色器"
              />
            </label>
            <Input
              value={input}
              onChange={(e) => change(e.target.value)}
              placeholder="#0071e3、rgb(0 113 227)、oklch(…)、rebeccapurple"
              mono
              className={cn(
                'h-10 text-[14px]',
                error && 'border-danger focus:border-danger focus:ring-danger/15',
              )}
              aria-label="颜色"
              aria-invalid={!!error}
            />
            {EyeDropperApi && (
              <Button
                iconOnly
                icon={<Pipette />}
                onClick={pick}
                aria-label="从屏幕吸取颜色"
                title="吸管"
              />
            )}
            <Button
              iconOnly
              icon={<Shuffle />}
              onClick={() => change(randomColor())}
              aria-label="随机颜色"
              title="随机颜色"
            />
          </div>

          <ErrorNotice error={error} />
          <AnimatePresence>
            {!info.inGamut && (
              <Notice key="gamut" tone="warning">
                该颜色超出 sRGB 色域，HEX / RGB / HSL 等已按 CSS Color 4
                算法映射到最接近的可显示颜色；OKLCH / OKLab / Lab 显示原始值。
              </Notice>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => change(s)}
                className={cn(
                  'h-7 rounded-full px-2.5 font-mono text-[11px] transition-colors',
                  input === s
                    ? 'bg-accent-soft text-accent'
                    : 'bg-fill text-fg-2 hover:bg-fill-3 hover:text-fg',
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4">
            <Switch
              checked={uppercase}
              onChange={(v) => setOpt('uppercase', v)}
              label={<span className="text-[13px] text-fg-2">HEX 大写</span>}
            />
            <Switch
              checked={legacy}
              onChange={(v) => setOpt('legacy', v)}
              label={<span className="text-[13px] text-fg-2">逗号语法 rgba()</span>}
            />
          </div>
        </Panel>

        <Panel className="min-w-0">
          <PanelHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Palette className="size-4 text-accent" />
                全部格式
              </span>
            }
          >
            <CopyButton
              text={() => FORMAT_ROWS.map((r) => `${r.label}: ${info.formats[r.key]}`).join('\n')}
              label="复制全部"
            />
          </PanelHeader>
          <div>
            {FORMAT_ROWS.map((row) => (
              <div
                key={row.key}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                  <div className="mb-0.5 flex shrink-0 items-center gap-1.5 sm:mb-0 sm:block sm:w-28">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-2">
                      {row.label}
                      {inputRow === row.key && (
                        <Badge className="px-1.5 py-0 text-[10px]">输入</Badge>
                      )}
                    </div>
                    {row.hint && <div className="text-[10px] text-fg-3">{row.hint}</div>}
                  </div>
                  <code className="block min-w-0 flex-1 font-mono text-[13px] break-words text-fg">
                    {info.formats[row.key]}
                  </code>
                </div>
                <CopyButton
                  text={info.formats[row.key]}
                  iconOnly
                  variant="ghost"
                  label={`复制 ${row.label}`}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <ScalePanel color={info.rgb} uppercase={uppercase} />

      <ContrastPanel
        color={info.rgb}
        bgInput={bgInput}
        onBgInput={(v) => setOpt('bg', v)}
        bg={bg}
        bgError={!bgParsed.ok && bgInput.trim() ? bgParsed.error : null}
        onSwap={() => {
          const fg = input
          change(bgInput)
          setOpt('bg', fg)
        }}
      />
    </div>
  )
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}
