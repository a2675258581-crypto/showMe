import { ArrowLeftRight, Braces, FileText, Globe, Image, KeyRound, ShieldCheck } from 'lucide-react'
import type { Category, CategoryId } from './types'

export const CATEGORIES: Category[] = [
  {
    id: 'format',
    name: '格式化',
    tagline: '乱成一团的代码，一键变整齐。',
    icon: Braces,
    color: 'var(--sys-blue)',
    gradient: ['#0a84ff', '#5e5ce6'],
  },
  {
    id: 'convert',
    name: '转换',
    tagline: '格式之间，来去自如。',
    icon: ArrowLeftRight,
    color: 'var(--sys-purple)',
    gradient: ['#bf5af2', '#ff375f'],
  },
  {
    id: 'encode',
    name: '编码解码',
    tagline: 'Base64、URL、JWT，一眼看穿。',
    icon: KeyRound,
    color: 'var(--sys-orange)',
    gradient: ['#ff9f0a', '#ff375f'],
  },
  {
    id: 'crypto',
    name: '加密与安全',
    tagline: '哈希、加解密、密钥生成，全在本地完成。',
    icon: ShieldCheck,
    color: 'var(--sys-green)',
    gradient: ['#30d158', '#00c7be'],
  },
  {
    id: 'network',
    name: '网络与 API',
    tagline: '调接口，从未如此顺手。',
    icon: Globe,
    color: 'var(--sys-cyan)',
    gradient: ['#32ade6', '#0a84ff'],
  },
  {
    id: 'text',
    name: '文本',
    tagline: '对比、匹配、预览、统计。',
    icon: FileText,
    color: 'var(--sys-indigo)',
    gradient: ['#5e5ce6', '#bf5af2'],
  },
  {
    id: 'image',
    name: '图片',
    tagline: '压缩、转换、二维码，拖进来就行。',
    icon: Image,
    color: 'var(--sys-pink)',
    gradient: ['#ff375f', '#ff9f0a'],
  },
]

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  CategoryId,
  Category
>
