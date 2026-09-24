import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Split } from 'lucide-react'
import {
  CopyButton,
  ErrorNotice,
  Input,
  Panel,
  PanelHeader,
  SegmentedControl,
  Slider,
} from '@/components/ui'
import {
  ipv4ToString,
  prefixForHostCount,
  prefixForSubnetCount,
  splitIPv4,
  type SubnetRow,
} from '@/lib/cidr-calculator'
import { cn } from '@/lib/cn'

export type SplitMode = 'count' | 'hosts' | 'prefix'

export interface SplitOptions {
  splitMode: SplitMode
  splitCount: number
  splitHosts: number
  /** 按前缀划分时，相对原前缀增加的位数 */
  splitExtra: number
}

const LIMIT = 256
const s = ipv4ToString
const n = (x: number) => x.toLocaleString('en-US')

function compute(
  network: number,
  prefix: number,
  o: SplitOptions,
): { newPrefix: number; total: number; rows: SubnetRow[]; error: null } | { error: string } {
  try {
    const newPrefix =
      o.splitMode === 'count'
        ? prefixForSubnetCount(prefix, o.splitCount)
        : o.splitMode === 'hosts'
          ? prefixForHostCount(prefix, o.splitHosts)
          : Math.min(32, prefix + Math.max(0, o.splitExtra))
    const { total, rows } = splitIPv4(network, prefix, newPrefix, LIMIT)
    return { newPrefix, total, rows, error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** 正整数输入：允许输入过程中暂时为空，失焦后回到有效值 */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="flex w-48 flex-col gap-1.5">
      <span className="text-xs font-semibold text-fg-2">{label}</span>
      <Input
        type="number"
        min={1}
        inputMode="numeric"
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value)
          if (e.target.value !== '') onChange(Math.max(0, Math.floor(Number(e.target.value))))
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}

/** 子网划分：按子网数 / 每网主机数 / 新前缀均分当前网段 */
export function SubnetSplitter({
  network,
  prefix,
  options,
  onChange,
  onPick,
}: {
  network: number
  prefix: number
  options: SplitOptions
  onChange: (patch: Partial<SplitOptions>) => void
  onPick: (cidr: string) => void
}) {
  const { splitMode, splitCount, splitHosts, splitExtra } = options
  const res = useMemo(
    () => compute(network, prefix, { splitMode, splitCount, splitHosts, splitExtra }),
    [network, prefix, splitMode, splitCount, splitHosts, splitExtra],
  )
  const ok = res.error === null ? res : null
  const listText = ok ? ok.rows.map((r) => `${s(r.network)}/${r.prefix}`).join('\n') : ''

  return (
    <Panel padded={false} className="overflow-hidden">
      <div className="p-5 sm:p-6">
        <PanelHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Split className="size-4 text-fg-2" />
              子网划分
            </span>
          }
        >
          <SegmentedControl<SplitMode>
            size="sm"
            aria-label="划分方式"
            value={splitMode}
            onChange={(v) => onChange({ splitMode: v })}
            options={[
              { value: 'count', label: '按子网数' },
              { value: 'hosts', label: '按主机数' },
              { value: 'prefix', label: '按前缀' },
            ]}
          />
        </PanelHeader>

        <div className="flex flex-wrap items-end gap-4">
          {splitMode === 'count' && (
            <NumberField
              label="需要的子网数"
              value={splitCount}
              onChange={(v) => onChange({ splitCount: v })}
            />
          )}
          {splitMode === 'hosts' && (
            <NumberField
              label="每个子网至少容纳的主机数"
              value={splitHosts}
              onChange={(v) => onChange({ splitHosts: v })}
            />
          )}
          {splitMode === 'prefix' && (
            <Slider
              className="w-full max-w-md"
              label="新前缀"
              min={prefix}
              max={32}
              value={Math.min(32, prefix + splitExtra)}
              onChange={(v) => onChange({ splitExtra: v - prefix })}
              format={(v) => `/${v}`}
            />
          )}
          {ok && (
            <motion.p
              key={`${ok.newPrefix}-${ok.total}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[13px] text-fg-2"
            >
              划分为 <b className="text-fg">{n(ok.total)}</b> 个{' '}
              <b className="font-mono text-fg">/{ok.newPrefix}</b>，每个子网{' '}
              <b className="text-fg">{n(ok.rows[0]?.usable ?? 0)}</b> 台可用主机
            </motion.p>
          )}
        </div>
        <ErrorNotice error={res.error} className="mt-4" />
      </div>

      <AnimatePresence initial={false}>
        {ok && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="border-t border-line"
          >
            <div className="flex items-center justify-between gap-2 px-5 py-2.5 text-xs text-fg-3 sm:px-6">
              <span>
                {ok.total > LIMIT
                  ? `仅显示前 ${LIMIT} 个（共 ${n(ok.total)} 个）`
                  : `共 ${n(ok.total)} 个子网`}
                ，点击一行可查看详情
              </span>
              <CopyButton text={listText} label="复制列表" />
            </div>
            <div
              className="thin-scrollbar max-h-[440px] overflow-y-auto border-t border-line"
              data-lenis-prevent
            >
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-fg-2">
                  <tr>
                    <th className="py-2 pr-2 pl-5 font-semibold sm:pl-6">#</th>
                    <th className="px-2 py-2 font-semibold">网段</th>
                    <th className="hidden px-2 py-2 font-semibold md:table-cell">可用范围</th>
                    <th className="hidden px-2 py-2 font-semibold sm:table-cell">广播地址</th>
                    <th className="py-2 pr-5 pl-2 text-right font-semibold sm:pr-6">可用</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.rows.map((r, i) => {
                    const cidr = `${s(r.network)}/${r.prefix}`
                    const current = r.network === network && r.prefix === prefix
                    return (
                      <tr
                        key={cidr}
                        tabIndex={0}
                        onClick={() => onPick(cidr)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(cidr)}
                        className={cn(
                          'cursor-pointer border-t border-line font-mono transition-colors hover:bg-fill-2 focus-visible:bg-fill-2 focus-visible:outline-none',
                          current && 'bg-accent-soft',
                        )}
                      >
                        <td className="py-2 pr-2 pl-5 font-sans text-[11px] text-fg-3 tabular-nums sm:pl-6">
                          {i + 1}
                        </td>
                        <td className="px-2 py-2 text-fg">{cidr}</td>
                        <td className="hidden px-2 py-2 text-fg-2 md:table-cell">
                          {s(r.first)} – {s(r.last)}
                        </td>
                        <td className="hidden px-2 py-2 text-fg-2 sm:table-cell">
                          {r.prefix >= 31 ? '—' : s(r.broadcast)}
                        </td>
                        <td className="py-2 pr-5 pl-2 text-right text-fg-2 tabular-nums sm:pr-6">
                          {n(r.usable)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}
