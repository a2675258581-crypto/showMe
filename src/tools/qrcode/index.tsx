import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { QrCode, ScanLine } from 'lucide-react'
import { SegmentedControl } from '@/components/ui'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { EMPTY_TEMPLATE_DATA, type TemplateData } from '@/lib/qrcode'
import { SAMPLES } from './ContentForm'
import { Decoder } from './Decoder'
import { Generator } from './Generator'
import { QR_DEFAULTS, sanitizeOptions, type QrMode, type QrOptions } from './options'

const INITIAL_DATA: TemplateData = { ...EMPTY_TEMPLATE_DATA, text: SAMPLES.text }

export default function QrCodeTool() {
  const [stored, setStored] = useLocalStorage<Partial<QrOptions>>('qrcode.options.v1', QR_DEFAULTS)
  const options = useMemo(() => sanitizeOptions(stored), [stored])
  const patch = (p: Partial<QrOptions>) => setStored((prev) => ({ ...sanitizeOptions(prev), ...p }))

  // 内容（可能含 Wi-Fi 密码等）只放内存，不持久化
  const [data, setData] = useState<TemplateData>(INITIAL_DATA)
  const [logo, setLogo] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex justify-center sm:justify-start">
        <SegmentedControl<QrMode>
          value={options.mode}
          onChange={(mode) => patch({ mode })}
          aria-label="模式"
          options={[
            {
              value: 'generate',
              label: (
                <>
                  <QrCode />
                  生成
                </>
              ),
            },
            {
              value: 'decode',
              label: (
                <>
                  <ScanLine />
                  识别
                </>
              ),
            },
          ]}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={options.mode}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        >
          {options.mode === 'generate' ? (
            <Generator
              options={options}
              onOptionsChange={patch}
              data={data}
              onDataChange={setData}
              logo={logo}
              onLogoChange={setLogo}
            />
          ) : (
            <Decoder
              onUseText={(text) => {
                setData((d) => ({ ...d, text }))
                patch({ mode: 'generate', template: 'text' })
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
