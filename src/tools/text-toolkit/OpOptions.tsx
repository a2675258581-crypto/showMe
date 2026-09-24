import { Shuffle } from 'lucide-react'
import {
  Button,
  Field,
  Input,
  SegmentedControl,
  Select,
  Switch,
  type SegmentOption,
} from '@/components/ui'
import { EXTRACT_KINDS, SORT_MODES, type ExtractKind, type SortMode } from '@/lib/text-toolkit'
import type { OpDef, ToolkitOptions } from './operations'

const SEPARATORS = [
  { value: '. ', label: '1. 点' },
  { value: '、', label: '1、顿号' },
  { value: ') ', label: '1) 括号' },
  { value: ': ', label: '1: 冒号' },
  { value: ' | ', label: '1 | 竖线' },
  { value: '\t', label: '1 ⇥ 制表符' },
  { value: ' ', label: '1 空格' },
]

const QUOTES = [
  { value: 'none', label: '不加引号' },
  { value: 'single', label: "单引号 'a'" },
  { value: 'double', label: '双引号 "a"' },
  { value: 'backtick', label: '反引号 `a`' },
]

const WRAPS = [
  { value: 'none', label: '不包裹' },
  { value: 'paren', label: '( … )' },
  { value: 'bracket', label: '[ … ]' },
  { value: 'brace', label: '{ … }' },
]

const sortOptions: SegmentOption<SortMode>[] = SORT_MODES
const extractOptions: SegmentOption<ExtractKind>[] = EXTRACT_KINDS

/** 当前操作的参数面板 */
export function OpOptions({
  op,
  o,
  patch,
  onReshuffle,
}: {
  op: OpDef
  o: ToolkitOptions
  patch: (p: Partial<ToolkitOptions>) => void
  onReshuffle: () => void
}) {
  const hint = <p className="text-[13px] leading-relaxed text-fg-2">{op.hint}</p>

  switch (op.id) {
    case 'dedupe':
      return (
        <div className="flex flex-col gap-3">
          {hint}
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Switch
              checked={o.dedupeIgnoreCase}
              onChange={(v) => patch({ dedupeIgnoreCase: v })}
              label="忽略大小写"
            />
            <Switch
              checked={o.dedupeTrim}
              onChange={(v) => patch({ dedupeTrim: v })}
              label="忽略首尾空白"
            />
            <Switch
              checked={o.dedupeKeepEmpty}
              onChange={(v) => patch({ dedupeKeepEmpty: v })}
              label="保留空行"
            />
          </div>
        </div>
      )

    case 'sort':
      return (
        <div className="flex flex-col gap-3">
          {hint}
          <div className="flex flex-wrap items-center gap-3">
            <div className="no-scrollbar -mx-1 max-w-full overflow-x-auto px-1">
              <SegmentedControl
                options={sortOptions}
                value={o.sortMode}
                onChange={(v) => patch({ sortMode: v })}
                aria-label="排序方式"
              />
            </div>
            {o.sortMode === 'shuffle' && (
              <Button size="sm" variant="secondary" icon={<Shuffle />} onClick={onReshuffle}>
                再打乱一次
              </Button>
            )}
          </div>
        </div>
      )

    case 'addNumbers':
      return (
        <div className="flex flex-col gap-3">
          {hint}
          <div className="grid gap-3 sm:grid-cols-[120px_200px_1fr] sm:items-end">
            <Field label="起始编号">
              <Input
                type="number"
                inputMode="numeric"
                value={String(o.lnStart)}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) patch({ lnStart: Math.trunc(n) })
                }}
                aria-label="起始编号"
                className="h-9"
              />
            </Field>
            <Field label="分隔符">
              <Select
                options={SEPARATORS}
                value={SEPARATORS.some((s) => s.value === o.lnSeparator) ? o.lnSeparator : '. '}
                onChange={(v) => patch({ lnSeparator: v })}
                aria-label="分隔符"
                className="w-full"
              />
            </Field>
            <div className="flex flex-wrap gap-x-6 gap-y-3 sm:pb-2">
              <Switch checked={o.lnPad} onChange={(v) => patch({ lnPad: v })} label="补齐宽度" />
              <Switch
                checked={o.lnNumberEmpty}
                onChange={(v) => patch({ lnNumberEmpty: v })}
                label="空行也编号"
              />
            </div>
          </div>
        </div>
      )

    case 'affix':
      return (
        <div className="flex flex-col gap-3">
          {hint}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="前缀">
              <Input
                mono
                value={o.prefix}
                onChange={(e) => patch({ prefix: e.target.value })}
                placeholder="如 - 或 '"
                aria-label="前缀"
              />
            </Field>
            <Field label="后缀">
              <Input
                mono
                value={o.suffix}
                onChange={(e) => patch({ suffix: e.target.value })}
                placeholder="如 ; 或 ',"
                aria-label="后缀"
              />
            </Field>
            <Switch
              checked={o.affixSkipEmpty}
              onChange={(v) => patch({ affixSkipEmpty: v })}
              label="跳过空行"
              className="sm:pb-2"
            />
          </div>
        </div>
      )

    case 'extract':
      return (
        <div className="flex flex-col gap-3">
          {hint}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="no-scrollbar -mx-1 max-w-full overflow-x-auto px-1">
              <SegmentedControl
                options={extractOptions}
                value={o.extractKind}
                onChange={(v) => patch({ extractKind: v })}
                aria-label="提取类型"
              />
            </div>
            <Switch
              checked={o.extractUnique}
              onChange={(v) => patch({ extractUnique: v })}
              label="去重"
            />
          </div>
        </div>
      )

    case 'replace':
      return (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="查找">
              <Input
                mono
                value={o.find}
                onChange={(e) => patch({ find: e.target.value })}
                placeholder={o.findRegex ? '正则表达式，如 (\\d+)-(\\d+)' : '要查找的文本'}
                aria-label="查找"
              />
            </Field>
            <Field
              label="替换为"
              hint={o.findRegex ? '可用 $1、$<name> 引用分组，$& 表示整个匹配' : undefined}
            >
              <Input
                mono
                value={o.replaceWith}
                onChange={(e) => patch({ replaceWith: e.target.value })}
                placeholder="留空表示删除"
                aria-label="替换为"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Switch
              checked={o.findRegex}
              onChange={(v) => patch({ findRegex: v })}
              label="正则表达式"
            />
            <Switch
              checked={o.findCase}
              onChange={(v) => patch({ findCase: v })}
              label="区分大小写"
            />
          </div>
        </div>
      )

    case 'join':
      return (
        <div className="flex flex-col gap-3">
          {hint}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <Field label="引号">
              <Select
                options={QUOTES}
                value={o.joinQuote}
                onChange={(v) => patch({ joinQuote: v as ToolkitOptions['joinQuote'] })}
                aria-label="引号"
                className="w-full"
              />
            </Field>
            <Field label="分隔符">
              <Input
                mono
                value={o.joinSeparator}
                onChange={(e) => patch({ joinSeparator: e.target.value })}
                aria-label="分隔符"
                className="h-9"
              />
            </Field>
            <Field label="外层包裹">
              <Select
                options={WRAPS}
                value={o.joinWrap}
                onChange={(v) => patch({ joinWrap: v as ToolkitOptions['joinWrap'] })}
                aria-label="外层包裹"
                className="w-full"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:pb-1">
              <Switch
                checked={o.joinUnique}
                onChange={(v) => patch({ joinUnique: v })}
                label="去重"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  patch({ joinQuote: 'single', joinSeparator: ', ', joinWrap: 'paren' })
                }
                title="单引号 + 逗号 + 圆括号，直接用于 WHERE id IN (…)"
              >
                SQL IN
              </Button>
            </div>
          </div>
        </div>
      )

    case 'split':
      return (
        <div className="flex flex-col gap-3">
          {hint}
          <Field
            label="分隔符"
            hint="默认逗号（同时识别中文逗号），也可以填 ; | 等"
            className="sm:max-w-60"
          >
            <Input
              mono
              value={o.splitSeparator}
              onChange={(e) => patch({ splitSeparator: e.target.value })}
              aria-label="分隔符"
            />
          </Field>
        </div>
      )

    default:
      return hint
  }
}
