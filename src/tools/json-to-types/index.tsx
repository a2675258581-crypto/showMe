import { useMemo, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { Boxes, Info, Layers, ListTree, Loader2, RotateCcw } from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Badge, Button, Input, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import {
  DEFAULT_TYPEGEN_OPTIONS,
  TARGETS,
  generateTypes,
  mainTypeName,
  type TargetLang,
  type TypeGenOptions,
} from '@/lib/json-to-types-render'
import type { ObjectDef } from '@/lib/json-to-types'
import { ErrorPanel, StaleOverlay } from '@/components/editor/ErrorPanel'
import { highlightFor } from './highlight'
import { SAMPLE } from './samples'

const spring = { type: 'spring', stiffness: 500, damping: 38 } as const

const LANGS = TARGETS.map((t) => t.id)

/** 各语言生成约定的一句话说明 */
const NOTES: Record<TargetLang, string> = {
  typescript: '缺失的字段用 ?，出现过 null 的加 | null',
  go: '可选字段加 omitempty，可空字段用指针；常见缩写大写（ID、URL）',
  java: '键名不是合法标识符或与字段名不同时加 Jackson @JsonProperty',
  kotlin: 'kotlinx.serialization：@Serializable data class，键名不同时加 @SerialName',
  rust: 'serde：可选 / 可空用 Option<T>，键名不同时 #[serde(rename)]',
  swift: 'Codable struct，键名不同时生成 CodingKeys',
  python: '',
  csharp: 'System.Text.Json：[JsonPropertyName]，可选 / 可空用 ?',
}

function sanitize(p: Partial<TypeGenOptions> | null | undefined): TypeGenOptions {
  const v = { ...DEFAULT_TYPEGEN_OPTIONS, ...(p && typeof p === 'object' ? p : {}) }
  return {
    lang: LANGS.includes(v.lang) ? v.lang : 'typescript',
    rootName: typeof v.rootName === 'string' ? v.rootName.slice(0, 64) : 'Root',
    tsDeclaration: v.tsDeclaration === 'type' ? 'type' : 'interface',
    tsReadonly: v.tsReadonly === true,
    tsExport: v.tsExport !== false,
    javaLombok: v.javaLombok === true,
    pythonStyle: v.pythonStyle === 'typeddict' ? 'typeddict' : 'dataclass',
  }
}

export default function JsonToTypes() {
  const [stored, setStored] = useLocalStorage<TypeGenOptions>(
    'json-to-types.options.v1',
    DEFAULT_TYPEGEN_OPTIONS,
  )
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = (patch: Partial<TypeGenOptions>) => setStored((p) => ({ ...sanitize(p), ...patch }))
  const { lang } = prefs

  const [input, setInput] = useState(SAMPLE)
  const debounced = useDebounced(input, 250)
  const pending = input !== debounced

  const optionsKey = JSON.stringify(prefs)
  const result = useMemo(
    () => generateTypes(debounced, JSON.parse(optionsKey) as TypeGenOptions),
    [debounced, optionsKey],
  )

  // 出错时保留上一次成功的结果（变淡）
  // 按语言记录：输入有误时切换语言，不能把别的语言的旧代码当成「上一次的结果」
  const [good, setGood] = useState({ lang, code: '' })
  if (result.ok && (result.code !== good.code || good.lang !== lang))
    setGood({ lang, code: result.code })
  const lastGood = good.lang === lang ? good.code : ''
  const output = result.ok ? result.code : ''

  const target = TARGETS.find((t) => t.id === lang) ?? TARGETS[0]
  const extensions = useMemo(() => highlightFor(lang), [lang])
  const rootName = result.ok && result.model ? result.model.rootName : 'Root'
  const fileName = target.fileName(
    rootName,
    result.ok && result.model ? mainTypeName(result.model) : undefined,
  )
  const stats = result.ok ? result.stats : null
  const objects = result.ok && result.model ? result.model.objects : []

  const badges: { key: string; node: ReactNode }[] = []
  if (stats && !pending) {
    badges.push({
      key: 'types',
      node: (
        <Badge>
          <Boxes className="size-3" />
          {stats.types} 个类型 · {stats.fields} 个字段
        </Badge>
      ),
    })
    if (stats.optional > 0)
      badges.push({
        key: 'opt',
        node: <Badge color="var(--sys-orange)">{stats.optional} 个可选</Badge>,
      })
    if (stats.nullable > 0)
      badges.push({
        key: 'null',
        node: <Badge color="var(--sys-purple)">{stats.nullable} 个可空</Badge>,
      })
    if (stats.samples > 1)
      badges.push({
        key: 'samples',
        node: (
          <Badge color="var(--sys-teal)">
            <Layers className="size-3" />
            {stats.jsonLines ? 'JSON Lines · ' : ''}合并 {stats.samples.toLocaleString()} 个样本
          </Badge>
        ),
      })
  }

  const note =
    lang === 'python'
      ? prefs.pythonStyle === 'typeddict'
        ? 'TypedDict：缺失的字段用 NotRequired（Python 3.11+）'
        : 'dataclass：可选字段默认 None，排在必填字段之后'
      : NOTES[lang]

  const toolbar = (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* 8 个语言在窄屏上放不下：手机上换成下拉框 */}
        <div className="no-scrollbar hidden max-w-full overflow-x-auto sm:block">
          <SegmentedControl<TargetLang>
            aria-label="目标语言"
            value={lang}
            onChange={(v) => set({ lang: v })}
            options={TARGETS.map((t) => ({ value: t.id, label: t.label }))}
          />
        </div>
        <label className="flex items-center gap-2 sm:hidden">
          <span className="text-[13px] whitespace-nowrap text-fg-2">目标语言</span>
          <Select
            size="sm"
            aria-label="目标语言"
            value={lang}
            onChange={(v) => {
              const next = TARGETS.find((t) => t.id === v)
              if (next) set({ lang: next.id })
            }}
            options={TARGETS.map((t) => ({ value: t.id, label: t.label }))}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[13px] whitespace-nowrap text-fg-2">根类型名</span>
          <div className="w-32">
            <Input
              value={prefs.rootName}
              onChange={(e) => set({ rootName: e.target.value })}
              placeholder="Root"
              mono
              spellCheck={false}
              aria-label="根类型名"
              className="h-8! px-2.5!"
            />
          </div>
        </label>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<RotateCcw />}
          title="恢复默认选项"
          aria-label="恢复默认选项"
          className="ml-auto"
          onClick={() => setStored((p) => ({ ...DEFAULT_TYPEGEN_OPTIONS, lang: sanitize(p).lang }))}
        />
      </div>
      <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-2.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {lang === 'typescript' && (
            <Opt key="ts-decl">
              <SegmentedControl<'interface' | 'type'>
                size="sm"
                aria-label="声明方式"
                value={prefs.tsDeclaration}
                onChange={(v) => set({ tsDeclaration: v })}
                options={[
                  { value: 'interface', label: 'interface' },
                  { value: 'type', label: 'type' },
                ]}
              />
            </Opt>
          )}
          {lang === 'typescript' && (
            <Opt key="ts-export">
              <Switch
                checked={prefs.tsExport}
                onChange={(v) => set({ tsExport: v })}
                label={<span className="text-[13px]">export</span>}
              />
            </Opt>
          )}
          {lang === 'typescript' && (
            <Opt key="ts-readonly">
              <Switch
                checked={prefs.tsReadonly}
                onChange={(v) => set({ tsReadonly: v })}
                label={<span className="text-[13px]">readonly</span>}
              />
            </Opt>
          )}
          {lang === 'java' && (
            <Opt key="java-lombok">
              <Switch
                checked={prefs.javaLombok}
                onChange={(v) => set({ javaLombok: v })}
                label={
                  <span className="text-[13px]" title="用 Lombok 的 @Data 代替手写 getter / setter">
                    Lombok @Data
                  </span>
                }
              />
            </Opt>
          )}
          {lang === 'python' && (
            <Opt key="py-style">
              <SegmentedControl<'dataclass' | 'typeddict'>
                size="sm"
                aria-label="Python 风格"
                value={prefs.pythonStyle}
                onChange={(v) => set({ pythonStyle: v })}
                options={[
                  { value: 'dataclass', label: 'dataclass' },
                  { value: 'typeddict', label: 'TypedDict' },
                ]}
              />
            </Opt>
          )}
          {note && (
            <Opt key={`note-${lang}-${prefs.pythonStyle}`}>
              <span className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-fg-3">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {note}
              </span>
            </Opt>
          )}
        </AnimatePresence>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputLang="json"
        inputTitle="JSON 样例"
        inputPlaceholder="粘贴 JSON 样例（对象、数组，或每行一个 JSON 的 JSON Lines）…"
        sample={SAMPLE}
        acceptFile=".json,.jsonl,.ndjson,text/*"
        downloadName={fileName}
        toolbar={toolbar}
        outputTitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {target.label}
            <AnimatePresence mode="popLayout" initial={false}>
              {pending ? (
                <motion.span
                  key="spin"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  className="inline-flex text-fg-3"
                  role="status"
                  aria-label="正在生成"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                </motion.span>
              ) : (
                badges.map((b) => (
                  <motion.span
                    key={b.key}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={spring}
                    className="inline-flex"
                  >
                    {b.node}
                  </motion.span>
                ))
              )}
            </AnimatePresence>
          </span>
        }
        outputFooter={
          <>
            <span>
              {result.ok
                ? `${output ? output.split('\n').length.toLocaleString() : 0} 行 · ${output.length.toLocaleString()} 字符`
                : '—'}
            </span>
            <span>{fileName}</span>
          </>
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
                value={result.ok ? result.code : lastGood}
                lang={lang === 'typescript' ? 'typescript' : 'text'}
                extensions={extensions}
                // 生成的代码不折行：Go 结构体的对齐、长类型名在窄屏上也保持原样（面板内横向滚动）
                lineWrapping={false}
                readOnly
                placeholder="类型定义会显示在这里"
                aria-label={`${target.label} 类型定义`}
              />
            </div>
            <StaleOverlay show={!result.ok}>
              {!result.ok && result.error.line !== undefined
                ? `第 ${result.error.line} 行有错误`
                : '无法解析'}
              {lastGood ? '，显示的是上一次的结果' : ''}
            </StaleOverlay>
          </div>
        }
      />
      <ErrorPanel error={result.ok ? null : result.error} />
      <AnimatePresence initial={false}>
        {objects.length > 0 && <TypeOverview key="overview" objects={objects} />}
      </AnimatePresence>
    </div>
  )
}

/** 推断出的类型一览：每个类型的字段数、可选 / 可空字段 */
function TypeOverview({ objects, ref }: { objects: readonly ObjectDef[]; ref?: Ref<HTMLElement> }) {
  return (
    <motion.section
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={spring}
      className="rounded-3xl border border-line bg-surface p-5 shadow-card"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold text-fg">
          <ListTree className="size-4 text-accent" />
          类型一览
        </h3>
        <span className="text-xs text-fg-3">
          数组元素的字段会合并：部分元素缺少 → 可选，出现过 null → 可空，结构相同的对象共用一个类型
        </span>
      </div>
      <LayoutGroup>
        <ul className="flex flex-wrap gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {objects.map((o) => {
              const optional = o.fields.filter((f) => f.optional).length
              const nullable = o.fields.filter((f) => f.type.nullable).length
              return (
                <motion.li
                  key={o.name}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={spring}
                  title={o.fields.map((f) => f.key).join(', ')}
                  className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-2"
                >
                  <span className="font-mono text-[13px] font-semibold text-fg">{o.name}</span>
                  <span className="text-[11px] text-fg-3 tabular-nums">
                    {o.fields.length} 字段
                    {optional > 0 && <span className="text-sys-orange"> · {optional} 可选</span>}
                    {nullable > 0 && <span className="text-sys-purple"> · {nullable} 可空</span>}
                  </span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      </LayoutGroup>
    </motion.section>
  )
}

function Opt({
  children,
  className,
  ref,
}: {
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
      {children}
    </motion.div>
  )
}
