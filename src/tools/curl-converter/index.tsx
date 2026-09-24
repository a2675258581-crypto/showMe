import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ClipboardPaste, Download, Send, Sparkles, Terminal, Trash2 } from 'lucide-react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { EditorPane } from '@/components/editor/IOPanel'
import {
  Button,
  CopyButton,
  ErrorNotice,
  Notice,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  useToast,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { STORAGE_KEYS, encodeImport } from '@/lib/api-client-store'
import { readClipboard } from '@/lib/clipboard'
import { parseCurl } from '@/lib/curl'
import { downloadText } from '@/lib/file'
import { CODE_TARGETS, CODE_TARGET_MAP, generateCode, type CodeTarget } from '@/lib/http-codegen'
import { editorLangFor } from '@/components/editor/streamLangs'
import { Summary } from './Summary'

const SAMPLES: { id: string; label: string; value: string }[] = [
  {
    id: 'chrome-bash',
    label: 'Chrome 复制（bash）',
    value: `curl 'https://api.example.com/v1/orders?page=1&size=20' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'accept-language: zh-CN,zh;q=0.9,en;q=0.8' \\
  -H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMDAxIn0.sig' \\
  -H 'content-type: application/json' \\
  -b 'sid=8f2c1e; theme=dark' \\
  -H 'origin: https://shop.example.com' \\
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' \\
  --data-raw '{"keyword":"降噪耳机","filters":{"price":[100,500],"inStock":true}}' \\
  --compressed`,
  },
  {
    id: 'chrome-cmd',
    label: 'Chrome 复制（cmd）',
    value: [
      'curl ^"https://api.example.com/v1/search?q=^%^E4^%^B8^%^AD^&lang=zh^" ^',
      '  -H ^"accept: application/json^" ^',
      '  -H ^"content-type: application/json;charset=UTF-8^" ^',
      '  --data-raw ^"^{^\\^"name^\\^":^\\^"^张^三^\\^",^\\^"tags^\\^":^[^\\^"a^\\^",^\\^"b^\\^"^]^}^" ^',
      '  --compressed',
    ].join('\n'),
  },
  {
    id: 'upload',
    label: '文件上传 + Basic 认证',
    value: `curl -X POST https://upload.example.com/api/files \\
  -u 'admin:s3cr3t' \\
  -F 'title=年度报告' \\
  -F 'file=@./report-2026.pdf;type=application/pdf' \\
  -F 'cover=@/Users/me/Pictures/cover.png' \\
  -L --max-time 30`,
  },
  {
    id: 'get',
    label: 'GET 查询（-G）',
    value: `curl -G https://api.github.com/search/repositories \\
  --data-urlencode 'q=language:typescript stars:>10000' \\
  -d per_page=5 \\
  -H 'Accept: application/vnd.github+json' \\
  -H 'X-GitHub-Api-Version: 2022-11-28'`,
  },
]

/** 分段控件里展示的常用语言，其余放进下拉框 */
const TOP: CodeTarget[] = ['fetch', 'axios', 'python', 'go']

interface Options {
  target: CodeTarget
}

export default function CurlConverter() {
  const [input, setInput] = useState(SAMPLES[0].value)
  const [opts, setOpts] = useLocalStorage<Options>('curl-converter.options.v1', { target: 'fetch' })
  const target: CodeTarget = CODE_TARGET_MAP[opts?.target] ? opts.target : 'fetch'
  const setTarget = (t: CodeTarget) => setOpts({ target: t })
  const toast = useToast()
  const navigate = useNavigate()

  const debounced = useDebounced(input, 150)
  const parsed = useMemo(() => (debounced.trim() ? parseCurl(debounced) : null), [debounced])
  const code = useMemo(
    () => (parsed?.ok ? generateCode(parsed.request, target) : ''),
    [parsed, target],
  )
  const info = CODE_TARGET_MAP[target]
  const editor = editorLangFor(info.lang)
  const inputEditor = editorLangFor('shell')

  const topOptions = TOP.map((id) => ({ value: id, label: CODE_TARGET_MAP[id].label }))
  const restOptions = CODE_TARGETS.filter((t) => !TOP.includes(t.id)).map((t) => ({
    value: t.id,
    label: t.label,
  }))

  const openInApiClient = () => {
    if (!parsed?.ok) return
    try {
      localStorage.setItem(STORAGE_KEYS.import, encodeImport(parsed.request, Date.now()))
    } catch {
      toast('无法写入本地存储，请检查浏览器隐私设置', 'error')
      return
    }
    navigate('/t/api-client')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5 rounded-3xl border border-line bg-surface px-4 py-3 shadow-card">
        <span className="text-xs font-semibold tracking-wide text-fg-2">目标语言</span>
        {/* 窄屏放不下四段分段控件，改用一个分组下拉框 */}
        <Select
          size="sm"
          aria-label="目标语言"
          value={target}
          onChange={(v) => setTarget(v as CodeTarget)}
          groups={[
            { label: '常用', options: topOptions },
            { label: '更多语言', options: restOptions },
          ]}
          className="min-w-40 flex-1 sm:hidden"
        />
        <SegmentedControl
          size="sm"
          aria-label="常用语言"
          value={target}
          onChange={setTarget}
          options={topOptions}
          className="hidden sm:inline-flex"
        />
        <Select
          size="sm"
          aria-label="更多语言"
          value={TOP.includes(target) ? '' : target}
          onChange={(v) => v && setTarget(v as CodeTarget)}
          options={[{ value: '', label: '更多语言…' }, ...restOptions]}
          className="hidden min-w-40 sm:inline-flex"
        />
        <Button
          variant="primary"
          size="sm"
          icon={<Send />}
          disabled={!parsed?.ok}
          onClick={openInApiClient}
          className="w-full sm:ml-auto sm:w-auto"
        >
          在 API 调试中打开
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EditorPane
          title={
            <span className="inline-flex items-center gap-1.5">
              <Terminal className="size-3.5 text-fg-2" />
              cURL 命令
            </span>
          }
          onDropFile={async (f) => setInput(await f.text())}
          actions={
            <>
              <Select
                size="sm"
                aria-label="载入示例"
                value=""
                onChange={(v) => {
                  const s = SAMPLES.find((x) => x.id === v)
                  if (s) setInput(s.value)
                }}
                options={[
                  { value: '', label: '示例' },
                  ...SAMPLES.map((s) => ({ value: s.id, label: s.label })),
                ]}
                className="w-24"
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<ClipboardPaste />}
                onClick={async () => {
                  const t = await readClipboard()
                  if (t !== null) setInput(t)
                  else toast('无法读取剪贴板，请直接粘贴到编辑器', 'error')
                }}
              >
                粘贴
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 />}
                iconOnly
                aria-label="清空"
                title="清空"
                disabled={!input}
                onClick={() => setInput('')}
              />
            </>
          }
          footer={
            <>
              <span className="shrink-0">{input.length.toLocaleString()} 字符</span>
              <span className="truncate">
                支持 bash / zsh、Windows cmd 与 Chrome「复制为 cURL」
              </span>
            </>
          }
        >
          <CodeEditor
            value={input}
            onChange={setInput}
            lang={inputEditor.lang}
            extensions={inputEditor.extensions}
            placeholder={
              "在此粘贴 curl 命令，例如：\ncurl 'https://api.example.com/users' -H 'Accept: application/json'"
            }
            aria-label="cURL 命令"
          />
        </EditorPane>

        <EditorPane
          title={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-fg-2" />
              {info.label}
            </span>
          }
          actions={
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Download />}
                iconOnly
                aria-label="下载代码"
                title={`下载 ${info.filename}`}
                disabled={!code}
                onClick={() => downloadText(info.filename, code)}
              />
              <CopyButton text={code} disabled={!code} />
            </>
          }
          footer={
            <>
              <span>{code ? `${code.split('\n').length} 行` : '—'}</span>
              <span>{info.filename}</span>
            </>
          }
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={target}
              className="h-full"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <CodeEditor
                value={code}
                readOnly
                lang={editor.lang}
                extensions={editor.extensions}
                placeholder="转换结果会显示在这里"
                aria-label="生成的代码"
              />
            </motion.div>
          </AnimatePresence>
        </EditorPane>
      </div>

      <ErrorNotice error={parsed && !parsed.ok ? parsed.error : null} />

      <AnimatePresence initial={false}>
        {parsed && parsed.warnings.length > 0 && (
          <motion.div
            key="warnings"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 36 }}
            className="overflow-hidden"
          >
            <Notice tone="warning">
              <div className="font-medium">解析时有 {parsed.warnings.length} 条提示：</div>
              <ul className="mt-1 list-disc pl-4">
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout" initial={false}>
        {parsed?.ok ? (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <Panel>
              <PanelHeader title="解析结果">
                <Button size="sm" variant="secondary" icon={<Send />} onClick={openInApiClient}>
                  发送这个请求
                </Button>
              </PanelHeader>
              <Summary request={parsed.request} />
            </Panel>
          </motion.div>
        ) : !parsed ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Panel className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Terminal className="size-5" />
              </span>
              <p className="max-w-md text-sm text-fg-2">
                在浏览器开发者工具的「网络」面板里右键请求 →「复制」→「以 cURL
                格式复制」，粘贴到上面即可。
              </p>
              <Button size="sm" variant="secondary" onClick={() => setInput(SAMPLES[0].value)}>
                载入示例
              </Button>
            </Panel>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
