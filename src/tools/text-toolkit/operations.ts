import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownAZ,
  AtSign,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Columns3,
  FlipVertical2,
  ListOrdered,
  ListRestart,
  ListX,
  Replace,
  Rows3,
  Scissors,
  Space,
  TextCursorInput,
  Type,
  WholeWord,
} from 'lucide-react'
import {
  addLineNumbers,
  addPrefixSuffix,
  changeCase,
  collapseSpaces,
  dedupeLines,
  extract,
  findReplace,
  linesToList,
  listToLines,
  removeEmptyLines,
  removeLineNumbers,
  reverseLines,
  seededRng,
  sortLines,
  toFullWidth,
  toHalfWidth,
  trimLines,
  type ExtractKind,
  type JoinOptions,
  type OpResult,
  type QuoteStyle,
  type SortMode,
} from '@/lib/text-toolkit'

export type OpId =
  | 'dedupe'
  | 'sort'
  | 'reverse'
  | 'removeEmpty'
  | 'trim'
  | 'collapse'
  | 'addNumbers'
  | 'removeNumbers'
  | 'affix'
  | 'halfWidth'
  | 'fullWidth'
  | 'upper'
  | 'lower'
  | 'title'
  | 'extract'
  | 'replace'
  | 'join'
  | 'split'

export interface OpDef {
  id: OpId
  label: string
  icon: LucideIcon
  /** 没有参数时显示的一句说明 */
  hint: string
}

export interface OpGroup {
  title: string
  ops: OpDef[]
}

export const OP_GROUPS: OpGroup[] = [
  {
    title: '行处理',
    ops: [
      { id: 'dedupe', label: '去重行', icon: ListX, hint: '删除重复的行，保留第一次出现的顺序。' },
      {
        id: 'sort',
        label: '排序',
        icon: ArrowDownAZ,
        hint: '按字母 / 拼音、自然顺序、长度排序或随机打乱。',
      },
      { id: 'reverse', label: '反转行', icon: FlipVertical2, hint: '把行的顺序整体倒过来。' },
      { id: 'removeEmpty', label: '去空行', icon: Rows3, hint: '删除空行和只包含空白字符的行。' },
      {
        id: 'trim',
        label: '去首尾空白',
        icon: Scissors,
        hint: '去掉每一行开头和结尾的空格、制表符与全角空格。',
      },
      {
        id: 'collapse',
        label: '合并空格',
        icon: Space,
        hint: '把连续的空格、制表符合并成一个空格，换行保留。',
      },
      { id: 'addNumbers', label: '添加行号', icon: ListOrdered, hint: '在每一行前面加上行号。' },
      {
        id: 'removeNumbers',
        label: '去除行号',
        icon: ListRestart,
        hint: '识别并去掉「1.」「2)」「3、」「(4)」等行首编号。',
      },
      {
        id: 'affix',
        label: '加前缀 / 后缀',
        icon: TextCursorInput,
        hint: '给每一行加上相同的前缀和后缀。',
      },
    ],
  },
  {
    title: '字符转换',
    ops: [
      {
        id: 'halfWidth',
        label: '全角 → 半角',
        icon: Type,
        hint: '把全角字母、数字、标点和全角空格转换为半角，中文句号等不受影响。',
      },
      {
        id: 'fullWidth',
        label: '半角 → 全角',
        icon: Type,
        hint: '把半角 ASCII 字符与空格转换为全角。',
      },
      { id: 'upper', label: '大写', icon: CaseUpper, hint: '所有字母转为大写。' },
      { id: 'lower', label: '小写', icon: CaseLower, hint: '所有字母转为小写。' },
      {
        id: 'title',
        label: '首字母大写',
        icon: CaseSensitive,
        hint: '每个英文单词首字母大写，其余字母小写。',
      },
    ],
  },
  {
    title: '提取与替换',
    ops: [
      {
        id: 'extract',
        label: '提取',
        icon: AtSign,
        hint: '从文本中提取邮箱、URL、数字、手机号或 IP 地址，每行一个。',
      },
      { id: 'replace', label: '查找替换', icon: Replace, hint: '支持普通文本与正则表达式。' },
    ],
  },
  {
    title: '列表',
    ops: [
      {
        id: 'join',
        label: '行 → 逗号列表',
        icon: Columns3,
        hint: '把多行合并为一行列表，可加引号，适合 SQL 的 IN (…)。',
      },
      {
        id: 'split',
        label: '逗号列表 → 行',
        icon: WholeWord,
        hint: '按分隔符拆成多行，自动去掉引号和外层括号。',
      },
    ],
  },
]

export const ALL_OPS: OpDef[] = OP_GROUPS.flatMap((g) => g.ops)

export interface ToolkitOptions {
  op: OpId
  dedupeIgnoreCase: boolean
  dedupeTrim: boolean
  dedupeKeepEmpty: boolean
  sortMode: SortMode
  lnStart: number
  lnSeparator: string
  lnPad: boolean
  lnNumberEmpty: boolean
  prefix: string
  suffix: string
  affixSkipEmpty: boolean
  extractKind: ExtractKind
  extractUnique: boolean
  find: string
  replaceWith: string
  findRegex: boolean
  findCase: boolean
  joinQuote: QuoteStyle
  joinSeparator: string
  joinWrap: NonNullable<JoinOptions['wrap']>
  joinUnique: boolean
  splitSeparator: string
}

export const DEFAULT_OPTIONS: ToolkitOptions = {
  op: 'dedupe',
  dedupeIgnoreCase: false,
  dedupeTrim: true,
  dedupeKeepEmpty: false,
  sortMode: 'asc',
  lnStart: 1,
  lnSeparator: '. ',
  lnPad: false,
  lnNumberEmpty: true,
  prefix: '- ',
  suffix: '',
  affixSkipEmpty: true,
  extractKind: 'email',
  extractUnique: true,
  find: '',
  replaceWith: '',
  findRegex: false,
  findCase: false,
  joinQuote: 'single',
  joinSeparator: ', ',
  joinWrap: 'paren',
  joinUnique: false,
  splitSeparator: ',',
}

/** 从 localStorage 读出的值可能是旧版本或被篡改，逐项校验 */
export function sanitizeOptions(raw: unknown): ToolkitOptions {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULT_OPTIONS } as Record<string, unknown>
  for (const [k, def] of Object.entries(DEFAULT_OPTIONS)) {
    const v = src[k]
    if (typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v
  }
  const o = out as unknown as ToolkitOptions
  if (!ALL_OPS.some((x) => x.id === o.op)) o.op = DEFAULT_OPTIONS.op
  return o
}

export function runOp(text: string, o: ToolkitOptions, shuffleSeed: number): OpResult {
  switch (o.op) {
    case 'dedupe':
      return dedupeLines(text, {
        ignoreCase: o.dedupeIgnoreCase,
        trim: o.dedupeTrim,
        keepEmpty: o.dedupeKeepEmpty,
      })
    case 'sort':
      return sortLines(text, o.sortMode, seededRng(shuffleSeed))
    case 'reverse':
      return reverseLines(text)
    case 'removeEmpty':
      return removeEmptyLines(text)
    case 'trim':
      return trimLines(text)
    case 'collapse':
      return collapseSpaces(text)
    case 'addNumbers':
      return addLineNumbers(text, {
        start: Math.trunc(o.lnStart),
        separator: o.lnSeparator,
        pad: o.lnPad,
        numberEmpty: o.lnNumberEmpty,
      })
    case 'removeNumbers':
      return removeLineNumbers(text)
    case 'affix':
      return addPrefixSuffix(text, {
        prefix: o.prefix,
        suffix: o.suffix,
        skipEmpty: o.affixSkipEmpty,
      })
    case 'halfWidth':
      return toHalfWidth(text)
    case 'fullWidth':
      return toFullWidth(text)
    case 'upper':
      return changeCase(text, 'upper')
    case 'lower':
      return changeCase(text, 'lower')
    case 'title':
      return changeCase(text, 'title')
    case 'extract':
      return extract(text, o.extractKind, o.extractUnique)
    case 'replace':
      return findReplace(text, o.find, o.replaceWith, {
        regex: o.findRegex,
        caseSensitive: o.findCase,
      })
    case 'join':
      return linesToList(text, {
        quote: o.joinQuote,
        separator: o.joinSeparator,
        wrap: o.joinWrap,
        unique: o.joinUnique,
      })
    case 'split':
      return listToLines(text, o.splitSeparator)
  }
}

/** 安全执行：任何意外异常都转成错误提示，不让页面崩溃 */
export function safeRunOp(text: string, o: ToolkitOptions, seed: number): OpResult {
  try {
    return runOp(text, o, seed)
  } catch (e) {
    return { output: '', error: `处理失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

export const SAMPLE_TEXT = `张三, zhangsan@example.com, 13800138000
李四, lisi@example.com, 139-1234-5678
王五, wangwu@test.cn, +86 15612345678
张三, zhangsan@example.com, 13800138000

  服务器 192.168.1.10   与   10.0.0.1 已上线，文档见 https://example.com/docs 。
Ｈｅｌｌｏ\u3000Ｗｏｒｌｄ！ 全角字符也能转换。
item10
item2
item1
The quick brown fox jumps over the lazy dog.`
