import { Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin } from '@codemirror/view'
import { applyFormat, type FormatAction } from '@/lib/markdown-preview-format'

/** 组件与 CodeMirror 之间的桥：拿到 EditorView，并转发滚动事件 */
export interface EditorBridge {
  view: EditorView | null
  onScroll: ((el: HTMLElement) => void) | null
}

export function createBridge(): EditorBridge {
  return { view: null, onScroll: null }
}

export function setScrollListener(bridge: EditorBridge, fn: ((el: HTMLElement) => void) | null) {
  bridge.onScroll = fn
}

/** 在当前选区执行格式化；编辑器未挂载时返回 false */
export function runFormat(bridge: EditorBridge, action: FormatAction): boolean {
  const view = bridge.view
  if (!view) return false
  return formatView(view, action)
}

function formatView(view: EditorView, action: FormatAction): boolean {
  const { from, to } = view.state.selection.main
  const e = applyFormat(view.state.doc.toString(), from, to, action)
  view.dispatch({
    changes: { from: e.from, to: e.to, insert: e.insert },
    selection: { anchor: e.selFrom, head: e.selTo },
    scrollIntoView: true,
    userEvent: 'input.format',
  })
  view.focus()
  return true
}

/** 把编辑器滚动到第 line 行（从 1 开始）并放置光标 */
export function revealLine(bridge: EditorBridge, line: number) {
  const view = bridge.view
  if (!view) return
  const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
  view.dispatch({
    selection: { anchor: l.from },
    effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 12 }),
  })
}

export function bridgeExtensions(bridge: EditorBridge): Extension[] {
  const plugin = ViewPlugin.define((view) => {
    bridge.view = view
    const onScroll = () => bridge.onScroll?.(view.scrollDOM)
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    return {
      destroy() {
        view.scrollDOM.removeEventListener('scroll', onScroll)
        if (bridge.view === view) bridge.view = null
      },
    }
  })
  const keys = Prec.high(
    keymap.of([
      { key: 'Mod-b', run: (v) => formatView(v, 'bold') },
      { key: 'Mod-i', run: (v) => formatView(v, 'italic') },
      { key: 'Mod-Shift-k', run: (v) => formatView(v, 'link') },
      { key: 'Mod-Shift-x', run: (v) => formatView(v, 'strike') },
    ]),
  )
  return [plugin, keys]
}
