import type { ModuleStyle, QrGeometry } from '@/lib/qrcode'

/** 直接用几何路径渲染二维码（与导出的 SVG / PNG 完全一致） */
export function QrSvg({
  geometry: g,
  fg,
  bg,
  logo,
  moduleStyle,
  className,
}: {
  geometry: QrGeometry
  fg: string
  bg: string
  logo?: string | null
  moduleStyle: ModuleStyle
  className?: string
}) {
  const inner = g.logo ? g.logo.size - g.logo.inset * 2 : 0
  return (
    <svg viewBox={`0 0 ${g.dim} ${g.dim}`} className={className} role="img" aria-label="二维码预览">
      <rect width={g.dim} height={g.dim} fill={bg} />
      {g.modules && (
        <path
          d={g.modules}
          fill={fg}
          shapeRendering={moduleStyle === 'square' ? 'crispEdges' : undefined}
        />
      )}
      <path d={g.eyeOuter} fill={fg} fillRule="evenodd" />
      <path d={g.eyeInner} fill={fg} />
      {g.logo && logo && (
        <>
          <rect
            x={g.logo.x}
            y={g.logo.y}
            width={g.logo.size}
            height={g.logo.size}
            rx={g.logo.radius}
            fill={bg}
          />
          <image
            href={logo}
            x={g.logo.x + g.logo.inset}
            y={g.logo.y + g.logo.inset}
            width={inner}
            height={inner}
            preserveAspectRatio="xMidYMid meet"
          />
        </>
      )}
    </svg>
  )
}
