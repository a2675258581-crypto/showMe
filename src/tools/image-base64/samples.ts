/** 示例 SVG（仅作演示内容，颜色写在图片里） */
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a84ff"/>
      <stop offset="1" stop-color="#bf5af2"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="28" fill="url(#g)"/>
  <circle cx="60" cy="60" r="26" fill="none" stroke="#fff" stroke-width="8"/>
  <circle cx="60" cy="60" r="7" fill="#fff"/>
</svg>
`

/** 32×32 的 PNG 示例（带透明圆角） */
export const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB1ElEQVR42sXX/4dUURjH8c/PERGxrCUiYolluUQiIiKWZXdnd7apaWramb07s81+m93Z2S8kIiInIiIiEZGJ6O+Yf2PvzNx77rlzPznc4erHNe7zF7ye4zyH88aFE+LiMXHpmLh8FONKO3Ym2rGaPIy7U63YXG0Nee1gyOv7Q97YH3K6GfHmXsSZvYizuxGdnYi3tg1vbxve2TK82zC81zC8/zLkg82QDzdDM1cPu/O1UC3UtJPb0Mi7GgVXo7iu8T+uJtoxJw9jTrVijgHnXD3kfC3kQk0zt6GZd7Ua4aVqgDTeyQBnwdUsruuOxct2gAxPPsJZqgYsVwNVqQQY3XnWOCuVgO5a4CBZOAmc9TVfIdl2CZyNF34XY3pq58G5U/YNBHE2yz4hibee+4QkfvRsQEjip3YASfxVaUBI4q+fDghJ/I0dQBJ/W+wTkvi7J31CEn//uE9I4h/sAJL4x0KfkMQ/PeoRkvhnO4Ak/mW1R0jiX/M9Ivm3i+Df8p5BEg0SOL+veF0kxSKB88eyp5DkkgTOn8ueg6TVlACufuU8pEOxkyHesfjvpTMgHYpJLmVycov/sQOkcNhWs7lki8VGg/23j+Op2W23C2fvPI3/XTzDPwcy9dPPcpRQAAAAAElFTkSuQmCC'

export const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BASE64}`
