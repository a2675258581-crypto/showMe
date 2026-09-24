import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { useIsDark } from '@/hooks/useTheme'
import { cn } from '@/lib/cn'
import { loadLanguage, type EditorLang } from './languages'
import { darkTheme, lightTheme } from './theme'

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  lang?: EditorLang
  readOnly?: boolean
  placeholder?: string
  /** CSS 高度，缺省撑满父元素 */
  height?: string
  minHeight?: string
  maxHeight?: string
  lineNumbers?: boolean
  lineWrapping?: boolean
  className?: string
  /** 额外的 CodeMirror 扩展 */
  extensions?: Extension[]
  autoFocus?: boolean
  'aria-label'?: string
}

/** 带语法高亮的代码编辑器（CodeMirror 6），明暗主题自动切换 */
export function CodeEditor({
  value,
  onChange,
  lang = 'text',
  readOnly,
  placeholder,
  height = '100%',
  minHeight,
  maxHeight,
  lineNumbers = true,
  lineWrapping = true,
  className,
  extensions,
  autoFocus,
  'aria-label': ariaLabel,
}: CodeEditorProps) {
  const dark = useIsDark()
  const [langExt, setLangExt] = useState<Extension[]>([])

  useEffect(() => {
    let alive = true
    loadLanguage(lang).then((ext) => alive && setLangExt(ext))
    return () => {
      alive = false
    }
  }, [lang])

  const exts = useMemo(() => {
    const list: Extension[] = [...langExt]
    if (lineWrapping) list.push(EditorView.lineWrapping)
    if (ariaLabel) list.push(EditorView.contentAttributes.of({ 'aria-label': ariaLabel }))
    if (extensions) list.push(...extensions)
    return list
  }, [langExt, lineWrapping, extensions, ariaLabel])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      height={height}
      minHeight={minHeight}
      maxHeight={maxHeight}
      autoFocus={autoFocus}
      theme={dark ? darkTheme : lightTheme}
      extensions={exts}
      className={cn('h-full text-[13px]', className)}
      basicSetup={{
        lineNumbers,
        foldGutter: lineNumbers,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
        searchKeymap: true,
        bracketMatching: true,
        closeBrackets: !readOnly,
        indentOnInput: true,
        tabSize: 2,
      }}
    />
  )
}
