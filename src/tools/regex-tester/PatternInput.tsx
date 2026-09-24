import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { FLAGS, type FlagInfo, type RegexFlag } from '@/lib/regex-tester'

/** 形如 /pattern/flags 的输入框 + 标志开关 */
export function PatternInput({
  pattern,
  flags,
  invalid,
  onPattern,
  onToggleFlag,
}: {
  pattern: string
  flags: string
  invalid: boolean
  onPattern: (v: string) => void
  onToggleFlag: (f: RegexFlag) => void
}) {
  const [hover, setHover] = useState<FlagInfo | null>(null)
  const activeNames = FLAGS.filter((f) => flags.includes(f.flag)).map((f) => f.name)

  return (
    <div className="flex flex-col gap-3">
      <label
        className={cn(
          'flex min-w-0 items-center rounded-2xl border bg-surface-2 font-mono transition-[border-color,box-shadow] duration-200',
          invalid
            ? 'border-danger/60 ring-4 ring-danger/10'
            : 'border-line focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15',
        )}
      >
        <span className="pl-4 text-xl text-fg-3 select-none" aria-hidden>
          /
        </span>
        <input
          value={pattern}
          onChange={(e) => onPattern(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          placeholder="在这里输入正则表达式，如 \d+"
          aria-label="正则表达式"
          aria-invalid={invalid}
          className="min-w-0 flex-1 bg-transparent px-1.5 py-3.5 text-[15px] text-fg outline-none placeholder:font-sans placeholder:text-fg-3"
        />
        <span className="text-xl text-fg-3 select-none" aria-hidden>
          /
        </span>
        <span
          className="min-w-[3ch] pr-4 pl-0.5 text-[15px] font-semibold text-accent"
          aria-label={`标志 ${flags || '无'}`}
        >
          {flags}
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="正则标志">
          {FLAGS.map((f) => {
            const on = flags.includes(f.flag)
            return (
              <motion.button
                key={f.flag}
                type="button"
                title={f.desc}
                aria-pressed={on}
                aria-label={`${f.flag} ${f.name}：${f.desc}`}
                onClick={() => onToggleFlag(f.flag)}
                onMouseEnter={() => setHover(f)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(f)}
                onBlur={() => setHover(null)}
                whileTap={{ scale: 0.94 }}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
                  on
                    ? 'border-accent/30 bg-accent-soft text-accent'
                    : 'border-transparent bg-fill text-fg-2 hover:bg-fill-3 hover:text-fg',
                )}
              >
                <span className="font-mono font-semibold">{f.flag}</span>
                <span className="text-xs">{f.name}</span>
              </motion.button>
            )
          })}
        </div>
        <div className="min-h-5 text-xs text-fg-3" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={hover?.flag ?? 'summary'}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.14 }}
              className="block"
            >
              {hover ? (
                <>
                  <span className="font-mono font-semibold text-fg-2">{hover.flag}</span> ·{' '}
                  {hover.desc}
                </>
              ) : activeNames.length ? (
                `已开启：${activeNames.join('、')}`
              ) : (
                '未开启任何标志：只匹配第一个结果'
              )}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
