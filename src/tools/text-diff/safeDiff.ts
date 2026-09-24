import { computeDiff, type DiffOptions, type DiffResult } from '@/lib/text-diff'

/** 主线程 / Worker 共用的消息格式 */
export interface DiffRequest {
  id: number
  left: string
  right: string
  opts: DiffOptions
  /** 超时（毫秒）：Worker 里不会卡页面，可以比主线程宽松得多 */
  timeoutMs: number
}

/** 主线程回退时的超时：超过就提示，不能让页面卡太久 */
export const MAIN_THREAD_TIMEOUT = 3000
/** Worker 中的超时：页面始终可操作，给重排严重的大文本更多时间 */
export const WORKER_TIMEOUT = 15_000

export interface DiffResponse {
  id: number
  result: DiffResult
}

/** 任何意外异常都转成中文错误，绝不抛出 */
export function safeDiff(
  left: string,
  right: string,
  opts: DiffOptions,
  timeoutMs = MAIN_THREAD_TIMEOUT,
): DiffResult {
  try {
    return computeDiff(left, right, opts, timeoutMs)
  } catch (e) {
    return { ok: false, error: `对比失败：${e instanceof Error ? e.message : String(e)}` }
  }
}
