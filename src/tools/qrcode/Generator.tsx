import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeftRight,
  Copy,
  Download,
  FileCode2,
  ImagePlus,
  QrCode,
  Sparkles,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  CopyButton,
  ErrorNotice,
  Field,
  Notice,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  Slider,
  useToast,
} from '@/components/ui'
import { useDebounced } from '@/hooks/useDebounced'
import { cn } from '@/lib/cn'
import { downloadBlob, downloadText } from '@/lib/file'
import {
  ECL_INFO,
  LOGO_MAX_AREA,
  LOGO_MIN_VERSION,
  QR_CAPACITY_BYTES,
  buildGeometry,
  buildPayload,
  colorWarning,
  createMatrix,
  renderSvg,
  utf8Length,
  type Ecl,
  type EyeStyle,
  type ModuleStyle,
  type TemplateData,
} from '@/lib/qrcode'
import { canCopyImage, copyPng, geometryToPng, prepareLogo } from './canvas'
import { ColorField } from './ColorField'
import { ContentForm, SAMPLES, TemplatePicker } from './ContentForm'
import { ECLS, PALETTES, type QrOptions } from './options'
import { QrSvg } from './QrSvg'

interface Props {
  options: QrOptions
  onOptionsChange: (patch: Partial<QrOptions>) => void
  data: TemplateData
  onDataChange: (d: TemplateData) => void
  /** Logo（≤256px 的 PNG data URL） */
  logo: string | null
  onLogoChange: (logo: string | null) => void
}

export function Generator({
  options: o,
  onOptionsChange,
  data,
  onDataChange,
  logo,
  onLogoChange: setLogo,
}: Props) {
  const toast = useToast()
  const set = <K extends keyof QrOptions>(k: K, v: QrOptions[K]) => onOptionsChange({ [k]: v })
  const template = o.template

  const [busy, setBusy] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)

  const payload = useMemo(() => buildPayload(template, data), [template, data])
  const text = useDebounced(payload.text, 150)
  const ecl: Ecl = logo ? 'H' : o.ecl

  const matrix = useMemo(
    () => (text ? createMatrix(text, ecl, logo ? LOGO_MIN_VERSION : 1) : null),
    [text, ecl, logo],
  )
  const geometry = useMemo(
    () =>
      matrix?.ok
        ? buildGeometry(matrix.matrix, {
            margin: o.margin,
            moduleStyle: o.moduleStyle,
            eyeStyle: o.eyeStyle,
            logoArea: logo ? o.logoArea : undefined,
          })
        : null,
    [matrix, o.margin, o.moduleStyle, o.eyeStyle, o.logoArea, logo],
  )

  const bytes = utf8Length(text)
  const colorWarn = colorWarning(o.fg, o.bg)
  const pngPx = Math.round(o.size * o.pngScale)
  const popKey = `${text}|${ecl}|${o.margin}|${o.moduleStyle}|${o.eyeStyle}|${logo ? o.logoArea : 0}`

  const exportPng = () => {
    if (!geometry) return Promise.reject(new Error('没有可导出的二维码'))
    return geometryToPng(geometry, { fg: o.fg, bg: o.bg, px: pngPx, logo })
  }

  const downloadPng = async () => {
    setBusy(true)
    try {
      downloadBlob(`qrcode-${pngPx}.png`, await exportPng())
    } catch (e) {
      const msg = e instanceof Error ? e.message : '导出失败'
      // 画布过大时（如 iOS Safari 超过约 4096px）toBlob 会失败
      toast(pngPx > 4096 ? `${msg}：${pngPx}px 可能超出浏览器画布上限，请降低倍率` : msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  const downloadSvg = () => {
    if (!geometry) return
    const svg = renderSvg(geometry, {
      fg: o.fg,
      bg: o.bg,
      size: o.size,
      logoHref: logo ?? undefined,
      moduleStyle: o.moduleStyle,
    })
    downloadText('qrcode.svg', svg, 'image/svg+xml;charset=utf-8')
  }

  const copyImage = async () => {
    if (!canCopyImage) {
      toast('当前浏览器不支持复制图片，请使用下载', 'error')
      return
    }
    try {
      await copyPng(exportPng())
      toast('已复制图片')
    } catch {
      toast('复制失败，请检查浏览器权限或改用下载', 'error')
    }
  }

  const onLogo = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('请选择图片文件', 'error')
      return
    }
    try {
      setLogo(await prepareLogo(file))
    } catch {
      toast('无法读取这张图片', 'error')
    }
  }

  return (
    <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      {/* 内容 */}
      <Panel className="min-w-0 lg:col-start-1 lg:row-start-1">
        <PanelHeader title="内容">
          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles />}
            onClick={() => onDataChange({ ...data, [template]: SAMPLES[template] })}
          >
            示例
          </Button>
        </PanelHeader>
        <div className="flex flex-col gap-5">
          <TemplatePicker value={template} onChange={(t) => set('template', t)} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={template}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <ContentForm template={template} data={data} onChange={onDataChange} />
            </motion.div>
          </AnimatePresence>
          <AnimatePresence>
            {payload.warnings.map((w) => (
              <Notice key={w} tone="warning">
                {w}
              </Notice>
            ))}
          </AnimatePresence>
          {payload.text && template !== 'text' && (
            <Field
              label="编码内容"
              action={
                <CopyButton text={payload.text} iconOnly variant="ghost" label="复制编码内容" />
              }
            >
              <pre className="thin-scrollbar max-h-40 overflow-auto rounded-2xl bg-fill-2 px-3.5 py-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-fg-2">
                {payload.text}
              </pre>
            </Field>
          )}
        </div>
      </Panel>

      {/* 预览 */}
      <Panel className="flex min-w-0 flex-col items-center gap-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="relative aspect-square w-full max-w-[320px]">
          {geometry ? (
            <motion.div
              key={popKey}
              initial={{ scale: 0.94, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              className="size-full overflow-hidden rounded-2xl shadow-[0_8px_30px_rgb(0_0_0/0.08)] ring-1 ring-line"
            >
              <QrSvg
                geometry={geometry}
                fg={o.fg}
                bg={o.bg}
                logo={logo}
                moduleStyle={o.moduleStyle}
                className="block size-full"
              />
            </motion.div>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-surface-2 text-center text-fg-3">
              <QrCode className="size-10" />
              <span className="px-6 text-sm">
                {payload.error ?? (matrix && !matrix.ok ? '无法生成' : '输入内容后自动生成')}
              </span>
            </div>
          )}
        </div>

        <ErrorNotice
          error={
            matrix && !matrix.ok
              ? logo && matrix.error.startsWith('内容过长')
                ? `${matrix.error.replace(/可以降低容错级别或缩短内容。$/, '')}放置 Logo 时固定使用 H 级容错，移除 Logo 后可以容纳更多内容。`
                : matrix.error
              : null
          }
          className="w-full"
        />

        {geometry && matrix?.ok && (
          <div className="flex w-full flex-col gap-2">
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-fg-2">
              <Badge>版本 {matrix.matrix.version}</Badge>
              <Badge color="var(--sys-indigo)">
                {matrix.matrix.size}×{matrix.matrix.size}
              </Badge>
              <Badge color="var(--sys-teal)">容错 {ecl}</Badge>
              <Badge color="var(--sys-orange)">{bytes.toLocaleString()} 字节</Badge>
            </div>
            <div
              className="h-1 w-full overflow-hidden rounded-full bg-fill"
              title={`已用容量 ${bytes} / ${QR_CAPACITY_BYTES[ecl]} 字节`}
            >
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  bytes / QR_CAPACITY_BYTES[ecl] > 0.8 ? 'bg-warning' : 'bg-accent',
                )}
                initial={false}
                animate={{
                  width: `${Math.min(100, Math.max(1, (bytes / QR_CAPACITY_BYTES[ecl]) * 100))}%`,
                }}
                transition={{ type: 'spring', stiffness: 200, damping: 30 }}
              />
            </div>
            <p className="text-center text-[11px] text-fg-3">
              内容越多码越密；打印尺寸较小时建议缩短内容或使用短链接。
            </p>
          </div>
        )}

        <div className="flex w-full flex-col gap-2">
          <div className="flex gap-2">
            <Button
              variant="primary"
              icon={<Download />}
              className="flex-1"
              disabled={!geometry || busy}
              onClick={downloadPng}
            >
              下载 PNG
            </Button>
            <Select
              value={String(o.pngScale)}
              onChange={(v) => set('pngScale', Number(v))}
              aria-label="PNG 倍率"
              options={[1, 2, 3, 4].map((k) => ({
                value: String(k),
                label: `${k}x · ${Math.round(o.size * k)}px`,
              }))}
              className="w-36"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={<FileCode2 />}
              className="flex-1"
              disabled={!geometry}
              onClick={downloadSvg}
            >
              下载 SVG
            </Button>
            <Button
              variant="secondary"
              icon={<Copy />}
              className="flex-1"
              disabled={!geometry}
              onClick={copyImage}
            >
              复制图片
            </Button>
          </div>
        </div>
      </Panel>

      {/* 样式 */}
      <Panel className="min-w-0 lg:col-start-1 lg:row-start-2">
        <PanelHeader title="样式" />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="容错级别"
            hint={logo ? '放置 Logo 时自动使用 H 级容错' : `可恢复${ECL_INFO[ecl].recovery}的损坏`}
          >
            {/* 有 Logo 时锁定为 H，禁用以免悄悄改掉保存的级别 */}
            <SegmentedControl<Ecl>
              block
              value={ecl}
              onChange={(v) => set('ecl', v)}
              disabled={!!logo}
              aria-label="容错级别"
              options={ECLS.map((e) => ({
                value: e,
                label: e,
                title: `恢复${ECL_INFO[e].recovery}`,
              }))}
            />
          </Field>
          <div className="flex flex-col gap-4">
            <Slider
              label="尺寸"
              value={o.size}
              min={128}
              max={2048}
              step={32}
              onChange={(v) => set('size', v)}
              format={(v) => `${v} px`}
            />
            <Slider
              label="边距"
              value={o.margin}
              min={0}
              max={8}
              onChange={(v) => set('margin', v)}
              format={(v) => `${v} 格`}
            />
          </div>

          <Field label="码点样式">
            <SegmentedControl<ModuleStyle>
              block
              value={o.moduleStyle}
              onChange={(v) => set('moduleStyle', v)}
              aria-label="码点样式"
              options={[
                { value: 'square', label: '方块' },
                { value: 'dots', label: '圆点' },
                { value: 'rounded', label: '圆角' },
              ]}
            />
          </Field>
          <Field label="码眼样式">
            <SegmentedControl<EyeStyle>
              block
              value={o.eyeStyle}
              onChange={(v) => set('eyeStyle', v)}
              aria-label="码眼样式"
              options={[
                { value: 'square', label: '方形' },
                { value: 'rounded', label: '圆角' },
                { value: 'circle', label: '圆形' },
              ]}
            />
          </Field>

          <div className="flex flex-col gap-3 sm:col-span-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
              <ColorField label="前景色" value={o.fg} onChange={(v) => set('fg', v)} />
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                icon={<ArrowLeftRight />}
                aria-label="交换前景色与背景色"
                title="交换前景色与背景色"
                className="mb-1"
                onClick={() => onOptionsChange({ fg: o.bg, bg: o.fg })}
              />
              <ColorField label="背景色" value={o.bg} onChange={(v) => set('bg', v)} />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="配色方案">
              {PALETTES.map((p) => {
                const active = p.fg === o.fg && p.bg === o.bg
                return (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    aria-label={`配色：${p.name}`}
                    aria-pressed={active}
                    onClick={() => onOptionsChange({ fg: p.fg, bg: p.bg })}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-xs transition-colors',
                      active ? 'border-accent text-fg' : 'border-line text-fg-2 hover:bg-fill-2',
                    )}
                  >
                    <span
                      className="flex size-6 items-center justify-center rounded-full ring-1 ring-line"
                      style={{ background: p.bg }}
                    >
                      <span className="size-3 rounded-[3px]" style={{ background: p.fg }} />
                    </span>
                    {p.name}
                  </button>
                )
              })}
            </div>
            <AnimatePresence>
              {colorWarn && (
                <Notice key={colorWarn} tone="warning">
                  {colorWarn}
                </Notice>
              )}
            </AnimatePresence>
          </div>

          {/* Logo */}
          <div className="flex flex-col gap-3 sm:col-span-2">
            <span className="text-xs font-semibold tracking-wide text-fg-2">中心 Logo</span>
            <input
              ref={logoInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void onLogo(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {logo ? (
              <div className="flex flex-wrap items-center gap-4">
                <img
                  src={logo}
                  alt="Logo 预览"
                  className="size-12 rounded-xl bg-fill-2 object-contain p-1 ring-1 ring-line"
                />
                <Slider
                  className="min-w-40 flex-1"
                  label="Logo 面积"
                  value={Math.round(o.logoArea * 100)}
                  min={4}
                  max={Math.round(LOGO_MAX_AREA * 100)}
                  onChange={(v) => set('logoArea', v / 100)}
                  format={(v) => `${v}%`}
                />
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => logoInput.current?.click()}>
                    更换
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={<X />}
                    aria-label="移除 Logo"
                    title="移除 Logo"
                    onClick={() => setLogo(null)}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ImagePlus />}
                  onClick={() => logoInput.current?.click()}
                >
                  上传 Logo
                </Button>
                <span className="text-xs text-fg-3">
                  Logo 最多占码区面积的 20%，并自动切换到 H 级容错。
                </span>
              </div>
            )}
            {logo && o.logoArea > 0.12 && (
              <p className="text-xs text-warning">Logo 较大，请用手机实际扫一扫确认能识别。</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  )
}
