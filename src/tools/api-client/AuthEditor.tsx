import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Field, Notice, SegmentedControl } from '@/components/ui'
import type { ApiRequest, AuthState, AuthType } from '@/lib/api-client'
import { VarInput } from './VarInput'

const TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: '无认证' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic' },
  { value: 'apikey', label: 'API Key' },
]

export function AuthEditor({
  request,
  vars,
  onChange,
}: {
  request: ApiRequest
  vars: Record<string, string>
  onChange: (auth: AuthState) => void
}) {
  const a = request.auth
  const set = (patch: Partial<AuthState>) => onChange({ ...a, ...patch })
  const [reveal, setReveal] = useState(false)
  const manual = request.headers.some(
    (h) => h.enabled && h.key.trim().toLowerCase() === 'authorization',
  )

  const secretToggle = (
    <button
      type="button"
      onClick={() => setReveal((r) => !r)}
      aria-label={reveal ? '隐藏' : '显示'}
      title={reveal ? '隐藏' : '显示'}
      className="inline-flex size-6 items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
    >
      {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
        <SegmentedControl
          size="sm"
          aria-label="认证方式"
          value={a.type}
          onChange={(type) => set({ type })}
          options={TYPES}
        />
      </div>

      {manual && a.type !== 'none' && a.type !== 'apikey' && (
        <Notice tone="info">请求头里已经手动设置了 Authorization，发送时会优先使用它。</Notice>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={a.type}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
          className="flex flex-col gap-4"
        >
          {a.type === 'none' && (
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-6 text-[13px] text-fg-3">
              <ShieldCheck className="size-5 shrink-0" />
              这个请求不使用认证。也可以直接在「请求头」里写 Authorization。
            </div>
          )}

          {a.type === 'bearer' && (
            <Field
              label="Token"
              action={secretToggle}
              hint="发送为 Authorization: Bearer <token>，支持 {{变量}}"
            >
              <VarInput
                value={a.token}
                onChange={(token) => set({ token })}
                vars={vars}
                placeholder="例如 {{token}} 或 eyJhbGciOi…"
                type={reveal || a.token.includes('{{') ? 'text' : 'password'}
                aria-label="Bearer Token"
              />
            </Field>
          )}

          {a.type === 'basic' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="用户名">
                <VarInput
                  value={a.username}
                  onChange={(username) => set({ username })}
                  vars={vars}
                  placeholder="username"
                  aria-label="用户名"
                />
              </Field>
              <Field label="密码" action={secretToggle}>
                <VarInput
                  value={a.password}
                  onChange={(password) => set({ password })}
                  vars={vars}
                  placeholder="password"
                  type={reveal || a.password.includes('{{') ? 'text' : 'password'}
                  aria-label="密码"
                />
              </Field>
              <p className="text-xs text-fg-3 sm:col-span-2">
                用户名和密码以 UTF-8 编码后 Base64，发送为 Authorization: Basic …
              </p>
            </div>
          )}

          {a.type === 'apikey' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="名称">
                <VarInput
                  value={a.apiKeyName}
                  onChange={(apiKeyName) => set({ apiKeyName })}
                  vars={vars}
                  placeholder="X-API-Key"
                  aria-label="API Key 名称"
                />
              </Field>
              <Field label="值" action={secretToggle}>
                <VarInput
                  value={a.apiKeyValue}
                  onChange={(apiKeyValue) => set({ apiKeyValue })}
                  vars={vars}
                  placeholder="{{apiKey}}"
                  type={reveal || a.apiKeyValue.includes('{{') ? 'text' : 'password'}
                  aria-label="API Key 值"
                />
              </Field>
              <Field label="添加到" className="sm:col-span-2">
                <SegmentedControl
                  size="sm"
                  aria-label="API Key 位置"
                  value={a.apiKeyIn}
                  onChange={(apiKeyIn) => set({ apiKeyIn })}
                  options={[
                    { value: 'header', label: '请求头' },
                    { value: 'query', label: '查询参数' },
                  ]}
                />
              </Field>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
