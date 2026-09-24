/** 文本对比的示例：一段 JS 模块的两个版本 */

export const SAMPLE_OLD = `// 用户服务：负责获取与缓存用户信息
import { request } from './http'

const CACHE_TTL = 60 * 1000
const cache = new Map()

export async function getUser(id) {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.time < CACHE_TTL) {
    return hit.data
  }
  const data = await request(\`/api/users/\${id}\`)
  cache.set(id, { data, time: Date.now() })
  return data
}

export function clearCache() {
  cache.clear()
}

export function cacheSize() {
  return cache.size
}

export function hasUser(id) {
  return cache.has(id)
}

export function removeUser(id) {
  cache.delete(id)
}

// 旧接口，下个版本移除
export const fetchUser = getUser
`

export const SAMPLE_NEW = `// 用户服务：负责获取、缓存与刷新用户信息
import { request } from './http'
import { logger } from './logger'

const CACHE_TTL = 5 * 60 * 1000
const cache = new Map()

export async function getUser(id, { force = false } = {}) {
  const hit = cache.get(id)
  if (!force && hit && Date.now() - hit.time < CACHE_TTL) {
    return hit.data
  }
  logger.debug('fetch user', id)
  const data = await request(\`/api/v2/users/\${id}\`)
  cache.set(id, { data, time: Date.now() })
  return data
}

export function clearCache() {
  cache.clear()
}

export function cacheSize() {
  return cache.size
}

export function hasUser(id) {
  return cache.has(id)
}

export function removeUser(id) {
  cache.delete(id)
}
`
