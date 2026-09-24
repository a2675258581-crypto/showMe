import { useEffect } from 'react'
import Lenis from 'lenis'
import { Bento } from './home/Bento'
import { CategoryRail } from './home/CategoryRail'
import { FinalCta } from './home/FinalCta'
import { Hero } from './home/Hero'
import { Keyboard } from './home/Keyboard'
import { Marquee } from './home/Marquee'
import { Privacy } from './home/Privacy'
import { ScrollText } from './home/ScrollText'
import { Stats } from './home/Stats'

/** 首页：仿苹果产品发布页的叙事式长页面 */
export default function Home() {
  // 首页启用顺滑滚动（减少动态效果时不启用）
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ autoRaf: true, lerp: 0.12, wheelMultiplier: 0.9 })
    return () => lenis.destroy()
  }, [])

  return (
    <div className="overflow-x-clip">
      <Hero />
      <ScrollText />
      <Stats />
      <Bento />
      <Marquee />
      <CategoryRail />
      <Privacy />
      <Keyboard />
      <FinalCta />
    </div>
  )
}
