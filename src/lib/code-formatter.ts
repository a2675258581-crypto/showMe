/**
 * 代码格式化（纯逻辑，基于 prettier/standalone）。
 *
 * - 按语言懒加载 prettier 插件（首次使用某种语言时才下载对应解析器）。
 * - HTML / Vue / Markdown 会按内容额外加载内嵌语言的插件（<script lang="ts">、```js 代码块、YAML front matter）。
 * - 根据内容猜测语言（自动识别）。
 * - 解析错误整理成「中文说明 + 行列 + 源码摘录」。
 */
import type { Options, Plugin } from 'prettier'
import { buildFrame, type CodeFrame } from './code-formatter-frame'

export type CodeLang =
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'json'
  | 'json5'
  | 'css'
  | 'scss'
  | 'less'
  | 'html'
  | 'vue'
  | 'angular'
  | 'markdown'
  | 'yaml'
  | 'graphql'

export interface CodeFormatOptions {
  printWidth: 80 | 100 | 120
  tabWidth: 2 | 4
  useTabs: boolean
  semi: boolean
  singleQuote: boolean
  trailingComma: 'all' | 'es5' | 'none'
  bracketSpacing: boolean
}

export type OptionKey = keyof CodeFormatOptions

export const DEFAULT_CODE_OPTIONS: CodeFormatOptions = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: 'all',
  bracketSpacing: true,
}

type PluginName =
  | 'babel'
  | 'estree'
  | 'typescript'
  | 'postcss'
  | 'html'
  | 'angular'
  | 'markdown'
  | 'yaml'
  | 'graphql'

export interface LangDef {
  id: CodeLang
  label: string
  parser: string
  plugins: PluginName[]
  /** 用于 prettier 的虚拟文件名（决定 TS 是否按 JSX 解析等）与下载扩展名 */
  filename: string
  /** 对该语言有效的选项 */
  options: OptionKey[]
}

const COMMON: OptionKey[] = ['printWidth', 'tabWidth', 'useTabs']
const SCRIPT: OptionKey[] = [...COMMON, 'semi', 'singleQuote', 'trailingComma', 'bracketSpacing']

export const LANGS: LangDef[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    parser: 'babel',
    plugins: ['babel', 'estree'],
    filename: 'index.js',
    options: SCRIPT,
  },
  {
    id: 'jsx',
    label: 'JSX',
    parser: 'babel',
    plugins: ['babel', 'estree'],
    filename: 'App.jsx',
    options: SCRIPT,
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    parser: 'typescript',
    plugins: ['typescript', 'estree'],
    filename: 'index.ts',
    options: SCRIPT,
  },
  {
    id: 'tsx',
    label: 'TSX',
    parser: 'typescript',
    plugins: ['typescript', 'estree'],
    filename: 'App.tsx',
    options: SCRIPT,
  },
  {
    id: 'json',
    label: 'JSON',
    parser: 'json',
    plugins: ['babel', 'estree'],
    filename: 'data.json',
    options: [...COMMON, 'bracketSpacing'],
  },
  {
    id: 'json5',
    label: 'JSON5',
    parser: 'json5',
    plugins: ['babel', 'estree'],
    filename: 'config.json5',
    options: [...COMMON, 'singleQuote', 'bracketSpacing'],
  },
  {
    id: 'css',
    label: 'CSS',
    parser: 'css',
    plugins: ['postcss'],
    filename: 'style.css',
    options: [...COMMON, 'singleQuote'],
  },
  {
    id: 'scss',
    label: 'SCSS',
    parser: 'scss',
    plugins: ['postcss'],
    filename: 'style.scss',
    options: [...COMMON, 'singleQuote'],
  },
  {
    id: 'less',
    label: 'Less',
    parser: 'less',
    plugins: ['postcss'],
    filename: 'style.less',
    options: [...COMMON, 'singleQuote'],
  },
  {
    id: 'html',
    label: 'HTML',
    parser: 'html',
    plugins: ['html', 'babel', 'estree', 'postcss'],
    filename: 'index.html',
    options: SCRIPT,
  },
  {
    id: 'vue',
    label: 'Vue',
    parser: 'vue',
    plugins: ['html', 'babel', 'estree', 'postcss'],
    filename: 'App.vue',
    options: SCRIPT,
  },
  {
    id: 'angular',
    label: 'Angular 模板',
    parser: 'angular',
    plugins: ['html', 'angular', 'babel', 'estree', 'postcss'],
    filename: 'app.component.html',
    options: SCRIPT,
  },
  {
    id: 'markdown',
    label: 'Markdown',
    parser: 'markdown',
    plugins: ['markdown'],
    filename: 'README.md',
    options: SCRIPT,
  },
  {
    id: 'yaml',
    label: 'YAML',
    parser: 'yaml',
    plugins: ['yaml'],
    filename: 'config.yaml',
    options: [...COMMON, 'singleQuote', 'bracketSpacing'],
  },
  {
    id: 'graphql',
    label: 'GraphQL',
    parser: 'graphql',
    plugins: ['graphql'],
    filename: 'query.graphql',
    options: [...COMMON, 'bracketSpacing'],
  },
]

export const LANG_MAP = Object.fromEntries(LANGS.map((l) => [l.id, l])) as Record<CodeLang, LangDef>

/* ───────────────────────── 插件懒加载 ───────────────────────── */

const LOADERS: Record<PluginName, () => Promise<Plugin>> = {
  babel: () => import('prettier/plugins/babel') as Promise<Plugin>,
  estree: () => import('prettier/plugins/estree') as Promise<Plugin>,
  typescript: () => import('prettier/plugins/typescript') as Promise<Plugin>,
  postcss: () => import('prettier/plugins/postcss') as Promise<Plugin>,
  html: () => import('prettier/plugins/html') as Promise<Plugin>,
  angular: () => import('prettier/plugins/angular') as Promise<Plugin>,
  markdown: () => import('prettier/plugins/markdown') as Promise<Plugin>,
  yaml: () => import('prettier/plugins/yaml') as Promise<Plugin>,
  graphql: () => import('prettier/plugins/graphql') as Promise<Plugin>,
}

const pluginCache = new Map<PluginName, Promise<Plugin>>()
let prettierPromise: Promise<typeof import('prettier/standalone')> | null = null

function loadPlugin(name: PluginName): Promise<Plugin> {
  let p = pluginCache.get(name)
  if (!p) {
    p = LOADERS[name]().catch((e) => {
      pluginCache.delete(name) // 网络抖动时允许下次重试
      throw e
    })
    pluginCache.set(name, p)
  }
  return p
}

function loadPrettier() {
  if (!prettierPromise) {
    prettierPromise = import('prettier/standalone').catch((e) => {
      prettierPromise = null
      throw e
    })
  }
  return prettierPromise
}

/** 该语言的插件是否都已加载过（用于界面上提示「正在加载格式化器」） */
export function isLangLoaded(lang: CodeLang, code = ''): boolean {
  return prettierPromise !== null && pluginsFor(lang, code).every((p) => pluginCache.has(p))
}

const FENCE_PLUGINS: [RegExp, PluginName[]][] = [
  [/^(js|javascript|jsx|mjs|cjs|json|json5|jsonc)$/i, ['babel', 'estree']],
  [/^(ts|typescript|tsx|mts|cts)$/i, ['typescript', 'estree']],
  [/^(css|scss|less)$/i, ['postcss']],
  [/^(html|vue)$/i, ['html', 'babel', 'estree', 'postcss']],
  [/^(ya?ml)$/i, ['yaml']],
  [/^(graphql|gql)$/i, ['graphql']],
]

/** 语言本身的插件 + 内嵌代码需要的插件 */
export function pluginsFor(lang: CodeLang, code: string): PluginName[] {
  const set = new Set<PluginName>(LANG_MAP[lang].plugins)
  if (lang === 'html' || lang === 'vue' || lang === 'angular') {
    if (
      /<script\b[^>]*\blang\s*=\s*["']?tsx?\b/i.test(code) ||
      /type\s*=\s*["']text\/typescript/i.test(code)
    ) {
      set.add('typescript')
      set.add('estree')
    }
  }
  if (lang === 'markdown') {
    if (/^---\s*\r?\n/.test(code)) set.add('yaml')
    for (const m of code.matchAll(/^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([\w+#.-]+)/gm)) {
      for (const [re, plugins] of FENCE_PLUGINS)
        if (re.test(m[1])) plugins.forEach((p) => set.add(p))
    }
  }
  return [...set]
}

/* ───────────────────────── 格式化 ───────────────────────── */

export interface FormatIssue {
  message: string
  /** 原始英文信息（有中文翻译时附上，便于搜索） */
  detail?: string
  line?: number
  column?: number
  frame?: CodeFrame
  /** load：格式化器下载失败（可重试） */
  kind?: 'syntax' | 'load' | 'other'
}

export type FormatResult =
  { ok: true; output: string; ms: number } | { ok: false; error: FormatIssue }

export function toPrettierOptions(lang: CodeLang, o: CodeFormatOptions): Options {
  const def = LANG_MAP[lang]
  return {
    parser: def.parser,
    filepath: def.filename,
    printWidth: o.printWidth,
    tabWidth: o.tabWidth,
    useTabs: o.useTabs,
    semi: o.semi,
    singleQuote: o.singleQuote,
    trailingComma: o.trailingComma,
    bracketSpacing: o.bracketSpacing,
    endOfLine: 'lf',
  }
}

export async function formatCode(
  code: string,
  lang: CodeLang,
  options: CodeFormatOptions = DEFAULT_CODE_OPTIONS,
): Promise<FormatResult> {
  if (!code.trim()) return { ok: true, output: '', ms: 0 }
  let prettier: typeof import('prettier/standalone')
  let plugins: Plugin[]
  try {
    ;[prettier, plugins] = await Promise.all([
      loadPrettier(),
      Promise.all(pluginsFor(lang, code).map(loadPlugin)),
    ])
  } catch {
    return {
      ok: false,
      error: { message: '格式化引擎加载失败，请检查网络连接后重试。', kind: 'load' },
    }
  }
  const t0 = performance.now()
  try {
    const output = await prettier.format(code, { ...toPrettierOptions(lang, options), plugins })
    return { ok: true, output, ms: performance.now() - t0 }
  } catch (e) {
    return { ok: false, error: describePrettierError(e, code) }
  }
}

/* ───────────────────────── 错误整理 ───────────────────────── */

// eslint-disable-next-line no-control-regex -- 匹配终端颜色转义序列
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

const TRANSLATIONS: [RegExp, string | ((...m: string[]) => string)][] = [
  // Babel / TypeScript
  [/^Unexpected token, expected "(.+)"$/, (_, x) => `意外的符号，此处应为 "${x}"`],
  [/^Unexpected token$/, '意外的符号'],
  [/^Unexpected token:? (.+)$/, (_, x) => `意外的符号 ${x}`],
  [/^Unterminated string constant$/, '字符串没有闭合'],
  [/^Unterminated template$/, '模板字符串没有闭合'],
  [/^Unterminated regular expression$/, '正则表达式没有闭合'],
  [/^Unterminated comment$/, '注释没有闭合'],
  [/^Unterminated JSX contents$/, 'JSX 内容没有闭合'],
  [/^Unterminated string literal$/, '字符串没有闭合'],
  [/^Unterminated template literal$/, '模板字符串没有闭合'],
  [/^Expected corresponding JSX closing tag for <(.+)>$/, (_, x) => `缺少与 <${x}> 对应的结束标签`],
  [/^Missing semicolon$/, '缺少分号'],
  [/^Unexpected keyword '(.+)'$/, (_, x) => `意外的关键字 '${x}'`],
  [/^Unexpected reserved word '(.+)'$/, (_, x) => `意外的保留字 '${x}'`],
  [/^Identifier '(.+)' has already been declared$/, (_, x) => `标识符 '${x}' 重复声明`],
  [/^'(.+)' expected$/, (_, x) => `此处应为 '${x}'`],
  [/^Expression expected$/, '此处应为表达式'],
  [/^Declaration or statement expected$/, '此处应为声明或语句'],
  [/^Identifier expected$/, '此处应为标识符'],
  [/^Property assignment expected$/, '此处应为属性（key: value）'],
  [/^Argument expression expected$/, '此处应为参数表达式'],
  [/^Type expected$/, '此处应为类型'],
  [/^Invalid character$/, '无效的字符'],
  [/^Unexpected character '(.+)'$/, (_, x) => `意外的字符 '${x}'`],
  [/^Unexpected end of input$/, '代码意外结束（可能缺少括号或引号）'],
  [/^Unexpected end of file$/, '代码意外结束（可能缺少括号或引号）'],
  [
    /^JSX expressions must have one parent element$/,
    'JSX 表达式必须只有一个根元素（可用 <>…</> 包裹）',
  ],
  [
    /^Adjacent JSX elements must be wrapped in an enclosing tag.*$/,
    '相邻的 JSX 元素必须用一个父元素包裹（可用 <>…</>）',
  ],
  // PostCSS
  [/^Unclosed block$/, '代码块没有闭合，缺少 }'],
  [/^Unclosed bracket$/, '括号没有闭合'],
  [/^Unclosed string$/, '字符串没有闭合'],
  [/^Unclosed comment$/, '注释没有闭合'],
  [
    /^Unknown word(?: (.+))?$/,
    (_, x) => (x ? `无法识别的内容：${x}` : '无法识别的内容（可能缺少分号或冒号）'),
  ],
  [/^Unexpected \}$/, '多余的 }'],
  [/^Missed semicolon$/, '缺少分号'],
  [/^Double colon$/, '多余的冒号'],
  // HTML / Angular / Vue
  [
    /^Unexpected closing tag "(.+?)"\.?.*$/,
    (_, x) => `意外的结束标签 </${x}>：它可能已被其他标签提前闭合，或缺少对应的开始标签`,
  ],
  [/^Unexpected character "(.+)"$/, (_, x) => `意外的字符 "${x}"`],
  [/^Opening tag "(.+)" not terminated\.?$/, (_, x) => `开始标签 <${x}> 没有写完（缺少 >）`],
  [
    /^Only void, custom and foreign elements can be self closed "(.+)"$/,
    (_, x) => `<${x}> 不能自闭合，请写成 <${x}></${x}>`,
  ],
  [/^Unexpected character "EOF".*$/, '文件意外结束（可能有标签或引号没有闭合）'],
  // YAML
  [
    /^All mapping items must start at the same column$/,
    '同一映射中的所有键必须从同一列开始（检查缩进）',
  ],
  [
    /^All sequence items must start at the same column$/,
    '同一列表中的所有项必须从同一列开始（检查缩进）',
  ],
  [/^Implicit map keys need to be followed by map values$/, '键后面缺少冒号或值'],
  [/^Implicit keys need to be on a single line$/, '键不能跨行（可能缺少冒号）'],
  [
    /^Nested mappings are not allowed in compact mappings$/,
    '同一行中不能嵌套映射（冒号后需要换行或加引号）',
  ],
  [/^Map keys must be unique.*$/, '映射中的键重复'],
  [/^Missing closing "?quote$/, '引号没有闭合'],
  [/^Tabs are not allowed as indentation.*$/, 'YAML 缩进不能使用 Tab'],
  // GraphQL
  [/^Expected (.+), found (.+?)\.?$/, (_, a, b) => `此处应为 ${a}，却遇到了 ${b}`],
  [/^Unexpected (.+?)\.?$/, (_, x) => `意外的 ${x}`],
  [/^Unterminated string\.?$/, '字符串没有闭合'],
]

export function translateParserMessage(msg: string): string | null {
  const m0 = msg.replace(/\.$/, '')
  for (const [re, zh] of TRANSLATIONS) {
    const m = re.exec(m0)
    if (m) return typeof zh === 'string' ? zh : zh(...m)
  }
  return null
}

/** 把 prettier 的解析错误整理成中文说明、行列与源码摘录（去掉 ANSI 与原始 code frame） */
export function describePrettierError(e: unknown, code: string): FormatIssue {
  const raw = (e instanceof Error ? e.message : String(e)).replace(ANSI, '')
  const name = e instanceof Error ? e.name : ''
  if (e instanceof RangeError || /Maximum call stack size exceeded/i.test(raw)) {
    return { message: '嵌套层级过深，超出了浏览器的处理能力', kind: 'other' }
  }
  if (name === 'ConfigError' || /Couldn't (resolve|find) (parser|plugin)/.test(raw)) {
    return { message: `格式化器配置错误：${raw.split('\n')[0]}`, kind: 'other' }
  }

  let first = raw.split('\n')[0].trim()
  first = first
    .replace(/\s*\(\d+:\d+\)\s*$/, '')
    .replace(
      /^(CssSyntaxError|SyntaxError|Syntax Error|YAMLSemanticError|YAMLSyntaxError):\s*/i,
      '',
    )
    .replace(/^<css input>:\d+:\d+:\s*/, '')
    .replace(/\s*For more info see https?:\/\/\S+/g, '')
    .replace(/\s*It may happen when[^.]*\./, '')
    .trim()

  const loc = (
    e as {
      loc?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
    }
  )?.loc
  let line = loc?.start?.line
  let column = loc?.start?.column
  if (line === undefined) {
    const m = /\((\d+):(\d+)\)\s*$/m.exec(raw.split('\n')[0])
    if (m) {
      line = Number(m[1])
      column = Number(m[2])
    }
  }

  const zh = translateParserMessage(first)
  const issue: FormatIssue = {
    message: zh ?? (first || '无法解析代码'),
    kind: 'syntax',
    ...(zh && first !== zh ? { detail: first } : {}),
  }
  if (line !== undefined) {
    const col = unitColumnToPointColumn(code, line, column ?? 1)
    const end = loc?.end
    const width =
      end?.line === line && end.column !== undefined && column !== undefined
        ? Math.max(1, end.column - column)
        : 1
    issue.line = line
    issue.column = col
    issue.frame = buildFrame(code, line, col, { width })
  }
  return issue
}

/** 解析器给出的列号按 UTF-16 计，这里换算成按码点计（emoji 算 1 列） */
function unitColumnToPointColumn(code: string, line: number, column: number): number {
  const text = code.split(/\r\n|\r|\n/)[line - 1]
  if (text === undefined) return column
  return Array.from(text.slice(0, Math.max(0, column - 1))).length + 1
}

/* ───────────────────────── 语言识别 ───────────────────────── */

const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0

/** 行首是这些词时不可能是 CSS 选择器 */
const SCRIPT_WORDS =
  'interface|class|function|if|for|while|switch|type|enum|namespace|export|import|const|let|var|return|else|try|catch|do|async|declare|abstract'

const ANGULAR =
  /\*ng(If|For|Switch\w*|Template\w*)\s*=|\[\(ngModel\)\]|\s\(\w+(\.\w+)*\)\s*=\s*"|\s\[[\w.-]+\]\s*=\s*"|@(if|for|switch|defer)\s*\(|\{\{[^}]*\|\s*[a-z]\w*/

const ONE_LINE_RULE = new RegExp(
  `^[ \\t]*(?!(${SCRIPT_WORDS})\\b)(?:[.#:\\w*>+~ ,-]|\\[[^\\]\\n]*\\])+\\{[^{}()=\\n]*:[^{}()=\\n]*\\}[ \\t]*$`,
  'gm',
)

function stripLeadingComments(s: string): string {
  let out = s
  for (;;) {
    const next = out.replace(/^\s*(\/\/[^\n]*\n?|\/\*[\s\S]*?\*\/)/, '')
    if (next === out) return out.trimStart()
    out = next
  }
}

/**
 * 根据内容猜测语言；空内容返回 null。
 * 先处理特征明确的（JSON、标记语言），再给脚本 / 样式 / Markdown / YAML / GraphQL 打分。
 */
export function detectLanguage(input: string): CodeLang | null {
  const src = input.replace(/^\uFEFF/, '').trim()
  if (!src) return null
  const head = src.length > 20000 ? src.slice(0, 20000) : src

  // ── JSON / JSON5
  const body = stripLeadingComments(head)
  if (body[0] === '{' || body[0] === '[') {
    if (body === head && src.length < 5_000_000) {
      try {
        JSON.parse(src)
        return 'json'
      } catch {
        /* 不是严格 JSON */
      }
    }
    const tail = src.trimEnd().slice(-1)
    if (
      (tail === '}' || tail === ']') &&
      !/\b(function|const|let|var|return|import|export|class|if|for|while)\b|=>|;\s*$/m.test(
        body,
      ) &&
      /(^|[{,])\s*["']?[\w$-]+["']?\s*:\s*\S/m.test(body) &&
      !/^\s*\w+\s*(\([^)]*\))?\s*\{\s*$/m.test(body)
    ) {
      return 'json5'
    }
  }

  // ── 标记语言
  if (head[0] === '<') {
    if (/^<template[\s>]/im.test(head) && /<\/template>/i.test(head)) return 'vue'
    if (ANGULAR.test(head)) return 'angular'
    if (
      !/^<!doctype|^<html/i.test(head) &&
      (/\s[a-zA-Z-]+=\{/.test(head) || /\bclassName=/.test(head))
    ) {
      return scriptTs(head) ? 'tsx' : 'jsx'
    }
    return 'html'
  }

  // ── 打分
  const lines = head.split(/\r?\n/)
  const meaningful = lines.filter((l) => l.trim() && !/^\s*#/.test(l))

  const yamlLine =
    /^\s*(- +)?(["'][^"']+["']|[\w./-][\w ./-]*?)\s*:(\s+[^\s{;][^;]*?|\s*[|>][-+]?\d*|\s*&\w+|\s*)$/
  const yamlItem = /^\s*- +[^\s:]/
  let yamlHits = 0
  for (const l of meaningful) {
    if (
      (yamlLine.test(l) && !/[;{]\s*$/.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l)) ||
      yamlItem.test(l)
    )
      yamlHits++
  }
  const yamlRatio = meaningful.length ? yamlHits / meaningful.length : 0
  let yaml = yamlRatio >= 0.6 ? 6 + yamlHits * 1.5 + 4 * count(head, /^---\s*$/gm) : 0
  if (/^\s*[\w-]+:\s*$/m.test(head) && yamlRatio >= 0.5) yaml += 3
  // 单独一行的 } 基本不会出现在 YAML 里（GraphQL / 脚本 / 样式才会）
  if (/^\s*\}\s*$/m.test(head)) yaml *= 0.2

  const markdown =
    3 * count(head, /^#{1,6}\s+\S/gm) +
    3 * count(head, /^\s*(```|~~~)/gm) +
    2 * count(head, /\[[^\]\n]+\]\([^)\s]+\)/g) +
    2 * count(head, /\*\*[^*\n]+\*\*/g) +
    2 * count(head, /^>\s/gm) +
    2 * count(head, /^\|.*\|\s*$/gm) +
    count(head, /^\s*([-*+]|\d+\.)\s+\S/gm) +
    count(head, /^[^\n<>{};=]{20,}$/gm) * 0.5

  const graphql =
    6 * count(head, /^\s*(query|mutation|subscription)\b\s*\w*\s*(\([^)]*\))?\s*(@\w+\s*)*\{/gm) +
    6 * count(head, /^\s*fragment\s+\w+\s+on\s+\w+/gm) +
    6 * count(head, /^\{\s*\w+(\([^)]*\))?\s*\{/g) +
    3 *
      count(
        head,
        /^\s*(type|input|enum|union|scalar|schema|directive|extend)\s+\w+[^=;\n]*(\{|$)/gm,
      ) +
    3 * count(head, /\.\.\.\s*(on\s+)?[A-Z]\w*/g) +
    2 * count(head, /\$\w+\s*:\s*\[?\w+!?\]?!?/g) +
    count(head, /^\s*\w+(\([^)]*\))?\s*:\s*\[?\w+!?\]?!?\s*$/gm) +
    count(head, /\b[A-Z]\w*!/g)

  const cssBase =
    3 *
      count(
        head,
        new RegExp(
          `^\\s*(?!(${SCRIPT_WORDS})\\b)([.#][\\w-]+|:root|\\*|[a-z][\\w-]*(\\s*[>+~]\\s*[\\w.#-]+)*)[^\\n{}=();]*\\{\\s*$`,
          'gm',
        ),
      ) +
    // 单行规则 `.a{color:red}`：属性选择器里的 = 只能出现在 [...] 中，
    // 否则 `const x = {a:1}` 这类脚本对象字面量会被误判成 CSS
    3 * count(head, ONE_LINE_RULE) +
    2 *
      count(head, /^\s*[a-z-]+\s*:\s*[^;{}\n]+;\s*$/gm) *
      (/[.#][\w-]+\s*\{|\w+\s*\{/.test(head) ? 1 : 0.2) +
    3 * count(head, /@(media|keyframes|font-face|supports|layer|import\s+url)\b/g) +
    count(head, /\d(px|rem|em|vh|vw|ms|deg)\b/g) +
    count(head, /#[0-9a-fA-F]{3,8}\b/g) * 0.5 +
    2 * count(head, /!important/g) +
    2 * count(head, /(^|[\s,])(&)?:(hover|focus|active|before|after|root|not\(|nth-child)/gm)
  const scss =
    3 * count(head, /^\s*\$[\w-]+\s*:/gm) +
    3 * count(head, /@(mixin|include|extend|use|forward|each|function|return)\b/g) +
    2 * count(head, /#\{/g) +
    count(head, /&[-_:.\w]/g) * 0.5
  const less =
    3 * count(head, /^\s*@[\w-]+\s*:/gm) +
    3 * count(head, /\.[\w-]+\s*\([^)]*\)\s*;/g) +
    3 * count(head, /\bwhen\s*\(/g) +
    3 * count(head, /@\{[\w-]+\}/g) +
    2 * count(head, /~["']/g) +
    2 * count(head, /\bfade\(|\bspin\(/g)
  const style = cssBase > 0 || scss > 0 || less > 0 ? cssBase + Math.max(scss, less) : 0

  const script =
    2 *
      count(
        head,
        /\b(const|let|var|function|return|import|export|require|async|await|new|this|typeof|class|extends|throw)\b/g,
      ) +
    2 * count(head, /=>/g) +
    count(head, /;\s*$/gm) * 0.5 +
    count(head, /\b(console|document|window|Math|JSON|Promise|Array|Object)\.\w+/g) * 2 +
    count(head, /\w+\([^)]*\)\s*\{/g) +
    count(head, /\b(if|for|while|switch)\s*\(/g) +
    (scriptTs(head) ? 6 : 0)

  const scores: [CodeLang | 'script' | 'style', number][] = [
    ['yaml', yaml],
    ['markdown', markdown],
    ['graphql', graphql],
    ['style', style],
    ['script', script],
  ]
  scores.sort((a, b) => b[1] - a[1])
  const [best, score] = scores[0]
  if (score <= 0) return /[;{}()=]/.test(head) ? 'javascript' : 'markdown'

  if (best === 'style') {
    if (scss > 0 && scss >= less) return 'scss'
    if (less > 0) return 'less'
    return 'css'
  }
  if (best === 'script') {
    const ts = scriptTs(head)
    const jsx = scriptJsx(head)
    return ts ? (jsx ? 'tsx' : 'typescript') : jsx ? 'jsx' : 'javascript'
  }
  return best
}

function scriptTs(s: string): boolean {
  const signals = [
    /\binterface\s+\w+(\s*<[^>]*>)?\s*(extends\s+[\w<>, .]+)?\s*\{[^}]*[;,]/,
    /\btype\s+\w+(\s*<[^>]*>)?\s*=/,
    /[\w)\]?]\s*:\s*(string|number|boolean|any|unknown|void|never|object|bigint|symbol|null|undefined)\b(\[\])?\s*[;,)=|&>\]]/,
    /\)\s*:\s*[\w<>[\]|., ]+\s*(\{|=>)/,
    /\b(as\s+const|satisfies|keyof|implements|declare\s+(const|module|global)|namespace\s+\w+|abstract\s+class)\b/,
    /\b(public|private|protected|readonly)\s+\w+\s*[:=(;?]/,
    /\bimport\s+type\b|\bexport\s+type\b/,
    /\b\w+<(string|number|boolean|any|unknown|[A-Z][\w, <>[\]|]*)(\[\])?>\s*\(/,
    /\benum\s+\w+\s*\{/,
    /\w+\?:\s*[\w'"[{(]/,
    /:\s*[A-Z]\w*(<[^>]+>)?(\[\])?\s*[;,)=]/,
    /\bas\s+[A-Z]\w*/,
  ]
  return signals.filter((re) => re.test(s)).length >= 1
}

function scriptJsx(s: string): boolean {
  // 标签前必须是表达式起始位置（排除 Promise<T>、useState<string>() 这类泛型）
  const openTag = /(^|[(>{?:,=&|]|\breturn)\s*<([A-Za-z][\w.]*)(\s[^<>]*)?\/?>(?!\s*\()/m
  return (
    (openTag.test(s) && /<\/[A-Za-z][\w.]*>|\/>/.test(s)) ||
    /\bclassName=/.test(s) ||
    /<>|<\/>/.test(s)
  )
}
