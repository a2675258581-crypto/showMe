import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  BATCH_DATE_FORMATS,
  instantFromMs,
  instantToUnit,
  localTimeZone,
  normalizeTimeZone,
  type BatchDateFormat,
} from '@/lib/timestamp'
import { BATCH_SAMPLE, BatchConvert } from './BatchConvert'
import { DateToTs } from './DateToTs'
import { LiveClock } from './LiveClock'
import { TimezonePicker } from './TimezonePicker'
import { TsToDate, type UnitChoice } from './TsToDate'

interface Options {
  tz: string
  unit: UnitChoice
  batchFormat: BatchDateFormat
  batchTsUnit: 's' | 'ms'
  batchInputUnit: UnitChoice
}

const DEFAULTS: Options = {
  tz: 'Asia/Shanghai',
  unit: 'auto',
  batchFormat: 'local',
  batchTsUnit: 's',
  batchInputUnit: 'auto',
}

const UNIT_CHOICES: readonly UnitChoice[] = ['auto', 's', 'ms', 'us', 'ns']

/** localStorage 里可能是旧版本或被手改过的值，逐项校验，非法的回退到默认值 */
function sanitize(stored: Partial<Options> | null): Options {
  const o = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) }
  return {
    tz: typeof o.tz === 'string' ? o.tz : DEFAULTS.tz,
    unit: UNIT_CHOICES.includes(o.unit) ? o.unit : DEFAULTS.unit,
    batchFormat: BATCH_DATE_FORMATS.some((f) => f.value === o.batchFormat)
      ? o.batchFormat
      : DEFAULTS.batchFormat,
    batchTsUnit: o.batchTsUnit === 'ms' ? 'ms' : 's',
    batchInputUnit: UNIT_CHOICES.includes(o.batchInputUnit)
      ? o.batchInputUnit
      : DEFAULTS.batchInputUnit,
  }
}

export default function Timestamp() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('timestamp.options.v1', DEFAULTS)
  const opts = sanitize(stored)
  const tz = normalizeTimeZone(opts.tz)
  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setStored((prev) => ({ ...sanitize(prev), [key]: value }))

  const [tsInput, setTsInput] = useState(() => String(Math.floor(Date.now() / 1000)))
  const [dateInput, setDateInput] = useState('2024-01-01 12:00:00')
  const [batchInput, setBatchInput] = useState(BATCH_SAMPLE)
  const local = localTimeZone()

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <LiveClock
        tz={tz}
        // 按「时间戳 → 日期」当前选中的单位填入，避免选了毫秒时把秒数当毫秒解析
        onUse={(ms) =>
          setTsInput(instantToUnit(instantFromMs(ms), opts.unit === 'auto' ? 's' : opts.unit))
        }
      />

      <div className="flex flex-wrap items-center gap-2 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card sm:px-5">
        <span className="text-xs font-semibold text-fg-2">时区</span>
        <TimezonePicker value={tz} onChange={(v) => set('tz', v)} className="max-w-full" />
        {local !== tz && (
          <Button size="sm" variant="ghost" icon={<MapPin />} onClick={() => set('tz', local)}>
            使用本机时区
          </Button>
        )}
        <span className="ml-auto hidden text-xs text-fg-3 md:inline">
          所有转换与输出均按所选时区计算
        </span>
      </div>

      <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
        <TsToDate
          input={tsInput}
          onInput={setTsInput}
          unit={opts.unit}
          onUnit={(u) => set('unit', u)}
          tz={tz}
        />
        <DateToTs input={dateInput} onInput={setDateInput} tz={tz} />
      </div>

      <BatchConvert
        input={batchInput}
        onInput={setBatchInput}
        tz={tz}
        dateFormat={opts.batchFormat}
        onDateFormat={(f) => set('batchFormat', f)}
        tsUnit={opts.batchTsUnit}
        onTsUnit={(u) => set('batchTsUnit', u)}
        inputUnit={opts.batchInputUnit}
        onInputUnit={(u) => set('batchInputUnit', u)}
      />
    </div>
  )
}
