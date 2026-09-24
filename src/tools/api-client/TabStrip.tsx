import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, X } from 'lucide-react'
import { requestLabel } from '@/lib/api-client'
import type { RequestTab } from '@/lib/api-client-store'
import { cn } from '@/lib/cn'
import { MethodBadge } from './MethodBadge'

export function tabTitle(tab: RequestTab): string {
  return tab.name?.trim() || requestLabel(tab.request)
}

/** 多请求标签栏：可新建、关闭（中键也可以）、双击重命名，未保存时显示圆点 */
export function TabStrip({
  tabs,
  activeId,
  dirty,
  loading,
  onActivate,
  onClose,
  onRename,
  onNew,
  leading,
}: {
  tabs: RequestTab[]
  activeId: string
  dirty: Set<string>
  loading: Set<string>
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onNew: () => void
  leading?: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<string | null>(null)

  // 激活的标签滚动到可见区域
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeId)}"]`,
    )
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeId, tabs.length])

  return (
    <div className="flex min-w-0 items-center gap-2">
      {leading}
      <div
        ref={scroller}
        role="tablist"
        aria-label="请求标签"
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1 shadow-card"
      >
        <AnimatePresence initial={false}>
          {tabs.map((t) => {
            const active = t.id === activeId
            const isDirty = dirty.has(t.id)
            return (
              <motion.div
                key={t.id}
                data-tab-id={t.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, width: 0, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="group relative flex h-9 max-w-[220px] shrink-0 items-center rounded-xl"
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    onClose(t.id)
                  }
                }}
              >
                {active && (
                  <motion.span
                    layoutId="api-tab-active"
                    className="absolute inset-0 rounded-xl bg-fill"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                {editing === t.id ? (
                  <input
                    autoFocus
                    defaultValue={tabTitle(t)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => {
                      onRename(t.id, e.currentTarget.value)
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setEditing(null)
                      }
                    }}
                    aria-label="标签名称"
                    className="relative mx-1 h-7 w-40 rounded-lg border border-accent bg-surface px-2 text-[13px] text-fg outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onActivate(t.id)}
                    onDoubleClick={() => setEditing(t.id)}
                    title={`${tabTitle(t)}（双击重命名）`}
                    className={cn(
                      'relative flex h-full min-w-0 items-center gap-2 pr-8 pl-3 text-[13px] transition-colors',
                      active ? 'text-fg' : 'text-fg-2 hover:text-fg',
                    )}
                  >
                    <MethodBadge method={t.request.method} />
                    <span className="min-w-0 truncate">{tabTitle(t)}</span>
                  </button>
                )}
                {editing !== t.id && (
                  <button
                    type="button"
                    onClick={() => onClose(t.id)}
                    aria-label={`关闭「${tabTitle(t)}」`}
                    title="关闭（中键点击也可以）"
                    className="absolute right-1.5 inline-flex size-5 items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-fill-3 hover:text-fg"
                  >
                    {loading.has(t.id) ? (
                      <span className="size-2 animate-pulse rounded-full bg-accent" />
                    ) : isDirty ? (
                      <>
                        <span
                          className="size-2 rounded-full bg-fg-2 group-hover:hidden"
                          aria-label="未保存"
                        />
                        <X className="hidden size-3 group-hover:block" />
                      </>
                    ) : (
                      <X
                        className={cn(
                          'size-3',
                          !active && 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
                        )}
                      />
                    )}
                  </button>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <motion.button
        type="button"
        onClick={onNew}
        whileTap={{ scale: 0.9 }}
        aria-label="新建请求标签"
        title="新建请求"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-fg-2 shadow-card transition-colors hover:text-fg"
      >
        <Plus className="size-4" />
      </motion.button>
    </div>
  )
}
