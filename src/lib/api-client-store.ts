/**
 * 「API 调试」的持久化数据：标签页、历史、集合、环境（纯逻辑，无 DOM 依赖）。
 * localStorage 里的数据可能来自旧版本或被手动改坏，读取时一律经过 normalize* 校验并补默认值。
 */
import type { FormPart, HttpRequest } from './curl'
import {
  DEFAULT_TIMEOUT_MS,
  HTTP_METHODS,
  MAX_TIMEOUT_MS,
  emptyAuth,
  emptyBody,
  isHttpMethod,
  kv,
  newRequest,
  requestSignature,
  syncParamsFromUrl,
  uid,
  type ApiRequest,
  type AuthState,
  type BodyMode,
  type FormField,
  type KeyValue,
  type RequestBodyState,
} from './api-client'

export const STORAGE_KEYS = {
  tabs: 'api-client.tabs.v1',
  history: 'api-client.history.v1',
  collections: 'api-client.collections.v1',
  environments: 'api-client.environments.v1',
  options: 'api-client.options.v1',
  /** 其它工具（如 cURL 转代码）交给 API 调试打开的请求，读取后立即清除 */
  import: 'api-client.import.v1',
} as const

export const HISTORY_LIMIT = 200
/** 历史记录里单个请求体最多保存的字符数，防止撑爆 localStorage */
export const HISTORY_BODY_LIMIT = 64 * 1024
/**
 * 整个历史记录序列化后的字符数上限。localStorage 每个站点只有约 5 MB，而且全站工具共用；
 * 超出配额时整条写入都会失败（历史全部丢失，还会连累其它工具），所以超出时丢弃最旧的记录。
 */
export const HISTORY_CHAR_BUDGET = 1_500_000

export interface HistoryEntry {
  id: string
  time: number
  request: ApiRequest
  /** 替换变量后的最终 URL */
  resolvedUrl?: string
  status?: number
  timeMs?: number
  size?: number
  error?: string
}

export interface SavedRequest {
  id: string
  name: string
  request: ApiRequest
  updatedAt: number
}

export interface Collection {
  id: string
  name: string
  requests: SavedRequest[]
  createdAt: number
}

export interface Environment {
  id: string
  name: string
  variables: KeyValue[]
}

export interface EnvironmentsState {
  environments: Environment[]
  activeId: string | null
}

export interface RequestTab {
  id: string
  /** 用户重命名后的名称；为空时显示 requestLabel(request) */
  name?: string
  request: ApiRequest
  /** 上次保存 / 打开时的签名；与当前签名不同即「有未保存的修改」 */
  baseline: string
  /** 来自集合的请求 */
  source?: { collectionId: string; requestId: string }
}

export interface TabsState {
  tabs: RequestTab[]
  activeId: string
}

// ───────────────────────────── normalize ─────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function rows(v: unknown): KeyValue[] {
  if (!Array.isArray(v)) return []
  return v.filter(isObj).map((r) => ({
    id: str(r.id) || uid(),
    key: str(r.key),
    value: str(r.value),
    enabled: bool(r.enabled, true),
  }))
}

function formRows(v: unknown): FormField[] {
  if (!Array.isArray(v)) return []
  return v.filter(isObj).map((r) => {
    const f: FormField = {
      id: str(r.id) || uid(),
      key: str(r.key),
      value: str(r.value),
      enabled: bool(r.enabled, true),
      type: r.type === 'file' ? 'file' : 'text',
    }
    if (f.type === 'file' && typeof r.fileName === 'string') {
      f.fileName = r.fileName
      f.fileSize = num(r.fileSize, 0)
      f.fileType = str(r.fileType)
    }
    return f
  })
}

const BODY_MODES: BodyMode[] = ['none', 'json', 'text', 'xml', 'urlencoded', 'form-data', 'binary']

export function normalizeRequest(raw: unknown): ApiRequest {
  if (!isObj(raw)) return newRequest()
  const method = str(raw.method).toUpperCase()
  const url = str(raw.url)
  const b = isObj(raw.body) ? raw.body : {}
  const body: RequestBodyState = {
    ...emptyBody(),
    mode: BODY_MODES.includes(b.mode as BodyMode) ? (b.mode as BodyMode) : 'none',
    json: str(b.json),
    text: str(b.text),
    xml: str(b.xml),
    urlencoded: rows(b.urlencoded),
    formData: formRows(b.formData),
  }
  if (isObj(b.binary) && typeof b.binary.name === 'string') {
    body.binary = { name: b.binary.name, size: num(b.binary.size, 0), type: str(b.binary.type) }
  }
  const a = isObj(raw.auth) ? raw.auth : {}
  const d = emptyAuth()
  const auth: AuthState = {
    type: ['none', 'bearer', 'basic', 'apikey'].includes(a.type as string)
      ? (a.type as AuthState['type'])
      : 'none',
    token: str(a.token),
    username: str(a.username),
    password: str(a.password),
    apiKeyName: str(a.apiKeyName, d.apiKeyName),
    apiKeyValue: str(a.apiKeyValue),
    apiKeyIn: a.apiKeyIn === 'query' ? 'query' : 'header',
  }
  const s = isObj(raw.settings) ? raw.settings : {}
  const params = Array.isArray(raw.params) ? rows(raw.params) : syncParamsFromUrl(url, [])
  return {
    method: isHttpMethod(method) ? method : HTTP_METHODS[0],
    url,
    params,
    headers: rows(raw.headers),
    body,
    auth,
    settings: {
      timeoutMs: Math.min(Math.max(num(s.timeoutMs, DEFAULT_TIMEOUT_MS), 0), MAX_TIMEOUT_MS),
      followRedirects: bool(s.followRedirects, true),
      useProxy: bool(s.useProxy, true),
    },
  }
}

export function makeTab(request: ApiRequest, extra: Partial<RequestTab> = {}): RequestTab {
  return { id: uid(), request, baseline: requestSignature(request), ...extra }
}

export function normalizeTabs(raw: unknown): TabsState | null {
  if (!isObj(raw) || !Array.isArray(raw.tabs)) return null
  const tabs: RequestTab[] = raw.tabs.filter(isObj).map((t) => {
    const request = normalizeRequest(t.request)
    const tab: RequestTab = {
      id: str(t.id) || uid(),
      request,
      baseline: typeof t.baseline === 'string' ? t.baseline : requestSignature(request),
    }
    if (typeof t.name === 'string' && t.name.trim()) tab.name = t.name
    if (
      isObj(t.source) &&
      typeof t.source.collectionId === 'string' &&
      typeof t.source.requestId === 'string'
    )
      tab.source = { collectionId: t.source.collectionId, requestId: t.source.requestId }
    return tab
  })
  if (!tabs.length) return null
  const activeId = tabs.some((t) => t.id === raw.activeId) ? String(raw.activeId) : tabs[0].id
  return { tabs, activeId }
}

export function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isObj)
    .map((e) => {
      const entry: HistoryEntry = {
        id: str(e.id) || uid(),
        time: num(e.time, 0),
        request: normalizeRequest(e.request),
      }
      if (typeof e.resolvedUrl === 'string') entry.resolvedUrl = e.resolvedUrl
      if (typeof e.status === 'number') entry.status = e.status
      if (typeof e.timeMs === 'number') entry.timeMs = e.timeMs
      if (typeof e.size === 'number') entry.size = e.size
      if (typeof e.error === 'string') entry.error = e.error
      return entry
    })
    .slice(0, HISTORY_LIMIT)
}

export function normalizeCollections(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isObj).map((c) => ({
    id: str(c.id) || uid(),
    name: str(c.name, '未命名集合') || '未命名集合',
    createdAt: num(c.createdAt, 0),
    requests: Array.isArray(c.requests)
      ? c.requests.filter(isObj).map((r) => ({
          id: str(r.id) || uid(),
          name: str(r.name, '未命名请求') || '未命名请求',
          request: normalizeRequest(r.request),
          updatedAt: num(r.updatedAt, 0),
        }))
      : [],
  }))
}

export function normalizeEnvironments(raw: unknown): EnvironmentsState | null {
  if (!isObj(raw) || !Array.isArray(raw.environments)) return null
  const environments = raw.environments.filter(isObj).map((e) => ({
    id: str(e.id) || uid(),
    name: str(e.name, '未命名环境') || '未命名环境',
    variables: rows(e.variables),
  }))
  const activeId =
    typeof raw.activeId === 'string' && environments.some((e) => e.id === raw.activeId)
      ? raw.activeId
      : null
  return { environments, activeId }
}

// ───────────────────────────── 历史 ─────────────────────────────

/** 历史里只保存有限长度的请求体；表单文件只记文件名 */
export function compactRequest(req: ApiRequest, limit = HISTORY_BODY_LIMIT): ApiRequest {
  const cut = (s: string) => (s.length > limit ? s.slice(0, limit) : s)
  return {
    ...req,
    body: {
      ...req.body,
      json: cut(req.body.json),
      text: cut(req.body.text),
      xml: cut(req.body.xml),
    },
  }
}

export function addHistory(
  list: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT,
  budget = HISTORY_CHAR_BUDGET,
): HistoryEntry[] {
  const next = [{ ...entry, request: compactRequest(entry.request) }, ...list].slice(0, limit)
  let total = 2
  let keep = 0
  for (; keep < next.length; keep++) {
    total += JSON.stringify(next[keep]).length + 1
    // 最新的一条总是保留
    if (total > budget && keep > 0) break
  }
  return keep < next.length ? next.slice(0, keep) : next
}

export type HistoryGroupLabel = '今天' | '昨天' | '更早'

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 按本地日期分成 今天 / 昨天 / 更早（保持原有顺序，空组不返回） */
export function groupHistory(
  list: HistoryEntry[],
  now: number,
): { label: HistoryGroupLabel; items: HistoryEntry[] }[] {
  const today = startOfDay(now)
  const yesterday = startOfDay(today - 1)
  const groups: Record<HistoryGroupLabel, HistoryEntry[]> = { 今天: [], 昨天: [], 更早: [] }
  for (const e of list) {
    if (e.time >= today) groups['今天'].push(e)
    else if (e.time >= yesterday) groups['昨天'].push(e)
    else groups['更早'].push(e)
  }
  return (['今天', '昨天', '更早'] as const)
    .map((label) => ({ label, items: groups[label] }))
    .filter((g) => g.items.length)
}

/** 按 URL / 方法 / 状态码搜索，多个关键词取交集，不区分大小写 */
export function searchHistory(list: HistoryEntry[], query: string): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((e) => {
    const hay =
      `${e.request.method} ${e.request.url} ${e.resolvedUrl ?? ''} ${e.status ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

// ───────────────────────────── 集合 ─────────────────────────────

export interface SaveTarget {
  /** 已有集合 id；与 newCollectionName 二选一 */
  collectionId?: string
  newCollectionName?: string
  name: string
}

/** 把请求保存进集合，返回新的集合列表与保存位置 */
export function saveToCollection(
  collections: Collection[],
  target: SaveTarget,
  request: ApiRequest,
  now: number,
): { collections: Collection[]; collectionId: string; requestId: string } {
  const saved: SavedRequest = {
    id: uid(),
    name: target.name.trim() || '未命名请求',
    request: compactRequest(request, Infinity),
    updatedAt: now,
  }
  if (target.collectionId && collections.some((c) => c.id === target.collectionId)) {
    return {
      collections: collections.map((c) =>
        c.id === target.collectionId ? { ...c, requests: [...c.requests, saved] } : c,
      ),
      collectionId: target.collectionId,
      requestId: saved.id,
    }
  }
  const col: Collection = {
    id: uid(),
    name: target.newCollectionName?.trim() || '我的集合',
    requests: [saved],
    createdAt: now,
  }
  return { collections: [...collections, col], collectionId: col.id, requestId: saved.id }
}

/** 覆盖集合里已有的请求；找不到时返回 null */
export function updateSavedRequest(
  collections: Collection[],
  source: { collectionId: string; requestId: string },
  request: ApiRequest,
  now: number,
  name?: string,
): Collection[] | null {
  let found = false
  const next = collections.map((c) => {
    if (c.id !== source.collectionId) return c
    return {
      ...c,
      requests: c.requests.map((r) => {
        if (r.id !== source.requestId) return r
        found = true
        return { ...r, request, updatedAt: now, name: name?.trim() || r.name }
      }),
    }
  })
  return found ? next : null
}

export function findSaved(
  collections: Collection[],
  source: { collectionId: string; requestId: string } | undefined,
): SavedRequest | undefined {
  if (!source) return undefined
  return collections
    .find((c) => c.id === source.collectionId)
    ?.requests.find((r) => r.id === source.requestId)
}

// ───────────────────────────── 交接（cURL 转代码 → API 调试） ─────────────────────────────

export interface ImportPayload {
  request: HttpRequest
  at: number
}

export function encodeImport(request: HttpRequest, now: number): string {
  return JSON.stringify({ request, at: now } satisfies ImportPayload)
}

/** 解析交接数据；超过 maxAge（默认 10 分钟）的视为过期 */
export function decodeImport(
  raw: string | null,
  now: number,
  maxAge = 10 * 60_000,
): HttpRequest | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<ImportPayload>
    const r = p.request as Partial<HttpRequest> | undefined
    if (!r || typeof r.url !== 'string' || typeof r.method !== 'string') return null
    if (typeof p.at !== 'number' || now - p.at > maxAge || p.at - now > 60_000) return null
    return {
      method: r.method,
      url: r.url,
      headers: Array.isArray(r.headers)
        ? r.headers
            .filter((h) => Array.isArray(h) && h.length === 2)
            .map(([k, v]) => [String(k), String(v)] as [string, string])
        : [],
      body: normalizeImportBody(r.body),
      ...(r.auth && typeof r.auth.username === 'string'
        ? { auth: { username: r.auth.username, password: String(r.auth.password ?? '') } }
        : {}),
      ...(typeof r.followRedirects === 'boolean' ? { followRedirects: r.followRedirects } : {}),
      ...(typeof r.timeout === 'number' ? { timeout: r.timeout } : {}),
    }
  } catch {
    return null
  }
}

/** 交接数据里的请求体来自 localStorage，可能被改坏：逐个字段校验，不合法的当作没有请求体 */
function normalizeImportBody(raw: unknown): HttpRequest['body'] {
  if (!isObj(raw)) return { kind: 'none' }
  if (raw.kind === 'text' && typeof raw.text === 'string') return { kind: 'text', text: raw.text }
  if (raw.kind === 'file' && typeof raw.path === 'string') return { kind: 'file', path: raw.path }
  if (raw.kind === 'multipart' && Array.isArray(raw.parts)) {
    const parts = raw.parts
      .filter(isObj)
      .filter((p) => typeof p.name === 'string' && typeof p.value === 'string')
      .map((p) => {
        const part: FormPart = {
          name: p.name as string,
          value: p.value as string,
          kind: p.kind === 'file' ? 'file' : 'text',
        }
        if (typeof p.filename === 'string') part.filename = p.filename
        if (typeof p.contentType === 'string') part.contentType = p.contentType
        return part
      })
    return { kind: 'multipart', parts }
  }
  return { kind: 'none' }
}

// ───────────────────────────── 默认数据与示例 ─────────────────────────────

export function defaultEnvironments(): EnvironmentsState {
  const env: Environment = {
    id: uid(),
    name: '示例环境',
    variables: [kv('baseUrl', 'https://jsonplaceholder.typicode.com'), kv('userId', '1')],
  }
  return { environments: [env], activeId: env.id }
}

export interface SampleRequest {
  name: string
  description: string
  build: () => ApiRequest
}

export const SAMPLE_REQUESTS: SampleRequest[] = [
  {
    name: '获取文章列表',
    description: 'GET · JSONPlaceholder，演示 {{变量}} 与查询参数',
    build: () => {
      const url = '{{baseUrl}}/posts?userId={{userId}}&_limit=5'
      return newRequest({
        url,
        params: syncParamsFromUrl(url, []),
        headers: [kv('Accept', 'application/json')],
      })
    },
  },
  {
    name: '创建文章（JSON）',
    description: 'POST · 发送 JSON 请求体',
    build: () =>
      newRequest({
        method: 'POST',
        url: 'https://jsonplaceholder.typicode.com/posts',
        body: {
          ...emptyBody(),
          mode: 'json',
          json: JSON.stringify(
            { title: '你好，showMe', body: '这是一条测试文章 ✨', userId: 1 },
            null,
            2,
          ),
        },
      }),
  },
  {
    name: '查看请求头',
    description: 'GET · httpbin 回显你发送的请求头',
    build: () =>
      newRequest({
        url: 'https://httpbin.org/headers',
        headers: [kv('X-Request-Id', '{{$uuid}}'), kv('Accept-Language', 'zh-CN')],
      }),
  },
  {
    name: '表单提交',
    description: 'POST · x-www-form-urlencoded',
    build: () =>
      newRequest({
        method: 'POST',
        url: 'https://httpbin.org/post',
        body: {
          ...emptyBody(),
          mode: 'urlencoded',
          urlencoded: [kv('name', '张三'), kv('city', '上海')],
        },
      }),
  },
  {
    name: 'Bearer 认证',
    description: 'GET · httpbin 校验 Authorization 头',
    build: () =>
      newRequest({
        url: 'https://httpbin.org/bearer',
        auth: { ...emptyAuth(), type: 'bearer', token: 'my-secret-token' },
      }),
  },
  {
    name: 'GitHub 用户信息',
    description: 'GET · 公开 REST API',
    build: () =>
      newRequest({
        url: 'https://api.github.com/users/octocat',
        headers: [kv('Accept', 'application/vnd.github+json')],
      }),
  },
]

export function defaultTabs(): TabsState {
  const tab = makeTab(SAMPLE_REQUESTS[0].build())
  return { tabs: [tab], activeId: tab.id }
}
