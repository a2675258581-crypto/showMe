import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Braces,
  CircleCheck,
  CircleAlert,
  FileUp,
  Minimize2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Button, DropZone, ErrorNotice, SegmentedControl } from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import {
  formatJsonText,
  validateJson,
  type ApiRequest,
  type BodyMode,
  type RequestBodyState,
} from '@/lib/api-client'
import { prettyXml } from '@/lib/api-client-response'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/file'
import { binaryKey, hasFile, setFile } from './files'
import { KeyValueTable } from './KeyValueTable'

const MODES: { value: BodyMode; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: '文本' },
  { value: 'xml', label: 'XML' },
  { value: 'urlencoded', label: 'URL 编码表单' },
  { value: 'form-data', label: 'form-data' },
  { value: 'binary', label: '二进制' },
]

const EDITOR_H = 'clamp(200px, 36vh, 360px)'

/**
 * ⌘/Ctrl + Enter 用来发送请求（页面级快捷键），这里只吞掉 CodeMirror 默认的「插入空行」。
 * 事件仍会冒泡到 window，由 useHotkey 负责发送。
 */
const SEND_KEY = [Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => true }]))]

export function BodyEditor({
  request,
  tabId,
  vars,
  onChange,
}: {
  request: ApiRequest
  tabId: string
  vars: Record<string, string>
  onChange: (body: RequestBodyState) => void
}) {
  const body = request.body
  const set = (patch: Partial<RequestBodyState>) => onChange({ ...body, ...patch })
  const debouncedJson = useDebounced(body.json, 250)
  // {{变量}} 可以出现在值的位置，例如 {"id": {{userId}}}
  const jsonCheck = useMemo(
    () =>
      body.mode === 'json'
        ? validateJson(debouncedJson, { allowVars: true })
        : { ok: true as const },
    [body.mode, debouncedJson],
  )
  const reformat = (indent: number) => {
    const f = formatJsonText(body.json, indent, { allowVars: true })
    if (f !== null) set({ json: f })
  }
  const binaryMissing = body.mode === 'binary' && !!body.binary && !hasFile(binaryKey(tabId))

  return (
    <div className="flex flex-col gap-3">
      <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
        <SegmentedControl
          size="sm"
          aria-label="请求体类型"
          value={body.mode}
          onChange={(mode) => set({ mode })}
          options={MODES}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={body.mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
          className="flex flex-col gap-3"
        >
          {body.mode === 'none' && (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-fg-3">
              这个请求没有请求体
            </p>
          )}

          {body.mode === 'json' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Braces />}
                  disabled={!body.json.trim() || !jsonCheck.ok}
                  onClick={() => reformat(2)}
                >
                  格式化
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Minimize2 />}
                  disabled={!body.json.trim() || !jsonCheck.ok}
                  onClick={() => reformat(0)}
                >
                  压缩
                </Button>
                <span
                  className={cn(
                    'ml-auto inline-flex items-center gap-1 text-xs font-medium',
                    !body.json.trim() ? 'text-fg-3' : jsonCheck.ok ? 'text-success' : 'text-danger',
                  )}
                >
                  {body.json.trim() &&
                    (jsonCheck.ok ? (
                      <CircleCheck className="size-3.5" />
                    ) : (
                      <CircleAlert className="size-3.5" />
                    ))}
                  {!body.json.trim() ? '支持 {{变量}}' : jsonCheck.ok ? '合法 JSON' : 'JSON 有错误'}
                </span>
              </div>
              <EditorBox>
                <CodeEditor
                  value={body.json}
                  onChange={(json) => set({ json })}
                  lang="json"
                  extensions={SEND_KEY}
                  placeholder={'{\n  "name": "张三",\n  "id": {{userId}}\n}'}
                  aria-label="JSON 请求体"
                />
              </EditorBox>
              <ErrorNotice error={jsonCheck.ok ? null : jsonCheck.error} />
            </>
          )}

          {body.mode === 'text' && (
            <EditorBox>
              <CodeEditor
                value={body.text}
                onChange={(text) => set({ text })}
                extensions={SEND_KEY}
                placeholder="纯文本请求体，支持 {{变量}}"
                aria-label="文本请求体"
              />
            </EditorBox>
          )}

          {body.mode === 'xml' && (
            <>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Braces />}
                  disabled={!body.xml.trim()}
                  onClick={() => set({ xml: prettyXml(body.xml) })}
                >
                  格式化
                </Button>
              </div>
              <EditorBox>
                <CodeEditor
                  value={body.xml}
                  onChange={(xml) => set({ xml })}
                  lang="xml"
                  extensions={SEND_KEY}
                  placeholder={
                    '<?xml version="1.0" encoding="UTF-8"?>\n<user>\n  <name>张三</name>\n</user>'
                  }
                  aria-label="XML 请求体"
                />
              </EditorBox>
            </>
          )}

          {body.mode === 'urlencoded' && (
            <KeyValueTable
              rows={body.urlencoded}
              onChange={(urlencoded) => set({ urlencoded })}
              vars={vars}
              keyPlaceholder="字段名"
              bulk
              emptyHint="以 application/x-www-form-urlencoded 编码发送"
            />
          )}

          {body.mode === 'form-data' && (
            <KeyValueTable
              rows={body.formData}
              onChange={(formData) => set({ formData })}
              vars={vars}
              keyPlaceholder="字段名"
              formData
              emptyHint="以 multipart/form-data 发送，可以上传文件"
            />
          )}

          {body.mode === 'binary' &&
            (body.binary ? (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3',
                  binaryMissing ? 'border-warning/40 bg-warning/5' : 'border-line bg-surface-2',
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <FileUp className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg">{body.binary.name}</div>
                  <div className={cn('text-xs', binaryMissing ? 'text-warning' : 'text-fg-3')}>
                    {binaryMissing
                      ? '文件不会被保存，刷新页面后需要重新选择'
                      : `${formatBytes(body.binary.size)} · ${body.binary.type || '未知类型'}`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw />}
                  onClick={() =>
                    pickFile((f) => {
                      setFile(binaryKey(tabId), f)
                      set({ binary: { name: f.name, size: f.size, type: f.type } })
                    })
                  }
                >
                  重新选择
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 />}
                  iconOnly
                  aria-label="移除文件"
                  title="移除文件"
                  onClick={() => {
                    setFile(binaryKey(tabId), undefined)
                    set({ binary: undefined })
                  }}
                />
              </div>
            ) : (
              <DropZone
                onFiles={([f]) => {
                  setFile(binaryKey(tabId), f)
                  set({ binary: { name: f.name, size: f.size, type: f.type } })
                }}
                title="拖入文件，或点击选择"
                hint="文件内容原样作为请求体发送，Content-Type 默认取文件类型"
                className="py-8"
              />
            ))}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function EditorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="thin-scrollbar overflow-auto rounded-2xl border border-line bg-surface-2 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15"
      style={{ height: EDITOR_H }}
      data-lenis-prevent
    >
      {children}
    </div>
  )
}

function pickFile(onFile: (f: File) => void) {
  const el = document.createElement('input')
  el.type = 'file'
  el.onchange = () => {
    const f = el.files?.[0]
    if (f) onFile(f)
  }
  el.click()
}
