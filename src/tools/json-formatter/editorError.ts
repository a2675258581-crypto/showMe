import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { columnToUtf16 } from '@/lib/text-position'

/** 错误位置（行列号从 1 开始，列按码点计） */
export interface ErrorMark {
  line: number
  column: number
}

/** 组件与 CodeMirror 之间的桥：保存 EditorView 引用和当前错误位置 */
export interface EditorHandle {
  view: EditorView | null
  mark: ErrorMark | null
}

export function createEditorHandle(): EditorHandle {
  return { view: null, mark: null }
}

const setErrorMark = StateEffect.define<ErrorMark | null>()

/** 行列号 → 文档位置 */
function markPos(
  state: EditorState,
  mark: ErrorMark,
): { pos: number; lineFrom: number; lineTo: number } {
  const line = state.doc.line(Math.min(Math.max(1, mark.line), state.doc.lines))
  const pos = line.from + Math.min(columnToUtf16(line.text, mark.column), line.length)
  return { pos, lineFrom: line.from, lineTo: line.to }
}

class EolMarker extends WidgetType {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-json-err-eol'
    el.setAttribute('aria-hidden', 'true')
    return el
  }
  eq() {
    return true
  }
}

function build(state: EditorState, mark: ErrorMark | null): DecorationSet {
  if (!mark) return Decoration.none
  const { pos, lineFrom, lineTo } = markPos(state, mark)
  const ranges = [Decoration.line({ class: 'cm-json-err-line' }).range(lineFrom)]
  if (pos < lineTo) {
    const c = state.doc.sliceString(pos, pos + 1).charCodeAt(0)
    const len = c >= 0xd800 && c <= 0xdbff && pos + 2 <= lineTo ? 2 : 1
    ranges.push(Decoration.mark({ class: 'cm-json-err-mark' }).range(pos, pos + len))
  } else {
    ranges.push(Decoration.widget({ widget: new EolMarker(), side: 1 }).range(pos))
  }
  return Decoration.set(ranges, true)
}

const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setErrorMark)) return build(tr.state, e.value)
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const errorTheme = EditorView.baseTheme({
  '.cm-json-err-line': {
    backgroundColor: 'color-mix(in srgb, var(--danger) 9%, transparent)',
  },
  '.cm-json-err-mark': {
    textDecoration: 'underline wavy var(--danger)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
    backgroundColor: 'color-mix(in srgb, var(--danger) 18%, transparent)',
    borderRadius: '2px',
  },
  '.cm-json-err-eol': {
    display: 'inline-block',
    width: '0.55em',
    height: '1.15em',
    marginLeft: '1px',
    verticalAlign: 'text-bottom',
    borderRadius: '2px',
    backgroundColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
  },
})

/** 错误高亮扩展：出错行淡红底色 + 出错字符波浪线；同时把 EditorView 交给 handle */
export function errorExtensions(handle: EditorHandle): Extension[] {
  return [
    errorField,
    errorTheme,
    ViewPlugin.define((view) => {
      handle.view = view
      // 视图晚于错误创建时，补上当前错误标记
      if (handle.mark) {
        queueMicrotask(() => {
          if (handle.view === view) view.dispatch({ effects: setErrorMark.of(handle.mark) })
        })
      }
      return {
        destroy() {
          if (handle.view === view) handle.view = null
        },
      }
    }),
  ]
}

/** 设置（或清除）错误标记 */
export function showErrorMark(handle: EditorHandle, mark: ErrorMark | null) {
  handle.mark = mark
  handle.view?.dispatch({ effects: setErrorMark.of(mark) })
}

/** 把光标移到错误位置并滚动到视野中央 */
export function jumpToMark(handle: EditorHandle, mark: ErrorMark) {
  const view = handle.view
  if (!view) return
  const { pos } = markPos(view.state, mark)
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  })
  view.focus()
  view.dom.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
