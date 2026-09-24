import { useMemo } from 'react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { CopyButton, Notice, SegmentedControl, type SegmentOption } from '@/components/ui'
import { CODE_LANGS, generateCode, type CodeLang } from '@/lib/regex-tester-codegen'

const OPTIONS: SegmentOption<CodeLang>[] = CODE_LANGS

/** 各语言的示例代码 */
export function CodePanel({
  lang,
  onLang,
  pattern,
  flags,
  text,
  replacement,
}: {
  lang: CodeLang
  onLang: (l: CodeLang) => void
  pattern: string
  flags: string
  text: string
  replacement?: string
}) {
  const { code, notes } = useMemo(() => {
    try {
      return generateCode(lang, { pattern, flags, text, replacement })
    } catch (e) {
      return { code: '', notes: [`生成代码失败：${e instanceof Error ? e.message : String(e)}`] }
    }
  }, [lang, pattern, flags, text, replacement])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="no-scrollbar -mx-1 min-w-0 overflow-x-auto px-1">
          <SegmentedControl
            options={OPTIONS}
            value={lang}
            onChange={onLang}
            size="sm"
            aria-label="语言"
          />
        </div>
        <CopyButton text={code} label="复制代码" iconOnly variant="ghost" disabled={!code} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
        <CodeEditor
          value={code}
          readOnly
          lang={lang}
          lineNumbers={false}
          lineWrapping={false}
          height="auto"
          maxHeight="460px"
          aria-label="示例代码"
        />
      </div>
      {notes.map((n) => (
        <Notice key={n} tone="warning">
          {n}
        </Notice>
      ))}
      {replacement !== undefined && (
        <p className="text-xs text-fg-3">
          替换模板已按目标语言的语法转换（如 Python 用 \g&lt;1&gt;，Go 用 ${'{1}'}）。
        </p>
      )}
    </div>
  )
}
