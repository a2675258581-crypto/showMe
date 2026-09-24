import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Panel, PanelHeader } from '@/components/ui'
import {
  ipv4Binary,
  ipv4Hex,
  ipv4Mapped,
  ipv4ReverseDns,
  ipv4ToString,
  type IPv4Info,
} from '@/lib/cidr-calculator'
import { cn } from '@/lib/cn'
import { BitLegend, StatCard, TagBadges } from './shared'

const n = (x: number) => x.toLocaleString('en-US')

/** 32 位二进制：网络位蓝、主机位橙，前缀变化时颜色平滑过渡 */
function BinaryRow({ label, value, prefix }: { label: string; value: number; prefix: number }) {
  const bits = ipv4Binary(value)
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-14 shrink-0 text-xs font-semibold text-fg-2">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center font-mono text-[13px] tracking-[0.02em] sm:text-[15px]">
        {[0, 1, 2, 3].map((o) => (
          <span key={o} className="inline-flex items-center">
            {o > 0 && <span className="px-0.5 text-fg-3">.</span>}
            <span className="inline-flex flex-col items-center">
              <span>
                {bits
                  .slice(o * 8, o * 8 + 8)
                  .split('')
                  .map((b, i) => {
                    const idx = o * 8 + i
                    return (
                      <span
                        key={i}
                        className={cn(
                          'transition-colors duration-300',
                          idx < prefix ? 'text-accent' : 'text-sys-orange',
                          b === '0' && 'opacity-60',
                        )}
                      >
                        {b}
                      </span>
                    )
                  })}
              </span>
              <span className="text-[10px] text-fg-3 tabular-nums">
                {(value >>> (24 - o * 8)) & 255}
              </span>
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function V4Result({
  info,
  onNavigate,
}: {
  info: IPv4Info
  onNavigate: (cidr: string) => void
}) {
  const s = ipv4ToString
  const cidr = `${s(info.network)}/${info.prefix}`
  const hostNote =
    info.prefix === 32
      ? '单个主机地址'
      : info.prefix === 31
        ? '点对点链路，两端都可用（RFC 3021）'
        : '不含网络地址与广播地址'

  return (
    <div className="flex flex-col gap-4">
      {/* 概要 */}
      <Panel className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-fg-2">所在网段</div>
          <motion.div
            key={cidr}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="mt-1 font-mono text-2xl font-semibold tracking-tight break-all text-fg sm:text-3xl"
          >
            {cidr}
          </motion.div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <TagBadges tags={info.tags} />
            <span title={info.classNote}>
              <span className="text-xs text-fg-3">
                {info.cls} 类地址 · {info.classNote}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            icon={<ChevronLeft />}
            disabled={info.prev === null}
            onClick={() => info.prev !== null && onNavigate(`${s(info.prev)}/${info.prefix}`)}
            title={info.prev !== null ? `${s(info.prev)}/${info.prefix}` : '已是第一个子网'}
          >
            上一个子网
          </Button>
          <Button
            size="sm"
            disabled={info.next === null}
            onClick={() => info.next !== null && onNavigate(`${s(info.next)}/${info.prefix}`)}
            title={info.next !== null ? `${s(info.next)}/${info.prefix}` : '已是最后一个子网'}
          >
            下一个子网
            <ChevronRight />
          </Button>
        </div>
      </Panel>

      {/* 主要结果 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="网络地址" value={s(info.network)} emphasis />
        {info.prefix >= 31 ? (
          <StatCard label="广播地址" value="无" copy="" emphasis sub="/31、/32 没有广播地址" />
        ) : (
          <StatCard label="广播地址" value={s(info.broadcast)} emphasis />
        )}
        <StatCard
          label="可用主机数"
          value={n(info.usable)}
          emphasis
          sub={`共 ${n(info.total)} 个地址 · ${hostNote}`}
        />
        <StatCard label="首个可用地址" value={s(info.first)} />
        <StatCard label="最后可用地址" value={s(info.last)} />
        <StatCard
          label="可用范围"
          value={`${s(info.first)} – ${s(info.last)}`}
          copy={`${s(info.first)}-${s(info.last)}`}
        />
        <StatCard
          label="子网掩码"
          value={s(info.mask)}
          sub={`/${info.prefix} · ${ipv4Hex(info.mask)}`}
        />
        <StatCard label="反掩码（通配符）" value={s(info.wildcard)} sub="用于 ACL、OSPF 配置" />
        <StatCard label="CIDR" value={cidr} />
      </div>

      {/* 二进制 */}
      <Panel>
        <PanelHeader title="二进制视图">
          <BitLegend />
        </PanelHeader>
        <div className="flex flex-col gap-3 overflow-x-auto">
          <BinaryRow label="IP 地址" value={info.ip} prefix={info.prefix} />
          <BinaryRow label="子网掩码" value={info.mask} prefix={info.prefix} />
          <BinaryRow label="网络地址" value={info.network} prefix={info.prefix} />
          <BinaryRow label="广播地址" value={info.broadcast} prefix={info.prefix} />
        </div>
      </Panel>

      {/* 其他表示 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="十六进制" value={ipv4Hex(info.ip)} />
        <StatCard label="32 位整数" value={String(info.ip)} />
        <StatCard label="反向解析（PTR）" value={ipv4ReverseDns(info.ip)} />
        <StatCard label="IPv4 映射的 IPv6" value={ipv4Mapped(info.ip)} />
      </div>
    </div>
  )
}
