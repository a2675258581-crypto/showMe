import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Badge, Panel, PanelHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  CHAR_CATEGORY_LABEL,
  inspectChars,
  textStats,
  type CharCategory,
} from '@/lib/unicode-escape'

/** 表格最多列出的码点数 */
const LIMIT = 300

const CATEGORY_COLOR: Record<CharCategory, string> = {
  control: 'var(--fg-3)',
  space: 'var(--fg-2)',
  'ascii-letter': 'var(--sys-blue)',
  'ascii-digit': 'var(--sys-cyan)',
  'ascii-symbol': 'var(--sys-teal)',
  han: 'var(--sys-red)',
  kana: 'var(--sys-pink)',
  hangul: 'var(--sys-purple)',
  latin: 'var(--sys-indigo)',
  greek: 'var(--sys-indigo)',
  cyrillic: 'var(--sys-indigo)',
  letter: 'var(--sys-indigo)',
  digit: 'var(--sys-cyan)',
  emoji: 'var(--sys-orange)',
  punct: 'var(--sys-green)',
  symbol: 'var(--sys-mint)',
  mark: 'var(--warning)',
  variation: 'var(--fg-2)',
  format: 'var(--fg-2)',
  private: 'var(--fg-3)',
  surrogate: 'var(--danger)',
  unassigned: 'var(--fg-3)',
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

/** 逐码点列出字符、码点、UTF-8 / UTF-16 与类别 */
export function CharInspector({ text }: { text: string }) {
  const stats = useMemo(() => textStats(text), [text])
  const { rows, total } = useMemo(() => inspectChars(text, LIMIT), [text])

  const chips = [
    { label: '码点', value: stats.codePoints },
    { label: '字素（可见字符）', value: stats.graphemes },
    { label: 'UTF-16 长度', value: stats.utf16 },
    { label: 'UTF-8 字节', value: stats.utf8 },
  ]

  return (
    <Panel>
      <PanelHeader title="字符分析">
        <span className="text-xs text-fg-3">同一底色的行属于同一个用户感知字符（字素簇）</span>
      </PanelHeader>
      <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chips.map((c) => (
          <div key={c.label} className="min-w-0 rounded-2xl bg-fill-2 px-3.5 py-2.5">
            <dt className="truncate text-[11px] font-semibold text-fg-3">{c.label}</dt>
            <dd className="text-lg font-semibold text-fg tabular-nums">
              <motion.span
                key={c.value}
                initial={{ opacity: 0.3, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="inline-block"
              >
                {c.value.toLocaleString()}
              </motion.span>
            </dd>
          </div>
        ))}
      </dl>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-fill-2 px-4 py-8 text-center text-sm text-fg-2">
          输入文本后，这里会逐个列出字符的码点与编码
        </p>
      ) : (
        <div
          className="thin-scrollbar -mx-5 max-h-[480px] overflow-auto px-5 sm:-mx-6 sm:px-6"
          data-lenis-prevent
        >
          <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-xs text-fg-2">
                {['字符', '码点', '十进制', 'UTF-8', 'UTF-16', '类别'].map((h) => (
                  <th
                    key={h}
                    className="border-b border-line px-2 py-2 font-semibold whitespace-nowrap first:pl-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.index}
                  className={cn(
                    'transition-colors hover:bg-accent-soft',
                    r.grapheme % 2 === 1 && 'bg-fill-2',
                  )}
                >
                  <td className="border-b border-line py-1.5 pr-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          'flex h-9 min-w-9 items-center justify-center rounded-xl bg-surface-2 px-1.5 text-xl leading-none',
                          r.display !== r.char ? 'text-fg-3' : 'text-fg',
                        )}
                      >
                        {r.display}
                      </span>
                      {r.name && (
                        <span className="text-xs whitespace-nowrap text-fg-2">{r.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="border-b border-line px-2 py-1.5 font-mono whitespace-nowrap text-fg">
                    {r.hex}
                  </td>
                  <td className="border-b border-line px-2 py-1.5 font-mono text-fg-2 tabular-nums">
                    {r.codePoint}
                  </td>
                  <td className="border-b border-line px-2 py-1.5 font-mono whitespace-nowrap text-fg-2">
                    {r.utf8.length ? (
                      r.utf8.map(hex2).join(' ')
                    ) : (
                      <span className="text-danger">无法编码</span>
                    )}
                  </td>
                  <td className="border-b border-line px-2 py-1.5 font-mono whitespace-nowrap text-fg-2">
                    {r.utf16.map(hex4).join(' ')}
                  </td>
                  <td className="border-b border-line px-2 py-1.5">
                    <Badge color={CATEGORY_COLOR[r.category]}>
                      {CHAR_CATEGORY_LABEL[r.category]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > rows.length && (
        <p className="mt-3 text-xs text-fg-3">
          仅列出前 {rows.length} 个码点（共 {total.toLocaleString()} 个）
        </p>
      )}
    </Panel>
  )
}
