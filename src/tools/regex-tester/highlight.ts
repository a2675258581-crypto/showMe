import { EditorSelection, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import type { RegexMatch } from '@/lib/regex-tester'

/** 捕获组的配色（与匹配列表一致） */
export const GROUP_COLORS = [
  'var(--sys-green)',
  'var(--sys-purple)',
  'var(--sys-pink)',
  'var(--sys-teal)',
  'var(--sys-indigo)',
]

export interface MatchPayload {
  matches: RegexMatch[]
  /** 鼠标悬停 / 选中的匹配序号，-1 表示无 */
  active: number
}

/** 组件与 CodeMirror 之间的桥 */
export interface HighlightHandle {
  view: EditorView | null
  pending: MatchPayload | null
}

export function createHighlightHandle(): HighlightHandle {
  return { view: null, pending: null }
}

const setMatches = StateEffect.define<MatchPayload | null>()

class EmptyMatch extends WidgetType {
  constructor(readonly cls: string) {
    super()
  }
  eq(other: EmptyMatch) {
    return other.cls === this.cls
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = `cm-rx-empty ${this.cls}`
    el.setAttribute('aria-hidden', 'true')
    return el
  }
}

function build(len: number, payload: MatchPayload | null): DecorationSet {
  if (!payload || !payload.matches.length) return Decoration.none
  const ranges = []
  for (const m of payload.matches) {
    if (m.end > len) break
    const cls = `cm-rx-m${m.n % 2}${m.n === payload.active ? ' cm-rx-active' : ''}`
    if (m.start === m.end) {
      ranges.push(Decoration.widget({ widget: new EmptyMatch(cls), side: 1 }).range(m.start))
    } else {
      ranges.push(Decoration.mark({ class: `cm-rx-match ${cls}` }).range(m.start, m.end))
    }
    for (const g of m.groups) {
      if (g.start === null || g.end === null || g.end <= g.start || g.end > len) continue
      ranges.push(
        Decoration.mark({ class: `cm-rx-g cm-rx-g${(g.index - 1) % GROUP_COLORS.length}` }).range(
          g.start,
          g.end,
        ),
      )
    }
  }
  return Decoration.set(ranges, true)
}

const matchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setMatches)) return build(tr.state.doc.length, e.value)
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const theme = EditorView.baseTheme({
  '.cm-rx-match': { borderRadius: '3px', transition: 'outline-color .15s' },
  '.cm-rx-m0': { backgroundColor: 'color-mix(in srgb, var(--sys-blue) 22%, transparent)' },
  '.cm-rx-m1': { backgroundColor: 'color-mix(in srgb, var(--sys-orange) 28%, transparent)' },
  '.cm-rx-active': { outline: '2px solid var(--accent)', outlineOffset: '0px' },
  '.cm-rx-empty': {
    display: 'inline-block',
    width: '2px',
    height: '1.1em',
    verticalAlign: 'text-bottom',
    margin: '0 -1px',
    borderRadius: '1px',
    backgroundColor: 'var(--sys-orange)',
  },
  '.cm-rx-empty.cm-rx-m0': { backgroundColor: 'var(--sys-blue)' },
  ...Object.fromEntries(
    GROUP_COLORS.map((c, i) => [
      `.cm-rx-g${i}`,
      {
        boxShadow: `inset 0 -2px 0 ${c}`,
        backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`,
      },
    ]),
  ),
})

/** 高亮扩展：记录 EditorView 引用，视图就绪时补上尚未应用的结果 */
export function highlightExtensions(handle: HighlightHandle): Extension[] {
  const plugin = ViewPlugin.define((view) => {
    handle.view = view
    if (handle.pending) {
      const p = handle.pending
      queueMicrotask(() => {
        if (handle.view === view) view.dispatch({ effects: setMatches.of(p) })
      })
    }
    return {
      destroy() {
        if (handle.view === view) handle.view = null
      },
    }
  })
  return [matchField, theme, plugin]
}

/**
 * 应用匹配结果。text 是这份结果对应的文本：编辑器内容已经变了就先不刷新，
 * 旧高亮会随编辑自动平移，等下一份结果到来。
 */
export function showMatches(handle: HighlightHandle, payload: MatchPayload | null, text: string) {
  handle.pending = payload
  const view = handle.view
  if (!view) return
  const doc = view.state.doc
  if (payload && (doc.length !== text.length || doc.toString() !== text)) return
  view.dispatch({ effects: setMatches.of(payload) })
}

/** 选中并滚动到某个匹配 */
export function revealRange(handle: HighlightHandle, start: number, end: number) {
  const view = handle.view
  if (!view || end > view.state.doc.length) return
  view.dispatch({
    selection: EditorSelection.range(start, end),
    effects: EditorView.scrollIntoView(start, { y: 'center' }),
  })
  view.focus()
}
