import type { ComponentType, LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'

export type CategoryId = 'format' | 'convert' | 'encode' | 'crypto' | 'network' | 'text' | 'image'

export interface Category {
  id: CategoryId
  name: string
  /** 一句话卖点，用于首页分类轨道 */
  tagline: string
  icon: LucideIcon
  /** 分类主色（CSS 颜色，可用 var(--sys-xxx)） */
  color: string
  /** 图标底板渐变 [from, to] */
  gradient: [string, string]
}

export interface ToolMeta {
  /** 路由 id：/t/:id，对应 src/tools/<id>/index.tsx */
  id: string
  name: string
  description: string
  category: CategoryId
  /** 供搜索用的关键词（英文名、别名、拼音首字母等） */
  keywords: string[]
  icon: LucideIcon
  /** 首页 Bento 网格精选 */
  featured?: boolean
}

export interface ToolDef extends ToolMeta {
  component: LazyExoticComponent<ComponentType>
}
