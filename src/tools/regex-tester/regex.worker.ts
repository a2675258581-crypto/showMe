/** 在 Worker 里执行正则，灾难性回溯时主线程可以直接 terminate */
import { runRegex, type RegexRequest } from '@/lib/regex-tester'

export type WorkerMessage =
  { type: 'started'; id: number } | { type: 'result'; res: ReturnType<typeof runRegex> }

const ctx = self as unknown as {
  postMessage(msg: WorkerMessage): void
  addEventListener(type: 'message', fn: (e: MessageEvent<RegexRequest>) => void): void
}

ctx.addEventListener('message', (e) => {
  ctx.postMessage({ type: 'started', id: e.data.id })
  ctx.postMessage({ type: 'result', res: runRegex(e.data) })
})
