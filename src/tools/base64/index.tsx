import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileUp, Type } from 'lucide-react'
import { SegmentedControl } from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { FileMode } from './FileMode'
import { DEFAULT_PREFS, sanitizePrefs, type Base64Prefs } from './prefs'
import { TextMode } from './TextMode'

export default function Base64Tool() {
  const [stored, setStored] = useLocalStorage<Base64Prefs>('base64.options.v1', DEFAULT_PREFS)
  const prefs = useMemo(() => sanitizePrefs(stored), [stored])
  const set = <K extends keyof Base64Prefs>(k: K, v: Base64Prefs[K]) =>
    setStored((p) => ({ ...sanitizePrefs(p), [k]: v }))

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="处理对象"
        value={prefs.mode}
        onChange={(v) => set('mode', v)}
        className="self-start"
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
                <FileUp />
                文件
              </>
            ),
          },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={prefs.mode}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          {prefs.mode === 'text' ? (
            <TextMode prefs={prefs} set={set} />
          ) : (
            <FileMode prefs={prefs} set={set} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
