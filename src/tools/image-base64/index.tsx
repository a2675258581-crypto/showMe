import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ImageDown, ImageUp } from 'lucide-react'
import { SegmentedControl } from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { looksLikeSvg } from '@/lib/image-base64'
import { DecodePanel } from './DecodePanel'
import { EncodePanel, readImage, type LoadedImage } from './EncodePanel'
import { SAMPLE_PNG_DATA_URL } from './samples'

interface Prefs {
  mode: 'encode' | 'decode'
  svgMode: 'base64' | 'url'
}

const DEFAULTS: Prefs = { mode: 'encode', svgMode: 'base64' }

function sanitize(p: Partial<Prefs> | null | undefined): Prefs {
  return {
    mode: p?.mode === 'decode' ? 'decode' : 'encode',
    svgMode: p?.svgMode === 'url' ? 'url' : 'base64',
  }
}

export default function ImageBase64() {
  const [stored, setStored] = useLocalStorage<Prefs>('image-base64.options.v1', DEFAULTS)
  const prefs = useMemo(() => sanitize(stored), [stored])
  const set = useCallback(
    <K extends keyof Prefs>(k: K, v: Prefs[K]) => setStored((p) => ({ ...sanitize(p), [k]: v })),
    [setStored],
  )
  const [text, setText] = useState(SAMPLE_PNG_DATA_URL)
  // 图片状态放在这里：切换方向再切回来时，已载入的图片还在
  const [img, setImg] = useState<LoadedImage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = useRef(0)

  const load = useCallback(
    async (blob: Blob, name: string) => {
      const ticket = ++loading.current
      setError(null)
      const r = await readImage(blob, name)
      // 连续粘贴 / 选择时只采用最后一次
      if (ticket !== loading.current) return
      if (r.ok) setImg(r.image)
      else setError(r.error)
      set('mode', 'encode')
    },
    [set],
  )

  // 全局粘贴（两个方向都生效）：图片直接载入；SVG 源码按图片载入；Data URL / Base64 文本去“还原”
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData
      if (!data) return
      const file = Array.from(data.items)
        .find((i) => i.kind === 'file' && i.type.startsWith('image/'))
        ?.getAsFile()
      if (file) {
        e.preventDefault()
        void load(file, file.name && file.name !== 'image.png' ? file.name : '剪贴板图片.png')
        return
      }
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const pasted = data.getData('text/plain').trim()
      if (!pasted) return
      if (prefs.mode === 'encode' && looksLikeSvg(pasted)) {
        e.preventDefault()
        void load(new Blob([pasted], { type: 'image/svg+xml' }), '粘贴的 SVG.svg')
      } else if (
        prefs.mode === 'decode' ||
        /^data:|^[A-Za-z0-9+/_-]{64,}={0,2}$/.test(pasted.replace(/\s+/g, ''))
      ) {
        e.preventDefault()
        setText(pasted)
        set('mode', 'decode')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [load, set, prefs.mode])

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="转换方向"
        value={prefs.mode}
        onChange={(v) => set('mode', v)}
        className="self-start"
        options={[
          {
            value: 'encode',
            label: (
              <>
                <ImageUp />
                图片 → Base64
              </>
            ),
          },
          {
            value: 'decode',
            label: (
              <>
                <ImageDown />
                Base64 → 图片
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
          {prefs.mode === 'encode' ? (
            <EncodePanel
              img={img}
              error={error}
              onLoad={(blob, name) => void load(blob, name)}
              onClear={() => {
                loading.current++
                setImg(null)
                setError(null)
              }}
              onError={setError}
              svgMode={prefs.svgMode}
              onSvgMode={(m) => set('svgMode', m)}
            />
          ) : (
            <DecodePanel text={text} onText={setText} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
