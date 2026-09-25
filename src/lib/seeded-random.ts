/**
 * 可复现的伪随机数（Park–Miller 最小标准生成器）。
 * 页面里的粒子（落叶、星星）用固定种子生成位置：每次渲染结果一致，
 * 也避免在 render 期间调用 Math.random 造成服务端 / 严格模式下的不一致。
 */
export function seededRandom(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483647
  if (s === 0) s = 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** 用固定种子生成 n 个 [0, 1) 区间的数 */
export function seededSequence(seed: number, n: number): number[] {
  const next = seededRandom(seed)
  return Array.from({ length: n }, () => next())
}
