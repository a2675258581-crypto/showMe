import type { Cell } from '@/lib/mock-data'
import { cn } from '@/lib/cn'

export const PREVIEW_LIMIT = 100

/** 预览表格：表头吸顶，数字右对齐，超长内容省略（悬停看全文） */
export function PreviewTable({ columns, rows }: { columns: string[]; rows: Cell[][] }) {
  const shown = rows.slice(0, PREVIEW_LIMIT)
  return (
    <table className="w-max min-w-full border-separate border-spacing-0 text-left text-[13px]">
      <thead>
        <tr>
          <th className="sticky top-0 left-0 z-20 border-b border-line bg-surface px-3 py-2 text-right text-[11px] font-semibold text-fg-3">
            #
          </th>
          {columns.map((c) => (
            <th
              key={c}
              className="sticky top-0 z-10 border-b border-line bg-surface px-3 py-2 font-mono text-xs font-semibold whitespace-nowrap text-fg-2"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r, i) => (
          <tr key={i} className="group">
            <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5 text-right font-mono text-[11px] text-fg-3 tabular-nums group-hover:bg-surface-3">
              {i + 1}
            </td>
            {r.map((v, j) => (
              <td
                key={j}
                title={v === null ? 'null' : String(v)}
                className={cn(
                  'max-w-72 truncate border-b border-line px-3 py-1.5 whitespace-nowrap group-hover:bg-fill-2',
                  typeof v === 'number' && 'text-right font-mono tabular-nums',
                  typeof v === 'boolean' && 'font-mono',
                  v === null ? 'text-fg-3 italic' : 'text-fg',
                )}
              >
                {v === null ? (
                  'null'
                ) : typeof v === 'boolean' ? (
                  <span className={v ? 'text-sys-green' : 'text-fg-3'}>{String(v)}</span>
                ) : (
                  String(v)
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
