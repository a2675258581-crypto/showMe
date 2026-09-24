import { useMemo, useState } from 'react'
import { AnimatePresence, motion, Reorder } from 'motion/react'
import { Code2, Dices, Download, Plus, Table2 } from 'lucide-react'
import {
  Badge,
  Button,
  CopyButton,
  Input,
  Notice,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
} from '@/components/ui'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EDITOR_HEIGHT, EditorPane } from '@/components/editor/IOPanel'
import type { EditorLang } from '@/components/editor/languages'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { cn } from '@/lib/cn'
import { downloadText, formatBytes } from '@/lib/file'
import {
  FIELD_TYPE_MAP,
  MAX_ROWS,
  PRESETS,
  clampCount,
  generate,
  makeFieldId,
  newSeed,
  presetFields,
  sanitizeFields,
  uniqueName,
  type Cell,
  type FieldDef,
  type FieldType,
} from '@/lib/mock-data'
import {
  OUTPUT_META,
  formatRows,
  type OutputFormat,
  type SqlDialect,
  type SqlOptions,
} from '@/lib/mock-data-format'
import { FieldRow } from './FieldRow'
import { PREVIEW_LIMIT, PreviewTable } from './PreviewTable'

type View = 'table' | 'code'

interface Settings {
  fields: FieldDef[]
  count: number
  format: OutputFormat
  sql: SqlOptions
  seed: number
  view: View
}

let defaultIdSeq = 0
const DEFAULT_FIELDS = presetFields(PRESETS[0], () => `d${defaultIdSeq++}`)

const DEFAULTS: Settings = {
  fields: DEFAULT_FIELDS,
  count: 20,
  format: 'json',
  sql: { table: 'users', batch: 100, dialect: 'mysql' },
  seed: 20240601,
  view: 'table',
}

const FORMAT_OPTIONS = (Object.keys(OUTPUT_META) as OutputFormat[]).map((f) => ({
  value: f,
  label: OUTPUT_META[f].label,
}))

const DIALECTS: { value: SqlDialect; label: string }[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'sqlserver', label: 'SQL Server' },
]

const LANG: Record<OutputFormat, EditorLang> = {
  json: 'json',
  csv: 'text',
  tsv: 'text',
  sql: 'sql',
  markdown: 'markdown',
}

const QUICK_COUNTS = [10, 100, 1000]

const PRESET_OPTIONS = [
  { value: '', label: '套用模板…' },
  ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
]

/** localStorage 里的设置可能来自旧版本或被手改过，逐项校验 */
function sanitize(raw: Partial<Settings> | null): Settings {
  const r: Partial<Settings> = raw && typeof raw === 'object' ? raw : {}
  const sql: Partial<SqlOptions> = r.sql && typeof r.sql === 'object' ? r.sql : DEFAULTS.sql
  return {
    fields: sanitizeFields(r.fields) ?? DEFAULTS.fields,
    count: typeof r.count === 'number' ? clampCount(r.count) : DEFAULTS.count,
    format: r.format && Object.hasOwn(OUTPUT_META, r.format) ? r.format : DEFAULTS.format,
    sql: {
      table: typeof sql.table === 'string' ? sql.table : DEFAULTS.sql.table,
      batch:
        typeof sql.batch === 'number' && Number.isFinite(sql.batch)
          ? Math.max(1, Math.min(1000, Math.round(sql.batch)))
          : DEFAULTS.sql.batch,
      dialect: DIALECTS.find((d) => d.value === sql.dialect)?.value ?? 'mysql',
    },
    seed: typeof r.seed === 'number' ? r.seed >>> 0 : DEFAULTS.seed,
    view: r.view === 'code' ? 'code' : 'table',
  }
}

const label = 'text-xs font-semibold tracking-wide text-fg-2'

export default function MockData() {
  const [stored, setStored] = useLocalStorage<Partial<Settings>>('mock-data.options.v1', DEFAULTS)
  const s = useMemo(() => sanitize(stored), [stored])
  const update = (patch: Partial<Settings> | ((prev: Settings) => Partial<Settings>)) =>
    setStored((prev) => {
      const cur = sanitize(prev)
      return { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
    })

  // 数字输入框的草稿：允许暂时清空再输入，失焦后恢复为实际值
  const [countDraft, setCountDraft] = useState<string | null>(null)
  const [batchDraft, setBatchDraft] = useState<string | null>(null)
  const [spin, setSpin] = useState(0)

  // 生成相对较重：字段 / 行数 / 种子变化后稍等再算
  const genInput = useMemo(
    () => ({ fields: s.fields, count: s.count, seed: s.seed }),
    [s.fields, s.count, s.seed],
  )
  const debounced = useDebounced(genInput, 150)
  const result = useMemo(
    () => generate(debounced.fields, debounced.count, debounced.seed),
    [debounced],
  )
  const samples = useMemo(() => {
    const m = new Map<string, Cell>()
    debounced.fields.forEach((f, i) => {
      const v = result.rows[0]?.[i]
      if (v !== undefined) m.set(f.id, v)
    })
    return m
  }, [debounced.fields, result])

  const { table, batch, dialect } = s.sql
  const output = useMemo(
    () => formatRows(result.columns, result.rows, s.format, { table, batch, dialect }),
    [result, s.format, table, batch, dialect],
  )
  const bytes = useMemo(() => new TextEncoder().encode(output).length, [output])
  const pending = debounced !== genInput

  const addField = () =>
    update((cur) => ({
      fields: [
        ...cur.fields,
        {
          id: makeFieldId(),
          name: uniqueName(
            FIELD_TYPE_MAP.zhName.defaultName,
            cur.fields.map((f) => f.name),
          ),
          type: 'zhName',
          options: {},
        },
      ],
    }))

  const changeType = (id: string, type: FieldType) =>
    update((cur) => ({
      fields: cur.fields.map((f) => {
        if (f.id !== id) return f
        // 名字还是旧类型的默认名时，顺手换成新类型的默认名
        const oldDefault = FIELD_TYPE_MAP[f.type].defaultName
        const autoNamed = f.name === oldDefault || new RegExp(`^${oldDefault}_\\d+$`).test(f.name)
        const name = autoNamed
          ? uniqueName(
              FIELD_TYPE_MAP[type].defaultName,
              cur.fields.filter((x) => x.id !== id).map((x) => x.name),
            )
          : f.name
        return { ...f, type, name, options: {} }
      }),
    }))

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    update((cur) => ({
      fields: presetFields(p),
      sql: { ...cur.sql, table: p.id === 'company' ? 'companies' : `${p.id}s` },
    }))
  }

  const regenerate = () => {
    setSpin((v) => v + 1)
    update({ seed: newSeed() })
  }

  const download = () => {
    const meta = OUTPUT_META[s.format]
    const base = (s.format === 'sql' && s.sql.table.trim()) || 'mock-data'
    // CSV / TSV 带 BOM，Excel 打开中文不乱码
    const bom = s.format === 'csv' || s.format === 'tsv' ? '﻿' : ''
    downloadText(`${base.replace(/[\\/:*?"<>|]/g, '_')}.${meta.ext}`, bom + output, meta.mime)
  }

  const formatLabel = OUTPUT_META[s.format].label

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {/* 顶部选项条 */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-3xl border border-line bg-surface px-4 py-3.5 shadow-card sm:px-5">
        <div className="flex flex-col gap-1.5">
          <span className={label}>行数（1–{MAX_ROWS}）</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_ROWS}
              value={countDraft ?? String(s.count)}
              onChange={(e) => {
                setCountDraft(e.target.value)
                const n = Number(e.target.value)
                if (e.target.value.trim() && Number.isFinite(n)) update({ count: clampCount(n) })
              }}
              onBlur={() => setCountDraft(null)}
              aria-label="行数"
              mono
              className="mr-1 h-9! w-24!"
            />
            {QUICK_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setCountDraft(null)
                  update({ count: n })
                }}
                aria-label={`生成 ${n} 行`}
                className={cn(
                  'h-7 rounded-full px-2.5 font-mono text-xs transition-colors',
                  s.count === n
                    ? 'bg-accent-soft text-accent'
                    : 'text-fg-2 hover:bg-fill-2 hover:text-fg',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex max-w-full min-w-0 flex-col gap-1.5">
          <span className={label}>输出格式</span>
          <div className="no-scrollbar max-w-full overflow-x-auto">
            <SegmentedControl
              options={FORMAT_OPTIONS}
              value={s.format}
              onChange={(format) => update({ format })}
              aria-label="输出格式"
              size="sm"
            />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {s.format === 'sql' && (
            <motion.div
              key="sql"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="flex flex-wrap items-end gap-3"
            >
              <label className="flex flex-col gap-1.5">
                <span className={label}>表名</span>
                <Input
                  value={s.sql.table}
                  onChange={(e) => update({ sql: { ...s.sql, table: e.target.value } })}
                  placeholder="mock_data"
                  mono
                  className="h-9! w-36!"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>每条 INSERT 行数</span>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  inputMode="numeric"
                  value={batchDraft ?? String(s.sql.batch)}
                  onChange={(e) => {
                    const raw = e.target.value
                    setBatchDraft(raw)
                    const n = Math.round(Number(raw))
                    if (raw.trim() && Number.isFinite(n)) {
                      update((cur) => ({
                        sql: { ...cur.sql, batch: Math.max(1, Math.min(1000, n)) },
                      }))
                    }
                  }}
                  onBlur={() => setBatchDraft(null)}
                  mono
                  className="h-9! w-24!"
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className={label}>方言</span>
                <Select
                  value={s.sql.dialect}
                  onChange={(v) => update({ sql: { ...s.sql, dialect: v as SqlDialect } })}
                  options={DIALECTS}
                  aria-label="SQL 方言"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="hidden font-mono text-[11px] text-fg-3 md:inline"
            title="相同的种子与字段总是生成相同的数据"
          >
            种子 {s.seed}
          </span>
          <Button
            variant="primary"
            onClick={regenerate}
            icon={
              <motion.span
                animate={{ rotate: spin * 180 }}
                transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                className="flex"
              >
                <Dices />
              </motion.span>
            }
          >
            重新生成
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-2">
        {/* 字段编辑 */}
        <Panel padded={false} className="min-w-0 p-4 sm:p-5">
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                字段 <Badge>{s.fields.length}</Badge>
              </span>
            }
          >
            <Select
              value=""
              onChange={applyPreset}
              options={PRESET_OPTIONS}
              aria-label="套用模板"
              size="sm"
            />
            <Button size="sm" variant="secondary" icon={<Plus />} onClick={addField}>
              添加字段
            </Button>
          </PanelHeader>

          {s.fields.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-10 text-center">
              <p className="text-sm text-fg-2">还没有字段，添加一个或套用模板开始吧。</p>
              <Button size="sm" variant="primary" icon={<Plus />} onClick={addField}>
                添加字段
              </Button>
            </div>
          ) : (
            <Reorder.Group
              axis="y"
              values={s.fields}
              onReorder={(fields: FieldDef[]) => update({ fields })}
              className="flex flex-col gap-2"
            >
              <AnimatePresence initial={false}>
                {s.fields.map((f, i) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    index={i}
                    sample={samples.get(f.id)}
                    canRemove={s.fields.length > 1}
                    onChange={(next) =>
                      update((cur) => ({
                        fields: cur.fields.map((x) => (x.id === f.id ? next : x)),
                      }))
                    }
                    onTypeChange={(t) => changeType(f.id, t)}
                    onRemove={() =>
                      update((cur) => ({ fields: cur.fields.filter((x) => x.id !== f.id) }))
                    }
                    onMove={(delta) =>
                      update((cur) => {
                        const from = cur.fields.findIndex((x) => x.id === f.id)
                        const to = from + delta
                        if (from < 0 || to < 0 || to >= cur.fields.length) return {}
                        const fields = cur.fields.slice()
                        ;[fields[from], fields[to]] = [fields[to], fields[from]]
                        return { fields }
                      })
                    }
                  />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          )}
          <p className="mt-3 text-xs leading-relaxed text-fg-3">
            拖动左侧把手调整列顺序。每列使用独立的随机流，修改某一列不会打乱其它列；「重新生成」会换一个随机种子。
          </p>
        </Panel>

        {/* 输出 */}
        <div className="order-first flex min-w-0 flex-col gap-3 xl:sticky xl:top-20 xl:order-none">
          <EditorPane
            height={EDITOR_HEIGHT}
            title={
              <SegmentedControl
                size="sm"
                value={s.view}
                onChange={(view) => update({ view })}
                aria-label="预览方式"
                options={[
                  {
                    value: 'table',
                    label: (
                      <>
                        <Table2 />
                        表格
                      </>
                    ),
                  },
                  {
                    value: 'code',
                    label: (
                      <>
                        <Code2 />
                        {formatLabel}
                      </>
                    ),
                  },
                ]}
              />
            }
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Download />}
                  iconOnly
                  title={`下载 .${OUTPUT_META[s.format].ext} 文件`}
                  aria-label={`下载 ${formatLabel} 文件`}
                  disabled={!output}
                  onClick={download}
                />
                <CopyButton text={() => output} disabled={!output} label={`复制 ${formatLabel}`} />
              </>
            }
            footer={
              <>
                <span>
                  {result.rows.length.toLocaleString()} 行 · {result.columns.length} 列
                  {s.view === 'table' && result.rows.length > PREVIEW_LIMIT
                    ? ` · 表格仅预览前 ${PREVIEW_LIMIT} 行，复制 / 下载包含全部`
                    : ''}
                </span>
                <span className="flex items-center gap-2">
                  <AnimatePresence>
                    {pending && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        className="size-1.5 rounded-full bg-accent"
                        aria-label="生成中"
                      />
                    )}
                  </AnimatePresence>
                  {formatBytes(bytes)}
                </span>
              </>
            }
          >
            <motion.div
              key={`${s.view}-${debounced.seed}`}
              initial={{ opacity: 0.35 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35 }}
              className="h-full"
            >
              {s.view === 'code' ? (
                <CodeEditor value={output} lang={LANG[s.format]} readOnly aria-label="生成结果" />
              ) : result.columns.length ? (
                <PreviewTable columns={result.columns} rows={result.rows} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-fg-3">
                  添加字段后在这里预览数据
                </div>
              )}
            </motion.div>
          </EditorPane>

          <AnimatePresence>
            {result.warnings.length > 0 && (
              <Notice key="warn" tone="warning">
                {result.warnings.join('\n')}
              </Notice>
            )}
          </AnimatePresence>
          {(s.format === 'csv' || s.format === 'tsv') && (
            <p className="px-1 text-xs text-fg-3">
              下载的文件带 UTF-8 BOM，用 Excel 直接打开中文不会乱码。身份证号、银行卡号等超过 15
              位的数字会被 Excel 当成数值截断，请用「数据 → 从文本/CSV」导入并把这些列设为文本。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
