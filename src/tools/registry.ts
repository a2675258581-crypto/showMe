import { lazy } from 'react'
import {
  ArrowLeftRight,
  AtSign,
  Binary,
  Braces,
  CalendarClock,
  CaseSensitive,
  Clock,
  CodeXml,
  Database,
  Dice5,
  FileCode2,
  FileDiff,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Hash,
  ImageDown,
  KeyRound,
  Link2,
  Lock,
  Network,
  Palette,
  QrCode,
  Regex,
  Send,
  Server,
  ShieldHalf,
  Sparkles,
  Terminal,
  Ticket,
  Type,
  FileImage,
  Languages,
  Shuffle,
  Users,
  Workflow,
} from 'lucide-react'
import type { CategoryId, ToolDef } from './types'

/**
 * 全部工具的唯一登记处。新增工具：
 *   1. 在 src/lib 写纯逻辑（附 *.test.ts）
 *   2. 在 src/tools/<id>/index.tsx 默认导出页面组件（只写工具主体，标题栏由 ToolPage 统一渲染）
 *   3. 在下面加一行
 */
export const TOOLS: ToolDef[] = [
  // ───── 格式化 ─────
  {
    id: 'json-formatter',
    name: 'JSON 格式化',
    description: '格式化、压缩、校验 JSON，精确定位错误行列，树形浏览与键排序。',
    category: 'format',
    keywords: ['json', 'format', 'beautify', 'minify', 'validate', '校验', '压缩', '美化', 'gsh'],
    icon: Braces,
    featured: true,
    component: lazy(() => import('./json-formatter')),
  },
  {
    id: 'xml-formatter',
    name: 'XML 格式化',
    description: '美化或压缩 XML，校验结构并指出错误位置。',
    category: 'format',
    keywords: ['xml', 'format', 'beautify', 'minify', 'svg', 'soap', '美化', '压缩'],
    icon: CodeXml,
    featured: true,
    component: lazy(() => import('./xml-formatter')),
  },
  {
    id: 'code-formatter',
    name: '代码格式化',
    description:
      'JavaScript、TypeScript、CSS、SCSS、Less、HTML、Markdown、YAML、GraphQL 一键美化。',
    category: 'format',
    keywords: [
      'prettier',
      'js',
      'ts',
      'css',
      'scss',
      'less',
      'html',
      'markdown',
      'yaml',
      'graphql',
      'vue',
      'beautify',
      '美化',
    ],
    icon: FileCode2,
    featured: true,
    component: lazy(() => import('./code-formatter')),
  },
  {
    id: 'sql-formatter',
    name: 'SQL 格式化',
    description: '支持 MySQL、PostgreSQL、SQLite、Oracle 等多种方言，关键字大小写可选。',
    category: 'format',
    keywords: ['sql', 'mysql', 'postgres', 'sqlite', 'oracle', 'format', 'beautify', '美化'],
    icon: Database,
    component: lazy(() => import('./sql-formatter')),
  },

  // ───── 转换 ─────
  {
    id: 'json-yaml',
    name: 'JSON ⇄ YAML',
    description: 'JSON 与 YAML 双向互转，保留结构与类型。',
    category: 'convert',
    keywords: ['json', 'yaml', 'yml', 'convert', '转换', 'k8s', 'config'],
    icon: ArrowLeftRight,
    component: lazy(() => import('./json-yaml')),
  },
  {
    id: 'json-xml',
    name: 'JSON ⇄ XML',
    description: 'JSON 与 XML 双向互转，属性、数组与文本节点都能正确处理。',
    category: 'convert',
    keywords: ['json', 'xml', 'convert', '转换'],
    icon: Shuffle,
    component: lazy(() => import('./json-xml')),
  },
  {
    id: 'json-csv',
    name: 'JSON ⇄ CSV',
    description: 'JSON 数组与 CSV / Excel 表格互转，支持嵌套字段展开与表格预览。',
    category: 'convert',
    keywords: ['json', 'csv', 'excel', 'table', 'tsv', '表格', '转换'],
    icon: FileSpreadsheet,
    component: lazy(() => import('./json-csv')),
  },
  {
    id: 'json-to-types',
    name: 'JSON 生成类型',
    description: '根据 JSON 样例生成 TypeScript 接口、Go 结构体、Java 类、Rust 结构体等。',
    category: 'convert',
    keywords: [
      'json',
      'typescript',
      'interface',
      'go',
      'struct',
      'java',
      'class',
      'rust',
      'swift',
      'kotlin',
      '类型',
    ],
    icon: Sparkles,
    featured: true,
    component: lazy(() => import('./json-to-types')),
  },
  {
    id: 'timestamp',
    name: '时间戳转换',
    description: 'Unix 时间戳（秒 / 毫秒）与日期时间互转，支持多时区与相对时间。',
    category: 'convert',
    keywords: ['timestamp', 'unix', 'epoch', 'date', 'time', '时间', '日期', 'sjc'],
    icon: Clock,
    featured: true,
    component: lazy(() => import('./timestamp')),
  },
  {
    id: 'base-converter',
    name: '进制转换',
    description: '二、八、十、十六进制及任意进制互转，支持超大整数。',
    category: 'convert',
    keywords: ['radix', 'binary', 'hex', 'octal', 'decimal', 'base', '二进制', '十六进制', '进制'],
    icon: Binary,
    component: lazy(() => import('./base-converter')),
  },
  {
    id: 'color-converter',
    name: '颜色转换',
    description: 'HEX、RGB、HSL、OKLCH 互转，取色、生成色阶并检查对比度。',
    category: 'convert',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'oklch', 'contrast', 'palette', '颜色', '取色'],
    icon: Palette,
    featured: true,
    component: lazy(() => import('./color-converter')),
  },
  {
    id: 'case-converter',
    name: '命名风格转换',
    description: 'camelCase、PascalCase、snake_case、kebab-case、CONSTANT_CASE 等一键互转。',
    category: 'convert',
    keywords: [
      'case',
      'camel',
      'pascal',
      'snake',
      'kebab',
      'upper',
      'lower',
      '大小写',
      '驼峰',
      '命名',
    ],
    icon: CaseSensitive,
    component: lazy(() => import('./case-converter')),
  },
  {
    id: 'cron-parser',
    name: 'Cron 表达式',
    description: '用中文解释 Cron 表达式，并列出接下来的执行时间。',
    category: 'convert',
    keywords: ['cron', 'crontab', 'schedule', 'quartz', '定时', '计划任务'],
    icon: CalendarClock,
    component: lazy(() => import('./cron-parser')),
  },

  // ───── 编码解码 ─────
  {
    id: 'base64',
    name: 'Base64 编解码',
    description: '文本与文件的 Base64 编码、解码，支持 URL 安全字符集与中文。',
    category: 'encode',
    keywords: ['base64', 'encode', 'decode', 'btoa', 'atob', '编码', '解码'],
    icon: Type,
    featured: true,
    component: lazy(() => import('./base64')),
  },
  {
    id: 'image-base64',
    name: '图片 ⇄ Base64',
    description: '图片转 Data URL / Base64，或把 Base64 还原成图片。',
    category: 'encode',
    keywords: ['image', 'base64', 'data url', 'datauri', '图片', 'img'],
    icon: FileImage,
    component: lazy(() => import('./image-base64')),
  },
  {
    id: 'url-codec',
    name: 'URL 编解码',
    description: 'URL 编码 / 解码，并把链接拆解成协议、主机、路径与查询参数。',
    category: 'encode',
    keywords: [
      'url',
      'uri',
      'encode',
      'decode',
      'encodeURIComponent',
      'query',
      'percent',
      '编码',
      '解析',
    ],
    icon: Link2,
    component: lazy(() => import('./url-codec')),
  },
  {
    id: 'html-entities',
    name: 'HTML 实体',
    description: 'HTML 特殊字符与实体（&amp;、&#x4E2D; 等）互相转换。',
    category: 'encode',
    keywords: ['html', 'entity', 'escape', 'unescape', '转义', '实体'],
    icon: AtSign,
    component: lazy(() => import('./html-entities')),
  },
  {
    id: 'unicode-escape',
    name: 'Unicode 转义',
    description: '中文与 \\uXXXX、&#xXXXX;、UTF-8 字节等编码形式互转。',
    category: 'encode',
    keywords: ['unicode', 'escape', 'utf8', 'utf-16', 'native2ascii', '中文', '转义'],
    icon: Languages,
    component: lazy(() => import('./unicode-escape')),
  },
  {
    id: 'jwt-decoder',
    name: 'JWT 解析',
    description: '解码 JWT 的 Header 与 Payload，显示过期时间，并可校验 HS256 签名。',
    category: 'encode',
    keywords: ['jwt', 'token', 'json web token', 'decode', 'verify', 'hs256', '令牌'],
    icon: Ticket,
    featured: true,
    component: lazy(() => import('./jwt-decoder')),
  },

  // ───── 加密与安全 ─────
  {
    id: 'hash',
    name: '哈希计算',
    description: 'MD5、SHA-1、SHA-256、SHA-512、SHA-3、CRC32 等，文本与文件都能算。',
    category: 'crypto',
    keywords: [
      'md5',
      'sha1',
      'sha256',
      'sha512',
      'sha3',
      'crc32',
      'hash',
      'digest',
      'checksum',
      '哈希',
      '摘要',
      '加密',
    ],
    icon: Hash,
    featured: true,
    component: lazy(() => import('./hash')),
  },
  {
    id: 'hmac',
    name: 'HMAC 签名',
    description: '使用密钥计算 HMAC-MD5 / SHA-1 / SHA-256 / SHA-512 签名。',
    category: 'crypto',
    keywords: ['hmac', 'signature', 'sha256', 'md5', '签名'],
    icon: Fingerprint,
    component: lazy(() => import('./hmac')),
  },
  {
    id: 'aes-des',
    name: 'AES / DES 加解密',
    description: '对称加密与解密，支持 CBC / ECB 等模式、PKCS7 填充、Base64 与 Hex 输出。',
    category: 'crypto',
    keywords: [
      'aes',
      'des',
      '3des',
      'tripledes',
      'encrypt',
      'decrypt',
      'cbc',
      'ecb',
      '加密',
      '解密',
    ],
    icon: Lock,
    component: lazy(() => import('./aes-des')),
  },
  {
    id: 'rsa',
    name: 'RSA 密钥与加解密',
    description: '生成 RSA 密钥对（PEM），用公钥加密、私钥解密。',
    category: 'crypto',
    keywords: ['rsa', 'pem', 'public key', 'private key', 'oaep', '公钥', '私钥', '非对称'],
    icon: KeyRound,
    component: lazy(() => import('./rsa')),
  },
  {
    id: 'password-generator',
    name: '密码生成器',
    description: '生成高强度随机密码，评估强度与破解时间。',
    category: 'crypto',
    keywords: ['password', 'generator', 'random', 'strength', '密码', '随机'],
    icon: ShieldHalf,
    featured: true,
    component: lazy(() => import('./password-generator')),
  },
  {
    id: 'uuid-generator',
    name: 'UUID 生成',
    description: '批量生成 UUID v4 / v7、ULID、NanoID，并可解析 UUID。',
    category: 'crypto',
    keywords: ['uuid', 'guid', 'ulid', 'nanoid', 'id', 'random', '唯一'],
    icon: Dice5,
    component: lazy(() => import('./uuid-generator')),
  },

  // ───── 网络与 API ─────
  {
    id: 'api-client',
    name: 'API 调试',
    description: '在线版 Postman：发送任意 HTTP 请求，查看响应、历史记录，导入导出 cURL。',
    category: 'network',
    keywords: [
      'postman',
      'http',
      'api',
      'rest',
      'request',
      'fetch',
      'curl',
      '接口',
      '调试',
      'jkts',
    ],
    icon: Send,
    featured: true,
    component: lazy(() => import('./api-client')),
  },
  {
    id: 'curl-converter',
    name: 'cURL 转代码',
    description: '把 cURL 命令转换成 fetch、axios、Python requests、Go 等代码。',
    category: 'network',
    keywords: ['curl', 'fetch', 'axios', 'python', 'requests', 'go', 'convert', '转换'],
    icon: Terminal,
    component: lazy(() => import('./curl-converter')),
  },
  {
    id: 'http-status',
    name: 'HTTP 状态码',
    description: '所有 HTTP 状态码的中文含义与使用场景速查。',
    category: 'network',
    keywords: ['http', 'status', 'code', '404', '500', '状态码'],
    icon: Server,
    component: lazy(() => import('./http-status')),
  },
  {
    id: 'cidr-calculator',
    name: 'IP 子网计算',
    description: '根据 CIDR 计算网络地址、广播地址、掩码与可用主机范围。',
    category: 'network',
    keywords: ['ip', 'cidr', 'subnet', 'mask', 'ipv4', 'network', '子网', '掩码'],
    icon: Network,
    component: lazy(() => import('./cidr-calculator')),
  },

  // ───── 文本 ─────
  {
    id: 'text-diff',
    name: '文本对比',
    description: '逐行 / 逐词对比两段文本，并排或行内高亮差异。',
    category: 'text',
    keywords: ['diff', 'compare', 'merge', '对比', '比较', '差异'],
    icon: FileDiff,
    featured: true,
    component: lazy(() => import('./text-diff')),
  },
  {
    id: 'regex-tester',
    name: '正则表达式测试',
    description: '实时高亮匹配、查看分组、测试替换，内置常用正则库。',
    category: 'text',
    keywords: ['regex', 'regexp', 'regular expression', 'match', 'replace', '正则'],
    icon: Regex,
    featured: true,
    component: lazy(() => import('./regex-tester')),
  },
  {
    id: 'markdown-preview',
    name: 'Markdown 预览',
    description: '所见即所得的 Markdown 实时预览，一键导出 HTML。',
    category: 'text',
    keywords: ['markdown', 'md', 'preview', 'html', '预览'],
    icon: FileText,
    component: lazy(() => import('./markdown-preview')),
  },
  {
    id: 'text-toolkit',
    name: '文本处理',
    description: '字数统计、去重、排序、去空行、加行号、大小写等批量处理。',
    category: 'text',
    keywords: ['text', 'count', 'word', 'dedupe', 'sort', 'lines', '字数', '统计', '去重', '排序'],
    icon: Workflow,
    component: lazy(() => import('./text-toolkit')),
  },
  {
    id: 'mock-data',
    name: '假数据生成',
    description:
      '批量生成中文姓名、手机号、邮箱、地址、身份证号等测试数据，导出 JSON / CSV / SQL。',
    category: 'text',
    keywords: ['mock', 'fake', 'faker', 'test data', '假数据', '测试数据', '随机'],
    icon: Users,
    component: lazy(() => import('./mock-data')),
  },

  // ───── 图片 ─────
  {
    id: 'qrcode',
    name: '二维码',
    description: '生成带颜色与容错级别的二维码，或上传图片识别二维码内容。',
    category: 'image',
    keywords: ['qr', 'qrcode', 'scan', 'generate', '二维码', '扫码'],
    icon: QrCode,
    featured: true,
    component: lazy(() => import('./qrcode')),
  },
  {
    id: 'image-compressor',
    name: '图片压缩',
    description: '本地压缩图片并转换为 JPEG / WebP / PNG，可调质量与尺寸，前后对比。',
    category: 'image',
    keywords: ['image', 'compress', 'resize', 'webp', 'jpeg', 'png', '压缩', '图片', '转换'],
    icon: ImageDown,
    component: lazy(() => import('./image-compressor')),
  },
]

export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]))

export function toolsByCategory(id: CategoryId): ToolDef[] {
  return TOOLS.filter((t) => t.category === id)
}

/** 简单的打分搜索：名称 > 关键词 > 描述 */
export function searchTools(query: string): ToolDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return TOOLS
  const scored = TOOLS.map((t) => {
    const name = t.name.toLowerCase()
    let score = 0
    if (name === q) score += 100
    else if (name.startsWith(q)) score += 60
    else if (name.includes(q)) score += 40
    if (t.id.includes(q)) score += 30
    for (const k of t.keywords) {
      const kk = k.toLowerCase()
      if (kk === q) score += 35
      else if (kk.startsWith(q)) score += 20
      else if (kk.includes(q)) score += 10
    }
    if (t.description.toLowerCase().includes(q)) score += 8
    return { t, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.t)
}
