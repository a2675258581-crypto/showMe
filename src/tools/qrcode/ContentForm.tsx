import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { AtSign, Contact, Eye, EyeOff, Link2, MessageSquare, Phone, Wifi } from 'lucide-react'
import { Field, Input, SegmentedControl, Switch, TextArea } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { QrTemplate, TemplateData, WifiSecurity } from '@/lib/qrcode'

export const TEMPLATES: { id: QrTemplate; label: string; icon: ReactNode }[] = [
  { id: 'text', label: '文本 / 网址', icon: <Link2 /> },
  { id: 'wifi', label: 'Wi-Fi', icon: <Wifi /> },
  { id: 'vcard', label: '名片', icon: <Contact /> },
  { id: 'email', label: '邮件', icon: <AtSign /> },
  { id: 'sms', label: '短信', icon: <MessageSquare /> },
  { id: 'tel', label: '电话', icon: <Phone /> },
]

/** 每个模板的示例数据 */
export const SAMPLES: { [K in QrTemplate]: TemplateData[K] } = {
  text: 'https://example.com/welcome?from=qrcode',
  wifi: { ssid: 'Office-5G', password: 'showme2024!', security: 'WPA', hidden: false },
  vcard: {
    lastName: '张',
    firstName: '晓明',
    org: '示例科技有限公司',
    title: '前端工程师',
    mobile: '138 0013 8000',
    phone: '010-8888 6666',
    email: 'xiaoming@example.com',
    url: 'https://example.com',
    address: '北京市海淀区中关村大街 1 号',
    note: '',
  },
  email: {
    to: 'hello@example.com',
    subject: '关于合作的咨询',
    body: '你好，\n我在官网看到了你们的产品，想进一步了解一下。',
  },
  sms: { phone: '10086', message: 'CXLL' },
  tel: { phone: '400-800-8888' },
}

export function TemplatePicker({
  value,
  onChange,
}: {
  value: QrTemplate
  onChange: (t: QrTemplate) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="内容类型"
      className="grid grid-cols-3 gap-1.5 sm:grid-cols-6"
    >
      {TEMPLATES.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium transition-colors [&_svg]:size-[18px]',
              active ? 'text-accent' : 'text-fg-2 hover:bg-fill-2 hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId="qr-template"
                className="absolute inset-0 rounded-2xl bg-accent-soft ring-1 ring-accent/25"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative flex flex-col items-center gap-1">
              {t.icon}
              {t.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface FormProps {
  template: QrTemplate
  data: TemplateData
  onChange: (data: TemplateData) => void
}

/** 各模板的输入表单 */
export function ContentForm({ template, data, onChange }: FormProps) {
  const [showPw, setShowPw] = useState(false)
  const set = <K extends QrTemplate>(k: K, v: TemplateData[K]) => onChange({ ...data, [k]: v })

  switch (template) {
    case 'text':
      return (
        <Field
          label="文本或网址"
          hint={`${data.text.length.toLocaleString()} 字符 · ${new TextEncoder().encode(data.text).length.toLocaleString()} 字节`}
        >
          <TextArea
            value={data.text}
            onChange={(e) => set('text', e.target.value)}
            placeholder="输入任意文本，或以 https:// 开头的网址"
            className="min-h-32"
            aria-label="二维码内容"
          />
        </Field>
      )

    case 'wifi': {
      const w = data.wifi
      const upd = (p: Partial<typeof w>) => set('wifi', { ...w, ...p })
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="网络名称（SSID）">
            <Input
              value={w.ssid}
              onChange={(e) => upd({ ssid: e.target.value })}
              placeholder="例如 Office-5G"
              aria-label="网络名称（SSID）"
            />
          </Field>
          <Field label="加密方式">
            <SegmentedControl<WifiSecurity>
              block
              value={w.security}
              onChange={(security) => upd({ security })}
              aria-label="加密方式"
              options={[
                { value: 'WPA', label: 'WPA/WPA2/3' },
                { value: 'WEP', label: 'WEP' },
                { value: 'nopass', label: '无密码' },
              ]}
            />
          </Field>
          {w.security !== 'nopass' && (
            <Field label="密码">
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={w.password}
                  onChange={(e) => upd({ password: e.target.value })}
                  placeholder="Wi-Fi 密码"
                  aria-label="Wi-Fi 密码"
                  autoComplete="off"
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? '隐藏密码' : '显示密码'}
                  title={showPw ? '隐藏密码' : '显示密码'}
                  className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
          )}
          <div className="flex items-end pb-2">
            <Switch
              checked={w.hidden}
              onChange={(hidden) => upd({ hidden })}
              label={<span className="text-sm text-fg">隐藏网络（不广播 SSID）</span>}
            />
          </div>
        </div>
      )
    }

    case 'vcard': {
      const v = data.vcard
      const upd = (p: Partial<typeof v>) => set('vcard', { ...v, ...p })
      const input = (k: keyof typeof v, label: string, placeholder: string, type = 'text') => (
        <Field label={label}>
          <Input
            type={type}
            value={v[k]}
            onChange={(e) => upd({ [k]: e.target.value })}
            placeholder={placeholder}
            aria-label={label}
          />
        </Field>
      )
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {input('lastName', '姓', '张')}
          {input('firstName', '名', '晓明')}
          {input('org', '公司', '示例科技有限公司')}
          {input('title', '职位', '前端工程师')}
          {input('mobile', '手机', '138 0013 8000', 'tel')}
          {input('phone', '工作电话', '010-8888 6666', 'tel')}
          {input('email', '邮箱', 'name@example.com', 'email')}
          {input('url', '网址', 'https://example.com', 'url')}
          <div className="sm:col-span-2">
            {input('address', '地址', '北京市海淀区中关村大街 1 号')}
          </div>
          <Field label="备注" className="sm:col-span-2">
            <TextArea
              value={v.note}
              onChange={(e) => upd({ note: e.target.value })}
              placeholder="可选"
              aria-label="备注"
              className="min-h-20"
            />
          </Field>
        </div>
      )
    }

    case 'email': {
      const e = data.email
      const upd = (p: Partial<typeof e>) => set('email', { ...e, ...p })
      return (
        <div className="grid gap-4">
          <Field label="收件人" hint="多个地址用逗号分隔">
            <Input
              type="email"
              value={e.to}
              onChange={(ev) => upd({ to: ev.target.value })}
              placeholder="hello@example.com"
              aria-label="收件人"
            />
          </Field>
          <Field label="主题">
            <Input
              value={e.subject}
              onChange={(ev) => upd({ subject: ev.target.value })}
              placeholder="邮件主题"
              aria-label="邮件主题"
            />
          </Field>
          <Field label="正文">
            <TextArea
              value={e.body}
              onChange={(ev) => upd({ body: ev.target.value })}
              placeholder="邮件正文"
              aria-label="邮件正文"
              className="min-h-24"
            />
          </Field>
        </div>
      )
    }

    case 'sms': {
      const s = data.sms
      const upd = (p: Partial<typeof s>) => set('sms', { ...s, ...p })
      return (
        <div className="grid gap-4">
          <Field label="手机号">
            <Input
              type="tel"
              value={s.phone}
              onChange={(ev) => upd({ phone: ev.target.value })}
              placeholder="138 0013 8000"
              aria-label="接收短信的手机号"
            />
          </Field>
          <Field label="短信内容">
            <TextArea
              value={s.message}
              onChange={(ev) => upd({ message: ev.target.value })}
              placeholder="预填的短信内容（可选）"
              aria-label="短信内容"
              className="min-h-24"
            />
          </Field>
        </div>
      )
    }

    case 'tel':
      return (
        <Field label="电话号码" hint="扫码后直接拨号；空格、横线、括号会被自动去掉">
          <Input
            type="tel"
            value={data.tel.phone}
            onChange={(ev) => set('tel', { phone: ev.target.value })}
            placeholder="400-800-8888"
            aria-label="电话号码"
          />
        </Field>
      )
  }
}
