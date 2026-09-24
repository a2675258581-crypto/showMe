import DOMPurify from 'dompurify'

/** 独立的 DOMPurify 实例，钩子不会影响站内其它工具 */
let purify: ReturnType<typeof DOMPurify> | null = null
/** 当前净化是否用于页面内预览（预览里复选框用 CSS 禁止点击，保留强调色） */
let forPreview = false

function instance() {
  if (!purify) {
    purify = DOMPurify(window)
    purify.addHook('afterSanitizeAttributes', (node) => {
      // 外链在新标签页打开
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') ?? ''
        if (/^(?:https?:|mailto:|\/\/)/i.test(href)) {
          node.setAttribute('target', '_blank')
          node.setAttribute('rel', 'noopener noreferrer')
        }
      }
      // 任务列表的复选框保持只读
      if (node.tagName === 'INPUT') {
        if (forPreview) {
          node.removeAttribute('disabled')
          node.setAttribute('tabindex', '-1')
          node.setAttribute('aria-readonly', 'true')
        } else node.setAttribute('disabled', '')
      }
    })
  }
  return purify
}

/** 预览里 id / name 统一加的前缀（与 GitHub 相同） */
export const ID_PREFIX = 'user-content-'

/**
 * 净化 marked 输出的 HTML：去掉脚本、事件属性、javascript: 链接等。
 *
 * DOMPurify 默认会删掉与 document / form 属性同名的 id（防 DOM clobbering），
 * 于是「# Title」「## Links」「## Style」这类标题的锚点会消失、目录点了不动。
 * - 预览：给所有 id 加 user-content- 前缀，既保留锚点，也不会污染页面上的同名全局变量；
 * - 导出：独立文件里没有脚本，关闭这项检查，原样保留 id，#锚点 直接可用。
 */
export function sanitizeHtml(html: string, preview = false): string {
  try {
    forPreview = preview
    return instance().sanitize(html, {
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['style', 'form'],
      ...(preview ? { SANITIZE_NAMED_PROPS: true } : { SANITIZE_DOM: false }),
    })
  } catch {
    return ''
  } finally {
    forPreview = false
  }
}
