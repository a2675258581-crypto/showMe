/** 用 Canvas 画一张「风景」示例图（高质量 JPEG，约 1 MB），方便直接体验压缩效果 */
export async function makeSampleImage(): Promise<File> {
  const W = 1600
  const H = 1000
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 Canvas')

  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7)
  sky.addColorStop(0, '#1e3c72')
  sky.addColorStop(0.55, '#f7797d')
  sky.addColorStop(1, '#fbd786')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  // 太阳 + 光晕
  const glow = ctx.createRadialGradient(W * 0.68, H * 0.52, 10, W * 0.68, H * 0.52, 320)
  glow.addColorStop(0, 'rgba(255,244,214,0.95)')
  glow.addColorStop(0.25, 'rgba(255,214,150,0.55)')
  glow.addColorStop(1, 'rgba(255,214,150,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff4d6'
  ctx.beginPath()
  ctx.arc(W * 0.68, H * 0.52, 70, 0, Math.PI * 2)
  ctx.fill()

  // 伪随机（固定种子，示例图每次都一样）
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  // 星点
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.6})`
    ctx.fillRect(rnd() * W, rnd() * H * 0.35, 1.5, 1.5)
  }

  // 三层山脉
  const layers: [string, number, number][] = [
    ['#6d4c7d', 0.62, 90],
    ['#4a3a63', 0.72, 70],
    ['#2b2340', 0.84, 55],
  ]
  for (const [color, base, amp] of layers) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, H)
    let y = H * base
    for (let x = 0; x <= W; x += 8) {
      y += (rnd() - 0.5) * 18
      y = Math.min(H * base + amp, Math.max(H * base - amp, y))
      ctx.lineTo(x, y)
    }
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fill()
  }

  // 湖面倒影 + 细噪点（模拟照片的颗粒感）
  const lake = ctx.createLinearGradient(0, H * 0.88, 0, H)
  lake.addColorStop(0, 'rgba(251,215,134,0.35)')
  lake.addColorStop(1, 'rgba(30,60,114,0.6)')
  ctx.fillStyle = lake
  ctx.fillRect(0, H * 0.88, W, H * 0.12)
  const noise = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < noise.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14
    noise.data[i] += n
    noise.data[i + 1] += n
    noise.data[i + 2] += n
  }
  ctx.putImageData(noise, 0, 0)

  // 相机直出一般是高质量 JPEG，这里用 0.97 模拟
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.97))
  if (!blob) throw new Error('生成示例图失败')
  return new File([blob], '示例-晚霞.jpg', { type: 'image/jpeg' })
}
