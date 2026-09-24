import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, Search } from 'lucide-react'
import { usePalette } from '@/components/CommandPalette'
import { ToolIcon } from '@/components/ToolIcon'
import { Kbd } from '@/components/ui'
import { modKey } from '@/hooks/useHotkey'
import { cn } from '@/lib/cn'
import { CATEGORIES } from '@/tools/categories'
import { toolsByCategory } from '@/tools/registry'
import type { CategoryId } from '@/tools/types'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

export const NAV_HEIGHT = 48

/**
 * 苹果官网式全局导航：毛玻璃顶栏；桌面端悬停分类展开整宽下拉面板（内容依次浮现、页面变模糊），
 * 移动端汉堡按钮变形为 ×，全屏菜单逐项滑入。
 */
export function GlobalNav() {
  const palette = usePalette()
  const location = useLocation()
  const [flyout, setFlyout] = useState<CategoryId | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 路由变化时收起所有菜单（渲染期间调整 state，避免 effect 里 setState）
  const locKey = location.pathname + location.search
  const [prevLoc, setPrevLoc] = useState(locKey)
  if (prevLoc !== locKey) {
    setPrevLoc(locKey)
    setFlyout(null)
    setMobileOpen(false)
  }

  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  const openFlyout = (id: CategoryId) => {
    clearTimeout(closeTimer.current)
    setFlyout(id)
  }
  const scheduleClose = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setFlyout(null), 120)
  }

  return (
    <>
      {/* 下拉展开时整页模糊 */}
      <AnimatePresence>
        {flyout && (
          <motion.div
            key="nav-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-40 bg-bg/30 backdrop-blur-xl"
            onMouseEnter={scheduleClose}
          />
        )}
      </AnimatePresence>

      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-300',
          flyout || mobileOpen ? 'bg-surface' : 'glass',
          scrolled || flyout ? 'border-b border-line' : 'border-b border-transparent',
        )}
        onMouseLeave={scheduleClose}
      >
        <nav className="mx-auto flex h-12 max-w-[1080px] items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />

          <ul className="hidden items-center gap-1 md:flex">
            <li>
              <NavLink to="/tools" onMouseEnter={scheduleClose} active={location.pathname === '/tools' && !location.search}>
                全部工具
              </NavLink>
            </li>
            {CATEGORIES.map((c) => (
              <li key={c.id} onMouseEnter={() => openFlyout(c.id)}>
                <NavLink
                  to={`/tools?c=${c.id}`}
                  active={flyout === c.id || location.search === `?c=${c.id}`}
                  onFocus={() => openFlyout(c.id)}
                >
                  {c.name.replace('与安全', '').replace('与 API', '')}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={palette.open}
              onMouseEnter={scheduleClose}
              className="flex h-8 items-center gap-2 rounded-full px-2 text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg md:bg-fill-2 md:pr-1.5 md:pl-3"
              aria-label="搜索工具"
            >
              <Search className="size-[17px]" />
              <span className="hidden text-xs lg:inline">搜索工具</span>
              <span className="hidden items-center gap-0.5 md:flex">
                <Kbd>{modKey}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <ThemeToggle />
            <Hamburger open={mobileOpen} onClick={() => setMobileOpen((o) => !o)} />
          </div>
        </nav>

        {/* 桌面端下拉面板 */}
        <AnimatePresence>
          {flyout && (
            <motion.div
              key="flyout"
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="hidden overflow-hidden md:block"
              onMouseEnter={() => clearTimeout(closeTimer.current)}
            >
              <Flyout id={flyout} />
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* 移动端全屏菜单 */}
      <AnimatePresence>{mobileOpen && <MobileMenu onSearch={() => (setMobileOpen(false), palette.open())} />}</AnimatePresence>
    </>
  )
}

function NavLink({
  to,
  active,
  children,
  onMouseEnter,
  onFocus,
}: {
  to: string
  active?: boolean
  children: React.ReactNode
  onMouseEnter?: () => void
  onFocus?: () => void
}) {
  return (
    <Link
      to={to}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs transition-colors duration-200',
        active ? 'text-fg' : 'text-fg-2 hover:text-fg',
      )}
    >
      {children}
    </Link>
  )
}

function Flyout({ id }: { id: CategoryId }) {
  const cat = CATEGORIES.find((c) => c.id === id)!
  const tools = toolsByCategory(id)
  return (
    <div className="mx-auto grid max-w-[1080px] gap-10 px-6 pt-8 pb-12 md:grid-cols-[1.1fr_2fr]">
      <motion.div
        key={`${id}-intro`}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <div className="mb-2 text-xs font-medium text-fg-3">探索{cat.name}</div>
        <div className="text-2xl font-semibold tracking-tight text-fg">{cat.tagline}</div>
        <Link to={`/tools?c=${id}`} className="mt-4 inline-flex items-center gap-1 text-sm text-link hover:underline">
          查看全部 {tools.length} 款 <ChevronRight className="size-3.5" />
        </Link>
      </motion.div>
      <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {tools.map((t, i) => (
          <motion.li
            key={`${id}-${t.id}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06 + i * 0.03 }}
          >
            <Link
              to={`/t/${t.id}`}
              className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-fill-2"
            >
              <ToolIcon tool={t} size="sm" />
              <span className="text-[15px] font-semibold text-fg">{t.name}</span>
            </Link>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

function Hamburger({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? '关闭菜单' : '打开菜单'}
      aria-expanded={open}
      className="relative flex size-8 items-center justify-center rounded-full text-fg md:hidden"
    >
      <motion.span
        className="absolute h-[1.5px] w-[17px] rounded-full bg-current"
        animate={open ? { y: 0, rotate: 45 } : { y: -3.5, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
      <motion.span
        className="absolute h-[1.5px] w-[17px] rounded-full bg-current"
        animate={open ? { y: 0, rotate: -45 } : { y: 3.5, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
    </button>
  )
}

function MobileMenu({ onSearch }: { onSearch: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="fixed inset-x-0 top-12 bottom-0 z-40 overflow-y-auto bg-surface px-8 pt-6 pb-16 md:hidden"
    >
      <button
        type="button"
        onClick={onSearch}
        className="mb-6 flex w-full items-center gap-3 rounded-2xl bg-fill-2 px-4 py-3 text-fg-2"
      >
        <Search className="size-5" /> 搜索工具
      </button>
      <ul className="flex flex-col gap-1">
        {[{ to: '/tools', label: '全部工具' }, ...CATEGORIES.map((c) => ({ to: `/tools?c=${c.id}`, label: c.name }))].map(
          (item, i) => (
            <motion.li
              key={item.to}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4, delay: 0.04 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link to={item.to} className="block py-2 text-[28px] font-semibold tracking-tight text-fg">
                {item.label}
              </Link>
            </motion.li>
          ),
        )}
      </ul>
    </motion.div>
  )
}
