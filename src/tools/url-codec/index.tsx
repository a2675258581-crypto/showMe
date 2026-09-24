import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, ScanText } from 'lucide-react'
import { SegmentedControl } from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { CodecPanel } from './CodecPanel'
import { DEFAULT_PREFS, sanitizePrefs, type UrlPrefs } from './prefs'
import { UrlParser } from './UrlParser'

export default function UrlCodec() {
  const [stored, setStored] = useLocalStorage<UrlPrefs>('url-codec.options.v1', DEFAULT_PREFS)
  const prefs = useMemo(() => sanitizePrefs(stored), [stored])
  const set = <K extends keyof UrlPrefs>(k: K, v: UrlPrefs[K]) =>
    setStored((p) => ({ ...sanitizePrefs(p), [k]: v }))

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="功能"
        value={prefs.tab}
        onChange={(v) => set('tab', v)}
        className="self-start"
        options={[
          {
            value: 'codec',
            label: (
              <>
                <ArrowLeftRight />
                编码 / 解码
              </>
            ),
          },
          {
            value: 'parse',
            label: (
              <>
                <ScanText />
                URL 解析
              </>
            ),
          },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={prefs.tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          {prefs.tab === 'codec' ? (
            <CodecPanel prefs={prefs} set={set} />
          ) : (
            <UrlParser prefs={prefs} set={set} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
