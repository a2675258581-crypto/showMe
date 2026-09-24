import { useDeferredValue, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Sparkles, Trash2 } from 'lucide-react'
import { Button, ErrorNotice, Panel, PanelHeader, Select, Switch } from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  baseName,
  bitLength,
  byteLength,
  formatInBase,
  isPowerOfTwo,
  minSignedBits,
  parseInBase,
  popcount,
} from '@/lib/base-converter'
import { BitGrid, type WidthChoice } from './BitGrid'
import { NumberField } from './NumberField'
import { TwosComplement } from './TwosComplement'

type FieldId = 'bin' | 'oct' | 'dec' | 'hex' | 'custom'

const FIXED: {
  id: Exclude<FieldId, 'custom'>
  base: number
  prefix?: string
  placeholder: string
}[] = [
  { id: 'dec', base: 10, placeholder: '例如 255、-42，也可粘贴 0xFF / 0b1010' },
  { id: 'hex', base: 16, prefix: '0x', placeholder: '例如 FF、DEAD_BEEF' },
  { id: 'bin', base: 2, prefix: '0b', placeholder: '例如 1111 1111' },
  { id: 'oct', base: 8, prefix: '0o', placeholder: '例如 377' },
]

const SAMPLES = ['3735928559', '-42', '255', '18446744073709551615', '1337']

const BASE_OPTIONS = Array.from({ length: 35 }, (_, i) => ({
  value: String(i + 2),
  label: `${i + 2} 进制`,
}))

interface Options {
  group: boolean
  uppercase: boolean
  customBase: number
  width: WidthChoice
  signed: boolean
}

const DEFAULTS: Options = {
  group: true,
  uppercase: true,
  customBase: 36,
  width: 'auto',
  signed: false,
}

const WIDTH_CHOICES: readonly WidthChoice[] = ['auto', '8', '16', '32', '64']

/** localStorage 里的值逐项校验：非法进制会让 BigInt#toString 抛错 */
function sanitize(stored: Partial<Options> | null): Options {
  const o = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) }
  const base = Number(o.customBase)
  return {
    group: typeof o.group === 'boolean' ? o.group : DEFAULTS.group,
    uppercase: typeof o.uppercase === 'boolean' ? o.uppercase : DEFAULTS.uppercase,
    customBase: Number.isInteger(base) && base >= 2 && base <= 36 ? base : DEFAULTS.customBase,
    width: WIDTH_CHOICES.includes(o.width) ? o.width : DEFAULTS.width,
    signed: typeof o.signed === 'boolean' ? o.signed : DEFAULTS.signed,
  }
}

interface FieldError {
  id: FieldId
  error: string
  invalid: number[]
}

export default function BaseConverter() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>(
    'base-converter.options.v1',
    DEFAULTS,
  )
  const opts: Options = useMemo(() => sanitize(stored), [stored])
  const setOpt = <K extends keyof Options>(k: K, v: Options[K]) =>
    setStored((prev) => ({ ...sanitize(prev), [k]: v }))

  const [src, setSrc] = useState<{ id: FieldId; text: string } | null>({
    id: 'dec',
    text: SAMPLES[0],
  })
  const [value, setValue] = useState<bigint | null>(BigInt(SAMPLES[0]))
  const [error, setError] = useState<FieldError | null>(null)
  const [sampleIdx, setSampleIdx] = useState(0)
  const shown = useDeferredValue(value)

  const baseOf = (id: FieldId) =>
    id === 'custom' ? opts.customBase : FIXED.find((f) => f.id === id)!.base

  const edit = (id: FieldId, text: string) => {
    setSrc({ id, text })
    const r = parseInBase(text, baseOf(id))
    if (r === null) {
      setValue(null)
      setError(null)
    } else if (r.ok) {
      setValue(r.value)
      setError(null)
    } else {
      setError({ id, error: r.error, invalid: r.invalid })
    }
  }

  const setDirect = (v: bigint | null) => {
    setValue(v)
    setSrc(null)
    setError(null)
  }

  const { group, uppercase, customBase } = opts
  const formatted = useMemo(() => {
    const out = {} as Record<FieldId, { display: string; raw: string }>
    const all: [FieldId, number][] = [
      ...FIXED.map((f): [FieldId, number] => [f.id, f.base]),
      ['custom', customBase],
    ]
    for (const [id, base] of all) {
      out[id] =
        shown === null
          ? { display: '', raw: '' }
          : {
              display: formatInBase(shown, base, { group, uppercase }),
              raw: formatInBase(shown, base, { uppercase }),
            }
    }
    return out
  }, [shown, customBase, group, uppercase])

  const fieldProps = (id: FieldId) => ({
    value: src?.id === id ? src.text : formatted[id].display,
    onChange: (t: string) => edit(id, t),
    copyText: formatted[id].raw,
    invalid: error?.id === id ? error.invalid : undefined,
    stale: !!error,
    active: error?.id === id,
  })

  const stats =
    value === null
      ? null
      : [
          { label: '位长度', value: `${bitLength(value)} 位` },
          { label: '最少字节', value: `${byteLength(value)} 字节` },
          { label: '补码最少位数', value: `${minSignedBits(value)} 位` },
          { label: '二进制中 1 的个数', value: String(popcount(value)) },
          {
            label: '特征',
            value: [
              value < 0n ? '负数' : value === 0n ? '零' : '正数',
              value % 2n === 0n ? '偶数' : '奇数',
              isPowerOfTwo(value) ? '2 的幂' : '',
            ]
              .filter(Boolean)
              .join(' · '),
          },
        ]

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Panel>
        <PanelHeader title="数值">
          <Switch
            checked={opts.group}
            onChange={(v) => setOpt('group', v)}
            label={<span className="text-[13px] text-fg-2">数字分组</span>}
          />
          <Switch
            checked={opts.uppercase}
            onChange={(v) => setOpt('uppercase', v)}
            label={<span className="text-[13px] text-fg-2">大写字母</span>}
          />
          {/* 两个按钮成组换行，窄屏上不会把「清空」单独挤到一行 */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<Sparkles />}
              onClick={() => {
                const next = (sampleIdx + 1) % SAMPLES.length
                setSampleIdx(next)
                edit('dec', SAMPLES[next])
              }}
            >
              示例
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setDirect(null)}>
              清空
            </Button>
          </div>
        </PanelHeader>

        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
          {FIXED.map((f) => (
            <NumberField
              key={f.id}
              label={baseName(f.base)}
              prefix={f.prefix}
              placeholder={f.placeholder}
              copyLabel={`复制${baseName(f.base)}`}
              {...fieldProps(f.id)}
            />
          ))}
          <div className="md:col-span-2">
            <NumberField
              label="自定义进制"
              extra={
                <Select
                  value={String(opts.customBase)}
                  onChange={(v) => {
                    setOpt('customBase', Number(v))
                    if (src?.id === 'custom') setSrc(null)
                    if (error?.id === 'custom') setError(null)
                  }}
                  options={BASE_OPTIONS}
                  size="sm"
                  aria-label="自定义进制的基数"
                />
              }
              placeholder={`${opts.customBase} 进制数字（0–9、A–Z）`}
              copyLabel={`复制${opts.customBase} 进制`}
              {...fieldProps('custom')}
            />
          </div>
        </div>

        <ErrorNotice error={error?.error} className="mt-4" />

        {stats && (
          <motion.dl
            layout
            className="mt-5 grid grid-cols-2 gap-2 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-5"
          >
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 rounded-2xl bg-fill-2 px-3.5 py-2.5">
                <dt className="text-[11px] font-semibold text-fg-3">{s.label}</dt>
                <dd className="truncate text-sm font-medium text-fg tabular-nums">{s.value}</dd>
              </div>
            ))}
          </motion.dl>
        )}
      </Panel>

      <BitGrid
        value={value}
        onChange={setDirect}
        width={opts.width}
        onWidth={(w) => setOpt('width', w)}
        signed={opts.signed}
        onSigned={(s) => setOpt('signed', s)}
      />

      <TwosComplement value={shown} />
    </div>
  )
}
