import { memo } from 'react'
import { motion } from 'motion/react'
import { TableProperties } from 'lucide-react'
import { cn } from '@/lib/cn'

/** 表格视图最多渲染的行数（再多会拖慢页面，完整数据请看代码视图或下载） */
export const MAX_TABLE_ROWS = 500

interface Props {
  headers: readonly string[]
  rows: readonly (readonly unknown[])[]
  /** 值已做类型推断（CSV → JSON）：null、数字、布尔用不同颜色 */
  typed?: boolean
}

function Cell({ value, typed }: { value: unknown; typed?: boolean }) {
  if (value === null || value === undefined) {
    return typed ? <span className="text-fg-3 italic">null</span> : null
  }
  if (typeof value === 'number')
    return <span className="text-sys-indigo tabular-nums">{String(value)}</span>
  if (typeof value === 'boolean') return <span className="text-sys-purple">{String(value)}</span>
  if (typeof value === 'object')
    return <span className="font-mono text-[12px] text-sys-teal">{JSON.stringify(value)}</span>
  return <>{String(value)}</>
}

const text = (v: unknown) =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)

/** 表格预览：表头吸顶、斑马纹、在面板内部横向滚动 */
export const DataTable = memo(function DataTable({ headers, rows, typed }: Props) {
  if (headers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-[13px] text-fg-3">
        <TableProperties className="size-6" />
        没有可以显示的数据
      </div>
    )
  }
  const shown = rows.length > MAX_TABLE_ROWS ? rows.slice(0, MAX_TABLE_ROWS) : rows
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className="min-w-full"
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px] text-fg">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2 text-right text-[11px] font-medium text-fg-3"
            >
              #
            </th>
            {headers.map((h, i) => (
              <th
                key={`${i}-${h}`}
                scope="col"
                className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2 text-left font-semibold whitespace-nowrap text-fg-2"
                title={h}
              >
                <div className="max-w-[320px] truncate">{h}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r} className="transition-colors even:bg-fill-2 hover:bg-accent-soft">
              <td className="border-b border-line px-3 py-1.5 text-right text-[11px] text-fg-3 tabular-nums">
                {r + 1}
              </td>
              {headers.map((_, c) => {
                const v = row[c]
                const t = text(v)
                return (
                  <td
                    key={c}
                    title={t.length > 40 || t.includes('\n') ? t : undefined}
                    className={cn(
                      'border-b border-line px-3 py-1.5 whitespace-nowrap',
                      typeof v === 'number' && 'text-right',
                    )}
                  >
                    <div className="max-w-[320px] truncate">
                      <Cell value={v} typed={typed} />
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_TABLE_ROWS && (
        <div className="sticky left-0 px-4 py-3 text-xs text-fg-3">
          仅预览前 {MAX_TABLE_ROWS.toLocaleString()} 行（共 {rows.length.toLocaleString()}{' '}
          行），完整结果请看代码视图或下载
        </div>
      )}
    </motion.div>
  )
})
