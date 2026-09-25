import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ClipboardPaste, FileText, ListChecks, Sparkles, Trash2, Type } from 'lucide-react'
import {
  Button,
  CopyButton,
  DropZone,
  ErrorNotice,
  SegmentedControl,
  Select,
  Switch,
  TextArea,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { readClipboard } from '@/lib/clipboard'
import {
  ALL_HASH_IDS,
  HASH_ALGOS,
  HashAbortedError,
  digestsToText,
  formatDigest,
  hashAlgo,
  hashBytes,
  hashChunks,
  matchDigest,
  type DigestFormat,
  type HashAlgoId,
  type HashDigests,
} from '@/lib/hash'
import {
  BYTE_ENCODING_LABELS,
  ByteDecodeError,
  decodeInput,
  type TextEncodingId,
} from '@/lib/hash-bytes'
import { AlgoPicker } from './AlgoPicker'
import { DigestList } from './DigestList'
import { FileCard, type FileJob } from './FileCard'
import { Md5Formats } from './Md5Formats'
import { VerifyField } from './VerifyField'

interface Options {
  source: 'text' | 'file'
  encoding: TextEncodingId
  upper: boolean
  format: DigestFormat
  /** 隐藏的算法（新增算法默认显示） */
  hidden: HashAlgoId[]
}

const DEFAULTS: Options = {
  source: 'text',
  encoding: 'utf8',
  upper: false,
  format: 'hex',
  hidden: [],
}

const SAMPLE = 'The quick brown fox jumps over the lazy dog'

const ENCODINGS: TextEncodingId[] = ['utf8', 'utf16le', 'latin1', 'hex', 'base64']
const ENCODING_OPTIONS = ENCODINGS.map((e) => ({
  value: e,
  label:
    e === 'hex' || e === 'base64' ? `${BYTE_ENCODING_LABELS[e]} 字节` : BYTE_ENCODING_LABELS[e],
}))

const PRESETS: { label: string; ids: HashAlgoId[] }[] = [
  { label: '全部', ids: [...ALL_HASH_IDS] },
  { label: '常用', ids: ['md5', 'sha1', 'sha256', 'sha512'] },
  {
    label: 'SHA 家族',
    ids: ['sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha3-256', 'sha3-512'],
  },
  { label: '国密', ids: ['sm3'] },
]

const isHashId = (x: string): x is HashAlgoId => (ALL_HASH_IDS as readonly string[]).includes(x)

const oneOf = <T,>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback

/** localStorage 里的旧值或被改坏的值回落到默认值，避免渲染时出错 */
function sanitize(stored: unknown): Options {
  const o = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) } as Options
  return {
    source: oneOf(o.source, ['text', 'file'] as const, DEFAULTS.source),
    encoding: oneOf(o.encoding, ENCODINGS, DEFAULTS.encoding),
    upper: o.upper === true,
    format: oneOf(o.format, ['hex', 'base64'] as const, DEFAULTS.format),
    hidden: Array.isArray(o.hidden)
      ? o.hidden.filter((x) => typeof x === 'string' && isHashId(x))
      : [],
  }
}

export default function HashTool() {
  const [stored, setStored] = useLocalStorage<Partial<Options>>('hash.options.v1', DEFAULTS)
  const opts = sanitize(stored)
  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setStored((prev) => ({ ...DEFAULTS, ...prev, [key]: value }))

  const hiddenKey = opts.hidden.join(',')
  const visibleIds = useMemo(() => {
    const hidden = new Set(hiddenKey.split(','))
    const ids = ALL_HASH_IDS.filter((id) => !hidden.has(id))
    return ids.length ? ids : [...ALL_HASH_IDS]
  }, [hiddenKey])
  const idsKey = visibleIds.join(',')

  const [text, setText] = useState(SAMPLE)
  const [expected, setExpected] = useState('')
  const [showPicker, setShowPicker] = useState(false)

  // ───── 文本：输入即算（防抖） ─────
  const debouncedText = useDebounced(text, 120)
  const decoded = useMemo<{ bytes: Uint8Array } | { error: string }>(() => {
    try {
      return { bytes: decodeInput(debouncedText, opts.encoding) }
    } catch (e) {
      return { error: e instanceof ByteDecodeError ? e.message : String(e) }
    }
  }, [debouncedText, opts.encoding])

  const [textResult, setTextResult] = useState<{
    ids: string
    text: string
    encoding: TextEncodingId
    digests: HashDigests
  } | null>(null)

  useEffect(() => {
    if (opts.source !== 'text' || !('bytes' in decoded)) return
    let alive = true
    const ids = idsKey.split(',').filter(isHashId)
    const source = { ids: idsKey, text: debouncedText, encoding: opts.encoding }
    hashBytes(decoded.bytes, ids)
      .then((digests) => {
        if (alive) setTextResult({ ...source, digests })
      })
      .catch(() => {
        // 只有 WebAssembly 不可用时才会失败，保留上一次结果
      })
    return () => {
      alive = false
    }
  }, [decoded, idsKey, opts.source, debouncedText, opts.encoding])

  // ───── 文件：分块增量计算 ─────
  const [job, setJob] = useState<FileJob | null>(null)
  const [fileResult, setFileResult] = useState<{ file: File; digests: HashDigests } | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  const startFile = useCallback((file: File, ids: readonly HashAlgoId[]) => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const started = performance.now()
    let lastTick = 0
    setJob({ file, status: 'hashing', done: 0 })
    setFileResult(null)
    hashChunks(file, {
      ids,
      signal: ctrl.signal,
      onProgress: (done) => {
        const now = performance.now()
        if (now - lastTick < 60 && done < file.size) return
        lastTick = now
        const secs = (now - started) / 1000
        setJob((j) =>
          j?.file === file ? { ...j, done, speed: secs > 0.25 ? done / secs : undefined } : j,
        )
      },
    })
      .then((digests) => {
        if (ctrl.signal.aborted) return
        setFileResult({ file, digests })
        setJob((j) =>
          j?.file === file
            ? { ...j, status: 'done', done: file.size, elapsedMs: performance.now() - started }
            : j,
        )
      })
      .catch((e) => {
        const cancelled = e instanceof HashAbortedError
        setJob((j) =>
          j?.file === file
            ? {
                ...j,
                status: cancelled ? 'cancelled' : 'error',
                error: cancelled
                  ? undefined
                  : `读取或计算失败：${e instanceof Error ? e.message : String(e)}`,
              }
            : j,
        )
      })
  }, [])

  useEffect(() => () => ctrlRef.current?.abort(), [])

  const changeAlgos = (next: HashAlgoId[]) => {
    set(
      'hidden',
      ALL_HASH_IDS.filter((id) => !next.includes(id)),
    )
    if (!job) return
    // 文件计算中或已算完时新增了算法：用新的算法组合重新计算
    const added = next.some((id) => !visibleIds.includes(id))
    const missing = !!fileResult && next.some((id) => !fileResult.digests[id])
    if ((job.status === 'hashing' && added) || (job.status === 'done' && missing)) {
      startFile(job.file, next)
    }
  }

  // ───── 当前结果 ─────
  const isText = opts.source === 'text'
  const textEmpty = text === ''
  const textOk = !textEmpty && 'bytes' in decoded
  let digests: HashDigests | null = null
  if (isText) digests = textOk ? (textResult?.digests ?? null) : null
  else if (fileResult && job?.file === fileResult.file) digests = fileResult.digests

  const pending = isText ? textOk && !textResult : job?.status === 'hashing'
  // 输入已变而新结果还没出来：旧结果变淡，避免误读
  const stale =
    isText &&
    !!textResult &&
    (textResult.text !== text || textResult.encoding !== opts.encoding || textResult.ids !== idsKey)

  const visibleDigests = useMemo(() => {
    const out: HashDigests = {}
    if (digests) for (const id of visibleIds) if (digests[id]) out[id] = digests[id]
    return out
  }, [digests, visibleIds])

  const match = useMemo(() => matchDigest(expected, visibleDigests), [expected, visibleDigests])
  const matched = useMemo(() => new Set<string>(match.status === 'match' ? match.ids : []), [match])

  const items = visibleIds.map((id) => {
    const a = hashAlgo(id)
    const d = digests?.[id]
    return {
      id,
      label: a.label,
      bits: a.bits,
      note: a.note,
      weak: a.weak,
      value: d ? formatDigest(d, opts.format, opts.upper) : null,
    }
  })

  const resultPlaceholder = isText ? '输入内容后自动计算' : job ? '等待计算' : '选择文件后开始计算'
  const byteCount = 'bytes' in decoded ? decoded.bytes.length : null
  const encodingLabel = ENCODING_OPTIONS.find((e) => e.value === opts.encoding)?.label

  return (
    <div className="flex flex-col gap-4">
      {/* 输入 */}
      <div className="rounded-3xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 sm:px-5">
          <SegmentedControl
            aria-label="输入来源"
            value={opts.source}
            onChange={(v) => set('source', v)}
            options={[
              {
                value: 'text',
                label: (
                  <>
                    <Type />
                    文本
                  </>
                ),
              },
              {
                value: 'file',
                label: (
                  <>
                    <FileText />
                    文件
                  </>
                ),
              },
            ]}
          />
          {isText ? (
            <div className="flex flex-wrap items-center gap-1">
              <Select
                size="sm"
                value={opts.encoding}
                onChange={(v) => set('encoding', v as TextEncodingId)}
                options={ENCODING_OPTIONS}
                aria-label="输入编码"
                title="先把输入按此编码转换成字节，再计算哈希"
              />
              <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => setText(SAMPLE)}>
                示例
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<ClipboardPaste />}
                onClick={async () => {
                  const t = await readClipboard()
                  if (t !== null) setText(t)
                }}
              >
                粘贴
              </Button>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<Trash2 />}
                aria-label="清空"
                title="清空"
                disabled={!text}
                onClick={() => setText('')}
              />
            </div>
          ) : (
            <span className="text-xs text-fg-3">文件只在本地分块读取，不会上传</span>
          )}
        </div>

        <div className="p-4 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            {isText ? (
              <motion.div
                key="text"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-2"
              >
                <TextArea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    opts.encoding === 'hex'
                      ? '输入十六进制字节，如 48 65 6c 6c 6f'
                      : opts.encoding === 'base64'
                        ? '输入 Base64，如 SGVsbG8='
                        : '输入要计算哈希的文本，结果实时更新'
                  }
                  mono
                  className="min-h-32"
                  aria-label="要计算哈希的文本"
                />
                <div className="flex justify-between gap-3 text-[11px] text-fg-3 tabular-nums">
                  <span>{text.length.toLocaleString()} 字符</span>
                  <span>
                    {byteCount === null ? '—' : `${byteCount.toLocaleString()} 字节`} ·{' '}
                    {encodingLabel}
                  </span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="file"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-3"
              >
                {job && (
                  <FileCard
                    job={job}
                    onCancel={() => ctrlRef.current?.abort()}
                    onRetry={() => startFile(job.file, visibleIds)}
                    onClear={() => {
                      ctrlRef.current?.abort()
                      setJob(null)
                      setFileResult(null)
                    }}
                  />
                )}
                <DropZone
                  onFiles={(files) => files[0] && startFile(files[0], visibleIds)}
                  title={job ? '换一个文件' : '拖入文件，或点击选择'}
                  hint="任意大小，按 2 MB 分块增量计算，可随时取消；只勾选需要的算法会更快"
                  className={job ? 'p-5' : 'py-12'}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <ErrorNotice error={isText && !textEmpty && 'error' in decoded ? decoded.error : null} />

      {/* 选项 */}
      <div className="flex flex-col gap-3 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <SegmentedControl
            size="sm"
            aria-label="输出格式"
            value={opts.format}
            onChange={(v) => set('format', v)}
            options={[
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' },
            ]}
          />
          <Switch
            checked={opts.upper}
            onChange={(v) => set('upper', v)}
            label="大写"
            disabled={opts.format !== 'hex'}
          />
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant={showPicker ? 'secondary' : 'ghost'}
              icon={<ListChecks />}
              onClick={() => setShowPicker((s) => !s)}
              aria-expanded={showPicker}
            >
              算法 {visibleIds.length}/{ALL_HASH_IDS.length}
            </Button>
            <CopyButton
              text={() =>
                digests ? digestsToText(digests, opts.format, opts.upper, visibleIds) : ''
              }
              label="复制全部"
              disabled={!digests}
            />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {showPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="overflow-hidden"
            >
              <div className="border-t border-line pt-3 pb-1">
                <AlgoPicker
                  algos={HASH_ALGOS}
                  selected={visibleIds}
                  onChange={changeAlgos}
                  presets={PRESETS}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <VerifyField
        value={expected}
        onChange={setExpected}
        result={match}
        labelOf={(id) => hashAlgo(id).label}
        idle={!digests}
      />

      {visibleIds.includes('md5') && (
        <Md5Formats
          md5={digests?.md5 ?? null}
          pending={pending}
          stale={stale}
          placeholder={resultPlaceholder}
        />
      )}

      <DigestList
        items={items}
        matched={matched}
        pending={pending}
        stale={stale}
        placeholder={resultPlaceholder}
      />

      <p className="px-1 text-xs leading-relaxed text-fg-3">
        MD5、SHA-1、CRC32、xxHash64 只适合做完整性校验，不要用于密码存储或数字签名；MD5 16 位即 32
        位结果的第 9–24 位。
      </p>
    </div>
  )
}
