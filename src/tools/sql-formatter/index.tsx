import { useMemo, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Braces,
  ChevronDown,
  Loader2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Badge, Button, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import {
  DEFAULT_SQL_OPTIONS,
  SQL_DIALECTS,
  formatSql,
  type LetterCase,
  type SqlIndent,
  type SqlMode,
  type SqlOptions,
} from '@/lib/sql-formatter'
import { SQL_SAMPLE } from '@/lib/sql-formatter-samples'
import { ErrorPanel, StaleOverlay, WarningList } from '@/tools/code-formatter/ErrorPanel'

interface Prefs extends SqlOptions {
  /** 是否展开「更多选项」 */
  more: boolean
}

const DEFAULT_PREFS: Prefs = { ...DEFAULT_SQL_OPTIONS, more: false }

const CASE_OPTIONS = [
  { value: 'upper', label: '大写' },
  { value: 'lower', label: '小写' },
  { value: 'preserve', label: '保持' },
] as const

const CASE_SELECT = CASE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

const spring = { type: 'spring', stiffness: 500, damping: 38 } as const

const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback

function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  const v = { ...DEFAULT_PREFS, ...(p ?? {}) }
  const cases = ['upper', 'lower', 'preserve'] as const
  return {
    dialect: oneOf(
      v.dialect,
      SQL_DIALECTS.map((d) => d.value),
      'mysql',
    ),
    mode: oneOf(v.mode, ['format', 'minify'] as const, 'format'),
    keywordCase: oneOf(v.keywordCase, cases, 'upper'),
    dataTypeCase: oneOf(v.dataTypeCase, cases, 'upper'),
    functionCase: oneOf(v.functionCase, cases, 'preserve'),
    indent: oneOf(v.indent, ['2', '4', 'tab'] as const, '2'),
    indentStyle: oneOf(
      v.indentStyle,
      ['standard', 'tabularLeft', 'tabularRight'] as const,
      'standard',
    ),
    logicalOperatorNewline: oneOf(v.logicalOperatorNewline, ['before', 'after'] as const, 'before'),
    linesBetweenQueries: [0, 1, 2, 3].includes(v.linesBetweenQueries) ? v.linesBetweenQueries : 1,
    denseOperators: v.denseOperators === true,
    more: v.more === true,
  }
}

export default function SqlFormatter() {
  const [input, setInput] = useState(SQL_SAMPLE)
  const [stored, setStored] = useLocalStorage<Prefs>('sql-formatter.options.v1', DEFAULT_PREFS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setStored((p) => ({ ...sanitize(p), [k]: v }))

  const debounced = useDebounced(input, 200)
  const pending = input !== debounced
  const { more: _more, ...options } = prefs
  const optionsKey = JSON.stringify(options)

  const result = useMemo(
    () => formatSql(debounced, JSON.parse(optionsKey) as SqlOptions),
    [debounced, optionsKey],
  )

  // 出错时保留上一次成功的结果（变淡显示），避免输入过程中输出区闪烁
  const [lastGood, setLastGood] = useState('')
  if (result.ok && lastGood !== result.output) setLastGood(result.output)
  const output = result.ok ? result.output : ''
  const shown = result.ok ? result.output : lastGood

  const isMinify = prefs.mode === 'minify'
  const hasPlaceholders = /[#$]\{[^{}\n]*\}/.test(debounced)
  const saved =
    isMinify && result.ok && debounced.length > 0
      ? Math.round((1 - result.output.length / debounced.length) * 100)
      : null

  const toolbar = (
    <>
      <SegmentedControl<SqlMode>
        aria-label="模式"
        value={prefs.mode}
        onChange={(v) => set('mode', v)}
        options={[
          {
            value: 'format',
            label: (
              <>
                <Sparkles />
                美化
              </>
            ),
          },
          {
            value: 'minify',
            label: (
              <>
                <Minimize2 />
                压缩
              </>
            ),
          },
        ]}
      />
      <Select
        aria-label="SQL 方言"
        value={prefs.dialect}
        onChange={(v) => set('dialect', v as SqlOptions['dialect'])}
        options={SQL_DIALECTS}
        className="min-w-32"
      />
      <AnimatePresence mode="popLayout" initial={false}>
        {!isMinify && (
          <Opt key="kw" label="关键字">
            <SegmentedControl<LetterCase>
              size="sm"
              aria-label="关键字大小写"
              value={prefs.keywordCase}
              onChange={(v) => set('keywordCase', v)}
              options={CASE_OPTIONS}
            />
          </Opt>
        )}
        {!isMinify && (
          <Opt key="indent" label="缩进">
            <SegmentedControl<SqlIndent>
              size="sm"
              aria-label="缩进"
              value={prefs.indent}
              onChange={(v) => set('indent', v)}
              options={[
                { value: '2', label: '2' },
                { value: '4', label: '4' },
                { value: 'tab', label: 'Tab' },
              ]}
            />
          </Opt>
        )}
        {!isMinify && (
          <Opt key="more">
            <Button
              size="sm"
              variant={prefs.more ? 'secondary' : 'ghost'}
              icon={<SlidersHorizontal />}
              aria-expanded={prefs.more}
              onClick={() => set('more', !prefs.more)}
            >
              更多选项
              <motion.span
                animate={{ rotate: prefs.more ? 180 : 0 }}
                transition={spring}
                className="inline-flex"
              >
                <ChevronDown />
              </motion.span>
            </Button>
          </Opt>
        )}
        {isMinify && (
          <Opt key="minify-hint">
            <span className="text-xs text-fg-3">
              去掉注释与多余空白，字符串、带引号的标识符与 /*+ 提示 */ 原样保留
            </span>
          </Opt>
        )}
        <Opt key="reset" className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<RotateCcw />}
            title="恢复默认选项（保留方言）"
            aria-label="恢复默认选项"
            onClick={() =>
              setStored((p) => {
                const cur = sanitize(p)
                return { ...DEFAULT_PREFS, dialect: cur.dialect, mode: cur.mode, more: cur.more }
              })
            }
          />
        </Opt>
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {!isMinify && prefs.more && (
          <motion.div
            key="more-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="basis-full overflow-hidden"
          >
            <div className="mt-1 grid gap-x-5 gap-y-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
              <Row label="函数名">
                <Select
                  size="sm"
                  aria-label="函数名大小写"
                  value={prefs.functionCase}
                  onChange={(v) => set('functionCase', v as LetterCase)}
                  options={CASE_SELECT}
                />
              </Row>
              <Row label="数据类型">
                <Select
                  size="sm"
                  aria-label="数据类型大小写"
                  value={prefs.dataTypeCase}
                  onChange={(v) => set('dataTypeCase', v as LetterCase)}
                  options={CASE_SELECT}
                />
              </Row>
              <Row label="对齐风格">
                <Select
                  size="sm"
                  aria-label="对齐风格"
                  value={prefs.indentStyle}
                  onChange={(v) => set('indentStyle', v as SqlOptions['indentStyle'])}
                  options={[
                    { value: 'standard', label: '标准缩进' },
                    { value: 'tabularLeft', label: '表格（关键字左对齐）' },
                    { value: 'tabularRight', label: '表格（关键字右对齐）' },
                  ]}
                />
              </Row>
              <Row label="AND / OR 位置">
                <SegmentedControl<SqlOptions['logicalOperatorNewline']>
                  size="sm"
                  aria-label="AND / OR 位置"
                  value={prefs.logicalOperatorNewline}
                  onChange={(v) => set('logicalOperatorNewline', v)}
                  options={[
                    { value: 'before', label: '行首' },
                    { value: 'after', label: '行尾' },
                  ]}
                />
              </Row>
              <Row label="语句间空行">
                <SegmentedControl<'0' | '1' | '2' | '3'>
                  size="sm"
                  aria-label="语句间空行"
                  value={String(prefs.linesBetweenQueries) as '0' | '1' | '2' | '3'}
                  onChange={(v) => set('linesBetweenQueries', Number(v))}
                  options={['0', '1', '2', '3'].map((n) => ({ value: n as '0', label: n }))}
                />
              </Row>
              <Row label="运算符">
                <Switch
                  checked={prefs.denseOperators}
                  onChange={(v) => set('denseOperators', v)}
                  label={<span className="text-[13px]">紧凑（a=b）</span>}
                />
              </Row>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputLang="sql"
        outputLang="sql"
        inputPlaceholder="粘贴 SQL，支持多条语句、注释与 MyBatis 的 #{…} 占位符…"
        sample={SQL_SAMPLE}
        acceptFile=".sql,text/*"
        downloadName={isMinify ? 'minified.sql' : 'formatted.sql'}
        toolbar={toolbar}
        outputTitle={
          <span className="inline-flex items-center gap-2">
            {isMinify ? '压缩结果' : '格式化结果'}
            <AnimatePresence mode="popLayout" initial={false}>
              {pending ? (
                <motion.span
                  key="spin"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  className="inline-flex text-fg-3"
                  role="status"
                  aria-label="正在处理"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                </motion.span>
              ) : hasPlaceholders && result.ok ? (
                <motion.span
                  key="ph"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={spring}
                  className="inline-flex"
                >
                  <Badge>
                    <Braces className="size-3" />
                    已保留占位符
                  </Badge>
                </motion.span>
              ) : null}
            </AnimatePresence>
          </span>
        }
        outputSlot={
          <div className="relative h-full">
            <div
              className={cn(
                'h-full transition-opacity duration-300',
                result.ok ? 'opacity-100' : 'opacity-35',
              )}
            >
              <CodeEditor
                value={shown}
                lang="sql"
                readOnly
                placeholder={
                  isMinify ? '压缩后的单行 SQL 会显示在这里' : '格式化后的 SQL 会显示在这里'
                }
                aria-label={isMinify ? '压缩结果' : '格式化结果'}
              />
            </div>
            <StaleOverlay show={!result.ok}>
              {!result.ok && result.error.line !== undefined
                ? `第 ${result.error.line} 行有错误`
                : '格式化失败'}
              {lastGood ? '，显示的是上一次的结果' : ''}
            </StaleOverlay>
          </div>
        }
        outputFooter={
          <>
            <span>
              {!result.ok
                ? '—'
                : isMinify
                  ? `${output.length.toLocaleString()} 字符`
                  : `${output ? output.split('\n').length.toLocaleString() : 0} 行 · ${output.length.toLocaleString()} 字符`}
            </span>
            {isMinify && result.ok && saved !== null ? (
              <span>
                {result.commentsRemoved ? `去掉 ${result.commentsRemoved} 条注释 · ` : ''}
                体积 {saved >= 0 ? `减少 ${saved}%` : `增加 ${-saved}%`}
              </span>
            ) : (
              <span>{SQL_DIALECTS.find((d) => d.value === prefs.dialect)?.label}</span>
            )}
          </>
        }
      />
      <ErrorPanel error={result.ok ? null : result.error} />
      <WarningList warnings={result.ok ? result.warnings : []} />
    </div>
  )
}

function Opt({
  label,
  children,
  className,
  ref,
}: {
  label?: string
  children: ReactNode
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={spring}
      className={cn('flex items-center gap-2', className)}
    >
      {label && <span className="text-[13px] text-fg-2">{label}</span>}
      {children}
    </motion.div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-start">
      <span className="w-24 shrink-0 text-[13px] text-fg-2">{label}</span>
      {children}
    </div>
  )
}
