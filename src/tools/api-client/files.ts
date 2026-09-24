/**
 * 选中的文件只保存在内存里（File 对象无法写入 localStorage）：
 * form-data 文件字段按字段 id 存，binary 请求体按标签页 id 存。刷新页面后需要重新选择。
 */
const files = new Map<string, File>()

export const binaryKey = (tabId: string) => `binary:${tabId}`

export function setFile(key: string, file: File | undefined): void {
  if (file) files.set(key, file)
  else files.delete(key)
}

export function getFile(key: string): File | undefined {
  return files.get(key)
}

export function hasFile(key: string): boolean {
  return files.has(key)
}
