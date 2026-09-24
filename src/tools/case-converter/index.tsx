import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { CopyButton, Panel, TextArea } from '@/components/ui'
import { CASE_STYLES, convertLines } from '@/lib/case'

const SAMPLE = 'user profile id\nXMLHttpRequest\nget_http_response_code'

export default function CaseConverter() {
  const [input, setInput] = useState(SAMPLE)
  const results = useMemo(
    () => CASE_STYLES.map((s) => ({ ...s, value: convertLines(input, s.id) })),
    [input],
  )

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入变量名或短语，每行一个"
          mono
          className="min-h-28"
          aria-label="输入"
        />
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.4 }}
            className="group flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-fg-2">{r.label}</span>
              <CopyButton text={r.value} iconOnly variant="ghost" disabled={!r.value} />
            </div>
            <pre className="thin-scrollbar max-h-40 overflow-auto font-mono text-[13px] leading-relaxed break-all whitespace-pre-wrap text-fg">
              {r.value || <span className="text-fg-3">{r.example}</span>}
            </pre>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
