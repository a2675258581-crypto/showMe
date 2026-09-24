import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { RegexMatch } from '@/lib/regex-tester'
import { GROUP_COLORS } from './highlight'

const PAGE = 200

/** 行首偏移表，用来把下标换算成行列号 */
function lineStarts(text: string): number[] {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}

function lineOf(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * 按顺序给匹配算行号与列号。列按码点计（emoji / 生僻字算 1 列，与编辑器一致）；
 * 同一行里的匹配接着上一个位置往后数，超长单行文本也只扫描一遍。
 */
function positions(text: string, starts: number[], matches: RegexMatch[]): [number, number][] {
  const out: [number, number][] = []
  let line = -1
  let pos = 0
  let col = 1
  for (const m of matches) {
    const l = lineOf(starts, m.start)
    if (l !== line || m.start < pos) {
      line = l
      pos = starts[l]
      col = 1
    }
    for (; pos < m.start; pos++) {
      const c = text.charCodeAt(pos)
      // 代理对的低位不单独算一列
      if (c < 0xdc00 || c > 0xdfff) col++
    }
    out.push([line + 1, col])
  }
  return out
}

function Visible({ text }: { text: string }) {
  if (text === '') return <span className="font-sans text-fg-3 italic">（空匹配）</span>
  // 让换行、制表符可见
  return <>{text.replace(/\n/g, '↵\n').replace(/\t/g, '⇥')}</>
}

export function MatchList({
  matches,
  text,
  stale,
  active,
  onHover,
  onReveal,
}: {
  matches: RegexMatch[]
  /** 这份结果对应的测试文本 */
  text: string
  stale: boolean
  active: number
  onHover: (n: number) => void
  onReveal: (m: RegexMatch) => void
}) {
  const starts = useMemo(() => lineStarts(text), [text])
  const [shownState, setShown] = useState<{ key: unknown; n: number }>({ key: null, n: PAGE })
  const shown = shownState.key === matches ? shownState.n : PAGE
  const visible = useMemo(() => matches.slice(0, shown), [matches, shown])
  const where = useMemo(() => positions(text, starts, visible), [text, starts, visible])

  if (!matches.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <span className="text-3xl" aria-hidden>
          ∅
        </span>
        <p className="text-sm text-fg-2">没有匹配</p>
        <p className="text-xs text-fg-3">检查表达式、标志（如 g、i、m）或测试文本</p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2 transition-opacity', stale && 'opacity-60')}>
      {visible.map((m, i) => {
        const [line, col] = where[i]
        return (
          <motion.button
            key={m.n}
            type="button"
            layout="position"
            initial={m.n < 30 ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 38,
              delay: Math.min(m.n, 12) * 0.015,
            }}
            onMouseEnter={() => onHover(m.n)}
            onMouseLeave={() => onHover(-1)}
            onFocus={() => onHover(m.n)}
            onBlur={() => onHover(-1)}
            onClick={() => onReveal(m)}
            className={cn(
              'w-full rounded-2xl border bg-surface-2 p-3 text-left transition-colors',
              active === m.n
                ? 'border-accent/50 bg-accent-soft'
                : 'border-line hover:border-line-strong',
            )}
            aria-label={`第 ${m.n + 1} 个匹配，第 ${line} 行第 ${col} 列，点击在编辑器中选中`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span
                className="size-2 rounded-full"
                style={{ background: m.n % 2 ? 'var(--sys-orange)' : 'var(--sys-blue)' }}
                aria-hidden
              />
              <span className="font-semibold text-fg">#{m.n + 1}</span>
              <span className="text-fg-3 tabular-nums">
                第 {line} 行 · 第 {col} 列 · 下标 {m.start}–{m.end}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[13px] leading-relaxed break-all whitespace-pre-wrap text-fg">
              <Visible text={m.text} />
            </div>
            {m.groups.length > 0 && (
              <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-2 text-xs">
                {m.groups.map((g) => (
                  <GroupRow key={g.index} g={g} />
                ))}
              </div>
            )}
          </motion.button>
        )
      })}
      {matches.length > shown && (
        <Button
          size="sm"
          variant="secondary"
          className="self-center"
          onClick={() => setShown({ key: matches, n: shown + PAGE })}
        >
          再显示 {Math.min(PAGE, matches.length - shown)} 个（共 {matches.length.toLocaleString()}{' '}
          个）
        </Button>
      )}
    </div>
  )
}

function GroupRow({ g }: { g: RegexMatch['groups'][number] }) {
  const color = GROUP_COLORS[(g.index - 1) % GROUP_COLORS.length]
  return (
    <>
      <span className="flex items-center gap-1.5 font-mono whitespace-nowrap">
        <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
        <span className="font-semibold" style={{ color }}>
          ${g.index}
        </span>
        {g.name && <span className="text-fg-2">{g.name}</span>}
      </span>
      <span className="min-w-0 font-mono break-all whitespace-pre-wrap text-fg">
        {g.value === undefined ? (
          <span className="font-sans text-fg-3">未参与匹配</span>
        ) : (
          <>
            <Visible text={g.value} />
            {g.start !== null && (
              <span className="ml-2 font-sans text-[11px] text-fg-3 tabular-nums">
                {g.start}–{g.end}
              </span>
            )}
          </>
        )}
      </span>
    </>
  )
}
