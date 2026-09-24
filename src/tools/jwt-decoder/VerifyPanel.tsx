import { motion } from 'motion/react'
import { LoaderCircle, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { Badge, Field, Input, Switch, TextArea } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  ALG_FAMILY_LABEL,
  MIN_SECRET_BYTES,
  algFamily,
  type HmacAlg,
  type VerifyOutcome,
} from '@/lib/jwt-decoder'
import { base64ToBytes, utf8Encode } from '@/lib/hash-bytes'

interface Props {
  alg: string
  secret: string
  onSecret: (v: string) => void
  secretBase64: boolean
  onSecretBase64: (v: boolean) => void
  publicKey: string
  onPublicKey: (v: string) => void
  result: VerifyOutcome | null
  pending: boolean
}

function secretLength(secret: string, b64: boolean): number | null {
  try {
    return b64 ? base64ToBytes(secret.trim()).length : utf8Encode(secret).length
  } catch {
    return null
  }
}

/** 签名验证：HS* 用共享密钥，RS* / PS* / ES* / EdDSA 用公钥 */
export function VerifyPanel({
  alg,
  secret,
  onSecret,
  secretBase64,
  onSecretBase64,
  publicKey,
  onPublicKey,
  result,
  pending,
}: Props) {
  const family = algFamily(alg)
  const len = family === 'hmac' ? secretLength(secret, secretBase64) : null
  const min = family === 'hmac' ? MIN_SECRET_BYTES[alg as HmacAlg] : 0

  const tone = pending
    ? 'pending'
    : !result
      ? 'idle'
      : result.status === 'valid'
        ? 'ok'
        : result.status === 'invalid'
          ? 'bad'
          : 'warn'

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">签名验证</h3>
        <div className="flex items-center gap-1.5">
          <Badge>{alg || '无 alg'}</Badge>
          <span className="text-xs text-fg-3">{ALG_FAMILY_LABEL[family]}</span>
        </div>
      </div>

      {family === 'hmac' && (
        <Field
          label="密钥（Secret）"
          hint={
            len === null
              ? '不是合法的 Base64'
              : `${len} 字节${len > 0 && len < min ? ` · 短于 RFC 7518 建议的 ${min} 字节` : ''}`
          }
          action={
            <Switch
              checked={secretBase64}
              onChange={onSecretBase64}
              label={<span className="text-xs text-fg-2">Base64 编码</span>}
            />
          }
        >
          <Input
            value={secret}
            onChange={(e) => onSecret(e.target.value)}
            mono
            placeholder={secretBase64 ? 'Base64 编码的密钥' : '输入签名时使用的密钥'}
            aria-label="签名密钥"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}

      {(family === 'rsa' || family === 'rsa-pss' || family === 'ec' || family === 'eddsa') && (
        <Field
          label="公钥"
          hint="支持 SPKI PEM、X.509 证书、JWK、JWKS（按 kid 匹配），粘贴 PKCS#8 私钥会自动取公钥"
        >
          <TextArea
            value={publicKey}
            onChange={(e) => onPublicKey(e.target.value)}
            mono
            className="min-h-32 text-[12px]"
            placeholder={
              '-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n\n或 {"kty":"EC","crv":"P-256","x":"…","y":"…"}'
            }
            aria-label="公钥"
          />
        </Field>
      )}

      {/* 不用 AnimatePresence mode="wait"：结论在 0.3 秒内连续变化（验证中 → 结果）时它会卡在旧状态 */}
      <motion.div
        key={tone + (result?.message ?? '')}
        initial={{ opacity: 0, y: 4, scale: 0.98 }}
        animate={
          tone === 'bad'
            ? { opacity: 1, y: 0, scale: 1, x: [0, -5, 5, -3, 3, 0] }
            : { opacity: 1, y: 0, scale: 1 }
        }
        transition={{ duration: 0.25 }}
        role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}
        className={cn(
          'flex items-start gap-3 rounded-2xl px-4 py-3',
          tone === 'ok' && 'bg-success/10 text-success',
          tone === 'bad' && 'bg-danger/10 text-danger',
          tone === 'warn' && 'bg-warning/10 text-warning',
          (tone === 'pending' || tone === 'idle') && 'bg-fill-2 text-fg-2',
        )}
      >
        {tone === 'pending' ? (
          <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin" />
        ) : tone === 'ok' ? (
          <motion.span
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            className="mt-0.5 inline-flex"
          >
            <ShieldCheck className="size-5 shrink-0" />
          </motion.span>
        ) : tone === 'bad' ? (
          <ShieldX className="mt-0.5 size-5 shrink-0" />
        ) : (
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
        )}
        <div className="min-w-0 text-[13px] leading-relaxed">
          <div className="font-semibold whitespace-pre-wrap break-words">
            {tone === 'pending' ? '验证中…' : (result?.message ?? '等待输入')}
          </div>
          {result?.note && tone !== 'pending' && (
            <div className="text-xs opacity-80">{result.note}</div>
          )}
        </div>
      </motion.div>
    </section>
  )
}
