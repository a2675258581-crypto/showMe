import { useEffect, useRef, useState } from 'react'
import { runRegex, type RegexRequest, type RegexResponse } from '@/lib/regex-tester'
import type { WorkerMessage } from './regex.worker'

/** 单次匹配允许的最长执行时间 */
export const REGEX_TIMEOUT = 1000
/** Worker 启动（首次加载模块）的宽限时间 */
const STARTUP_TIMEOUT = 8000

export type RegexInput = Omit<RegexRequest, 'id'>

interface RunnerState {
  /** 这份结果对应的请求（按引用比较） */
  req: RegexInput | null
  res: RegexResponse | null
  timedOut: boolean
}

function createWorker(): Worker | null {
  try {
    return new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

/**
 * 在 Web Worker 中执行正则。超过 1 秒直接 terminate 并报告超时，页面永远不会卡死。
 * 新请求到来时如果上一次还在跑，也会直接终止旧 Worker。
 */
export function useRegexRunner(req: RegexInput | null) {
  const workerRef = useRef<Worker | null>(null)
  const busyRef = useRef(false)
  const seq = useRef(0)
  const [state, setState] = useState<RunnerState>({ req: null, res: null, timedOut: false })

  useEffect(() => {
    if (!req) return
    const id = ++seq.current
    const worker = workerRef.current ?? createWorker()
    workerRef.current = worker

    // 极少数环境不支持 module worker：退回主线程（下一帧执行，不阻塞本次渲染）
    if (!worker) {
      const t = setTimeout(() => setState({ req, res: runRegex({ ...req, id }), timedOut: false }))
      return () => clearTimeout(t)
    }

    const w = worker
    busyRef.current = true
    let timer = setTimeout(() => kill(), STARTUP_TIMEOUT)
    const kill = () => {
      w.terminate()
      if (workerRef.current === w) workerRef.current = null
      busyRef.current = false
      setState({ req, res: null, timedOut: true })
    }
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'started') {
        if (msg.id !== id) return
        clearTimeout(timer)
        timer = setTimeout(kill, REGEX_TIMEOUT)
        return
      }
      if (msg.res.id !== id) return
      clearTimeout(timer)
      busyRef.current = false
      setState({ req, res: msg.res, timedOut: false })
    }
    w.onerror = (e) => {
      e.preventDefault()
      clearTimeout(timer)
      w.terminate()
      if (workerRef.current === w) workerRef.current = null
      busyRef.current = false
      setState({
        req,
        res: { id, ok: false, error: `匹配出错：${e.message || '后台线程异常退出'}` },
        timedOut: false,
      })
    }
    w.postMessage({ ...req, id } satisfies RegexRequest)
    return () => {
      clearTimeout(timer)
      // 请求已过期而旧任务还在跑：直接终止，避免后台空耗 CPU
      if (busyRef.current) {
        w.terminate()
        if (workerRef.current === w) workerRef.current = null
        busyRef.current = false
      }
    }
  }, [req])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    [],
  )

  return {
    res: state.res,
    timedOut: state.timedOut,
    /** 当前请求还没有结果 */
    pending: !!req && state.req !== req,
    /** 已有结果对应的请求 */
    resultReq: state.req,
  }
}
