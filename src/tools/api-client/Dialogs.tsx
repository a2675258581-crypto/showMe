import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileDown, Import, Plus, Save, Trash2 } from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Input,
  Notice,
  Select,
  TextArea,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { kv, uid, varsToRecord } from '@/lib/api-client'
import type { Collection, Environment, EnvironmentsState, SaveTarget } from '@/lib/api-client-store'
import { cn } from '@/lib/cn'
import { parseCurl, type HttpRequest } from '@/lib/curl'
import { downloadText } from '@/lib/file'
import { CODE_TARGETS, CODE_TARGET_MAP, generateCode, type CodeTarget } from '@/lib/http-codegen'
import { editorLangFor } from '@/components/editor/streamLangs'
import { Dialog } from './Dialog'
import { KeyValueTable } from './KeyValueTable'
import { MethodBadge } from './MethodBadge'

// ───────────────────────────── 保存到集合 ─────────────────────────────

export function SaveDialog({
  open,
  onClose,
  collections,
  defaultName,
  onSave,
}: {
  open: boolean
  onClose: () => void
  collections: Collection[]
  defaultName: string
  onSave: (target: SaveTarget) => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="保存到集合"
      description="保存后可以在侧栏「集合」里随时打开"
    >
      {open && (
        <SaveForm
          collections={collections}
          defaultName={defaultName}
          onSave={onSave}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

function SaveForm({
  collections,
  defaultName,
  onSave,
  onClose,
}: {
  collections: Collection[]
  defaultName: string
  onSave: (target: SaveTarget) => void
  onClose: () => void
}) {
  const [name, setName] = useState(defaultName)
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '')
  const [newName, setNewName] = useState(collections.length ? '' : '我的集合')
  const creating = collectionId === ''
  const submit = () => {
    if (!name.trim()) return
    onSave(creating ? { name, newCollectionName: newName } : { name, collectionId })
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Field label="请求名称">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：获取用户详情"
        />
      </Field>
      <Field label="集合">
        <Select
          value={collectionId}
          onChange={setCollectionId}
          options={[
            ...collections.map((c) => ({
              value: c.id,
              label: `${c.name}（${c.requests.length}）`,
            })),
            { value: '', label: '＋ 新建集合…' },
          ]}
          className="w-full"
          aria-label="选择集合"
        />
      </Field>
      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Field label="新集合名称">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：用户服务"
              />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" variant="primary" icon={<Save />} disabled={!name.trim()}>
          保存
        </Button>
      </div>
    </form>
  )
}

// ───────────────────────────── 关闭未保存的标签 ─────────────────────────────

export function ConfirmCloseDialog({
  open,
  name,
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean
  name: string
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      size="sm"
      title="有未保存的修改"
      description={`「${name}」的修改还没有保存到集合，关闭后会丢失。`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            不保存
          </Button>
          <Button variant="primary" icon={<Save />} onClick={onSave} autoFocus>
            保存
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-fg-2">要先保存再关闭吗？</p>
    </Dialog>
  )
}

// ───────────────────────────── 导入 cURL ─────────────────────────────

export function CurlImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (request: HttpRequest, warnings: string[]) => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="导入 cURL"
      description="支持 bash / zsh、Windows cmd 与浏览器开发者工具「复制为 cURL」。也可以直接把 curl 命令粘贴到 URL 输入框。"
    >
      {open && <CurlImportForm onImport={onImport} onClose={onClose} />}
    </Dialog>
  )
}

function CurlImportForm({
  onImport,
  onClose,
}: {
  onImport: (request: HttpRequest, warnings: string[]) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const debounced = useDebounced(text, 120)
  const parsed = useMemo(() => (debounced.trim() ? parseCurl(debounced) : null), [debounced])
  return (
    <div className="flex flex-col gap-3">
      <TextArea
        autoFocus
        mono
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "curl 'https://api.example.com/users' \\\n  -H 'Authorization: Bearer xxx' \\\n  --data-raw '{\"name\":\"张三\"}'"
        }
        className="min-h-44"
        aria-label="cURL 命令"
      />
      <AnimatePresence mode="wait" initial={false}>
        {parsed?.ok && (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex min-w-0 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3 py-2"
          >
            <MethodBadge method={parsed.request.method} variant="pill" />
            <span className="min-w-0 truncate font-mono text-[12.5px] text-fg">
              {parsed.request.url}
            </span>
            <span className="ml-auto shrink-0 text-xs text-fg-3">
              {parsed.request.headers.length} 个请求头
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <ErrorNotice error={parsed && !parsed.ok ? parsed.error : null} />
      {parsed && parsed.warnings.length > 0 && (
        <Notice tone="warning">
          <ul className="list-disc pl-4">
            {parsed.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          icon={<Import />}
          disabled={!parsed?.ok}
          onClick={() => parsed?.ok && onImport(parsed.request, parsed.warnings)}
        >
          导入
        </Button>
      </div>
    </div>
  )
}

// ───────────────────────────── 生成代码 ─────────────────────────────

export function CodeDialog({
  open,
  onClose,
  request,
  target,
  onTarget,
  missingVars,
}: {
  open: boolean
  onClose: () => void
  request: HttpRequest
  target: CodeTarget
  onTarget: (t: CodeTarget) => void
  missingVars: string[]
}) {
  const info = CODE_TARGET_MAP[target] ?? CODE_TARGET_MAP.curl
  const code = useMemo(() => (open ? generateCode(request, info.id) : ''), [open, request, info.id])
  const editor = editorLangFor(info.lang)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="生成代码"
      description="把当前请求（已替换环境变量）导出为各语言代码"
      footer={
        <>
          <Button
            variant="ghost"
            icon={<FileDown />}
            onClick={() => downloadText(info.filename, code)}
            disabled={!code}
          >
            下载 {info.filename}
          </Button>
          <CopyButton text={code} variant="primary" size="md" />
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={info.id}
            onChange={(v) => onTarget(v as CodeTarget)}
            options={CODE_TARGETS.map((t) => ({ value: t.id, label: t.label }))}
            aria-label="目标语言"
            className="min-w-48"
          />
          {request.body.kind === 'multipart' || request.body.kind === 'file' ? (
            <span className="text-xs text-fg-3">文件以文件名占位，运行前请改成实际路径</span>
          ) : null}
        </div>
        {missingVars.length > 0 && (
          <Notice tone="warning">
            变量 {missingVars.map((v) => `{{${v}}}`).join('、')} 在当前环境中没有定义，已原样保留。
          </Notice>
        )}
        <div
          className="thin-scrollbar overflow-auto rounded-2xl border border-line bg-surface-2"
          style={{ height: 'clamp(280px, 55vh, 560px)' }}
          data-lenis-prevent
        >
          <CodeEditor
            value={code}
            readOnly
            lang={editor.lang}
            extensions={editor.extensions}
            aria-label="生成的代码"
          />
        </div>
      </div>
    </Dialog>
  )
}

// ───────────────────────────── 环境管理 ─────────────────────────────

export function EnvironmentsDialog({
  open,
  onClose,
  state,
  onChange,
}: {
  open: boolean
  onClose: () => void
  state: EnvironmentsState
  onChange: (s: EnvironmentsState) => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="管理环境"
      description="环境变量可以在 URL、参数、请求头、请求体和认证里用 {{变量名}} 引用"
    >
      {open && <EnvironmentsEditor state={state} onChange={onChange} />}
    </Dialog>
  )
}

function EnvironmentsEditor({
  state,
  onChange,
}: {
  state: EnvironmentsState
  onChange: (s: EnvironmentsState) => void
}) {
  const [selected, setSelected] = useState(state.activeId ?? state.environments[0]?.id ?? '')
  const [confirmDel, setConfirmDel] = useState(false)
  const env = state.environments.find((e) => e.id === selected) ?? state.environments[0]

  const patch = (id: string, p: Partial<Environment>) =>
    onChange({
      ...state,
      environments: state.environments.map((e) => (e.id === id ? { ...e, ...p } : e)),
    })
  const add = () => {
    const e: Environment = {
      id: uid(),
      name: `新环境 ${state.environments.length + 1}`,
      variables: [kv('baseUrl', '')],
    }
    onChange({ ...state, environments: [...state.environments, e] })
    setSelected(e.id)
  }
  const remove = (id: string) => {
    const rest = state.environments.filter((e) => e.id !== id)
    onChange({ environments: rest, activeId: state.activeId === id ? null : state.activeId })
    setSelected(rest[0]?.id ?? '')
    setConfirmDel(false)
  }

  return (
    <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        {state.environments.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => {
              setSelected(e.id)
              setConfirmDel(false)
            }}
            className={cn(
              'relative flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors',
              env?.id === e.id ? 'text-fg' : 'text-fg-2 hover:bg-fill-2 hover:text-fg',
            )}
          >
            {env?.id === e.id && (
              <motion.span
                layoutId="env-active"
                className="absolute inset-0 rounded-xl bg-fill"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative min-w-0 flex-1 truncate font-medium">{e.name}</span>
            <span className="relative text-[11px] text-fg-3 tabular-nums">
              {Object.keys(varsToRecord(e.variables)).length}
            </span>
            {state.activeId === e.id && (
              <span className="relative size-1.5 rounded-full bg-sys-green" title="当前使用中" />
            )}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus />}
          className="mt-1 justify-start"
          onClick={add}
        >
          新建环境
        </Button>
      </div>

      {env ? (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="环境名称" className="min-w-0 flex-1">
              <Input value={env.name} onChange={(e) => patch(env.id, { name: e.target.value })} />
            </Field>
            <Button
              variant={state.activeId === env.id ? 'secondary' : 'primary'}
              onClick={() =>
                onChange({ ...state, activeId: state.activeId === env.id ? null : env.id })
              }
            >
              {state.activeId === env.id ? '停用' : '设为当前环境'}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={() => (confirmDel ? remove(env.id) : setConfirmDel(true))}
              onBlur={() => setConfirmDel(false)}
            >
              {confirmDel ? '确认删除' : '删除'}
            </Button>
          </div>
          <KeyValueTable
            key={env.id}
            rows={env.variables}
            onChange={(variables) => patch(env.id, { variables })}
            vars={varsToRecord(env.variables)}
            keyPlaceholder="变量名"
            valuePlaceholder="值"
            bulk
            emptyHint="例如 baseUrl = https://api.example.com"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center text-[13px] text-fg-3">
          还没有环境
          <Button size="sm" variant="primary" icon={<Plus />} onClick={add}>
            新建环境
          </Button>
        </div>
      )}
    </div>
  )
}
