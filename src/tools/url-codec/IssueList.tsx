import { Notice } from '@/components/ui'
import type { CodecIssue } from '@/lib/url-codec'

/** 解码时遇到的问题：列出前几处的行列位置 */
export function IssueList({ issues, title }: { issues: CodecIssue[]; title: string }) {
  if (!issues.length) return null
  const shown = issues.slice(0, 6)
  const more = issues.length - shown.length
  return (
    <Notice tone="warning">
      <div className="font-medium">
        {title}（{issues.length >= 200 ? '200+' : issues.length} 处）
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {shown.map((i) => (
          <li key={i.index} className="flex flex-wrap gap-x-1.5">
            <span className="font-mono tabular-nums">
              第 {i.line} 行第 {i.column} 列
            </span>
            <span className="opacity-90">{i.message}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <div className="mt-1 opacity-80">…还有 {more} 处</div>}
    </Notice>
  )
}
