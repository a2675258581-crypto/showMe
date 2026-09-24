import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  ArrowLeftRight,
  ClipboardPaste,
  Download,
  FolderOpen,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button, CopyButton, ErrorNotice } from '@/components/ui'
import { readClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { downloadText } from '@/lib/file'
import { CodeEditor } from './CodeEditor'
import type { EditorLang } from './languages'

/** 默认编辑区高度：跟随视口，但不超过 640px */
export const EDITOR_HEIGHT = 'clamp(320px, 62vh, 640px)'

interface EditorPaneProps {
  title: ReactNode
  /** 标题右侧的按钮 */
  actions?: ReactNode
  children: ReactNode
  /** 底部状态栏（字符数等） */
  footer?: ReactNode
  height?: string
  className?: string
  onDropFile?: (file: File) => void
}

/** 带标题栏的编辑区卡片，可单独用于自定义布局 */
export function EditorPane({
  title,
  actions,
  children,
  footer,
  height = EDITOR_HEIGHT,
  className,
  onDropFile,
}: EditorPaneProps) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-3xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-300',
        over ? 'border-accent ring-4 ring-accent/15' : 'border-line',
        className,
      )}
      onDragOver={
        onDropFile
          ? (e) => {
              e.preventDefault()
              setOver(true)
            }
          : undefined
      }
      onDragLeave={onDropFile ? () => setOver(false) : undefined}
      onDrop={
        onDropFile
          ? (e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files[0]
              if (f) onDropFile(f)
            }
          : undefined
      }
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="text-[13px] font-semibold text-fg">{title}</div>
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
      <div className="thin-scrollbar min-h-0 overflow-auto" style={{ height }} data-lenis-prevent>
        {children}
      </div>
      {footer && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2 text-[11px] text-fg-3 tabular-nums">
          {footer}
        </div>
      )}
    </div>
  )
}

export interface IOPanelProps {
  input: string
  onInputChange: (v: string) => void
  output: string
  inputLang?: EditorLang
  outputLang?: EditorLang
  inputTitle?: ReactNode
  outputTitle?: ReactNode
  inputPlaceholder?: string
  outputPlaceholder?: string
  /** 提供后显示「示例」按钮 */
  sample?: string
  error?: string | null
  /** 提供后在两栏之间显示交换按钮 */
  onSwap?: () => void
  /** 提供后输出栏显示「下载」按钮 */
  downloadName?: string
  /** 允许打开 / 拖入文件到输入栏（值为 input accept 属性） */
  acceptFile?: string
  /** 两栏上方的选项工具条 */
  toolbar?: ReactNode
  /** 替换输出编辑器的自定义内容（如树形视图） */
  outputSlot?: ReactNode
  inputActions?: ReactNode
  outputActions?: ReactNode
  outputFooter?: ReactNode
  height?: string
}

/** 输入 / 输出双栏布局：粘贴、示例、清空、打开文件、交换、复制、下载 */
export function IOPanel({
  input,
  onInputChange,
  output,
  inputLang = 'text',
  outputLang = 'text',
  inputTitle = '输入',
  outputTitle = '输出',
  inputPlaceholder = '在此粘贴或输入内容…',
  outputPlaceholder = '结果会显示在这里',
  sample,
  error,
  onSwap,
  downloadName,
  acceptFile,
  toolbar,
  outputSlot,
  inputActions,
  outputActions,
  outputFooter,
  height = EDITOR_HEIGHT,
}: IOPanelProps) {
  const [spin, setSpin] = useState(0)
  // 没有有效输出时交换没有意义（还会把错误状态带过去）
  const canSwap = !!output && !error

  const openFile = () => {
    const el = document.createElement('input')
    el.type = 'file'
    if (acceptFile) el.accept = acceptFile
    el.onchange = async () => {
      const f = el.files?.[0]
      if (f) onInputChange(await f.text())
    }
    el.click()
  }

  return (
    <div className="flex flex-col gap-4">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card">
          {toolbar}
        </div>
      )}
      <div className="relative grid gap-4 lg:grid-cols-2">
        <EditorPane
          title={inputTitle}
          height={height}
          onDropFile={
            acceptFile !== undefined ? async (f) => onInputChange(await f.text()) : undefined
          }
          actions={
            <>
              {inputActions}
              {sample !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Sparkles />}
                  onClick={() => onInputChange(sample)}
                >
                  示例
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<ClipboardPaste />}
                onClick={async () => {
                  const t = await readClipboard()
                  if (t !== null) onInputChange(t)
                }}
              >
                粘贴
              </Button>
              {acceptFile !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<FolderOpen />}
                  onClick={openFile}
                  iconOnly
                  title="打开文件"
                  aria-label="打开文件"
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 />}
                onClick={() => onInputChange('')}
                iconOnly
                title="清空"
                aria-label="清空"
                disabled={!input}
              />
            </>
          }
          footer={
            <>
              <span>{input.length.toLocaleString()} 字符</span>
              <span>{input ? input.split('\n').length.toLocaleString() : 0} 行</span>
            </>
          }
        >
          <CodeEditor
            value={input}
            onChange={onInputChange}
            lang={inputLang}
            placeholder={inputPlaceholder}
            aria-label="输入"
          />
        </EditorPane>

        {onSwap && (
          <motion.button
            type="button"
            aria-label="交换输入与输出"
            title={canSwap ? '交换输入与输出' : '有结果后才能交换'}
            disabled={!canSwap}
            onClick={() => {
              setSpin((s) => s + 180)
              onSwap()
            }}
            animate={{ rotate: spin }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            className="glass absolute top-1/2 left-1/2 z-10 hidden size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line text-fg shadow-float disabled:pointer-events-none disabled:opacity-40 lg:flex"
          >
            <ArrowLeftRight className="size-4" />
          </motion.button>
        )}

        <EditorPane
          title={outputTitle}
          height={height}
          actions={
            <>
              {outputActions}
              {onSwap && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ArrowLeftRight />}
                  onClick={onSwap}
                  disabled={!canSwap}
                  className="lg:hidden"
                >
                  交换
                </Button>
              )}
              {downloadName && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Download />}
                  iconOnly
                  title="下载"
                  aria-label="下载"
                  disabled={!output}
                  onClick={() => downloadText(downloadName, output)}
                />
              )}
              <CopyButton text={output} disabled={!output} />
            </>
          }
          footer={
            outputFooter ?? (
              <>
                <span>{output.length.toLocaleString()} 字符</span>
                <span>{output ? output.split('\n').length.toLocaleString() : 0} 行</span>
              </>
            )
          }
        >
          {outputSlot ?? (
            <CodeEditor
              value={output}
              lang={outputLang}
              readOnly
              placeholder={outputPlaceholder}
              aria-label="输出"
            />
          )}
        </EditorPane>
      </div>
      <ErrorNotice error={error} />
    </div>
  )
}
