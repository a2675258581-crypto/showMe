/** 按文件头魔数识别文件类型（纯函数，无 DOM 依赖） */

export type FileKind =
  'image' | 'audio' | 'video' | 'document' | 'archive' | 'font' | 'text' | 'executable' | 'binary'

export interface FileTypeInfo {
  mime: string
  /** 扩展名（不含点） */
  ext: string
  /** 中文友好名称 */
  label: string
  kind: FileKind
}

const at = (b: Uint8Array, sig: readonly number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v)

const ascii = (b: Uint8Array, text: string, offset = 0) =>
  b.length >= offset + text.length &&
  Array.from(text).every((ch, i) => b[offset + i] === ch.charCodeAt(0))

function readAscii(b: Uint8Array, offset: number, len: number): string {
  let s = ''
  for (let i = offset; i < offset + len && i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

const T = (mime: string, ext: string, label: string, kind: FileKind): FileTypeInfo => ({
  mime,
  ext,
  label,
  kind,
})

/** ISO-BMFF（ftyp 盒子）的品牌 → 类型 */
function ftyp(b: Uint8Array): FileTypeInfo | null {
  if (!ascii(b, 'ftyp', 4)) return null
  const brand = readAscii(b, 8, 4).replace(/\0/g, ' ').trim().toLowerCase()
  if (brand === 'avif' || brand === 'avis') return T('image/avif', 'avif', 'AVIF 图片', 'image')
  if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand))
    return T('image/heic', 'heic', 'HEIC 图片', 'image')
  if (brand === 'mif1' || brand === 'msf1') return T('image/heif', 'heif', 'HEIF 图片', 'image')
  if (brand === 'qt') return T('video/quicktime', 'mov', 'QuickTime 视频', 'video')
  if (brand === 'm4a' || brand === 'm4b') return T('audio/mp4', 'm4a', 'M4A 音频', 'audio')
  if (brand.startsWith('3g')) return T('video/3gpp', '3gp', '3GP 视频', 'video')
  return T('video/mp4', 'mp4', 'MP4 视频', 'video')
}

/** ZIP 容器细分：docx / xlsx / pptx / epub / jar / apk */
function zipFlavor(b: Uint8Array): FileTypeInfo {
  const head = readAscii(b, 0, Math.min(b.length, 8192))
  if (head.includes('mimetypeapplication/epub+zip'))
    return T('application/epub+zip', 'epub', 'EPUB 电子书', 'document')
  if (head.includes('word/'))
    return T(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx',
      'Word 文档',
      'document',
    )
  if (head.includes('xl/'))
    return T(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx',
      'Excel 表格',
      'document',
    )
  if (head.includes('ppt/'))
    return T(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'pptx',
      'PowerPoint 演示文稿',
      'document',
    )
  if (head.includes('AndroidManifest.xml'))
    return T('application/vnd.android.package-archive', 'apk', 'Android 安装包', 'archive')
  if (head.includes('META-INF/MANIFEST.MF'))
    return T('application/java-archive', 'jar', 'Java 归档', 'archive')
  return T('application/zip', 'zip', 'ZIP 压缩包', 'archive')
}

/** 看起来像文本：合法 UTF-8 且没有除 \t \n \r \f 外的控制字符 */
function sniffText(b: Uint8Array): FileTypeInfo | null {
  const sample = b.subarray(0, 4096)
  if (sample.length === 0) return null
  for (const c of sample) {
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12) return null
    if (c === 0x7f) return null
  }
  let text: string
  try {
    // 截断处可能切开多字节字符，stream 模式会把残缺的尾巴留着不报错
    text = new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true })
  } catch {
    return null
  }
  const t = text.replace(/^\ufeff/, '').trimStart()
  const lower = t.slice(0, 1024).toLowerCase()
  const noXmlDecl = lower.replace(/^<\?xml[\s\S]*?\?>\s*/, '').replace(/^(<!--[\s\S]*?-->\s*)+/, '')
  if (/^(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(noXmlDecl))
    return T('image/svg+xml', 'svg', 'SVG 矢量图', 'image')
  if (/^<!doctype html|^<html[\s>]/.test(noXmlDecl)) return T('text/html', 'html', 'HTML', 'text')
  if (lower.startsWith('<?xml')) return T('application/xml', 'xml', 'XML', 'text')
  if (/^[{[]/.test(t) && b.length <= 1 << 20) {
    try {
      JSON.parse(new TextDecoder().decode(b))
      return T('application/json', 'json', 'JSON', 'text')
    } catch {
      /* 不是 JSON */
    }
  }
  if (lower.startsWith('%!ps')) return T('application/postscript', 'ps', 'PostScript', 'document')
  if (lower.startsWith('{\\rtf')) return T('application/rtf', 'rtf', 'RTF 文档', 'document')
  return T('text/plain', 'txt', '纯文本', 'text')
}

/** 根据文件头识别类型，无法识别返回 null */
export function detectFileType(b: Uint8Array): FileTypeInfo | null {
  if (b.length === 0) return null

  // ── 图片
  if (at(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return T('image/png', 'png', 'PNG 图片', 'image')
  if (at(b, [0xff, 0xd8, 0xff])) return T('image/jpeg', 'jpg', 'JPEG 图片', 'image')
  if (ascii(b, 'GIF87a') || ascii(b, 'GIF89a')) return T('image/gif', 'gif', 'GIF 动图', 'image')
  if (ascii(b, 'RIFF') && ascii(b, 'WEBP', 8)) return T('image/webp', 'webp', 'WebP 图片', 'image')
  if (at(b, [0x00, 0x00, 0x01, 0x00]) && b.length >= 6 && b[4] + b[5] > 0)
    return T('image/x-icon', 'ico', 'ICO 图标', 'image')
  if (at(b, [0x00, 0x00, 0x02, 0x00]) && b.length >= 6 && b[4] + b[5] > 0)
    return T('image/x-icon', 'cur', 'CUR 光标', 'image')
  if (ascii(b, 'BM') && b.length >= 26 && b[14] >= 12 && b[15] === 0 && b[6] === 0 && b[7] === 0)
    return T('image/bmp', 'bmp', 'BMP 位图', 'image')
  if (at(b, [0x49, 0x49, 0x2a, 0x00]) || at(b, [0x4d, 0x4d, 0x00, 0x2a]))
    return T('image/tiff', 'tiff', 'TIFF 图片', 'image')
  if (ascii(b, '8BPS')) return T('image/vnd.adobe.photoshop', 'psd', 'Photoshop 文档', 'image')
  if (at(b, [0xff, 0x0a]) || at(b, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20]))
    return T('image/jxl', 'jxl', 'JPEG XL 图片', 'image')
  if (ascii(b, 'icns')) return T('image/icns', 'icns', 'macOS 图标', 'image')

  // ── 文档
  if (ascii(b, '%PDF-')) return T('application/pdf', 'pdf', 'PDF 文档', 'document')
  if (at(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return T('application/x-cfb', 'doc', 'Office 97-2003 文档', 'document')
  if (ascii(b, 'SQLite format 3\0'))
    return T('application/vnd.sqlite3', 'sqlite', 'SQLite 数据库', 'binary')

  // ── 压缩包
  if (at(b, [0x50, 0x4b, 0x03, 0x04]) || at(b, [0x50, 0x4b, 0x05, 0x06])) return zipFlavor(b)
  if (at(b, [0x1f, 0x8b])) return T('application/gzip', 'gz', 'GZIP 压缩包', 'archive')
  if (at(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    return T('application/x-7z-compressed', '7z', '7-Zip 压缩包', 'archive')
  if (ascii(b, 'Rar!\x1a\x07')) return T('application/vnd.rar', 'rar', 'RAR 压缩包', 'archive')
  if (at(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))
    return T('application/x-xz', 'xz', 'XZ 压缩包', 'archive')
  if (ascii(b, 'BZh')) return T('application/x-bzip2', 'bz2', 'BZIP2 压缩包', 'archive')
  if (at(b, [0x28, 0xb5, 0x2f, 0xfd]))
    return T('application/zstd', 'zst', 'Zstandard 压缩包', 'archive')
  if (ascii(b, 'ustar', 257)) return T('application/x-tar', 'tar', 'TAR 归档', 'archive')

  // ── 音视频
  if (ascii(b, 'RIFF') && ascii(b, 'WAVE', 8)) return T('audio/wav', 'wav', 'WAV 音频', 'audio')
  if (ascii(b, 'RIFF') && ascii(b, 'AVI ', 8))
    return T('video/x-msvideo', 'avi', 'AVI 视频', 'video')
  if (ascii(b, 'OggS')) return T('audio/ogg', 'ogg', 'Ogg 音频', 'audio')
  if (ascii(b, 'fLaC')) return T('audio/flac', 'flac', 'FLAC 音频', 'audio')
  if (ascii(b, 'ID3') || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe6) === 0xe2))
    return T('audio/mpeg', 'mp3', 'MP3 音频', 'audio')
  if (at(b, [0xff, 0xf1]) || at(b, [0xff, 0xf9])) return T('audio/aac', 'aac', 'AAC 音频', 'audio')
  if (ascii(b, 'MThd')) return T('audio/midi', 'mid', 'MIDI 音乐', 'audio')
  if (at(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = readAscii(b, 0, 64)
    return head.includes('webm')
      ? T('video/webm', 'webm', 'WebM 视频', 'video')
      : T('video/x-matroska', 'mkv', 'Matroska 视频', 'video')
  }
  const box = ftyp(b)
  if (box) return box
  if (ascii(b, 'FLV')) return T('video/x-flv', 'flv', 'FLV 视频', 'video')

  // ── 字体
  if (ascii(b, 'wOFF')) return T('font/woff', 'woff', 'WOFF 字体', 'font')
  if (ascii(b, 'wOF2')) return T('font/woff2', 'woff2', 'WOFF2 字体', 'font')
  if (ascii(b, 'OTTO')) return T('font/otf', 'otf', 'OpenType 字体', 'font')
  if (at(b, [0x00, 0x01, 0x00, 0x00, 0x00])) return T('font/ttf', 'ttf', 'TrueType 字体', 'font')

  // ── 可执行 / 字节码
  if (at(b, [0x00, 0x61, 0x73, 0x6d]))
    return T('application/wasm', 'wasm', 'WebAssembly 模块', 'executable')
  if (at(b, [0x7f, 0x45, 0x4c, 0x46]))
    return T('application/x-elf', 'elf', 'ELF 可执行文件', 'executable')
  if (ascii(b, 'MZ'))
    return T(
      'application/vnd.microsoft.portable-executable',
      'exe',
      'Windows 可执行文件',
      'executable',
    )
  if (at(b, [0xca, 0xfe, 0xba, 0xbe]))
    return T('application/java-vm', 'class', 'Java 字节码', 'executable')
  if (
    at(b, [0xcf, 0xfa, 0xed, 0xfe]) ||
    at(b, [0xce, 0xfa, 0xed, 0xfe]) ||
    at(b, [0xfe, 0xed, 0xfa, 0xcf])
  )
    return T('application/x-mach-binary', 'macho', 'Mach-O 可执行文件', 'executable')

  return sniffText(b)
}

/** MIME → 扩展名（用于 data: URL 声明的类型） */
export function extFromMime(mime: string): string | null {
  const m = mime.toLowerCase().split(';')[0].trim()
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'image/tiff': 'tiff',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/json': 'json',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'text/plain': 'txt',
    'text/html': 'html',
    'text/css': 'css',
    'text/csv': 'csv',
    'text/javascript': 'js',
    'application/javascript': 'js',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
    'application/wasm': 'wasm',
    'application/octet-stream': 'bin',
  }
  if (map[m]) return map[m]
  const sub = /^[a-z]+\/([a-z0-9.+-]+)$/.exec(m)?.[1]
  if (!sub) return null
  return sub.replace(/^x-/, '').replace(/\+.*$/, '').split('.').pop() || null
}

/**
 * 结合文件头识别结果与 data: URL 声明的 MIME 得出最终类型：
 * 文件头能认出具体格式时以文件头为准；只认出“纯文本”或完全认不出时，采用声明的类型
 * （例如 data:text/csv;base64,… 应下载为 .csv 而不是 .txt）。
 */
export function resolveFileType(
  detected: FileTypeInfo | null,
  declaredMime?: string,
): FileTypeInfo | null {
  const declared = declaredMime?.toLowerCase().split(';')[0].trim()
  if (!declared || declared === 'text/plain' || declared === 'application/octet-stream')
    return detected
  if (detected && detected.mime !== 'text/plain') return detected
  return {
    mime: declared,
    ext: extFromMime(declared) ?? detected?.ext ?? 'bin',
    label: declared,
    kind: detected?.kind ?? (declared.startsWith('text/') ? 'text' : 'binary'),
  }
}
