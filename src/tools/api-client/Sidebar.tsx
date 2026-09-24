import { useMemo, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  History,
  Inbox,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button, SegmentedControl } from '@/components/ui'
import { requestLabel } from '@/lib/api-client'
import {
  groupHistory,
  searchHistory,
  type Collection,
  type HistoryEntry,
} from '@/lib/api-client-store'
import { formatDuration, STATUS_COLORS, statusTone } from '@/lib/api-client-response'
import { cn } from '@/lib/cn'
import { MethodBadge, TONE_TEXT, toneStyle } from './MethodBadge'

export type SidebarTab = 'history' | 'collections'

const subscribeMinute = (cb: () => void) => {
  const t = setInterval(cb, 30_000)
  return () => clearInterval(t)
}
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000

const pad = (n: number) => String(n).padStart(2, '0')
function timeLabel(t: number, withDate: boolean): string {
  const d = new Date(t)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withDate ? `${d.getMonth() + 1}月${d.getDate()}日 ${hm}` : hm
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export interface SidebarProps {
  tab: SidebarTab
  onTab: (t: SidebarTab) => void
  history: HistoryEntry[]
  onOpenHistory: (e: HistoryEntry) => void
  onDeleteHistory: (id: string) => void
  onClearHistory: () => void
  collections: Collection[]
  activeSource?: { collectionId: string; requestId: string }
  onOpenSaved: (collectionId: string, requestId: string) => void
  onNewCollection: (name: string) => void
  onRenameCollection: (id: string, name: string) => void
  onDeleteCollection: (id: string) => void
  onRenameSaved: (collectionId: string, requestId: string, name: string) => void
  onDeleteSaved: (collectionId: string, requestId: string) => void
}

/** 左侧栏：历史记录 / 集合 */
export function Sidebar(props: SidebarProps) {
  const { tab, onTab, history, collections } = props
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3 pb-2">
        <SegmentedControl
          block
          size="sm"
          aria-label="侧栏内容"
          value={tab}
          onChange={onTab}
          options={[
            { value: 'history', label: `历史${history.length ? ` · ${history.length}` : ''}` },
            {
              value: 'collections',
              label: `集合${collections.length ? ` · ${collections.length}` : ''}`,
            },
          ]}
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          className="flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, x: tab === 'history' ? -8 : 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          {tab === 'history' ? <HistoryList {...props} /> : <CollectionList {...props} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ───────────────────────────── 历史 ─────────────────────────────

function HistoryList({ history, onOpenHistory, onDeleteHistory, onClearHistory }: SidebarProps) {
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow)
  const groups = useMemo(
    () => groupHistory(searchHistory(history, query), now),
    [history, query, now],
  )

  return (
    <>
      <div className="flex items-center gap-2 px-3 pb-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 URL、方法、状态码"
            aria-label="搜索历史"
            className="h-8 w-full rounded-full bg-fill pr-3 pl-8 text-xs text-fg placeholder:text-fg-3 outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>
        {history.length > 0 &&
          (confirmClear ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                onClearHistory()
                setConfirmClear(false)
              }}
              onBlur={() => setConfirmClear(false)}
              autoFocus
            >
              确认清空
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 />}
              iconOnly
              aria-label="清空历史"
              title="清空历史"
              onClick={() => setConfirmClear(true)}
            />
          ))}
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-lenis-prevent>
        {!history.length ? (
          <SideEmpty icon={<History />} text="发送过的请求会自动记录在这里（最多 200 条）" />
        ) : !groups.length ? (
          <SideEmpty icon={<Search />} text={`没有找到「${query}」`} />
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-2">
              <h4 className="sticky top-0 z-10 bg-surface px-2 py-1.5 text-[11px] font-semibold tracking-wide text-fg-3">
                {g.label}
              </h4>
              <AnimatePresence initial={false}>
                {g.items.map((e) => {
                  const url = e.resolvedUrl || e.request.url
                  return (
                    <motion.div
                      key={e.id}
                      layout="position"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      className="group relative"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenHistory(e)}
                        title={url}
                        className="flex w-full min-w-0 items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-fill-2 pointer-coarse:pr-9"
                      >
                        <MethodBadge
                          method={e.request.method}
                          className="mt-0.5 w-9 justify-start"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[12px] text-fg">
                            {requestLabel({ url })}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-3">
                            <span className="truncate">{hostOf(url)}</span>
                            <span className="shrink-0">
                              · {timeLabel(e.time, g.label === '更早')}
                            </span>
                            {e.timeMs !== undefined && (
                              <span className="shrink-0 tabular-nums">
                                · {formatDuration(e.timeMs)}
                              </span>
                            )}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'mt-0.5 shrink-0 font-mono text-[11px] font-semibold tabular-nums transition-opacity pointer-fine:group-hover:opacity-0',
                            TONE_TEXT,
                          )}
                          style={toneStyle(
                            e.status !== undefined
                              ? STATUS_COLORS[statusTone(e.status)]
                              : 'var(--danger)',
                          )}
                          title={e.error}
                        >
                          {e.status ?? '失败'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteHistory(e.id)}
                        aria-label="删除这条历史"
                        title="删除"
                        className="absolute top-1.5 right-1 inline-flex size-7 items-center justify-center rounded-full text-fg-3 opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 pointer-coarse:opacity-100"
                      >
                        <X className="size-3.5" />
                      </button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </section>
          ))
        )}
      </div>
    </>
  )
}

// ───────────────────────────── 集合 ─────────────────────────────

function CollectionList({
  collections,
  activeSource,
  onOpenSaved,
  onNewCollection,
  onRenameCollection,
  onDeleteCollection,
  onRenameSaved,
  onDeleteSaved,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <div className="px-3 pb-2">
        {creating ? (
          <InlineEdit
            initial=""
            placeholder="集合名称，例如「用户服务」"
            onCommit={(name) => {
              if (name.trim()) onNewCollection(name.trim())
              setCreating(false)
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={<FolderPlus />}
            className="w-full"
            onClick={() => setCreating(true)}
          >
            新建集合
          </Button>
        )}
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-lenis-prevent>
        {!collections.length ? (
          <SideEmpty
            icon={<Inbox />}
            text="还没有集合。按「保存」（⌘ / Ctrl + S）把当前请求存进集合，方便以后复用。"
          />
        ) : (
          <AnimatePresence initial={false}>
            {collections.map((c) => {
              const open = !collapsed.has(c.id)
              return (
                <motion.section
                  key={c.id}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-1"
                >
                  <EditableRow
                    label={c.name}
                    onRename={(n) => onRenameCollection(c.id, n)}
                    onDelete={() =>
                      confirmDelete === c.id ? onDeleteCollection(c.id) : setConfirmDelete(c.id)
                    }
                    deleteArmed={confirmDelete === c.id}
                    onDisarm={() => setConfirmDelete(null)}
                    onClick={() => toggle(c.id)}
                    leading={
                      <>
                        <motion.span
                          animate={{ rotate: open ? 90 : 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        >
                          <ChevronRight className="size-3.5 text-fg-3" />
                        </motion.span>
                        <Folder className="size-4 text-accent" />
                      </>
                    }
                    trailing={
                      <span className="text-[11px] text-fg-3 tabular-nums">
                        {c.requests.length}
                      </span>
                    }
                    bold
                  />
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                        className="overflow-hidden pl-5"
                      >
                        {!c.requests.length && (
                          <p className="px-2 py-1.5 text-[11px] text-fg-3">空集合</p>
                        )}
                        {c.requests.map((r) => {
                          const active =
                            activeSource?.collectionId === c.id && activeSource.requestId === r.id
                          const key = `${c.id}/${r.id}`
                          return (
                            <EditableRow
                              key={r.id}
                              label={r.name}
                              active={active}
                              onClick={() => onOpenSaved(c.id, r.id)}
                              onRename={(n) => onRenameSaved(c.id, r.id, n)}
                              onDelete={() =>
                                confirmDelete === key
                                  ? onDeleteSaved(c.id, r.id)
                                  : setConfirmDelete(key)
                              }
                              deleteArmed={confirmDelete === key}
                              onDisarm={() => setConfirmDelete(null)}
                              leading={
                                <MethodBadge
                                  method={r.request.method}
                                  className="w-9 justify-start"
                                />
                              }
                              title={r.request.url}
                            />
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.section>
              )
            })}
          </AnimatePresence>
        )}
      </div>
    </>
  )
}

function EditableRow({
  label,
  leading,
  trailing,
  active,
  bold,
  title,
  deleteArmed,
  onClick,
  onRename,
  onDelete,
  onDisarm,
}: {
  label: string
  leading: React.ReactNode
  trailing?: React.ReactNode
  active?: boolean
  bold?: boolean
  title?: string
  deleteArmed: boolean
  onClick: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onDisarm: () => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <div className="px-1 py-0.5">
        <InlineEdit
          initial={label}
          onCommit={(n) => {
            if (n.trim() && n.trim() !== label) onRename(n.trim())
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-xl transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-fill-2',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={() => setEditing(true)}
        title={title ?? label}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left pointer-coarse:pr-16"
      >
        {leading}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px]',
            bold ? 'font-medium text-fg' : 'text-fg',
            active && 'text-accent',
          )}
        >
          {label}
        </span>
        <span className="transition-opacity group-hover:opacity-0 pointer-coarse:hidden">
          {trailing}
        </span>
      </button>
      <div
        className={cn(
          'absolute right-1 flex items-center gap-0.5 rounded-full bg-surface/90 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
          deleteArmed && 'opacity-100',
        )}
      >
        {!deleteArmed && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`重命名「${label}」`}
            title="重命名"
            className="inline-flex size-7 items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          onBlur={onDisarm}
          aria-label={deleteArmed ? `确认删除「${label}」` : `删除「${label}」`}
          title={deleteArmed ? '再点一次确认删除' : '删除'}
          className={cn(
            'inline-flex h-7 items-center justify-center rounded-full text-xs font-medium transition-colors',
            deleteArmed
              ? 'bg-danger/10 px-2.5 text-danger'
              : 'w-7 text-fg-3 hover:bg-danger/10 hover:text-danger',
          )}
        >
          {deleteArmed ? '确认删除' : <Trash2 className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}

function InlineEdit({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder?: string
  onCommit: (v: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(value)
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        onBlur={() => onCommit(value)}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="名称"
        className="h-8 min-w-0 flex-1 rounded-lg border border-accent bg-surface px-2 text-[13px] text-fg outline-none ring-4 ring-accent/15"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onCommit(value)}
        aria-label="确定"
        className="inline-flex size-7 items-center justify-center rounded-full text-accent hover:bg-accent-soft"
      >
        <Check className="size-3.5" />
      </button>
    </div>
  )
}

function SideEmpty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-fg-3 [&>svg]:size-6">
      {icon}
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  )
}
