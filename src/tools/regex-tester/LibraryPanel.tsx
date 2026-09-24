import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BookOpen, Search } from 'lucide-react'
import {
  Badge,
  Input,
  Panel,
  PanelHeader,
  SegmentedControl,
  type SegmentOption,
} from '@/components/ui'
import { REGEX_PRESETS, type RegexPreset } from '@/lib/regex-tester-library'

type GroupFilter = '全部' | RegexPreset['group']

const GROUPS: SegmentOption<GroupFilter>[] = (
  ['全部', '常用', '证件与号码', '网络', '日期时间', '文本', '替换'] as const
).map((g) => ({ value: g, label: g }))

/** 常用正则库 */
export function LibraryPanel({
  currentPattern,
  onPick,
}: {
  currentPattern: string
  onPick: (p: RegexPreset) => void
}) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<GroupFilter>('全部')

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return REGEX_PRESETS.filter(
      (p) =>
        (group === '全部' || p.group === group) &&
        (!kw ||
          p.name.toLowerCase().includes(kw) ||
          p.desc.toLowerCase().includes(kw) ||
          p.pattern.toLowerCase().includes(kw)),
    )
  }, [q, group])

  return (
    <Panel id="regex-library">
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <BookOpen className="size-4 text-accent" />
            常用正则库
            <span className="text-xs font-normal text-fg-3">点击即可载入表达式与示例文本</span>
          </span>
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="no-scrollbar -mx-1 min-w-0 overflow-x-auto px-1">
          <SegmentedControl
            options={GROUPS}
            value={group}
            onChange={setGroup}
            size="sm"
            aria-label="分类"
          />
        </div>
        <div className="relative md:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索：手机号、邮箱、IP…"
            aria-label="搜索常用正则"
            className="h-9 pl-9"
          />
        </div>
      </div>
      <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {list.map((p) => {
            const current = p.pattern === currentPattern
            return (
              <motion.button
                key={p.id}
                type="button"
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onPick(p)}
                className={
                  'group flex min-w-0 flex-col gap-1.5 rounded-2xl border p-4 text-left transition-colors ' +
                  (current
                    ? 'border-accent/50 bg-accent-soft'
                    : 'border-line bg-surface-2 hover:border-accent/40 hover:bg-surface')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-fg">{p.name}</span>
                  <Badge color={p.replacement !== undefined ? 'var(--sys-orange)' : undefined}>
                    {p.replacement !== undefined ? '替换' : p.group}
                  </Badge>
                </div>
                <span className="text-xs leading-relaxed text-fg-2">{p.desc}</span>
                <code className="mt-1 truncate rounded-lg bg-fill-2 px-2 py-1 font-mono text-[12px] text-fg-2 group-hover:text-fg">
                  /{p.pattern}/{p.flags}
                </code>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </motion.div>
      {!list.length && <p className="py-8 text-center text-sm text-fg-3">没有找到相关正则</p>}
    </Panel>
  )
}
