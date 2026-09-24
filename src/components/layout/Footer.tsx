import { Link } from 'react-router-dom'
import { CATEGORIES } from '@/tools/categories'
import { toolsByCategory } from '@/tools/registry'

/** 苹果式页脚：小号灰字、分栏目录、底部版权 */
export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-surface-2 text-xs text-fg-2">
      <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-6">
        <p className="border-b border-line pb-4 leading-relaxed text-fg-3">
          所有工具均在你的浏览器中本地运行，输入的内容不会上传到任何服务器。「API
          调试」通过本机开发服务器转发请求，仅供本地使用。
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 py-8 sm:grid-cols-4 lg:grid-cols-7">
          {CATEGORIES.map((c) => (
            <div key={c.id}>
              <h4 className="mb-2.5 font-semibold text-fg">{c.name}</h4>
              <ul className="flex flex-col gap-2">
                {toolsByCategory(c.id).map((t) => (
                  <li key={t.id}>
                    <Link
                      to={`/t/${t.id}`}
                      className="transition-colors hover:text-fg hover:underline"
                    >
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4 text-fg-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Copyright © {new Date().getFullYear()} showMe. 为开发者打造的小工具集。</span>
          <span>
            按 <kbd className="font-sans">/</kbd> 或 <kbd className="font-sans">⌘K</kbd> 随时搜索
          </span>
        </div>
      </div>
    </footer>
  )
}
