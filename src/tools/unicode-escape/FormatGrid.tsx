import { useMemo } from 'react'
import { motion } from 'motion/react'
import { CopyButton, Panel, PanelHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ESCAPE_FORMATS, escapeText, type EscapeFormat } from '@/lib/unicode-escape'

/** 概览里最多转换的字符数，避免超长文本拖慢页面 */
const MAX_CHARS = 4000

interface Props {
  text: string
  onlyNonAscii: boolean
  upper: boolean
  current: EscapeFormat | null
  onPick: (f: EscapeFormat) => void
}

/** 同一段文本在所有格式下的写法 */
export function FormatGrid({ text, onlyNonAscii, upper, current, onPick }: Props) {
  const clipped = text.length > MAX_CHARS
  const items = useMemo(() => {
    const src = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text
    return ESCAPE_FORMATS.map((f) => ({
      ...f,
      value: escapeText(src, { format: f.id, onlyNonAscii, upper }).output,
    }))
  }, [text, onlyNonAscii, upper])

  return (
    <Panel>
      <PanelHeader title="所有格式一览">
        <span className="text-xs text-fg-3">
          {clipped ? `只转换前 ${MAX_CHARS.toLocaleString()} 个字符 · ` : ''}点击标题设为输出格式
        </span>
      </PanelHeader>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it, i) => (
          <motion.div
            key={it.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, delay: i * 0.03 }}
            className={cn(
              'flex min-w-0 flex-col gap-2 rounded-2xl border bg-surface-2 p-4 transition-colors',
              current === it.id ? 'border-accent/60 ring-4 ring-accent/10' : 'border-line',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onPick(it.id)}
                className="min-w-0 text-left"
                title="设为输出格式"
              >
                <div className="truncate font-mono text-[13px] font-semibold text-fg">
                  {it.label}
                </div>
                <div className="truncate text-[11px] text-fg-3">{it.hint}</div>
              </button>
              <CopyButton
                text={it.value}
                label={`复制 ${it.label} 格式`}
                iconOnly
                variant="ghost"
                disabled={!it.value}
              />
            </div>
            <pre className="thin-scrollbar max-h-32 overflow-auto font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-fg-2">
              {it.value || <span className="text-fg-3">{it.example}</span>}
            </pre>
          </motion.div>
        ))}
      </div>
    </Panel>
  )
}
