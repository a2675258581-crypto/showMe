import { motion } from 'motion/react'
import { Panel, PanelHeader } from '@/components/ui'
import {
  compressIPv6,
  expandIPv6,
  formatPow2,
  ipv6Nibbles,
  ipv6ReverseDns,
  type IPv6Info,
} from '@/lib/cidr-calculator'
import { cn } from '@/lib/cn'
import { BitLegend, StatCard, TagBadges } from './shared'

/** 32 个半字节按 8 组展示：网络部分蓝、主机部分橙、被前缀切开的半字节紫 */
function NibbleView({ value, prefix }: { value: bigint; prefix: number }) {
  const nibbles = ipv6Nibbles(value)
  return (
    <div className="flex flex-wrap gap-y-2 font-mono text-[13px] sm:text-[15px]">
      {Array.from({ length: 8 }, (_, g) => (
        <span key={g} className="inline-flex items-center">
          {g > 0 && <span className="px-0.5 text-fg-3">:</span>}
          {nibbles
            .slice(g * 4, g * 4 + 4)
            .split('')
            .map((c, i) => {
              const bitStart = (g * 4 + i) * 4
              const tone =
                bitStart + 4 <= prefix
                  ? 'text-accent'
                  : bitStart >= prefix
                    ? 'text-sys-orange'
                    : 'text-sys-purple font-bold'
              return (
                <span key={i} className={cn('transition-colors duration-300', tone)}>
                  {c}
                </span>
              )
            })}
        </span>
      ))}
    </div>
  )
}

/** 2 的幂：小数值直接给千分位，大数值用上标写法 */
function Pow2({ bits, exact }: { bits: number; exact: string }) {
  if (bits <= 20) return <>{exact}</>
  return (
    <>
      2<sup className="ml-px align-super text-[0.62em]">{bits}</sup>
    </>
  )
}

export function V6Result({ info, zone }: { info: IPv6Info; zone?: string }) {
  const net = `${compressIPv6(info.network)}/${info.prefix}`
  const count = formatPow2(128 - info.prefix)
  const subnets64 = info.prefix <= 64 ? formatPow2(64 - info.prefix) : null
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="text-xs font-semibold text-fg-2">网络前缀</div>
        <motion.div
          key={net}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="mt-1 font-mono text-xl font-semibold tracking-tight break-all text-fg sm:text-3xl"
        >
          {net}
        </motion.div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <TagBadges tags={info.tags} />
          {zone && <span className="text-xs text-fg-3">区域 ID：%{zone}</span>}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="压缩格式（RFC 5952）" value={compressIPv6(info.value)} emphasis />
        <StatCard label="完整格式" value={expandIPv6(info.value)} />
        <StatCard
          label="起始地址"
          value={compressIPv6(info.network)}
          sub={expandIPv6(info.network)}
        />
        <StatCard label="结束地址" value={compressIPv6(info.last)} sub={expandIPv6(info.last)} />
        <StatCard
          label="地址数量"
          value={<Pow2 bits={128 - info.prefix} exact={count.exact} />}
          copy={count.exact.replace(/,/g, '')}
          sub={count.short !== count.exact ? count.exact : undefined}
          emphasis
        />
        {subnets64 ? (
          <StatCard
            label="可划分的 /64 子网"
            value={<Pow2 bits={64 - info.prefix} exact={subnets64.exact} />}
            copy={subnets64.exact.replace(/,/g, '')}
            sub={
              subnets64.short !== subnets64.exact
                ? subnets64.exact
                : '一个 /64 是 IPv6 局域网的标准大小'
            }
            emphasis
          />
        ) : (
          <StatCard
            label="主机位"
            value={`${128 - info.prefix} 位`}
            sub="前缀长于 /64，常见于点对点链路（/127）或单个主机（/128）"
          />
        )}
      </div>

      <Panel>
        <PanelHeader title="半字节视图">
          <BitLegend
            extra={
              info.prefix % 4 !== 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <i className="size-2 rounded-full bg-sys-purple" />
                  被前缀切开的半字节
                </span>
              )
            }
          />
        </PanelHeader>
        <NibbleView value={info.value} prefix={info.prefix} />
      </Panel>

      <div className="grid gap-3">
        <StatCard label="反向解析（PTR）" value={ipv6ReverseDns(info.value)} />
        {info.prefix % 4 === 0 && info.prefix > 0 && info.prefix < 128 && (
          <StatCard
            label="反向解析区域"
            value={ipv6ReverseDns(info.network, info.prefix)}
            sub="委派该前缀的 ip6.arpa 区域"
          />
        )}
      </div>
    </div>
  )
}
