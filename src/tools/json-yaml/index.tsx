import { useMemo, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, Files, Link2, Loader2, RotateCcw } from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Badge, Button, Notice, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import {
  DEFAULT_OPTIONS,
  convertJsonYaml,
  parseJson,
  yamlToJson,
  type Direction,
  type JsonYamlOptions,
} from '@/lib/json-yaml'
import { JSON_SAMPLE, YAML_SAMPLE } from '@/lib/json-yaml-samples'
import { ErrorPanel, StaleOverlay, WarningList } from '@/tools/code-formatter/ErrorPanel'

interface Prefs extends JsonYamlOptions {
  direction: Direction
}

const DEFAULT_PREFS: Prefs = { direction: 'json2yaml', ...DEFAULT_OPTIONS }

const SAMPLE: Record<Direction, string> = { json2yaml: JSON_SAMPLE, yaml2json: YAML_SAMPLE }

const spring = { type: 'spring', stiffness: 500, damping: 38 } as const

function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  const v = { ...DEFAULT_PREFS, ...(p ?? {}) }
  return {
    direction: v.direction === 'yaml2json' ? 'yaml2json' : 'json2yaml',
    indent: v.indent === 4 ? 4 : 2,
    sortKeys: v.sortKeys === true,
    lineWidth: [80, 120, -1].includes(v.lineWidth) ? v.lineWidth : 80,
    quoteStyle: v.quoteStyle === 'double' ? 'double' : 'single',
    forceQuotes: v.forceQuotes === true,
    multiDoc: v.multiDoc === true,
    customTags: v.customTags !== false,
  }
}

const flip = (d: Direction): Direction => (d === 'json2yaml' ? 'yaml2json' : 'json2yaml')

export default function JsonYaml() {
  const [stored, setStored] = useLocalStorage<Prefs>('json-yaml.options.v1', DEFAULT_PREFS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setStored((p) => ({ ...sanitize(p), [k]: v }))
  const { direction } = prefs
  const toYaml = direction === 'json2yaml'

  const [input, setInput] = useState(() => SAMPLE[prefs.direction])
  // 方向与输入一起防抖：交换 / 换示例时不会用旧输入按新方向转换而闪出错误
  const live = `${direction}\u0000${input}`
  const settled = useDebounced(live, 200)
  const cut = settled.indexOf('\u0000')
  const dDirection = settled.slice(0, cut) as Direction
  const debounced = settled.slice(cut + 1)
  const pending = live !== settled
  /** 输出区对应的是「已防抖」的方向 */
  const outYaml = dDirection === 'json2yaml'

  const { direction: _d, ...options } = prefs
  const optionsKey = JSON.stringify(options)
  const result = useMemo(
    () => convertJsonYaml(dDirection, debounced, JSON.parse(optionsKey) as JsonYamlOptions),
    [dDirection, debounced, optionsKey],
  )

  // 出错时保留上一次成功的结果（变淡），避免边输入边闪烁
  const [lastGood, setLastGood] = useState('')
  if (result.ok && result.output !== lastGood) setLastGood(result.output)
  const output = result.ok ? result.output : ''

  /** 输入看起来是另一种格式时，提示切换方向 */
  const suggestion = useMemo((): Direction | null => {
    const t = debounced.trim()
    if (!t) return null
    if (dDirection === 'yaml2json') {
      return (t[0] === '{' || t[0] === '[') && parseJson(t).ok ? 'json2yaml' : null
    }
    if (result.ok || t[0] === '{' || t[0] === '[') return null
    const y = yamlToJson(t, JSON.parse(optionsKey) as JsonYamlOptions)
    return y.ok && /:\s|^-\s/m.test(t) ? 'yaml2json' : null
  }, [debounced, dDirection, result.ok, optionsKey])

  const changeDirection = (next: Direction) => {
    if (next === direction) return
    set('direction', next)
    // 输入为空或仍是示例时，换成对应方向的示例
    const t = input.trim()
    if (!t || input === SAMPLE[direction]) setInput(SAMPLE[next])
  }

  const swap = () => {
    // 按当前（未防抖）的输入与方向重新算一次，避免刚输入完就交换时拿到过时的输出
    const fresh = convertJsonYaml(direction, input, JSON.parse(optionsKey) as JsonYamlOptions)
    set('direction', flip(direction))
    if (fresh.ok && fresh.output) setInput(fresh.output)
  }

  const badges: { key: string; node: ReactNode }[] = []
  if (result.ok && !pending) {
    if (result.docCount > 1)
      badges.push({
        key: 'docs',
        node: (
          <Badge>
            <Files className="size-3" />
            {outYaml ? `${result.docCount} 个文档` : `${result.docCount} 个文档 → 数组`}
          </Badge>
        ),
      })
    if (result.aliasCount > 0)
      badges.push({
        key: 'alias',
        node: (
          <Badge color="var(--sys-purple)">
            <Link2 className="size-3" />
            展开 {result.aliasCount} 处别名
          </Badge>
        ),
      })
  }

  const toolbar = (
    <>
      <SegmentedControl<Direction>
        aria-label="转换方向"
        value={direction}
        onChange={changeDirection}
        options={[
          { value: 'json2yaml', label: 'JSON → YAML' },
          { value: 'yaml2json', label: 'YAML → JSON' },
        ]}
      />
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
      <AnimatePresence mode="popLayout" initial={false}>
        <Opt key="indent" label="缩进">
          <SegmentedControl<'2' | '4'>
            size="sm"
            aria-label="缩进"
            value={String(prefs.indent) as '2' | '4'}
            onChange={(v) => set('indent', v === '4' ? 4 : 2)}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
            ]}
          />
        </Opt>
        <Opt key="sort">
          <Switch
            checked={prefs.sortKeys}
            onChange={(v) => set('sortKeys', v)}
            label={<span className="text-[13px]">键排序</span>}
          />
        </Opt>
        {toYaml && (
          <Opt key="width" label="行宽">
            <Select
              size="sm"
              aria-label="YAML 行宽"
              value={String(prefs.lineWidth)}
              onChange={(v) => set('lineWidth', Number(v))}
              options={[
                { value: '80', label: '80' },
                { value: '120', label: '120' },
                { value: '-1', label: '不折行' },
              ]}
            />
          </Opt>
        )}
        {toYaml && (
          <Opt key="quote" label="引号">
            <SegmentedControl<'single' | 'double'>
              size="sm"
              aria-label="引号风格"
              value={prefs.quoteStyle}
              onChange={(v) => set('quoteStyle', v)}
              options={[
                { value: 'single', label: '单引号', title: "需要引号时用 'x'" },
                { value: 'double', label: '双引号', title: '需要引号时用 "x"' },
              ]}
            />
          </Opt>
        )}
        {toYaml && (
          <Opt key="force">
            <Switch
              checked={prefs.forceQuotes}
              onChange={(v) => set('forceQuotes', v)}
              label={<span className="text-[13px]">字符串都加引号</span>}
            />
          </Opt>
        )}
        {toYaml && (
          <Opt key="multi">
            <Switch
              checked={prefs.multiDoc}
              onChange={(v) => set('multiDoc', v)}
              label={<span className="text-[13px]">数组拆成多文档</span>}
            />
          </Opt>
        )}
        {!toYaml && (
          <Opt key="tags">
            <Switch
              checked={prefs.customTags}
              onChange={(v) => set('customTags', v)}
              label={
                <span
                  className="text-[13px]"
                  title="如 CloudFormation 的 !Ref、!Sub：忽略标签，只保留值"
                >
                  忽略自定义标签
                </span>
              }
            />
          </Opt>
        )}
        <Opt key="reset" className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<RotateCcw />}
            title="恢复默认选项"
            aria-label="恢复默认选项"
            onClick={() =>
              setStored((p) => ({ ...DEFAULT_PREFS, direction: sanitize(p).direction }))
            }
          />
        </Opt>
      </AnimatePresence>
    </>
  )

  const switchButton = (to: Direction) => (
    <Button
      size="sm"
      variant="secondary"
      icon={<ArrowLeftRight />}
      onClick={() => changeDirection(to)}
    >
      切换为 {to === 'json2yaml' ? 'JSON → YAML' : 'YAML → JSON'}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputLang={toYaml ? 'json' : 'yaml'}
        outputLang={outYaml ? 'yaml' : 'json'}
        inputTitle={toYaml ? 'JSON' : 'YAML'}
        inputPlaceholder={
          toYaml
            ? '粘贴 JSON，实时转换为 YAML…'
            : '粘贴 YAML（支持 --- 多文档与锚点），实时转换为 JSON…'
        }
        sample={SAMPLE[direction]}
        onSwap={swap}
        acceptFile=".json,.yaml,.yml,text/*"
        downloadName={outYaml ? 'converted.yaml' : 'converted.json'}
        toolbar={toolbar}
        outputFooter={
          <>
            <span>
              {result.ok
                ? `${output ? output.split('\n').length.toLocaleString() : 0} 行 · ${output.length.toLocaleString()} 字符`
                : '—'}
            </span>
            <span>{outYaml ? 'YAML 1.2' : 'JSON'}</span>
          </>
        }
        outputTitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {toYaml ? 'YAML' : 'JSON'}
            <AnimatePresence mode="popLayout" initial={false}>
              {pending ? (
                <motion.span
                  key="spin"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  className="inline-flex text-fg-3"
                  role="status"
                  aria-label="正在转换"
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
        outputSlot={
          <div className="relative h-full">
            <div
              className={cn(
                'h-full transition-opacity duration-300',
                result.ok ? 'opacity-100' : 'opacity-35',
              )}
            >
              <CodeEditor
                value={result.ok ? result.output : lastGood}
                lang={outYaml ? 'yaml' : 'json'}
                readOnly
                placeholder={toYaml ? 'YAML 会显示在这里' : 'JSON 会显示在这里'}
                aria-label={toYaml ? 'YAML 输出' : 'JSON 输出'}
              />
            </div>
            <StaleOverlay show={!result.ok}>
              {!result.ok && result.error.line !== undefined
                ? `第 ${result.error.line} 行有错误`
                : '转换失败'}
              {lastGood ? '，显示的是上一次的结果' : ''}
            </StaleOverlay>
          </div>
        }
      />
      <AnimatePresence>
        {suggestion && result.ok && (
          <Notice key="suggest" tone="info">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                输入看起来是 {suggestion === 'json2yaml' ? 'JSON' : 'YAML'}，要反过来转换吗？
              </span>
              {switchButton(suggestion)}
            </div>
          </Notice>
        )}
      </AnimatePresence>
      <ErrorPanel
        error={result.ok ? null : result.error}
        action={!result.ok && suggestion ? switchButton(suggestion) : undefined}
      />
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
