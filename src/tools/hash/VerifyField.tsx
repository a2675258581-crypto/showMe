import { motion } from 'motion/react'
import { CircleCheck, CircleX, ClipboardPaste, ShieldCheck, X } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { readClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import type { MatchResult } from '@/lib/hash'

interface Props<T extends string> {
  value: string
  onChange: (v: string) => void
  result: MatchResult<T>
  labelOf: (id: T) => string
  /** 还没有可比对的结果（如输入为空） */
  idle?: boolean
  placeholder?: string
  /** 还没输入期望值时的说明 */
  emptyHint?: string
}

/** 「校验」输入框：粘贴期望值，显示匹配 / 不匹配 */
export function VerifyField<T extends string>({
  value,
  onChange,
  result,
  labelOf,
  idle,
  placeholder = '粘贴期望的哈希值，自动比对',
  emptyHint = 'Hex / Base64 均可，不区分大小写；也支持 sha256-…（SRI）、sha256:…、sha256sum 输出与证书指纹',
}: Props<T>) {
  const tone = idle || result.status === 'empty' ? 'idle' : result.status === 'match' ? 'ok' : 'bad'

  let message: string
  if (result.status === 'empty') message = emptyHint
  else if (idle) message = '先输入要计算的内容'
  else if (result.status === 'match') {
    message = `匹配 ${result.ids.map(labelOf).join('、')}`
  } else if (result.status === 'invalid') message = result.message
  else {
    const same = result.sameLength.map(labelOf)
    const size =
      result.format === 'hex'
        ? `${result.byteLength} 字节（${result.byteLength * 2} 位十六进制）`
        : `按 Base64 解析为 ${result.byteLength} 字节`
    message = `不匹配。期望值${result.format === 'hex' ? '为 ' : ''}${size}${
      same.length ? `，同长度的 ${same.join('、')} 都不一致` : '，没有相同长度的算法'
    }`
  }

  return (
    <div className="rounded-3xl border border-line bg-surface px-4 py-3.5 shadow-card sm:px-5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-300',
            tone === 'ok'
              ? 'bg-success/12 text-success'
              : tone === 'bad'
                ? 'bg-danger/10 text-danger'
                : 'bg-fill text-fg-2',
          )}
        >
          <ShieldCheck className="size-4" />
        </span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          mono
          aria-label="校验值"
          aria-invalid={tone === 'bad'}
          className={cn(
            'min-w-0 flex-1',
            tone === 'ok' && 'border-success/60! focus:border-success! focus:ring-success/15!',
            tone === 'bad' && 'border-danger/50! focus:border-danger! focus:ring-danger/15!',
          )}
        />
        {value ? (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<X />}
            aria-label="清空校验值"
            title="清空"
            onClick={() => onChange('')}
          />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<ClipboardPaste />}
            aria-label="粘贴校验值"
            title="粘贴"
            onClick={async () => {
              const t = await readClipboard()
              if (t) onChange(t.trim())
            }}
          />
        )}
      </div>
      {/* 按状态重新挂载做入场动画；不用 AnimatePresence mode="wait"，输入过快时它会卡在旧提示上 */}
      <motion.div
        key={tone}
        initial={{ opacity: 0, y: -4 }}
        animate={
          tone === 'bad' ? { opacity: 1, y: 0, x: [0, -4, 4, -2, 2, 0] } : { opacity: 1, y: 0 }
        }
        transition={{ duration: 0.3 }}
        role={tone === 'bad' ? 'alert' : 'status'}
        className={cn(
          'mt-2 flex items-start gap-1.5 pl-10 text-xs leading-relaxed',
          tone === 'ok' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-fg-3',
        )}
      >
        {tone === 'ok' && <CircleCheck className="mt-px size-3.5 shrink-0" />}
        {tone === 'bad' && <CircleX className="mt-px size-3.5 shrink-0" />}
        <span className="min-w-0 break-words">{message}</span>
      </motion.div>
    </div>
  )
}
