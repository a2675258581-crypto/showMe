/** Markdown 预览的示例文档 */

const BANNER =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgNjQwIDIwMCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMGE4NGZmIi8+PHN0b3Agb2Zmc2V0PSIuNTUiIHN0b3AtY29sb3I9IiNiZjVhZjIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmZjM3NWYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjIwMCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iMzIwIiB5PSIxMTgiIGZvbnQtZmFtaWx5PSItYXBwbGUtc3lzdGVtLEhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjUyIiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5zaG93TWU8L3RleHQ+PC9zdmc+'

export const MARKDOWN_SAMPLE = `# 项目周报：showMe 开发者百宝箱

> 所有工具都在浏览器本地运行，**不上传任何数据**。这份示例演示了常用的 Markdown 语法，左边改动，右边实时预览。

## 本周进展

本周完成了 **文本类工具** 的开发，包括 *文本对比*、正则测试、~~旧版编辑器~~ Markdown 预览等。
行内代码写作 \`npm run dev\`，链接写作 [Markdown 指南](https://commonmark.org/help/)，裸链接也能自动识别：https://github.com

### 待办清单

- [x] 文本对比：并排 / 行内两种视图
- [x] 正则测试：Web Worker 防止卡死
- [ ] Markdown：导出带样式的 HTML
- [ ] 补充更多示例

### 有序列表

1. 打开工具页面
2. 粘贴或输入内容
   - 支持拖入文件
   - 支持快捷键 ⌘B 加粗、⌘I 斜体
3. 一键导出

## 数据一览

| 工具 | 类别 | 进度 | 备注 |
| :--- | :---: | ---: | --- |
| 文本对比 | 文本 | 100% | 支持下载 .patch |
| 正则测试 | 文本 | 100% | 内置常用正则库 |
| Markdown 预览 | 文本 | 90% | 目录与滚动同步 |

## 代码示例

\`\`\`ts
// 计算两段文本的相似度
export function similarity(a: string, b: string): number {
  const common = [...a].filter((ch) => b.includes(ch)).length
  return (2 * common) / (a.length + b.length || 1)
}
\`\`\`

\`\`\`python
def greet(name: str) -> str:
    return f"你好，{name}！"
\`\`\`

## 图片

![showMe 横幅][banner]

图片地址用了「引用式链接」，定义写在文档末尾。

---

### 引用与嵌套

> 简洁是可靠的前提。
>
> > —— Edsger W. Dijkstra

Markdown 同时支持 <kbd>Ctrl</kbd> + <kbd>C</kbd> 这样的内联 HTML。

[banner]: ${BANNER}
`
