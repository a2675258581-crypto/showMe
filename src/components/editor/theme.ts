import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/** 仿 Xcode 默认配色的语法高亮 */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#9b2393', fontWeight: '600' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#c41a16' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#1c00cf' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#5d6c79', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace], color: '#0b4f79' },
  { tag: [t.propertyName, t.attributeName], color: '#326d74' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#326d74' },
  { tag: [t.tagName, t.angleBracket], color: '#9b2393' },
  { tag: [t.attributeValue], color: '#c41a16' },
  { tag: [t.heading], color: '#0b4f79', fontWeight: '700' },
  { tag: [t.link, t.url], color: '#0e0eff', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.meta, t.processingInstruction], color: '#643820' },
  { tag: t.invalid, color: '#ff3b30' },
])

const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#ff7ab2', fontWeight: '600' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#ff8170' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d9c97c' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7f8c98', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace], color: '#5dd8ff' },
  { tag: [t.propertyName, t.attributeName], color: '#67b7a4' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#67b7a4' },
  { tag: [t.tagName, t.angleBracket], color: '#ff7ab2' },
  { tag: [t.attributeValue], color: '#ff8170' },
  { tag: [t.heading], color: '#5dd8ff', fontWeight: '700' },
  { tag: [t.link, t.url], color: '#6699ff', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.meta, t.processingInstruction], color: '#fd8f3f' },
  { tag: t.invalid, color: '#ff453a' },
])

function base(dark: boolean) {
  return EditorView.theme(
    {
      '&': { color: 'var(--fg)', backgroundColor: 'transparent' },
      '.cm-content': { caretColor: 'var(--accent)', padding: '12px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: dark ? 'rgb(10 132 255 / 0.35) !important' : 'rgb(0 113 227 / 0.2) !important',
      },
      '.cm-matchingBracket': { backgroundColor: 'var(--fill-3)', outline: 'none' },
      '.cm-searchMatch': { backgroundColor: 'rgb(255 214 10 / 0.4)' },
      '.cm-foldPlaceholder': { background: 'var(--fill)', border: 'none', color: 'var(--fg-2)' },
      '.cm-tooltip': {
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: '10px',
        boxShadow: 'var(--shadow-float)',
      },
      '.cm-panels': { background: 'var(--surface-2)', color: 'var(--fg)' },
      '.cm-line': { padding: '0 14px 0 6px' },
    },
    { dark },
  )
}

export const lightTheme: Extension = [base(false), syntaxHighlighting(lightHighlight)]
export const darkTheme: Extension = [base(true), syntaxHighlighting(darkHighlight)]
