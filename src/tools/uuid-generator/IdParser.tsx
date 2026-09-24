import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ScanSearch } from 'lucide-react'
import { Badge, Button, CopyButton, ErrorNotice, Input, Panel, PanelHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { parseId, type ParsedId } from '@/lib/uuid-generator'

const SAMPLES = [
  { label: 'v1', value: 'c232ab00-9414-11ec-b3c8-9f6bdeced846' },
  { label: 'v4', value: '919108f7-52d1-4320-9bac-f847db4148a8' },
  { label: 'v6', value: '1ec9414c-232a-6b00-b3c8-9f6bdeced846' },
  { label: 'v7', value: '017f22e2-79b0-7cc3-98c4-dc0c0c07398f' },
  { label: 'ULID', value: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
]

const localFmt = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
})
const TIME_ZONE = localFmt.resolvedOptions().timeZone
const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

function relative(ms: number, now: number): string {
  const diff = (ms - now) / 1000
  const abs = Math.abs(diff)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365.2425 * 86400],
    ['month', 30.44 * 86400],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]
  // 向零取整：4.6 年前显示「4年前」而不是「5年前」
  for (const [unit, sec] of units) {
    if (abs >= sec || unit === 'second') return rtf.format(Math.trunc(diff / sec), unit)
  }
  return ''
}

/** 标准格式里的各字段着色：时间戳绿、版本蓝、变体粉 */
function Anatomy({ p }: { p: ParsedId }) {
  const s = p.canonical
  const cls = (i: number): string => {
    if (p.kind === 'ulid') return i < 10 ? 'text-sys-green' : 'text-fg'
    if (p.special) return 'text-fg-2'
    if (i === 14) return 'text-sys-blue font-bold'
    if (i === 19) return 'text-sys-pink font-bold'
    const ts =
      (p.version === 7 && i < 13) ||
      (p.version === 6 && i < 18 && i !== 14) ||
      (p.version === 1 && i < 18 && i !== 14)
    return ts ? 'text-sys-green' : 'text-fg'
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[15px] break-all sm:text-lg">
        {s.split('').map((c, i) => (
          <span key={i} className={cls(i)}>
            {c}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-3">
        {(p.timestamp || p.kind === 'ulid') && (
          <span className="inline-flex items-center gap-1.5">
            <i className="size-2 rounded-full bg-sys-green" />
            时间戳
          </span>
        )}
        {p.kind === 'uuid' && !p.special && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-sys-blue" />
              版本位
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2 rounded-full bg-sys-pink" />
              变体位
            </span>
          </>
        )}
        {p.kind === 'ulid' && <span>其余 16 位为 80 位随机数</span>}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  mono = true,
  copy,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  copy?: string
}) {
  return (
    <div className="flex min-h-12 min-w-0 items-center gap-3 border-t border-line py-2 first:border-t-0">
      {/* 手机上标签在上、值在下，给等宽长串留出整行宽度 */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-3">
        <span className="shrink-0 text-xs font-semibold text-fg-2 sm:w-24 sm:pt-px">{label}</span>
        <span className={cn('min-w-0 flex-1 text-[13px] break-all text-fg', mono && 'font-mono')}>
          {value}
        </span>
      </div>
      {copy && <CopyButton text={copy} iconOnly variant="ghost" label={`复制${label}`} />}
    </div>
  )
}

export function IdParser({ input, onInput }: { input: string; onInput: (v: string) => void }) {
  const [now] = useState(() => Date.now())
  const parsed = useMemo<{ ok: true; p: ParsedId } | { ok: false; error: string } | null>(() => {
    if (!input.trim()) return null
    try {
      return { ok: true, p: parseId(input) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, [input])
  const p = parsed?.ok ? parsed.p : null

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ScanSearch className="size-4 text-fg-2" />
            解析 UUID / ULID
          </span>
        }
      >
        {SAMPLES.map((s) => (
          <Button key={s.label} size="sm" variant="ghost" onClick={() => onInput(s.value)}>
            {s.label}
          </Button>
        ))}
      </PanelHeader>
      <Input
        mono
        value={input}
        onChange={(e) => onInput(e.target.value)}
        placeholder="粘贴 UUID（可带花括号或 urn:uuid: 前缀）或 ULID"
        aria-label="要解析的 UUID 或 ULID"
        className="h-11"
      />
      <ErrorNotice error={parsed && !parsed.ok ? parsed.error : null} className="mt-3" />
      <AnimatePresence mode="wait">
        {p && (
          <motion.div
            key={p.canonical}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="mt-4 grid gap-4 lg:grid-cols-2"
          >
            <div className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={p.kind === 'ulid' ? 'var(--sys-purple)' : 'var(--accent)'}>
                  {p.kind === 'ulid' ? 'ULID' : p.special ? p.versionName : `UUID v${p.version}`}
                </Badge>
                {p.kind === 'uuid' && !p.special && (
                  <span className="text-[13px] text-fg-2">{p.versionName}</span>
                )}
              </div>
              <Anatomy p={p} />
              {p.timestamp && (
                <div className="rounded-xl border border-line bg-surface p-3">
                  <div className="text-xs font-semibold text-fg-2">
                    内嵌时间 · 本地（{TIME_ZONE}）
                  </div>
                  <div className="mt-1 text-lg font-semibold text-fg tabular-nums">
                    {localFmt.format(p.timestamp.ms)}
                  </div>
                  <div className="mt-0.5 text-xs text-fg-3">{relative(p.timestamp.ms, now)}</div>
                </div>
              )}
            </div>
            <div className="min-w-0">
              {p.kind === 'uuid' && p.variant && (
                <Row label="变体" value={p.variant} mono={false} />
              )}
              {p.timestamp && (
                <>
                  <Row
                    label="时间（UTC）"
                    value={p.timestamp.isoPrecise ?? p.timestamp.iso}
                    copy={p.timestamp.isoPrecise ?? p.timestamp.iso}
                  />
                  <Row label="Unix 毫秒" value={p.timestamp.ms} copy={String(p.timestamp.ms)} />
                </>
              )}
              {p.clockSeq !== undefined && (
                <Row label="时钟序列" value={`${p.clockSeq}（0x${p.clockSeq.toString(16)}）`} />
              )}
              {p.node && (
                <Row
                  label="节点"
                  value={
                    <>
                      {p.node}
                      <span className="ml-2 font-sans text-xs text-fg-3">
                        {p.nodeIsRandom ? '组播位为 1：随机生成的节点' : '可能是真实 MAC 地址'}
                      </span>
                    </>
                  }
                  copy={p.node}
                />
              )}
              <Row label="标准格式" value={p.canonical} copy={p.canonical} />
              {p.asUlid && <Row label="ULID 写法" value={p.asUlid} copy={p.asUlid} />}
              {p.asUuid && <Row label="UUID 写法" value={p.asUuid} copy={p.asUuid} />}
              <Row label="十六进制" value={p.hex} copy={p.hex} />
              <Row label="十进制" value={p.decimal} copy={p.decimal} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}
