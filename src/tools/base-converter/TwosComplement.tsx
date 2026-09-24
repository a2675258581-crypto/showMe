import { motion } from 'motion/react'
import { Badge, CopyButton, Panel, PanelHeader } from '@/components/ui'
import { WIDTHS, groupDigits, twosComplement } from '@/lib/base-converter'

/** 8 / 16 / 32 / 64 位补码视图 */
export function TwosComplement({ value }: { value: bigint | null }) {
  return (
    <Panel>
      <PanelHeader title="补码表示" />
      {value === null ? (
        <p className="py-6 text-center text-[13px] text-fg-3">输入数值后显示各位宽下的补码</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {WIDTHS.map((w, i) => {
            const info = twosComplement(value, w)
            const status = info.overflow
              ? { text: '溢出 · 已截断', color: 'var(--danger)' }
              : info.fitsSigned && info.fitsUnsigned
                ? { text: '有 / 无符号均可', color: 'var(--sys-green)' }
                : info.fitsSigned
                  ? { text: `仅 int${w}`, color: 'var(--sys-blue)' }
                  : { text: `仅 uint${w}`, color: 'var(--sys-orange)' }
            return (
              <motion.div
                key={w}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, type: 'spring', stiffness: 380, damping: 32 }}
                className="flex min-w-0 flex-col gap-2 rounded-2xl bg-fill-2 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg">{w} 位</span>
                  <span className="font-mono text-[11px] text-fg-3">
                    int{w} / uint{w}
                  </span>
                  <Badge color={status.color} className="ml-auto">
                    {status.text}
                  </Badge>
                </div>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 font-mono text-[12.5px] leading-5 break-all text-fg">
                    {groupDigits(info.binary, 4)}
                  </code>
                  <CopyButton
                    text={info.binary}
                    iconOnly
                    variant="ghost"
                    label={`复制 ${w} 位二进制`}
                  />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-[12px]">
                  <div className="min-w-0">
                    <dt className="text-[11px] text-fg-3">十六进制</dt>
                    <dd className="truncate font-mono text-fg" title={`0x${info.hex}`}>
                      0x{info.hex}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] text-fg-3">有符号</dt>
                    <dd className="truncate font-mono text-fg" title={info.signed.toString()}>
                      {info.signed.toString()}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] text-fg-3">无符号</dt>
                    <dd className="truncate font-mono text-fg" title={info.unsigned.toString()}>
                      {info.unsigned.toString()}
                    </dd>
                  </div>
                </dl>
                {info.overflow && (
                  <p className="text-[12px] leading-relaxed text-danger">
                    超出 {w} 位可表示的范围（int{w} 与 uint{w} 都放不下），上面是截断后的低 {w} 位。
                  </p>
                )}
                {!info.overflow && !info.fitsSigned && (
                  <p className="text-[12px] leading-relaxed text-fg-2">
                    按有符号 int{w} 解读时，这组位表示 {info.signed.toString()}。
                  </p>
                )}
              </motion.div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
