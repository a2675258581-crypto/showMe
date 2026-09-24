import type { Extension } from '@codemirror/state'

export type EditorLang =
  | 'text'
  | 'json'
  | 'xml'
  | 'html'
  | 'vue'
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'css'
  | 'scss'
  | 'less'
  | 'sql'
  | 'markdown'
  | 'yaml'
  | 'graphql'

const cache = new Map<EditorLang, Promise<Extension[]>>()

/** 按需加载语言包，避免把所有语法高亮都打进首屏 */
export function loadLanguage(lang: EditorLang): Promise<Extension[]> {
  let p = cache.get(lang)
  if (!p) {
    p = load(lang).catch(() => [])
    cache.set(lang, p)
  }
  return p
}

async function load(lang: EditorLang): Promise<Extension[]> {
  switch (lang) {
    case 'json':
      return [(await import('@codemirror/lang-json')).json()]
    case 'xml':
      return [(await import('@codemirror/lang-xml')).xml()]
    case 'html':
    case 'vue':
      return [(await import('@codemirror/lang-html')).html()]
    case 'javascript':
      return [(await import('@codemirror/lang-javascript')).javascript()]
    case 'jsx':
      return [(await import('@codemirror/lang-javascript')).javascript({ jsx: true })]
    case 'typescript':
      return [(await import('@codemirror/lang-javascript')).javascript({ typescript: true })]
    case 'tsx':
      return [
        (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
      ]
    case 'css':
    case 'scss':
    case 'less':
      return [(await import('@codemirror/lang-css')).css()]
    case 'sql':
      return [(await import('@codemirror/lang-sql')).sql()]
    case 'markdown':
      return [(await import('@codemirror/lang-markdown')).markdown()]
    case 'yaml':
      return [(await import('@codemirror/lang-yaml')).yaml()]
    default:
      return []
  }
}
