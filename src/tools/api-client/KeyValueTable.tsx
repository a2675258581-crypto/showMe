import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileUp, ListTree, Paperclip, TextCursorInput, Trash2 } from 'lucide-react'
import { Button, TextArea } from '@/components/ui'
import { kv, uid, type FormField, type KeyValue } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/file'
import { hasFile, setFile } from './files'
import { VarInput } from './VarInput'

interface Props<T extends KeyValue> {
  rows: T[]
  onChange: (rows: T[]) => void
  vars: Record<string, string>
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** 键名输入框的自动补全候选 */
  keySuggestions?: string[]
  /** 值输入框的自动补全候选（按键名） */
  valueSuggestions?: (key: string) => string[] | undefined
  /** form-data 模式：每行可切换 文本 / 文件 */
  formData?: boolean
  /** 允许批量编辑（key: value 每行一条） */
  bulk?: boolean
  emptyHint?: string
}

function toBulk(rows: KeyValue[]): string {
  return rows
    .map((r) => `${r.enabled ? '' : '// '}${r.key}${r.value !== '' ? `: ${r.value}` : ''}`)
    .join('\n')
}

/** 行内容的签名（忽略 id），用来判断批量编辑的文本是否已经过期 */
function contentOf(rows: KeyValue[]): string {
  return JSON.stringify(rows.map((r) => [r.key, r.value, r.enabled]))
}

function fromBulk<T extends KeyValue>(text: string, prev: T[]): T[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((line, i) => {
      let l = line.trim()
      const enabled = !l.startsWith('//')
      if (!enabled) l = l.replace(/^\/\/\s*/, '')
      const c = l.indexOf(':')
      const key = (c < 0 ? l : l.slice(0, c)).trim()
      const value = c < 0 ? '' : l.slice(c + 1).trim()
      return { ...(prev[i] ?? kv()), id: prev[i]?.id ?? uid(), key, value, enabled } as T
    })
}

/** Postman 式键值表：勾选启用、末尾空行直接输入即新增、行进出带动画 */
export function KeyValueTable<T extends KeyValue>({
  rows,
  onChange,
  vars,
  keyPlaceholder = '参数名',
  valuePlaceholder = '值',
  keySuggestions,
  valueSuggestions,
  formData,
  bulk,
  emptyHint,
}: Props<T>) {
  const listId = useId()
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState('')
  // 批量编辑的文本对应的行内容；行被外部改动（在 URL 栏输入、切换环境…）时重新生成文本
  const [bulkSynced, setBulkSynced] = useState('')
  if (bulkMode && contentOf(rows) !== bulkSynced) {
    setBulkSynced(contentOf(rows))
    setBulkText(toBulk(rows))
  }
  // 末尾「空行」的 id：在空行里输入时它直接变成真正的一行（React key 不变），
  // 输入框不会重新挂载，光标和中文输入法的组字状态都能保留
  const [ghostId, setGhostId] = useState(uid)

  const update = (id: string, patch: Partial<FormField>) =>
    onChange(rows.map((r) => (r.id === id ? ({ ...r, ...patch } as T) : r)))
  const remove = (id: string) => {
    setFile(id, undefined)
    onChange(rows.filter((r) => r.id !== id))
  }
  const addFromGhost = (patch: Partial<FormField>) => {
    const row = { ...kv(), ...(formData ? { type: 'text' } : {}), ...patch, id: ghostId } as T
    onChange([...rows, row])
    setGhostId(uid())
  }
  const ghostRow: FormField = { id: ghostId, key: '', value: '', enabled: true, type: 'text' }
  const items = [
    ...rows.map((r) => ({ row: r as unknown as FormField, ghost: false })),
    { row: ghostRow, ghost: true },
  ]
  const enabledCount = rows.filter((r) => r.enabled && r.key).length
  const allOn = rows.length > 0 && rows.every((r) => r.enabled)

  return (
    <div className="flex flex-col gap-2">
      {keySuggestions && (
        <datalist id={`${listId}-keys`}>
          {keySuggestions.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-fg-3">
        <span>
          {rows.length
            ? `${enabledCount} / ${rows.length} 项已启用`
            : (emptyHint ?? '在下方空行输入即可新增')}
        </span>
        {bulk && (
          <Button
            size="sm"
            variant="ghost"
            icon={bulkMode ? <ListTree /> : <TextCursorInput />}
            onClick={() => {
              if (!bulkMode) {
                setBulkText(toBulk(rows))
                setBulkSynced(contentOf(rows))
              }
              setBulkMode(!bulkMode)
            }}
          >
            {bulkMode ? '表格编辑' : '批量编辑'}
          </Button>
        )}
      </div>

      {bulkMode ? (
        <TextArea
          mono
          value={bulkText}
          onChange={(e) => {
            const next = fromBulk(e.target.value, rows)
            setBulkText(e.target.value)
            setBulkSynced(contentOf(next))
            onChange(next)
          }}
          placeholder={'每行一条，格式为「名称: 值」\n以 // 开头表示禁用'}
          className="min-h-40"
          aria-label="批量编辑"
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div
            className={cn(
              'hidden items-center gap-2 border-b border-line bg-fill-2 px-2 py-1.5 text-[11px] font-semibold tracking-wide text-fg-2 sm:grid',
              formData
                ? 'grid-cols-[24px_minmax(0,1fr)_76px_minmax(0,1.4fr)_32px]'
                : 'grid-cols-[24px_minmax(0,1fr)_minmax(0,1.4fr)_32px]',
            )}
          >
            <input
              type="checkbox"
              aria-label="全部启用"
              checked={allOn}
              disabled={!rows.length}
              onChange={() => onChange(rows.map((r) => ({ ...r, enabled: !allOn })))}
              className="mx-auto size-3.5 cursor-pointer accent-[var(--accent)]"
            />
            <span className="px-1">名称</span>
            {formData && <span className="px-1">类型</span>}
            <span className="px-1">值</span>
            <span />
          </div>
          <AnimatePresence initial={false}>
            {/* 真实的行与末尾的空行在同一个数组里，空行变成真实行时 key 不变 */}
            {items.map(({ row: r, ghost }) => (
              <motion.div
                key={r.id}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                className={ghost ? undefined : 'border-b border-line'}
              >
                <Row
                  row={r}
                  ghost={ghost}
                  formData={formData}
                  vars={vars}
                  listId={keySuggestions ? `${listId}-keys` : undefined}
                  valueList={ghost ? undefined : valueSuggestions?.(r.key)}
                  keyPlaceholder={keyPlaceholder}
                  valuePlaceholder={valuePlaceholder}
                  onPatch={ghost ? addFromGhost : (p) => update(r.id, p)}
                  onRemove={() => remove(r.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function Row({
  row,
  ghost,
  formData,
  vars,
  listId,
  valueList,
  keyPlaceholder,
  valuePlaceholder,
  onPatch,
  onRemove,
}: {
  row: FormField
  ghost?: boolean
  formData?: boolean
  vars: Record<string, string>
  listId?: string
  valueList?: string[]
  keyPlaceholder: string
  valuePlaceholder: string
  onPatch: (p: Partial<FormField>) => void
  onRemove: () => void
}) {
  const valueListId = useId()
  const isFile = formData && row.type === 'file'
  const fileMissing = isFile && !!row.fileName && !hasFile(row.id)
  const trailing = formData ? 'col-start-4 sm:col-start-5' : 'col-start-3 sm:col-start-4'

  const pickFile = () => {
    const el = document.createElement('input')
    el.type = 'file'
    el.onchange = () => {
      const f = el.files?.[0]
      if (!f) return
      setFile(row.id, f)
      if (ghost) {
        // 空行里直接选文件：直接变成一个文件字段
        onPatch({
          type: 'file',
          key: 'file',
          fileName: f.name,
          fileSize: f.size,
          fileType: f.type,
        })
        return
      }
      onPatch({ fileName: f.name, fileSize: f.size, fileType: f.type })
    }
    el.click()
  }

  return (
    <div
      className={cn(
        'grid items-center gap-x-2 gap-y-1.5 px-2 py-1.5',
        formData
          ? 'grid-cols-[24px_minmax(0,1fr)_76px_32px] sm:grid-cols-[24px_minmax(0,1fr)_76px_minmax(0,1.4fr)_32px]'
          : 'grid-cols-[24px_minmax(0,1fr)_32px] sm:grid-cols-[24px_minmax(0,1fr)_minmax(0,1.4fr)_32px]',
        ghost && 'opacity-70 focus-within:opacity-100',
      )}
    >
      <input
        type="checkbox"
        aria-label={row.enabled ? '禁用这一项' : '启用这一项'}
        checked={row.enabled}
        disabled={ghost}
        onChange={() => onPatch({ enabled: !row.enabled })}
        className="col-start-1 row-start-1 mx-auto size-3.5 cursor-pointer accent-[var(--accent)] disabled:opacity-30"
      />
      <input
        value={row.key}
        onChange={(e) => onPatch({ key: e.target.value })}
        placeholder={keyPlaceholder}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        aria-label="名称"
        className={cn(
          'col-start-2 row-start-1 h-8 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-3 outline-none transition-colors hover:border-line focus:border-accent focus:bg-surface',
          !row.enabled && !ghost && 'text-fg-3 line-through',
        )}
      />
      {formData && (
        <select
          value={row.type}
          aria-label="字段类型"
          onChange={(e) => onPatch({ type: e.target.value as FormField['type'] })}
          disabled={ghost}
          className="col-start-3 row-start-1 h-8 w-full cursor-pointer rounded-lg bg-fill px-2 text-xs font-medium text-fg outline-none disabled:opacity-40"
        >
          <option value="text">文本</option>
          <option value="file">文件</option>
        </select>
      )}
      <div
        className={cn(
          'min-w-0',
          formData
            ? 'col-span-2 col-start-2 row-start-2 sm:col-span-1 sm:col-start-4 sm:row-start-1'
            : 'col-start-2 row-start-2 sm:col-start-3 sm:row-start-1',
        )}
      >
        {isFile ? (
          <button
            type="button"
            onClick={pickFile}
            className={cn(
              'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-dashed px-2 text-left text-[12.5px] transition-colors hover:bg-fill-2',
              fileMissing ? 'border-warning/50 text-warning' : 'border-line-strong text-fg',
            )}
            title={fileMissing ? '刷新后文件需要重新选择' : '选择文件'}
          >
            {row.fileName ? (
              <Paperclip className="size-3.5 shrink-0" />
            ) : (
              <FileUp className="size-3.5 shrink-0 text-fg-2" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {row.fileName ?? <span className="text-fg-3">选择文件…</span>}
            </span>
            {row.fileName && (
              <span className="shrink-0 text-[11px] text-fg-3">
                {fileMissing ? '需重新选择' : formatBytes(row.fileSize ?? 0)}
              </span>
            )}
          </button>
        ) : (
          <>
            {valueList && (
              <datalist id={valueListId}>
                {valueList.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            )}
            <VarInput
              size="sm"
              value={row.value}
              onChange={(v) => onPatch({ value: v })}
              vars={vars}
              placeholder={valuePlaceholder}
              list={valueList ? valueListId : undefined}
              aria-label="值"
              className={cn(!row.enabled && !ghost && 'opacity-50')}
            />
          </>
        )}
      </div>
      {!ghost ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="删除这一项"
          title="删除"
          className={cn(
            'row-start-1 inline-flex size-8 items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-danger/10 hover:text-danger',
            trailing,
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : formData ? (
        <button
          type="button"
          onClick={pickFile}
          aria-label="添加文件字段"
          title="添加文件字段"
          className={cn(
            'row-start-1 inline-flex size-8 items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg',
            trailing,
          )}
        >
          <FileUp className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
