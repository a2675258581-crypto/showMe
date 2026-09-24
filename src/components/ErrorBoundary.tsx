import { Component, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

interface State {
  error: Error | null
}

/** 单个工具崩溃时不影响整站 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-line bg-surface px-6 py-14 text-center shadow-card">
        <TriangleAlert className="size-8 text-warning" />
        <div>
          <p className="font-semibold text-fg">这个工具出了点问题</p>
          <p className="mt-1 max-w-md text-sm break-words text-fg-2">{this.state.error.message}</p>
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-fill px-4 text-sm font-medium text-fg hover:bg-fill-3"
        >
          <RotateCcw className="size-4" /> 重试
        </button>
      </div>
    )
  }
}
