import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Lenis from 'lenis'
import { MotionConfig, motion } from 'motion/react'
import { ChevronLeft } from 'lucide-react'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { cn } from '@/lib/cn'
import { ChapterRail, type RailItem } from './ChapterRail'
import { FINALE, PROLOGUE, SCENES, UI, type SceneTone } from './poem'
import { InkDefs, PaperGrain } from './primitives'
import { Bridge } from './scenes/Bridge'
import { Finale } from './scenes/Finale'
import { Lamp } from './scenes/Lamp'
import { Prologue } from './scenes/Prologue'
import { Rain } from './scenes/Rain'
import { River } from './scenes/River'
import { Stars } from './scenes/Stars'
import { Wind } from './scenes/Wind'
import './jianghu.css'

const RAIL: RailItem[] = [
  { id: 'prologue', label: UI.rail.prologue, title: PROLOGUE.label },
  ...SCENES.map((s, i) => ({
    id: s.id,
    label: UI.rail.acts[i],
    title: `${s.chapter} · ${s.name}`,
  })),
  { id: 'finale', label: UI.rail.finale, title: `${FINALE.chapter} · ${FINALE.name}` },
]

const TONES: Record<string, SceneTone> = {
  prologue: 'day',
  finale: 'dawn',
  ...Object.fromEntries(SCENES.map((s) => [s.id, s.tone])),
}

/**
 * 《临江仙 · 江湖》：一首词，七幕水墨长卷。
 * 独立于全站布局（没有工具导航与页脚），自带顶栏、章节轨道与顺滑滚动。
 */
export default function JianghuPage() {
  const [active, setActive] = useState('prologue')
  const lenis = useRef<Lenis | null>(null)

  useEffect(() => {
    document.title = '临江仙 · 江湖 · showMe'
    window.scrollTo(0, 0)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const l = new Lenis({ autoRaf: true, lerp: 0.1, wheelMultiplier: 0.9 })
    lenis.current = l
    return () => {
      l.destroy()
      lenis.current = null
      // 离开时把滚动位置归零，回到首页不至于停在页脚
      window.scrollTo(0, 0)
    }
  }, [])

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    if (lenis.current) lenis.current.scrollTo(el, { duration: 1.6 })
    else el.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const tone = TONES[active] ?? 'day'

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 }}
        className={cn(
          'jianghu jh-song relative overflow-x-clip bg-(--jh-paper) transition-colors duration-700',
          `jh-tone-${tone}`,
        )}
      >
        <InkDefs />
        <PaperGrain />
        <TopBar />
        <ChapterRail items={RAIL} label={UI.rail.navLabel} activeId={active} onSelect={scrollTo} />

        <Prologue onActive={setActive} />
        <Wind scene={SCENES[0]} onActive={setActive} />
        <Rain scene={SCENES[1]} onActive={setActive} />
        <Bridge scene={SCENES[2]} onActive={setActive} />
        <River scene={SCENES[3]} onActive={setActive} />
        <Lamp scene={SCENES[4]} onActive={setActive} />
        <Stars scene={SCENES[5]} onActive={setActive} />
        <Finale onActive={setActive} onAgain={() => scrollTo('prologue')} />
      </motion.div>
    </MotionConfig>
  )
}

/**
 * 本页专用顶栏：左边回站点首页，右边切换外观。
 * 幕与幕之间底色从纸到夜来回切换，顶栏正好压在两幕的接缝上，
 * 所以不按幕的色调取色，而是用 difference 混合：白字与底色相减，纸上成墨、夜里成白。
 */
function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between px-3 mix-blend-difference sm:px-5">
      <Link
        to="/"
        className="flex items-center gap-0.5 rounded-full py-1 pr-3 pl-1.5 font-sans text-[13px] font-medium tracking-tight text-white opacity-75 transition-opacity duration-300 hover:opacity-100"
      >
        <ChevronLeft className="size-4" />
        showMe
      </Link>
      <div className="opacity-75 transition-opacity duration-300 hover:opacity-100 [&>button]:text-white [&>button:hover]:bg-transparent [&>button:hover]:text-white">
        <ThemeToggle />
      </div>
    </header>
  )
}
