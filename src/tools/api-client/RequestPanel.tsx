import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { RefreshCw } from 'lucide-react'
import { Button, Field, Input, Switch, Tabs } from '@/components/ui'
import {
  MAX_TIMEOUT_MS,
  applyParamsToUrl,
  type ApiRequest,
  type KeyValue,
  type RequestSettings,
} from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { AuthEditor } from './AuthEditor'
import { BodyEditor } from './BodyEditor'
import { KeyValueTable } from './KeyValueTable'

export type ProxyStatus = 'checking' | 'available' | 'unavailable'

type Section = 'params' | 'headers' | 'body' | 'auth' | 'settings'

const HEADER_NAMES = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Type',
  'Cookie',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'Origin',
  'Pragma',
  'Range',
  'Referer',
  'User-Agent',
  'X-API-Key',
  'X-Forwarded-For',
  'X-Request-Id',
  'X-Requested-With',
]

const HEADER_VALUES: Record<string, string[]> = {
  'content-type': [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
    'application/xml',
    'text/html',
    'application/octet-stream',
  ],
  accept: ['application/json', '*/*', 'text/html', 'application/xml', 'text/plain'],
  'cache-control': ['no-cache', 'no-store', 'max-age=0'],
  'accept-encoding': ['gzip, deflate, br', 'identity'],
  'accept-language': ['zh-CN,zh;q=0.9,en;q=0.8', 'en-US,en;q=0.9'],
  'x-requested-with': ['XMLHttpRequest'],
}

const dot = <span className="size-1.5 rounded-full bg-accent" aria-label="已设置" />

export function RequestPanel({
  request,
  tabId,
  vars,
  proxy,
  onRecheckProxy,
  onChange,
}: {
  request: ApiRequest
  tabId: string
  vars: Record<string, string>
  proxy: ProxyStatus
  onRecheckProxy: () => void
  onChange: (fn: (r: ApiRequest) => ApiRequest) => void
}) {
  const [section, setSection] = useState<Section>('params')
  const count = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key).length || undefined

  return (
    <div className="flex min-w-0 flex-col rounded-3xl border border-line bg-surface shadow-card">
      <Tabs
        className="px-3"
        value={section}
        onChange={setSection}
        items={[
          { value: 'params', label: '查询参数', badge: count(request.params) },
          { value: 'headers', label: '请求头', badge: count(request.headers) },
          {
            value: 'body',
            label: (
              <span className="inline-flex items-center gap-1.5">
                请求体{request.body.mode !== 'none' && dot}
              </span>
            ),
          },
          {
            value: 'auth',
            label: (
              <span className="inline-flex items-center gap-1.5">
                认证{request.auth.type !== 'none' && dot}
              </span>
            ),
          },
          { value: 'settings', label: '设置' },
        ]}
      />
      <div className="p-4 sm:p-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            {section === 'params' && (
              <KeyValueTable
                rows={request.params}
                onChange={(params) =>
                  onChange((r) => ({ ...r, params, url: applyParamsToUrl(r.url, params) }))
                }
                vars={vars}
                keyPlaceholder="参数名"
                bulk
                emptyHint="与 URL 中 ? 后面的查询串双向同步"
              />
            )}
            {section === 'headers' && (
              <KeyValueTable
                rows={request.headers}
                onChange={(headers) => onChange((r) => ({ ...r, headers }))}
                vars={vars}
                keyPlaceholder="请求头名称"
                keySuggestions={HEADER_NAMES}
                valueSuggestions={(k) => HEADER_VALUES[k.trim().toLowerCase()]}
                bulk
                emptyHint="Content-Type 会按请求体类型自动添加，手动设置时以这里为准"
              />
            )}
            {section === 'body' && (
              <BodyEditor
                request={request}
                tabId={tabId}
                vars={vars}
                onChange={(body) => onChange((r) => ({ ...r, body }))}
              />
            )}
            {section === 'auth' && (
              <AuthEditor
                request={request}
                vars={vars}
                onChange={(auth) => onChange((r) => ({ ...r, auth }))}
              />
            )}
            {section === 'settings' && (
              <SettingsForm
                settings={request.settings}
                proxy={proxy}
                onRecheckProxy={onRecheckProxy}
                onChange={(settings) => onChange((r) => ({ ...r, settings }))}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function SettingsForm({
  settings,
  proxy,
  onRecheckProxy,
  onChange,
}: {
  settings: RequestSettings
  proxy: ProxyStatus
  onRecheckProxy: () => void
  onChange: (s: RequestSettings) => void
}) {
  const set = (patch: Partial<RequestSettings>) => onChange({ ...settings, ...patch })
  const invalid = settings.timeoutMs < 100 || settings.timeoutMs > MAX_TIMEOUT_MS
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="超时时间（毫秒）"
        hint={
          invalid
            ? `请输入 100 – ${MAX_TIMEOUT_MS.toLocaleString()} 之间的数值`
            : '超过这个时间没有响应就放弃请求'
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36">
            <Input
              type="number"
              min={100}
              max={MAX_TIMEOUT_MS}
              step={1000}
              value={settings.timeoutMs}
              onChange={(e) =>
                set({ timeoutMs: Math.max(0, Math.round(Number(e.target.value) || 0)) })
              }
              className={cn(
                'font-mono',
                invalid && 'border-danger focus:border-danger focus:ring-danger/15',
              )}
              aria-label="超时时间（毫秒）"
            />
          </div>
          {[5_000, 30_000, 60_000, 120_000].map((ms) => (
            <button
              key={ms}
              type="button"
              onClick={() => set({ timeoutMs: ms })}
              className={cn(
                'h-8 rounded-full px-3 text-xs font-medium transition-colors',
                settings.timeoutMs === ms
                  ? 'bg-accent text-white'
                  : 'bg-fill text-fg hover:bg-fill-3',
              )}
            >
              {ms / 1000} 秒
            </button>
          ))}
        </div>
      </Field>

      <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <Switch
          checked={settings.followRedirects}
          onChange={(followRedirects) => set({ followRedirects })}
          label={
            <span className="flex flex-col">
              <span>自动跟随重定向</span>
              <span className="text-xs text-fg-3">关闭后可以查看 301 / 302 响应本身</span>
            </span>
          }
        />
        <div className="h-px bg-line" />
        <Switch
          checked={settings.useProxy}
          onChange={(useProxy) => set({ useProxy })}
          label={
            <span className="flex flex-col">
              <span>使用本地代理</span>
              <span className="text-xs text-fg-3">
                由本机转发请求，绕过浏览器 CORS 限制，可读取全部响应头与 Cookie
              </span>
            </span>
          }
        />
        <div className="flex flex-wrap items-center gap-2 pl-[54px] text-xs">
          <ProxyIndicator status={proxy} />
          <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={onRecheckProxy}>
            重新检测
          </Button>
        </div>
        {proxy === 'unavailable' && (
          <p className="pl-[54px] text-xs leading-relaxed text-fg-3">
            本地代理由 showMe 的开发 / 预览服务器提供：在项目目录运行{' '}
            <code className="rounded bg-fill px-1">npm run dev</code> 或{' '}
            <code className="rounded bg-fill px-1">npm run preview</code>{' '}
            后即可使用。纯静态部署时只能浏览器直连。
          </p>
        )}
      </div>
    </div>
  )
}

export function ProxyIndicator({ status, compact }: { status: ProxyStatus; compact?: boolean }) {
  const map = {
    checking: { color: 'var(--fg-3)', text: '正在检测本地代理…' },
    available: { color: 'var(--sys-green)', text: compact ? '本地代理' : '本地代理可用' },
    unavailable: {
      color: 'var(--sys-orange)',
      text: compact ? '浏览器直连' : '本地代理不可用，将使用浏览器直连',
    },
  }[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-2">
      <span
        className={cn('size-2 rounded-full', status === 'checking' && 'animate-pulse')}
        style={{ background: map.color }}
      />
      {map.text}
    </span>
  )
}
