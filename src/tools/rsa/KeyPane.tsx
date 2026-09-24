import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Download, FolderOpen, Trash2 } from 'lucide-react'
import { Badge, Button, CopyButton, ErrorNotice, Select, type SelectOption } from '@/components/ui'
import { cn } from '@/lib/cn'
import { downloadText, formatBytes } from '@/lib/file'
import { KEY_SOURCE_LABELS, bytesToBase64, type RsaKeyInfo } from '@/lib/rsa'

export type Parsed = { ok: true; info: RsaKeyInfo } | { ok: false; error: string } | null

/** 密钥 / 证书文件通常只有几 KB，超过这个大小多半是拖错了文件 */
const MAX_KEY_FILE = 256 * 1024

/** 读取拖入 / 选择的密钥文件：DER 二进制转成 Base64，其余按文本读取 */
async function readKeyFile(f: File): Promise<string> {
  if (f.size > MAX_KEY_FILE) {
    throw new Error(
      `文件「${f.name}」有 ${formatBytes(f.size)}，不像是密钥文件（密钥 / 证书通常只有几 KB）`,
    )
  }
  const bytes = new Uint8Array(await f.arrayBuffer())
  const looksBinary =
    bytes[0] === 0x30 && bytes.subarray(0, 64).some((b) => b < 9 || (b > 13 && b < 32))
  return looksBinary ? bytesToBase64(bytes) : new TextDecoder().decode(bytes)
}

interface Props {
  title: string
  icon: ReactNode
  kind: 'public' | 'private'
  value: string
  onChange: (v: string) => void
  parsed: Parsed
  format: string
  formats: readonly SelectOption[]
  onFormat: (f: string) => void
  downloadName: string
  placeholder: string
  /** 标题栏右侧额外按钮 */
  extra?: ReactNode
  /** 信息行下方的附加内容（如指纹） */
  footer?: ReactNode
  busy?: boolean
}

export function KeyPane({
  title,
  icon,
  kind,
  value,
  onChange,
  parsed,
  format,
  formats,
  onFormat,
  downloadName,
  placeholder,
  extra,
  footer,
  busy,
}: Props) {
  const [over, setOver] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const info = parsed?.ok ? parsed.info : null
  const wrongKind = info && info.kind !== kind

  const load = async (f: File) => {
    try {
      const text = await readKeyFile(f)
      setFileError(null)
      onChange(text)
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e))
    }
  }
  const edit = (v: string) => {
    setFileError(null)
    onChange(v)
  }

  const openFile = () => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.pem,.key,.pub,.der,.cer,.crt,.json,.txt'
    el.onchange = async () => {
      const f = el.files?.[0]
      if (f) await load(f)
    }
    el.click()
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-3xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-300',
        over ? 'border-accent ring-4 ring-accent/15' : 'border-line',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f && !busy) await load(f)
      }}
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-fg [&_svg]:size-4 [&_svg]:text-fg-2">
          {icon}
          {title}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {extra}
          <Select
            size="sm"
            aria-label={`${title}导出格式`}
            value={format}
            options={formats}
            onChange={onFormat}
          />
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<FolderOpen />}
            title="打开密钥文件"
            aria-label={`打开${title}文件`}
            disabled={busy}
            onClick={openFile}
          />
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<Download />}
            title="下载"
            aria-label={`下载${title}`}
            disabled={!value.trim()}
            onClick={() => downloadText(downloadName, value.endsWith('\n') ? value : value + '\n')}
          />
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={<Trash2 />}
            title="清空"
            aria-label={`清空${title}`}
            disabled={!value || busy}
            onClick={() => edit('')}
          />
          <CopyButton text={value} disabled={!value.trim()} />
        </div>
      </div>

      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => edit(e.target.value)}
          readOnly={busy}
          aria-busy={busy}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={title}
          className={cn(
            'thin-scrollbar block h-60 w-full resize-y bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed text-fg outline-none placeholder:text-fg-3 sm:h-72',
            busy && 'opacity-40',
          )}
          data-lenis-prevent
        />
        <AnimatePresence>
          {busy && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 overflow-hidden"
              aria-hidden
            >
              <div className="h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent,var(--fill),transparent)] bg-[length:200%_100%]" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-fg-3">
        {info ? (
          <>
            <Badge color={wrongKind ? 'var(--danger)' : 'var(--sys-green)'}>RSA-{info.bits}</Badge>
            <span className="tabular-nums">e = {info.exponent}</span>
            <span>来源：{KEY_SOURCE_LABELS[info.source]}</span>
            {info.pssOid && <span>已将 RSA-PSS 专用 OID 转为通用 rsaEncryption</span>}
          </>
        ) : (
          <span>
            支持 PEM（PKCS#8 / PKCS#1 / SPKI / 证书）、Base64 DER、ssh-rsa、JWK，可拖入文件
          </span>
        )}
      </div>
      {footer}
      <ErrorNotice
        className="mx-4 mb-4"
        error={
          fileError ??
          (parsed && !parsed.ok
            ? parsed.error
            : wrongKind
              ? kind === 'public'
                ? '这里需要公钥，但粘贴的是私钥（可粘贴到右侧私钥框）'
                : '这里需要私钥，但粘贴的是公钥'
              : null)
        }
      />
    </div>
  )
}
