import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronDown,
  CodeXml,
  Columns2,
  Import,
  LoaderCircle,
  Rows2,
  Save,
  Send,
  Settings2,
} from 'lucide-react'
import { Button, Kbd } from '@/components/ui'
import { modKey } from '@/hooks/useHotkey'
import { HTTP_METHODS, type ApiRequest, type HttpMethod } from '@/lib/api-client'
import type { Environment } from '@/lib/api-client-store'
import { cn } from '@/lib/cn'
import { looksLikeCurl } from '@/lib/curl'
import { methodColor, TONE_TEXT, toneStyle } from './MethodBadge'
import { ProxyIndicator, type ProxyStatus } from './RequestPanel'
import { VarInput } from './VarInput'

const MANAGE = '__manage__'

export function UrlBar({
  request,
  vars,
  loading,
  dirty,
  missingVars,
  environments,
  activeEnvId,
  proxy,
  layout,
  onMethod,
  onUrl,
  onSend,
  onCancel,
  onPasteCurl,
  onEnv,
  onManageEnvs,
  onImportCurl,
  onShowCode,
  onSave,
  onLayout,
}: {
  request: ApiRequest
  vars: Record<string, string>
  loading: boolean
  dirty: boolean
  missingVars: string[]
  environments: Environment[]
  activeEnvId: string | null
  proxy: ProxyStatus
  layout: 'stack' | 'split'
  onMethod: (m: HttpMethod) => void
  onUrl: (url: string) => void
  onSend: () => void
  onCancel: () => void
  onPasteCurl: (text: string) => void
  onEnv: (id: string | null) => void
  onManageEnvs: () => void
  onImportCurl: () => void
  onShowCode: () => void
  onSave: () => void
  onLayout: (l: 'stack' | 'split') => void
}) {
  const color = methodColor(request.method)
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
          <div className="relative shrink-0">
            <select
              value={request.method}
              onChange={(e) => onMethod(e.target.value as HttpMethod)}
              aria-label="请求方法"
              className={cn(
                'h-10 cursor-pointer appearance-none rounded-xl bg-fill py-0 pr-7 pl-3 font-mono text-[13px] font-bold outline-none transition-colors hover:bg-fill-3 focus-visible:ring-4 focus-visible:ring-accent/15',
                TONE_TEXT,
              )}
              style={toneStyle(color)}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <ChevronDown
              className={cn(
                'pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2',
                TONE_TEXT,
              )}
              style={toneStyle(color)}
              aria-hidden
            />
          </div>
          <VarInput
            value={request.url}
            onChange={onUrl}
            vars={vars}
            placeholder="输入请求地址，或直接粘贴 curl 命令"
            aria-label="请求 URL"
            className="flex-1"
            onPaste={(e) => {
              const text = e.clipboardData.getData('text/plain')
              if (looksLikeCurl(text)) {
                e.preventDefault()
                onPasteCurl(text)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !(e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSend()
              }
            }}
          />
        </div>
        <Button
          variant={loading ? 'secondary' : 'primary'}
          onClick={loading ? onCancel : onSend}
          className="w-full min-w-24 sm:w-auto"
          aria-label={loading ? '取消请求' : '发送请求'}
          title={loading ? '取消请求' : `发送（${modKey} + Enter）`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={loading ? 'cancel' : 'send'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: 'spring', stiffness: 600, damping: 32 }}
              className="inline-flex items-center gap-2"
            >
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {loading ? '取消' : '发送'}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="inline-flex items-center gap-2 text-xs text-fg-2">
          <span className="font-semibold tracking-wide">环境</span>
          <span className="relative inline-flex">
            <select
              value={activeEnvId ?? ''}
              onChange={(e) => {
                if (e.target.value === MANAGE) onManageEnvs()
                else onEnv(e.target.value || null)
              }}
              aria-label="当前环境"
              className="h-8 max-w-44 cursor-pointer appearance-none truncate rounded-full bg-fill pr-7 pl-3 text-xs font-medium text-fg outline-none hover:bg-fill-3"
            >
              <option value="">无环境</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
              <option value={MANAGE}>管理环境…</option>
            </select>
            <Settings2 className="pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2 text-fg-2" />
          </span>
        </label>
        <span className="hidden text-xs sm:inline-flex">
          <ProxyIndicator status={proxy} compact />
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<Import />}
            onClick={onImportCurl}
            title="从 cURL 导入"
          >
            <span className="hidden sm:inline">导入 cURL</span>
            <span className="sm:hidden">导入</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<CodeXml />}
            onClick={onShowCode}
            title="生成代码 / 导出 cURL"
          >
            代码
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Save />}
            onClick={onSave}
            title={`保存到集合（${modKey} + S）`}
            className="relative"
          >
            保存
            {dirty && (
              <span
                className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent"
                aria-label="有未保存的修改"
              />
            )}
          </Button>
          <span className="hidden xl:inline-flex">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon={layout === 'split' ? <Rows2 /> : <Columns2 />}
              onClick={() => onLayout(layout === 'split' ? 'stack' : 'split')}
              aria-label={layout === 'split' ? '上下排列' : '左右并排'}
              title={layout === 'split' ? '请求与响应上下排列' : '请求与响应左右并排'}
            />
          </span>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {missingVars.length > 0 && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={cn('overflow-hidden text-xs text-danger')}
          >
            未定义的变量：{missingVars.map((v) => `{{${v}}}`).join('、')}
            <button
              type="button"
              onClick={onManageEnvs}
              className="ml-2 font-medium text-accent hover:underline"
            >
              去定义
            </button>
          </motion.p>
        )}
      </AnimatePresence>

      <p className="hidden text-[11px] text-fg-3 lg:block">
        <Kbd>{modKey}</Kbd> <Kbd>Enter</Kbd> 发送 · <Kbd>{modKey}</Kbd> <Kbd>S</Kbd> 保存 ·
        在地址栏粘贴 curl 命令会自动导入 · 支持{' '}
        <code className="rounded bg-fill px-1 font-mono">{'{{变量}}'}</code> 与{' '}
        <code className="rounded bg-fill px-1 font-mono">{'{{$uuid}}'}</code>、
        <code className="rounded bg-fill px-1 font-mono">{'{{$timestamp}}'}</code>
      </p>
    </div>
  )
}
