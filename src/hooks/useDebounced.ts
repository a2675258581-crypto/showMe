import { useEffect, useState } from 'react'

/** 返回延迟 ms 后才更新的值，用于输入即时计算但较重的场景 */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
