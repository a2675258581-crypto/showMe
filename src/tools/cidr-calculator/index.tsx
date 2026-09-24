import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Info, Network } from 'lucide-react'
import { Button, CopyButton, ErrorNotice, Input, Panel, PanelHeader, Slider } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  IpError,
  compressIPv6,
  detectFamily,
  ipv4Info,
  ipv4ToString,
  ipv6Info,
  normalizeIpInput,
  parseIPv4Input,
  parseIPv4Range,
  parseIPv6Input,
  prefixToMask,
  rangeToCidrs,
  type IPv4Info,
  type IPv4Input,
  type IPv6Info,
} from '@/lib/cidr-calculator'
import { cn } from '@/lib/cn'
import { SubnetSplitter, type SplitOptions } from './SubnetSplitter'
import { V4Result } from './V4Result'
import { V6Result } from './V6Result'

interface Stored extends SplitOptions {
  input: string
}

const DEFAULTS: Stored = {
  input: '192.168.1.10/24',
  splitMode: 'count',
  splitCount: 4,
  splitHosts: 50,
  splitExtra: 2,
}

const SAMPLES = [
  '192.168.1.10/24',
  '10.20.30.40/255.255.240.0',
  '172.16.5.4 0.0.3.255',
  '100.64.12.1/10',
  '10.0.0.1 - 10.0.0.100',
  '2001:db8:abcd:12::1/48',
  'fe80::1%en0/64',
]

type Analysis =
  | { kind: 'empty' }
  | { kind: 'error'; error: string }
  | { kind: 'v4'; parsed: IPv4Input; info: IPv4Info }
  | { kind: 'v6'; info: IPv6Info; zone?: string; hasPrefix: boolean }
  | { kind: 'range'; start: number; end: number; cidrs: { network: number; prefix: number }[] }

function analyze(raw: string): Analysis {
  const input = normalizeIpInput(raw)
  if (!input.trim()) return { kind: 'empty' }
  try {
    const range = parseIPv4Range(input)
    if (range) return { kind: 'range', ...range, cidrs: rangeToCidrs(range.start, range.end) }
    if (detectFamily(input) === 6) {
      const p = parseIPv6Input(input)
      return { kind: 'v6', info: ipv6Info(p.value, p.prefix), zone: p.zone, hasPrefix: p.hasPrefix }
    }
    const parsed = parseIPv4Input(input)
    return { kind: 'v4', parsed, info: ipv4Info(parsed.ip, parsed.prefix) }
  } catch (e) {
    return { kind: 'error', error: e instanceof IpError ? e.message : String(e) }
  }
}

const valid = (a: Analysis) => a.kind === 'v4' || a.kind === 'v6' || a.kind === 'range'

export default function CidrCalculator() {
  const [stored, setStored] = useLocalStorage<Partial<Stored>>(
    'cidr-calculator.options.v1',
    DEFAULTS,
  )
  const o: Stored = { ...DEFAULTS, ...stored }
  const set = (patch: Partial<Stored>) => setStored((prev) => ({ ...DEFAULTS, ...prev, ...patch }))
  const input = typeof o.input === 'string' ? o.input : DEFAULTS.input

  // 输入合法时立即计算；输入到一半不合法时，先保留上一次结果，停顿后再显示错误
  const dInput = useDebounced(input, 400)
  const now = useMemo(() => analyze(input), [input])
  const later = useMemo(() => analyze(dInput), [dInput])
  const view: Analysis = valid(now) || now.kind === 'empty' ? now : later
  const stale = !valid(now) && now.kind !== 'empty' && valid(later)
  const error = view.kind === 'error' ? view.error : null

  const family = detectFamily(normalizeIpInput(input))
  const navigate = (cidr: string) => {
    set({ input: cidr })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  let note: string | null = null
  if (view.kind === 'v4') {
    const { parsed, info } = view
    if (parsed.via === 'mask')
      note = `已按子网掩码 ${ipv4ToString(info.mask)} 识别为 /${info.prefix}`
    else if (parsed.via === 'wildcard') {
      note = `已按反掩码（通配符）${ipv4ToString(info.wildcard)} 识别为 /${info.prefix}`
    } else if (parsed.via === 'none') note = '未指定前缀，按单个主机 /32 计算，可拖动下方滑块调整'
  } else if (view.kind === 'v6' && !view.hasPrefix) {
    note = '未指定前缀，按 /128 计算，可拖动下方滑块调整'
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="relative">
          <Network className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3" />
          <Input
            mono
            value={input}
            onChange={(e) => set({ input: e.target.value })}
            placeholder="192.168.1.10/24、10.0.0.1 255.255.255.0、起始 - 结束 或 2001:db8::/32"
            aria-label="IP 地址 / CIDR"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-14 pr-20 pl-12 text-base sm:text-lg"
          />
          <span
            className={cn(
              'pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors',
              family === 6 ? 'bg-sys-purple/15 text-sys-purple' : 'bg-accent-soft text-accent',
            )}
          >
            {view.kind === 'range' ? '范围' : family === 6 ? 'IPv6' : 'IPv4'}
          </span>
        </div>

        <div className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
          {SAMPLES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === input ? 'primary' : 'secondary'}
              onClick={() => set({ input: s })}
              className="font-mono text-xs"
            >
              {s}
            </Button>
          ))}
        </div>

        <AnimatePresence initial={false}>
          {note && (
            <motion.p
              key={note}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-1.5 overflow-hidden text-xs text-fg-2"
            >
              <Info className="mt-3 size-3.5 shrink-0 text-accent" />
              <span className="mt-3">{note}</span>
            </motion.p>
          )}
        </AnimatePresence>

        {view.kind === 'v4' && (
          <Slider
            className="mt-4"
            label="前缀长度"
            min={0}
            max={32}
            value={view.info.prefix}
            onChange={(p) => set({ input: `${ipv4ToString(view.info.ip)}/${p}` })}
            format={(p) => `/${p} · ${ipv4ToString(prefixToMask(p))}`}
          />
        )}
        {view.kind === 'v6' && (
          <Slider
            className="mt-4"
            label="前缀长度"
            min={0}
            max={128}
            value={view.info.prefix}
            onChange={(p) =>
              set({
                input: `${compressIPv6(view.info.value)}${view.zone ? `%${view.zone}` : ''}/${p}`,
              })
            }
            format={(p) => `/${p}`}
          />
        )}
        <ErrorNotice error={error} className="mt-4" />
      </Panel>

      <motion.div
        animate={{ opacity: stale ? 0.5 : 1 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col gap-4"
      >
        {view.kind === 'v4' && (
          <>
            <V4Result info={view.info} onNavigate={navigate} />
            <SubnetSplitter
              network={view.info.network}
              prefix={view.info.prefix}
              options={o}
              onChange={set}
              onPick={navigate}
            />
          </>
        )}
        {view.kind === 'v6' && <V6Result info={view.info} zone={view.zone} />}
        {view.kind === 'range' && (
          <RangeResult start={view.start} end={view.end} cidrs={view.cidrs} onPick={navigate} />
        )}
      </motion.div>
    </div>
  )
}

function RangeResult({
  start,
  end,
  cidrs,
  onPick,
}: {
  start: number
  end: number
  cidrs: { network: number; prefix: number }[]
  onPick: (cidr: string) => void
}) {
  const list = cidrs.map((c) => `${ipv4ToString(c.network)}/${c.prefix}`)
  return (
    <Panel>
      <PanelHeader title={`范围 → ${list.length} 个 CIDR 块`}>
        <CopyButton text={list.join('\n')} label="复制全部" />
      </PanelHeader>
      <p className="mb-4 text-[13px] text-fg-2">
        {ipv4ToString(start)} – {ipv4ToString(end)}，共 {(end - start + 1).toLocaleString('en-US')}{' '}
        个地址，最少可用以下网段精确覆盖：
      </p>
      <div className="flex flex-wrap gap-2">
        {list.map((c, i) => (
          <motion.button
            key={c}
            type="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: Math.min(i, 30) * 0.02,
              type: 'spring',
              stiffness: 500,
              damping: 30,
            }}
            onClick={() => onPick(c)}
            className="rounded-full border border-line bg-surface-2 px-3 py-1.5 font-mono text-[13px] text-fg transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
          >
            {c}
          </motion.button>
        ))}
      </div>
    </Panel>
  )
}
