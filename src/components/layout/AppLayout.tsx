import { useEffect } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { CommandPaletteProvider } from '@/components/CommandPalette'
import { ToastProvider } from '@/components/ui'
import { Footer } from './Footer'
import { GlobalNav } from './GlobalNav'

/** 路由切换：旧页面淡出，新页面从轻微模糊中浮现 */
function AnimatedOutlet() {
  const location = useLocation()
  const outlet = useOutlet()
  return (
    <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
        exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.16, ease: 'easeIn' } }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  )
}

function TitleSync() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname === '/') document.title = 'showMe · 开发者百宝箱'
    else if (pathname === '/tools') document.title = '全部工具 · showMe'
  }, [pathname])
  return null
}

export function AppLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <CommandPaletteProvider>
          <TitleSync />
          <GlobalNav />
          <main className="min-h-[calc(100dvh-48px)] pt-12">
            <AnimatedOutlet />
          </main>
          <Footer />
        </CommandPaletteProvider>
      </ToastProvider>
    </MotionConfig>
  )
}
