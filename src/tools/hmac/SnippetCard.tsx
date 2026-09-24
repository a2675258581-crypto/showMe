import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Code2 } from 'lucide-react'
import { CopyButton, Select, Tabs } from '@/components/ui'
import { HMAC_ALGOS, hmacAlgo, type HmacAlgoId } from '@/lib/hmac'
import {
  SNIPPET_LANGS,
  hmacSnippet,
  type SnippetInput,
  type SnippetLang,
} from '@/lib/hmac-snippets'

const THIRD_PARTY: Record<SnippetLang, string> = {
  node: '请升级到带 OpenSSL 3 的 Node.js。',
  python: '请确认 Python 链接的 OpenSSL 支持该算法。',
  go: '可使用 github.com/tjfoc/gmsm 等第三方库。',
  java: '可使用 BouncyCastle 提供的 HMac + SM3Digest。',
  php: '可使用 openssl 扩展或第三方 SM3 实现。',
}

interface Props {
  input: SnippetInput
  lang: SnippetLang
  onLang: (l: SnippetLang) => void
  onAlgo: (a: HmacAlgoId) => void
}

/** 「在代码里怎么写」：按当前参数生成各语言的等价实现 */
export function SnippetCard({ input, lang, onLang, onAlgo }: Props) {
  const code = useMemo(() => hmacSnippet(lang, input), [lang, input])
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 sm:px-5">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
          <Code2 className="size-4 text-fg-2" />
          代码示例
        </h3>
        <div className="flex items-center gap-1">
          <Select
            size="sm"
            value={input.algo}
            onChange={(v) => onAlgo(v as HmacAlgoId)}
            options={HMAC_ALGOS.map((a) => ({ value: a.id, label: a.label }))}
            aria-label="代码示例使用的算法"
          />
          <CopyButton
            text={code ?? ''}
            iconOnly
            variant="ghost"
            disabled={!code}
            label="复制代码"
          />
        </div>
      </div>
      <Tabs
        items={SNIPPET_LANGS.map((l) => ({ value: l.id, label: l.label }))}
        value={lang}
        onChange={onLang}
        className="mt-1 px-2 sm:px-3"
      />
      {/* 按语言重新挂载做入场动画（快速连点标签时 AnimatePresence mode="wait" 会卡住） */}
      <motion.div
        key={lang}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {code ? (
          <pre
            className="thin-scrollbar max-h-80 overflow-auto bg-surface-2 px-4 py-4 font-mono text-[12.5px] leading-relaxed text-fg sm:px-5"
            data-lenis-prevent
          >
            {code}
          </pre>
        ) : (
          <p className="bg-surface-2 px-4 py-6 text-[13px] text-fg-2 sm:px-5">
            {SNIPPET_LANGS.find((l) => l.id === lang)?.label} 标准库没有{' '}
            {hmacAlgo(input.algo).label}，{THIRD_PARTY[lang]}
          </p>
        )}
      </motion.div>
    </section>
  )
}
