import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Home, LayoutGrid, Monitor, Moon, Search, Sun } from 'lucide-react'
import { useRecent } from '@/hooks/useFavorites'
import { useHotkey } from '@/hooks/useHotkey'
import { useTheme } from '@/hooks/useTheme'
import { CATEGORIES } from '@/tools/categories'
import { TOOL_MAP, TOOLS } from '@/tools/registry'
import { ToolIcon } from './ToolIcon'
import { Kbd } from './ui'

const PaletteContext = createContext<{ open: () => void }>({ open: () => {} })

export function usePalette() {
  return useContext(PaletteContext)
}

/** 类 Spotlight 的全局搜索（⌘K / Ctrl+K / “/”） */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openPalette = useCallback(() => setOpen(true), [])

  useHotkey('mod+k', (e) => {
    e.preventDefault()
    setOpen((o) => !o)
  })
  useHotkey(
    '/',
    (e) => {
      e.preventDefault()
      setOpen(true)
    },
    { allowInInput: false },
  )

  return (
    <PaletteContext.Provider value={{ open: openPalette }}>
      {children}
      <AnimatePresence>{open && <Palette onClose={() => setOpen(false)} />}</AnimatePresence>
    </PaletteContext.Provider>
  )
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const recent = useRecent()
  const theme = useTheme()
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const recentTools = recent.ids.map((id) => TOOL_MAP[id]).filter(Boolean)

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm dark:bg-black/50" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="搜索工具"
        initial={{ opacity: 0, scale: 0.94, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
        className="relative w-full max-w-[640px] overflow-hidden rounded-[22px] border border-line bg-surface/85 shadow-float backdrop-blur-2xl backdrop-saturate-150"
      >
        <Command label="搜索工具" loop>
          <div className="flex items-center gap-3 border-b border-line px-5">
            <Search className="size-5 shrink-0 text-fg-3" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="搜索工具，例如 json、md5、时间戳…"
              className="h-16 w-full bg-transparent text-lg text-fg outline-none placeholder:text-fg-3"
            />
            <Kbd>esc</Kbd>
          </div>
          <Command.List className="thin-scrollbar max-h-[min(60vh,440px)] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-3">
            <Command.Empty className="py-12 text-center text-sm text-fg-2">没有找到相关工具</Command.Empty>

            {!query && recentTools.length > 0 && (
              <Command.Group heading="最近使用">
                {recentTools.map((t) => (
                  <ToolItem key={`recent-${t.id}`} id={t.id} value={`recent ${t.id}`} onSelect={() => go(`/t/${t.id}`)} />
                ))}
              </Command.Group>
            )}

            {CATEGORIES.map((c) => (
              <Command.Group key={c.id} heading={c.name}>
                {TOOLS.filter((t) => t.category === c.id).map((t) => (
                  <ToolItem key={t.id} id={t.id} value={t.id} onSelect={() => go(`/t/${t.id}`)} />
                ))}
              </Command.Group>
            ))}

            <Command.Group heading="操作">
              <ActionItem icon={<Home />} label="回到首页" value="home 首页 主页" onSelect={() => go('/')} />
              <ActionItem icon={<LayoutGrid />} label="全部工具" value="all tools 全部工具" onSelect={() => go('/tools')} />
              <ActionItem icon={<Sun />} label="浅色模式" value="light theme 浅色 主题" onSelect={() => (theme.setPref('light'), onClose())} />
              <ActionItem icon={<Moon />} label="深色模式" value="dark theme 深色 主题 暗色" onSelect={() => (theme.setPref('dark'), onClose())} />
              <ActionItem icon={<Monitor />} label="跟随系统外观" value="system theme 系统 主题" onSelect={() => (theme.setPref('system'), onClose())} />
            </Command.Group>
          </Command.List>
          <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[11px] text-fg-3">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> 选择
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>
                <CornerDownLeft className="size-3" />
              </Kbd>
              打开
            </span>
          </div>
        </Command>
      </motion.div>
    </motion.div>
  )
}

const itemClass =
  'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-fg transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-white [&[data-selected=true]_.sub]:text-white/75'

function ToolItem({ id, value, onSelect }: { id: string; value: string; onSelect: () => void }) {
  const t = TOOL_MAP[id]
  return (
    <Command.Item value={value} keywords={[t.name, ...t.keywords, t.description]} onSelect={onSelect} className={itemClass}>
      <ToolIcon tool={t} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t.name}</div>
        <div className="sub truncate text-xs text-fg-2">{t.description}</div>
      </div>
    </Command.Item>
  )
}

function ActionItem({
  icon,
  label,
  value,
  onSelect,
}: {
  icon: ReactNode
  label: string
  value: string
  onSelect: () => void
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={itemClass}>
      <span className="flex size-8 items-center justify-center rounded-[9px] bg-fill [&_svg]:size-4">{icon}</span>
      <span className="font-medium">{label}</span>
    </Command.Item>
  )
}
