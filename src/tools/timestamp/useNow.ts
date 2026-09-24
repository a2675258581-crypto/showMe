import { useEffect, useState } from 'react'

/**
 * 返回定时刷新的当前时间（毫秒）。
 * interval ≥ 1s 时对齐到整秒边界，避免显示的秒数比真实时间慢半拍；paused 时停止刷新。
 */
export function useNow(intervalMs = 1000, paused = false): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (paused) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const t = Date.now()
      setNow(t)
      const delay = intervalMs >= 1000 ? intervalMs - (t % intervalMs) + 5 : intervalMs
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, 0)
    return () => clearTimeout(timer)
  }, [intervalMs, paused])
  return now
}
