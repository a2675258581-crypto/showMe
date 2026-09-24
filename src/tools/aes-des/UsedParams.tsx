import { Terminal } from 'lucide-react'
import { CopyButton } from '@/components/ui'
import type { OpensslCommand } from '@/lib/aes-des'

interface Props {
  used: { key: string; iv: string; salt?: string }
  inputBytes: number
  outputBytes: number
  command: OpensslCommand
  direction: 'encrypt' | 'decrypt'
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-12 shrink-0 text-xs font-semibold text-fg-2">{label}</span>
      <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all text-fg">
        {value || <span className="text-fg-3">（不使用）</span>}
      </code>
      <CopyButton text={value} iconOnly variant="ghost" disabled={!value} label={`复制 ${label}`} />
    </div>
  )
}

/** 实际参与运算的 Key / IV / Salt（Hex）与等价的 OpenSSL 命令 */
export function UsedParams({ used, inputBytes, outputBytes, command, direction }: Props) {
  return (
    <section className="rounded-3xl border border-line bg-surface px-4 py-3 shadow-card sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">实际参数（Hex）</h3>
        <span className="text-xs text-fg-3 tabular-nums">
          {direction === 'encrypt' ? '明文' : '密文'} {inputBytes.toLocaleString()} 字节 →{' '}
          {direction === 'encrypt' ? '密文' : '明文'} {outputBytes.toLocaleString()} 字节
        </span>
      </div>
      <div className="divide-y divide-line">
        <Row label="Key" value={used.key} />
        <Row label="IV" value={used.iv} />
        {used.salt !== undefined && <Row label="Salt" value={used.salt} />}
      </div>
      <div className="mt-2 rounded-2xl bg-surface-2 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-fg-2">
            <Terminal className="size-3.5" />
            等价的 OpenSSL 命令
          </span>
          {command.ok && (
            <CopyButton text={command.command} iconOnly variant="ghost" label="复制命令" />
          )}
        </div>
        {command.ok ? (
          <code className="block font-mono text-[12px] leading-relaxed break-all text-fg">
            {command.command}
          </code>
        ) : (
          <p className="text-xs text-fg-3">{command.reason}</p>
        )}
        {command.ok && (
          <p className="mt-1.5 text-[11px] text-fg-3">
            从标准输入读取原始字节，例如：printf '%s' '内容' | openssl enc …
          </p>
        )}
      </div>
    </section>
  )
}
