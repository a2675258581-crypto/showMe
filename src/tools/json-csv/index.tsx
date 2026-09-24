import { useMemo, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeftRight,
  Braces,
  Code2,
  Columns3,
  Download,
  Loader2,
  RotateCcw,
  Rows3,
  Table2,
} from 'lucide-react'
import { IOPanel } from '@/components/editor/IOPanel'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Badge, Button, Notice, SegmentedControl, Select, Switch } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import { downloadText } from '@/lib/file'
import {
  DELIMITER_LABELS,
  csvToJson,
  jsonToCsv,
  withBom,
  type CsvDelimiter,
  type CsvDirection,
  type CsvTable,
  type RecordArrayCandidate,
} from '@/lib/json-csv'
import type { ConvertIssue } from '@/lib/json-yaml'
import { ErrorPanel, StaleOverlay, WarningList } from '@/tools/code-formatter/ErrorPanel'
import { DataTable } from './DataTable'
import { CSV_SAMPLE, JSON_SAMPLE } from './samples'

type View = 'code' | 'table'

interface Prefs {
  direction: CsvDirection
  view: View
  /* JSON → CSV */
  delimiter: CsvDelimiter
  flatten: boolean
  quoteAll: boolean
  header: boolean
  bom: boolean
  /* CSV → JSON */
  csvDelimiter: CsvDelimiter | 'auto'
  csvHeader: boolean
  dynamicTyping: boolean
  unflatten: boolean
}

const DEFAULT_PREFS: Prefs = {
  direction: 'json2csv',
  view: 'code',
  delimiter: ',',
  flatten: true,
  quoteAll: false,
  header: true,
  bom: true,
  csvDelimiter: 'auto',
  csvHeader: true,
  dynamicTyping: true,
  unflatten: true,
}

const DELIMITERS: CsvDelimiter[] = [',', ';', '\t', '|']
const isDelimiter = (v: unknown): v is CsvDelimiter => DELIMITERS.includes(v as CsvDelimiter)

const DELIMITER_OPTIONS = DELIMITERS.map((d) => ({
  value: d,
  label: `${DELIMITER_LABELS[d]}${d === '\t' ? '' : `  ${d}`}`,
}))

const SAMPLE: Record<CsvDirection, string> = { json2csv: JSON_SAMPLE, csv2json: CSV_SAMPLE }
const LABEL: Record<CsvDirection, string> = { json2csv: 'JSON → CSV', csv2json: 'CSV → JSON' }

const spring = { type: 'spring', stiffness: 500, damping: 38 } as const

const EMPTY_TABLE: CsvTable = { headers: [], rows: [] }

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)

function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  const v = { ...DEFAULT_PREFS, ...(p && typeof p === 'object' ? p : {}) }
  return {
    direction: v.direction === 'csv2json' ? 'csv2json' : 'json2csv',
    view: v.view === 'table' ? 'table' : 'code',
    delimiter: isDelimiter(v.delimiter) ? v.delimiter : ',',
    flatten: bool(v.flatten, true),
    quoteAll: bool(v.quoteAll, false),
    header: bool(v.header, true),
    bom: bool(v.bom, true),
    csvDelimiter:
      v.csvDelimiter === 'auto' || isDelimiter(v.csvDelimiter) ? v.csvDelimiter : 'auto',
    csvHeader: bool(v.csvHeader, true),
    dynamicTyping: bool(v.dynamicTyping, true),
    unflatten: bool(v.unflatten, true),
  }
}

type Outcome =
  | {
      ok: true
      output: string
      table: CsvTable
      warnings: string[]
      candidates: RecordArrayCandidate[]
      usedPath: string | null
      delimiter: string
    }
  | { ok: false; error: ConvertIssue }

function convert(direction: CsvDirection, text: string, p: Prefs, path: string | null): Outcome {
  if (direction === 'json2csv') {
    const r = jsonToCsv(text, {
      delimiter: p.delimiter,
      flatten: p.flatten,
      quoteAll: p.quoteAll,
      header: p.header,
      path: path ?? undefined,
    })
    return r.ok ? { ...r, output: r.csv, delimiter: p.delimiter } : r
  }
  const r = csvToJson(text, {
    header: p.csvHeader,
    dynamicTyping: p.dynamicTyping,
    unflatten: p.unflatten,
    delimiter: p.csvDelimiter,
  })
  return r.ok ? { ...r, output: r.json, candidates: [], usedPath: null } : r
}

const flip = (d: CsvDirection): CsvDirection => (d === 'json2csv' ? 'csv2json' : 'json2csv')

export default function JsonCsv() {
  const [stored, setStored] = useLocalStorage<Prefs>('json-csv.options.v1', DEFAULT_PREFS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = (patch: Partial<Prefs>) => setStored((p) => ({ ...sanitize(p), ...patch }))
  const { direction, view } = prefs
  const toCsv = direction === 'json2csv'

  const [input, setInput] = useState(() => SAMPLE[prefs.direction])
  /** 只转换顶层对象里的某个数组字段（如 data） */
  const [path, setPath] = useState<string | null>(null)

  const live = `${direction}\u0000${input}`
  const settled = useDebounced(live, 200)
  const cut = settled.indexOf('\u0000')
  const dDirection = settled.slice(0, cut) as CsvDirection
  const debounced = settled.slice(cut + 1)
  const pending = live !== settled
  const outCsv = dDirection === 'json2csv'

  const { direction: _d, view: _v, ...options } = prefs
  const optionsKey = JSON.stringify(options)
  const result = useMemo(
    () => convert(dDirection, debounced, JSON.parse(optionsKey) as Prefs, path),
    [dDirection, debounced, optionsKey, path],
  )

  // 按方向记录：切换方向后出错时，不能把另一种格式的旧结果当成「上一次的结果」显示
  const [good, setGood] = useState<{ dir: CsvDirection; output: string; table: CsvTable }>({
    dir: dDirection,
    output: '',
    table: EMPTY_TABLE,
  })
  if (
    result.ok &&
    (result.output !== good.output || result.table !== good.table || good.dir !== dDirection)
  )
    setGood({ dir: dDirection, output: result.output, table: result.table })
  const lastGood = good.dir === dDirection ? good : { output: '', table: EMPTY_TABLE }
  const output = result.ok ? result.output : ''
  const shown = result.ok ? result : lastGood

  const suggestion = useMemo((): CsvDirection | null => {
    const t = debounced.trimStart()
    if (!t) return null
    const looksJson = t[0] === '{' || t[0] === '['
    if (dDirection === 'csv2json' && looksJson) return 'json2csv'
    if (dDirection === 'json2csv' && !looksJson && /[,;\t|]/.test(t.split('\n')[0]))
      return 'csv2json'
    return null
  }, [debounced, dDirection])

  const changeDirection = (next: CsvDirection) => {
    if (next === direction) return
    set({ direction: next })
    if (!input.trim() || input === SAMPLE[direction]) setInput(SAMPLE[next])
  }

  const swap = () => {
    set({ direction: flip(direction) })
    if (output) setInput(output)
    setPath(null)
  }

  const download = () => {
    if (!output) return
    if (outCsv) {
      // 下载的文件用 CRLF 换行（RFC 4180），可选 BOM 让 Excel 正确识别 UTF-8
      const r = jsonToCsv(debounced, {
        delimiter: prefs.delimiter,
        flatten: prefs.flatten,
        quoteAll: prefs.quoteAll,
        header: prefs.header,
        path: path ?? undefined,
        newline: '\r\n',
      })
      const csv = r.ok ? r.csv : output
      const ext = prefs.delimiter === '\t' ? 'tsv' : 'csv'
      downloadText(
        `converted.${ext}`,
        prefs.bom ? withBom(csv) : csv,
        `text/${ext === 'tsv' ? 'tab-separated-values' : 'csv'};charset=utf-8`,
      )
    } else downloadText('converted.json', output, 'application/json;charset=utf-8')
  }

  const rows = shown.table.rows.length
  const cols = shown.table.headers.length
  const badges: { key: string; node: ReactNode }[] = []
  if (result.ok && !pending && cols > 0) {
    badges.push({
      key: 'size',
      node: (
        <Badge>
          <Rows3 className="size-3" />
          {rows.toLocaleString()} 行<span className="opacity-50">×</span>
          <Columns3 className="size-3" />
          {cols.toLocaleString()} 列
        </Badge>
      ),
    })
    if (!outCsv && prefs.csvDelimiter === 'auto' && isDelimiter(result.delimiter))
      badges.push({
        key: 'delim',
        node: <Badge color="var(--sys-teal)">分隔符：{DELIMITER_LABELS[result.delimiter]}</Badge>,
      })
    if (result.usedPath)
      badges.push({
        key: 'path',
        node: (
          <Badge color="var(--sys-orange)" className="font-mono">
            <Braces className="size-3" />
            {result.usedPath}
          </Badge>
        ),
      })
  }

  const toolbar = (
    <>
      <SegmentedControl<CsvDirection>
        aria-label="转换方向"
        value={direction}
        onChange={changeDirection}
        options={[
          { value: 'json2csv', label: LABEL.json2csv },
          { value: 'csv2json', label: LABEL.csv2json },
        ]}
      />
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
      <AnimatePresence mode="popLayout" initial={false}>
        {toCsv ? (
          <Opt key="delim" label="分隔符">
            <Select
              size="sm"
              aria-label="分隔符"
              value={prefs.delimiter}
              onChange={(v) => isDelimiter(v) && set({ delimiter: v })}
              options={DELIMITER_OPTIONS}
            />
          </Opt>
        ) : (
          <Opt key="csv-delim" label="分隔符">
            <Select
              size="sm"
              aria-label="分隔符"
              value={prefs.csvDelimiter}
              onChange={(v) =>
                set({ csvDelimiter: v === 'auto' ? 'auto' : isDelimiter(v) ? v : 'auto' })
              }
              options={[{ value: 'auto', label: '自动识别' }, ...DELIMITER_OPTIONS]}
            />
          </Opt>
        )}
        {toCsv && (
          <Opt key="flatten">
            <Switch
              checked={prefs.flatten}
              onChange={(v) => set({ flatten: v })}
              label={
                <span
                  className="text-[13px]"
                  title="{ a: { b: 1 } } → 列 a.b；关闭时整个对象写成 JSON"
                >
                  展开嵌套对象
                </span>
              }
            />
          </Opt>
        )}
        {toCsv && (
          <Opt key="header">
            <Switch
              checked={prefs.header}
              onChange={(v) => set({ header: v })}
              label={<span className="text-[13px]">输出表头</span>}
            />
          </Opt>
        )}
        {toCsv && (
          <Opt key="quote">
            <Switch
              checked={prefs.quoteAll}
              onChange={(v) => set({ quoteAll: v })}
              label={<span className="text-[13px]">全部加引号</span>}
            />
          </Opt>
        )}
        {toCsv && (
          <Opt key="bom">
            <Switch
              checked={prefs.bom}
              onChange={(v) => set({ bom: v })}
              label={
                <span
                  className="text-[13px]"
                  title="下载时在文件开头加 UTF-8 BOM，Excel 打开中文不乱码"
                >
                  下载带 BOM
                </span>
              }
            />
          </Opt>
        )}
        {!toCsv && (
          <Opt key="csv-header">
            <Switch
              checked={prefs.csvHeader}
              onChange={(v) => set({ csvHeader: v })}
              label={
                <span className="text-[13px]" title="开启：输出对象数组；关闭：输出二维数组">
                  首行是表头
                </span>
              }
            />
          </Opt>
        )}
        {!toCsv && (
          <Opt key="typing">
            <Switch
              checked={prefs.dynamicTyping}
              onChange={(v) => set({ dynamicTyping: v })}
              label={
                <span
                  className="text-[13px]"
                  title="数字、true / false、空值 → null、JSON 数组 / 对象；007 这类前导零保持字符串"
                >
                  类型推断
                </span>
              }
            />
          </Opt>
        )}
        {!toCsv && (
          <Opt key="unflatten">
            <Switch
              checked={prefs.unflatten && prefs.csvHeader}
              disabled={!prefs.csvHeader}
              onChange={(v) => set({ unflatten: v })}
              label={
                <span className="text-[13px]" title="列名 a.b → { a: { b } }，a.0、a.1 → 数组">
                  还原嵌套
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
              setStored((p) => {
                const cur = sanitize(p)
                return { ...DEFAULT_PREFS, direction: cur.direction, view: cur.view }
              })
            }
          />
        </Opt>
      </AnimatePresence>
    </>
  )

  const switchButton = (to: CsvDirection) => (
    <Button
      size="sm"
      variant="secondary"
      icon={<ArrowLeftRight />}
      onClick={() => changeDirection(to)}
    >
      切换为 {LABEL[to]}
    </Button>
  )

  const outputLabel = toCsv ? (prefs.delimiter === '\t' ? 'TSV' : 'CSV') : 'JSON'

  return (
    <div className="flex flex-col gap-4">
      <IOPanel
        input={input}
        onInputChange={setInput}
        output={output}
        inputLang={toCsv ? 'json' : 'text'}
        inputTitle={toCsv ? 'JSON' : 'CSV'}
        inputPlaceholder={
          toCsv
            ? '粘贴 JSON 数组（或单个对象），实时转换为 CSV…'
            : '粘贴 CSV / TSV，或直接从 Excel 复制单元格…'
        }
        sample={SAMPLE[direction]}
        onSwap={swap}
        acceptFile=".json,.csv,.tsv,.txt,text/*"
        toolbar={toolbar}
        outputActions={
          <>
            <SegmentedControl<View>
              size="sm"
              aria-label="输出视图"
              value={view}
              onChange={(v) => set({ view: v })}
              options={[
                {
                  value: 'code',
                  title: '代码',
                  label: (
                    <>
                      <Code2 aria-hidden />
                      {/* 窄屏只显示图标，屏幕阅读器仍能读到文字 */}
                      <span className="sr-only sm:not-sr-only">代码</span>
                    </>
                  ),
                },
                {
                  value: 'table',
                  title: '表格',
                  label: (
                    <>
                      <Table2 aria-hidden />
                      <span className="sr-only sm:not-sr-only">表格</span>
                    </>
                  ),
                },
              ]}
              className="mr-1"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Download />}
              iconOnly
              title={outCsv && prefs.bom ? '下载（含 UTF-8 BOM）' : '下载'}
              aria-label="下载"
              disabled={!output}
              onClick={download}
            />
          </>
        }
        outputFooter={
          <>
            <span>
              {result.ok
                ? `${output ? output.split('\n').length.toLocaleString() : 0} 行 · ${output.length.toLocaleString()} 字符`
                : '—'}
            </span>
            <span>{outputLabel}</span>
          </>
        }
        outputTitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {outputLabel}
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
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full"
                >
                  {view === 'table' ? (
                    <DataTable
                      headers={shown.table.headers}
                      rows={shown.table.rows}
                      typed={!outCsv && prefs.dynamicTyping}
                    />
                  ) : (
                    <CodeEditor
                      value={shown.output}
                      lang={outCsv ? 'text' : 'json'}
                      lineWrapping={!outCsv}
                      readOnly
                      placeholder={toCsv ? 'CSV 会显示在这里' : 'JSON 会显示在这里'}
                      aria-label={toCsv ? 'CSV 输出' : 'JSON 输出'}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <StaleOverlay show={!result.ok}>
              {!result.ok && result.error.line !== undefined
                ? `第 ${result.error.line} 行有错误`
                : '转换失败'}
              {lastGood.output ? '，显示的是上一次的结果' : ''}
            </StaleOverlay>
          </div>
        }
      />
      <AnimatePresence>
        {result.ok && outCsv && !result.usedPath && result.candidates.length > 0 && (
          <Notice key="candidates" tone="info">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                {result.candidates.length === 1
                  ? `顶层是一个对象，其中 “${result.candidates[0].key}” 是包含 ${result.candidates[0].length} 条记录的数组，只转换它会得到更有用的表格：`
                  : `顶层是一个对象，其中有 ${result.candidates.length} 个对象数组字段，可以只转换其中一个：`}
              </span>
              {result.candidates.slice(0, 4).map((c) => (
                <Button key={c.key} size="sm" variant="secondary" onClick={() => setPath(c.key)}>
                  只转换 {c.key}
                  {result.candidates.length > 1 && (
                    <span className="text-fg-3">（{c.length} 条）</span>
                  )}
                </Button>
              ))}
            </div>
          </Notice>
        )}
        {result.ok && outCsv && result.usedPath && (
          <Notice key="path" tone="info">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>正在转换顶层对象里的 “{result.usedPath}” 数组，其余字段已忽略。</span>
              <Button size="sm" variant="secondary" onClick={() => setPath(null)}>
                转换整个 JSON
              </Button>
            </div>
          </Notice>
        )}
        {suggestion && result.ok && (
          <Notice key="suggest" tone="info">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                输入看起来是 {suggestion === 'csv2json' ? 'CSV' : 'JSON'}，要反过来转换吗？
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
      {label && <span className="text-[13px] whitespace-nowrap text-fg-2">{label}</span>}
      {children}
    </motion.div>
  )
}
