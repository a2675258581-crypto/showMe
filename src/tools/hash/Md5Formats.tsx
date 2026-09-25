import { motion } from 'motion/react'
import { CopyButton, Panel, PanelHeader } from '@/components/ui'
import { md5Variants } from '@/lib/hash'

/** 还没有结果时只显示四个格式名 */
const EMPTY = md5Variants(new Uint8Array(16)).map((v) => ({ ...v, value: '' }))

interface Props {
  md5: Uint8Array | null
  pending?: boolean
  stale?: boolean
  placeholder?: string
}

/** MD5 的 32 / 16 位 × 小写 / 大写四种写法，各自一键复制 */
export function Md5Formats({ md5, pending, stale, placeholder = '—' }: Props) {
  const rows = md5 ? md5Variants(md5) : EMPTY
  return (
    <Panel>
      <PanelHeader title="MD5 常用格式">
        <span className="text-xs text-fg-3">固定 Hex，不受「大写」与输出格式影响</span>
      </PanelHeader>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex min-w-0 items-center gap-2 rounded-2xl bg-fill-2 py-2.5 pr-2 pl-3.5"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-fg-3">{r.label}</div>
              <div className="font-mono text-[13px] leading-relaxed break-all text-fg">
                {pending ? (
                  <span className="my-1 block h-4 w-full animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--fill)_25%,var(--fill-3)_50%,var(--fill)_75%)] bg-[length:200%_100%]" />
                ) : r.value ? (
                  <motion.span
                    key={r.value}
                    initial={{ opacity: 0.3 }}
                    animate={{ opacity: stale ? 0.5 : 1 }}
                    transition={{ duration: 0.2 }}
                    className="select-all"
                  >
                    {r.value}
                  </motion.span>
                ) : (
                  <span className="text-fg-3">{placeholder}</span>
                )}
              </div>
            </div>
            <CopyButton
              text={r.value}
              iconOnly
              variant="ghost"
              disabled={!r.value}
              label={`复制 MD5 ${r.label}`}
            />
          </div>
        ))}
      </div>
    </Panel>
  )
}
