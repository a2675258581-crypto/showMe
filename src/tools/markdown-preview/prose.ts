/**
 * 仿 GitHub 的 Markdown 排版（全部基于设计 token，深浅色自动适配）。
 * 作用于预览容器，选择器写成 Tailwind 任意变体。
 */
export const PROSE = [
  'text-[15px] leading-[1.75] text-fg [overflow-wrap:anywhere]',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  // 标题
  '[&_:is(h1,h2,h3,h4,h5,h6)]:relative [&_:is(h1,h2,h3,h4,h5,h6)]:scroll-mt-4 [&_:is(h1,h2,h3,h4,h5,h6)]:rounded-md [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:tracking-tight [&_:is(h1,h2,h3,h4,h5,h6)]:leading-snug',
  '[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:border-b [&_h1]:border-line [&_h1]:pb-2 [&_h1]:text-[1.9em] [&_h1]:font-bold',
  '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-line [&_h2]:pb-1.5 [&_h2]:text-[1.45em]',
  '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[1.2em]',
  '[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-[1.05em]',
  '[&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:text-[0.95em]',
  '[&_h6]:mt-4 [&_h6]:mb-2 [&_h6]:text-[0.9em] [&_h6]:text-fg-2',
  '[&_.md-anchor]:absolute [&_.md-anchor]:-left-5 [&_.md-anchor]:pr-1 [&_.md-anchor]:font-normal [&_.md-anchor]:text-accent [&_.md-anchor]:no-underline [&_.md-anchor]:opacity-0 [&_.md-anchor]:transition-opacity [&_:is(h1,h2,h3,h4,h5,h6):hover_.md-anchor]:opacity-100',
  // 段落、链接、强调
  '[&_p]:my-3',
  '[&_a]:text-link [&_a]:underline-offset-2 [&_a:hover]:underline',
  '[&_strong]:font-semibold [&_del]:text-fg-3',
  // 列表
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_li]:my-1 [&_li>ul]:my-1 [&_li>ol]:my-1 [&_li::marker]:text-fg-3',
  '[&_.contains-task-list]:list-none [&_.contains-task-list]:pl-1',
  '[&_.task-list-item_input]:mr-2 [&_.task-list-item_input]:size-3.5 [&_.task-list-item_input]:translate-y-[2px] [&_.task-list-item_input]:pointer-events-none [&_.task-list-item_input]:accent-accent',
  // 引用
  '[&_blockquote]:my-4 [&_blockquote]:rounded-r-2xl [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:bg-accent-soft [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-fg-2',
  '[&_blockquote_p]:my-1.5 [&_blockquote_blockquote]:my-2 [&_blockquote_blockquote]:bg-transparent',
  // 行内代码
  '[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-fill [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.86em]',
  // 代码块
  '[&_.md-code]:my-4 [&_.md-code]:overflow-hidden [&_.md-code]:rounded-2xl [&_.md-code]:border [&_.md-code]:border-line [&_.md-code]:bg-surface-2',
  '[&_.md-code-head]:flex [&_.md-code-head]:items-center [&_.md-code-head]:justify-between [&_.md-code-head]:border-b [&_.md-code-head]:border-line [&_.md-code-head]:py-1 [&_.md-code-head]:pr-2 [&_.md-code-head]:pl-4',
  '[&_.md-code-lang]:text-[11px] [&_.md-code-lang]:font-semibold [&_.md-code-lang]:tracking-wider [&_.md-code-lang]:text-fg-3 [&_.md-code-lang]:uppercase',
  '[&_.md-copy]:rounded-full [&_.md-copy]:px-2.5 [&_.md-copy]:py-0.5 [&_.md-copy]:text-[11px] [&_.md-copy]:font-medium [&_.md-copy]:text-fg-2 [&_.md-copy]:transition-colors [&_.md-copy:hover]:bg-fill [&_.md-copy:hover]:text-fg',
  '[&_pre]:overflow-x-auto [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-relaxed',
  // 表格
  '[&_.md-table]:my-4 [&_.md-table]:overflow-x-auto [&_.md-table]:rounded-2xl [&_.md-table]:border [&_.md-table]:border-line',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-[14px]',
  '[&_th]:bg-fill-2 [&_th]:px-3.5 [&_th]:py-2 [&_th]:font-semibold [&_th:not([align])]:text-left',
  '[&_td]:border-t [&_td]:border-line [&_td]:px-3.5 [&_td]:py-2 [&_th+th]:border-l [&_th+th]:border-line [&_td+td]:border-l',
  '[&_tbody_tr:nth-child(even)]:bg-fill-2',
  // 其它
  '[&_hr]:my-8 [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-line',
  '[&_img]:inline-block [&_img]:max-w-full [&_img]:rounded-xl',
  '[&_kbd]:rounded-md [&_kbd]:border [&_kbd]:border-b-2 [&_kbd]:border-line-strong [&_kbd]:bg-surface [&_kbd]:px-1.5 [&_kbd]:font-sans [&_kbd]:text-[0.82em]',
].join(' ')
