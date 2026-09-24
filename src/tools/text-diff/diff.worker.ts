/** 在 Worker 里计算文本差异，超大 / 重排严重的文本也不会卡住页面 */
import { safeDiff, type DiffRequest, type DiffResponse } from './safeDiff'

const ctx = self as unknown as {
  postMessage(msg: DiffResponse): void
  addEventListener(type: 'message', fn: (e: MessageEvent<DiffRequest>) => void): void
}

ctx.addEventListener('message', (e) => {
  const { id, left, right, opts, timeoutMs } = e.data
  ctx.postMessage({ id, result: safeDiff(left, right, opts, timeoutMs) })
})
