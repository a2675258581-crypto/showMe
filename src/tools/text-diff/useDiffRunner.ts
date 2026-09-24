import { useEffect, useRef, useState } from 'react'
import type { DiffOptions, DiffResult } from '@/lib/text-diff'
import { safeDiff, WORKER_TIMEOUT, type DiffRequest, type DiffResponse } from './safeDiff'

export interface DiffInput {
  left: string
  right: string
  opts: DiffOptions
}

function createWorker(): Worker | null {
  try {
    return new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

/**
 * 在 Web Worker 中计算差异：主线程只负责渲染，输入再大也能继续打字。
 * 新请求到来时如果上一次还没算完，直接终止旧 Worker，不让过期任务排队。
 * 首次渲染同步计算一次，避免页面打开时闪一下空状态。
 */
export function useDiffRunner(req: DiffInput) {
  const workerRef = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const seq = useRef(0)
  const [state, setState] = useState<{ req: DiffInput; result: DiffResult }>(() => ({
    req,
    result: safeDiff(req.left, req.right, req.opts),
  }))
  const doneReq = state.req

  useEffect(() => {
    if (doneReq === req) return
    const id = ++seq.current
    const worker = workerRef.current ?? createWorker()
    workerRef.current = worker
    if (!worker) {
      // 不支持 module worker 的环境：退回主线程（下一轮事件循环执行，不阻塞本次渲染）
      const t = setTimeout(() => setState({ req, result: safeDiff(req.left, req.right, req.opts) }))
      return () => clearTimeout(t)
    }
    const w = worker
    busyRef.current = true
    w.onmessage = (e: MessageEvent<DiffResponse>) => {
      if (e.data.id !== id) return
      busyRef.current = false
      setState({ req, result: e.data.result })
    }
    w.onerror = (e) => {
      e.preventDefault()
      w.terminate()
      if (workerRef.current === w) workerRef.current = null
      busyRef.current = false
      setState({
        req,
        result: { ok: false, error: `对比出错：${e.message || '后台线程异常退出'}` },
      })
    }
    w.postMessage({ id, ...req, timeoutMs: WORKER_TIMEOUT } satisfies DiffRequest)
    return () => {
      if (busyRef.current) {
        w.terminate()
        if (workerRef.current === w) workerRef.current = null
        busyRef.current = false
      }
    }
    // doneReq 只用来跳过已经有结果的请求，不作为触发条件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  return { result: state.result, pending: state.req !== req }
}
