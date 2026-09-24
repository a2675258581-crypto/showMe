import { useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, ListOrdered, Sparkles, Trash2 } from 'lucide-react'
import {
  Button,
  CopyButton,
  Panel,
  PanelHeader,
  Select,
  SegmentedControl,
  TextArea,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'
import { BATCH_DATE_FORMATS, UNIT_LABEL, convertBatch, type BatchDateFormat } from '@/lib/timestamp'
import type { UnitChoice } from './TsToDate'
import { useNow } from './useNow'

export const BATCH_SAMPLE = [
  '1704067200',
  '1704067200123',
  '1719792000000000',
  '2024-06-01 09:30:00',
  '2024-01-01T00:00:00Z',
  'Mon, 01 Jan 2024 08:00:00 +0800',
  '2024年10月1日 10:00',
  'now',
  '+1d',
].join('\n')

interface Props {
  input: string
  onInput: (v: string) => void
  tz: string
  dateFormat: BatchDateFormat
  onDateFormat: (f: BatchDateFormat) => void
  tsUnit: 's' | 'ms'
  onTsUnit: (u: 's' | 'ms') => void
  inputUnit: UnitChoice
  onInputUnit: (u: UnitChoice) => void
}

/** 最多渲染的行数，复制结果不受限制 */
const MAX_ROWS = 500

const INPUT_UNITS = [
  { value: 'auto', label: '时间戳单位：自动识别' },
  { value: 's', label: '时间戳单位：秒' },
  { value: 'ms', label: '时间戳单位：毫秒' },
  { value: 'us', label: '时间戳单位：微秒' },
  { value: 'ns', label: '时间戳单位：纳秒' },
]

/** 批量转换：每行一个时间戳或日期 */
export function BatchConvert(p: Props) {
  const debounced = useDebounced(p.input, 200)
  const now = useNow(60_000)
  const lines = useMemo(
    () =>
      convertBatch(debounced, {
        tz: p.tz,
        nowMs: now,
        dateFormat: p.dateFormat,
        tsUnit: p.tsUnit,
        inputUnit: p.inputUnit,
      }),
    [debounced, p.tz, now, p.dateFormat, p.tsUnit, p.inputUnit],
  )
  const filled = lines.filter((l) => l.kind !== 'empty')
  const failed = filled.filter((l) => l.error).length
  const outputText = lines.map((l) => (l.error ? '' : l.output)).join('\n')

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ListOrdered className="size-4 text-accent" />
            批量转换
          </span>
        }
      >
        <Button
          size="sm"
          variant="ghost"
          icon={<Sparkles />}
          onClick={() => p.onInput(BATCH_SAMPLE)}
        >
          示例
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 />}
          onClick={() => p.onInput('')}
          disabled={!p.input}
        >
          清空
        </Button>
        <CopyButton text={outputText} label="复制结果" disabled={!filled.length} />
      </PanelHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={p.dateFormat}
          onChange={(v) => p.onDateFormat(v as BatchDateFormat)}
          options={BATCH_DATE_FORMATS.map((f) => ({
            value: f.value,
            label: `日期格式：${f.label}`,
          }))}
          size="sm"
          aria-label="日期输出格式"
        />
        <Select
          value={p.inputUnit}
          onChange={(v) => p.onInputUnit(v as UnitChoice)}
          options={INPUT_UNITS}
          size="sm"
          aria-label="输入时间戳单位"
        />
        <SegmentedControl
          options={[
            { value: 's', label: '输出秒' },
            { value: 'ms', label: '输出毫秒' },
          ]}
          value={p.tsUnit}
          onChange={p.onTsUnit}
          size="sm"
          aria-label="日期转时间戳的输出单位"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TextArea
          value={p.input}
          onChange={(e) => p.onInput(e.target.value)}
          placeholder={'每行一个时间戳或日期，例如：\n1704067200\n2024-01-01 12:00:00'}
          mono
          className="h-72 resize-none lg:h-80"
          aria-label="批量输入"
        />
        <div
          className="thin-scrollbar h-72 overflow-auto rounded-xl border border-line bg-surface-2 lg:h-80"
          data-lenis-prevent
          aria-label="批量结果"
        >
          {filled.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-fg-3">
              数字行按时间戳转成日期，其余行按日期转成时间戳
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {lines.slice(0, MAX_ROWS).map((l, i) =>
                l.kind === 'empty' ? null : (
                  <motion.li
                    key={`${i}-${l.input}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.015 }}
                    className="flex items-start gap-2 px-3.5 py-2"
                  >
                    <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-[11px] text-fg-3 tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-fg-3">
                        <span className="truncate font-mono">{l.input}</span>
                        <ArrowRight className="size-3 shrink-0" />
                        <span className="shrink-0">
                          {l.kind === 'ts2date'
                            ? `日期${l.unit ? `（输入为${UNIT_LABEL[l.unit]}）` : ''}`
                            : `时间戳（${UNIT_LABEL[p.tsUnit]}）`}
                        </span>
                      </div>
                      <div
                        className={cn(
                          'font-mono text-[13px] break-all',
                          l.error ? 'text-danger' : 'text-fg',
                        )}
                      >
                        {l.error ?? l.output}
                      </div>
                    </div>
                    {!l.error && (
                      <CopyButton
                        text={l.output}
                        iconOnly
                        variant="ghost"
                        label={`复制第 ${i + 1} 行结果`}
                      />
                    )}
                  </motion.li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>
      {filled.length > 0 && (
        <div className="mt-3 text-xs text-fg-3 tabular-nums">
          共 {filled.length} 行 · 成功 {filled.length - failed}
          {failed > 0 && <span className="text-danger"> · 失败 {failed}</span>}
          {lines.length > MAX_ROWS && ` · 仅显示前 ${MAX_ROWS} 行，复制结果包含全部`}
        </div>
      )}
    </Panel>
  )
}
