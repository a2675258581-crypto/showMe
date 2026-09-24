/**
 * API 调试的工作区状态：标签页、历史、集合、环境与界面选项，全部持久化到 localStorage（带版本号的 key）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import {
  cloneRequest,
  fromHttpRequest,
  newRequest,
  requestSignature,
  uid,
  varsToRecord,
  type ApiRequest,
} from '@/lib/api-client'
import {
  STORAGE_KEYS,
  addHistory,
  compactRequest,
  decodeImport,
  defaultEnvironments,
  defaultTabs,
  findSaved,
  makeTab,
  normalizeCollections,
  normalizeEnvironments,
  normalizeHistory,
  normalizeTabs,
  saveToCollection,
  updateSavedRequest,
  type Collection,
  type EnvironmentsState,
  type HistoryEntry,
  type RequestTab,
  type SaveTarget,
  type TabsState,
} from '@/lib/api-client-store'
import type { CodeTarget } from '@/lib/http-codegen'
import type { SidebarTab } from './Sidebar'

export interface UiOptions {
  layout: 'stack' | 'split'
  sidebarTab: SidebarTab
  sidebarOpen: boolean
  codeTarget: CodeTarget
}

const DEFAULT_OPTIONS: UiOptions = {
  layout: 'stack',
  sidebarTab: 'history',
  sidebarOpen: true,
  codeTarget: 'curl',
}

/** 标签页持久化时单个请求体最多保存的字符数 */
const TAB_BODY_LIMIT = 512 * 1024

/** 首次使用时的示例环境：模块加载时生成一次，保证 id 稳定 */
const INITIAL_ENVS = defaultEnvironments()

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * 写入标签页：超大的请求体不完整保存，避免撑爆 localStorage 导致所有标签都无法保存；
 * 仍然超出配额时再按更小的上限重试一次。
 */
function persistTabs(state: TabsState) {
  for (const limit of [TAB_BODY_LIMIT, 16 * 1024]) {
    try {
      const compact = {
        ...state,
        tabs: state.tabs.map((t) => ({ ...t, request: compactRequest(t.request, limit) })),
      }
      localStorage.setItem(STORAGE_KEYS.tabs, JSON.stringify(compact))
      return
    } catch {
      /* 存储已满或被禁用：换更小的上限再试 */
    }
  }
}

/** 启动时读取已保存的标签页；如果其它工具交来了待导入的请求，打开到新标签页 */
function boot(): { tabs: TabsState; imported: boolean } {
  const saved = normalizeTabs(readJson(STORAGE_KEYS.tabs)) ?? defaultTabs()
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEYS.import)
  } catch {
    raw = null
  }
  const req = decodeImport(raw, Date.now())
  if (!req) return { tabs: saved, imported: false }
  const tab = makeTab(fromHttpRequest(req))
  return { tabs: { tabs: [...saved.tabs, tab], activeId: tab.id }, imported: true }
}

export function useWorkspace() {
  const [initial] = useState(boot)
  const [tabsState, setTabsState] = useState<TabsState>(initial.tabs)
  const [rawHistory, setRawHistory] = useLocalStorage<unknown>(STORAGE_KEYS.history, [])
  const [rawCollections, setRawCollections] = useLocalStorage<unknown>(STORAGE_KEYS.collections, [])
  const [rawEnvs, setRawEnvs] = useLocalStorage<unknown>(STORAGE_KEYS.environments, INITIAL_ENVS)
  const [rawOptions, setRawOptions] = useLocalStorage<Partial<UiOptions>>(
    STORAGE_KEYS.options,
    DEFAULT_OPTIONS,
  )

  // 标签页（含请求体）写入稍作防抖；离开页面 / 切到其它工具时立即写入，不丢最后几次输入
  const latestTabs = useRef(tabsState)
  useEffect(() => {
    latestTabs.current = tabsState
    const t = setTimeout(() => persistTabs(tabsState), 300)
    return () => clearTimeout(t)
  }, [tabsState])
  useEffect(() => {
    const flush = () => persistTabs(latestTabs.current)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
  // 交接数据读取后立即清除
  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEYS.import)
    } catch {
      /* ignore */
    }
  }, [])

  const history = useMemo(() => normalizeHistory(rawHistory), [rawHistory])
  const collections = useMemo(() => normalizeCollections(rawCollections), [rawCollections])
  const envState = useMemo(
    () => normalizeEnvironments(rawEnvs) ?? { environments: [], activeId: null },
    [rawEnvs],
  )
  const options: UiOptions = {
    ...DEFAULT_OPTIONS,
    ...(rawOptions && typeof rawOptions === 'object' ? rawOptions : {}),
  }
  const activeEnv = envState.environments.find((e) => e.id === envState.activeId)
  const vars = useMemo(() => varsToRecord(activeEnv?.variables), [activeEnv])

  const { tabs, activeId } = tabsState
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const dirty = useMemo(
    () => new Set(tabs.filter((t) => requestSignature(t.request) !== t.baseline).map((t) => t.id)),
    [tabs],
  )

  // ── 标签页 ──
  const setOptions = useCallback(
    (patch: Partial<UiOptions>) =>
      setRawOptions((prev) => ({ ...DEFAULT_OPTIONS, ...prev, ...patch })),
    [setRawOptions],
  )

  const updateRequest = useCallback((tabId: string, fn: (r: ApiRequest) => ApiRequest) => {
    setTabsState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, request: fn(t.request) } : t)),
    }))
  }, [])

  const patchTab = useCallback((tabId: string, patch: Partial<RequestTab>) => {
    setTabsState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
    }))
  }, [])

  const openTab = useCallback(
    (request: ApiRequest = newRequest(), extra: Partial<RequestTab> = {}) => {
      const tab = makeTab(request, extra)
      setTabsState((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
      return tab.id
    },
    [],
  )

  const activate = useCallback((id: string) => setTabsState((s) => ({ ...s, activeId: id })), [])

  const removeTab = useCallback((id: string) => {
    setTabsState((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx < 0) return s
      const rest = s.tabs.filter((t) => t.id !== id)
      if (!rest.length) {
        const fresh = makeTab(newRequest())
        return { tabs: [fresh], activeId: fresh.id }
      }
      const activeId = s.activeId === id ? rest[Math.min(idx, rest.length - 1)].id : s.activeId
      return { tabs: rest, activeId }
    })
  }, [])

  // ── 历史 ──
  const pushHistory = useCallback(
    (entry: HistoryEntry) =>
      setRawHistory((prev: unknown) => addHistory(normalizeHistory(prev), entry)),
    [setRawHistory],
  )
  const deleteHistory = useCallback(
    (id: string) =>
      setRawHistory((prev: unknown) => normalizeHistory(prev).filter((e) => e.id !== id)),
    [setRawHistory],
  )
  const clearHistory = useCallback(() => setRawHistory([]), [setRawHistory])

  // ── 集合 ──
  const setCollections = useCallback(
    (fn: (c: Collection[]) => Collection[]) =>
      setRawCollections((prev: unknown) => fn(normalizeCollections(prev))),
    [setRawCollections],
  )

  /** 保存当前标签：已关联集合时直接覆盖，否则返回 false 让调用方弹出「保存到集合」 */
  const saveExisting = (tab: RequestTab): Collection | null => {
    if (!tab.source || !findSaved(collections, tab.source)) return null
    const next = updateSavedRequest(collections, tab.source, tab.request, Date.now())
    if (!next) return null
    setCollections(() => next)
    patchTab(tab.id, { baseline: requestSignature(tab.request) })
    return next.find((c) => c.id === tab.source!.collectionId) ?? null
  }

  const saveAs = (tab: RequestTab, target: SaveTarget): Collection | null => {
    const r = saveToCollection(collections, target, tab.request, Date.now())
    setCollections(() => r.collections)
    patchTab(tab.id, {
      source: { collectionId: r.collectionId, requestId: r.requestId },
      name: target.name.trim() || undefined,
      baseline: requestSignature(tab.request),
    })
    return r.collections.find((c) => c.id === r.collectionId) ?? null
  }

  const openSaved = (collectionId: string, requestId: string) => {
    const existing = tabs.find(
      (t) => t.source?.collectionId === collectionId && t.source.requestId === requestId,
    )
    if (existing) return activate(existing.id)
    const saved = findSaved(collections, { collectionId, requestId })
    if (!saved) return
    openTab(cloneRequest(saved.request), { source: { collectionId, requestId }, name: saved.name })
  }

  const newCollection = (name: string) =>
    setCollections((c) => [...c, { id: uid(), name, requests: [], createdAt: Date.now() }])
  const renameCollection = (id: string, name: string) =>
    setCollections((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)))
  const deleteCollection = (id: string) => {
    setCollections((cs) => cs.filter((c) => c.id !== id))
    setTabsState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.source?.collectionId === id ? { ...t, source: undefined } : t)),
    }))
  }
  const renameSaved = (collectionId: string, requestId: string, name: string) => {
    setCollections((cs) =>
      cs.map((c) =>
        c.id === collectionId
          ? { ...c, requests: c.requests.map((r) => (r.id === requestId ? { ...r, name } : r)) }
          : c,
      ),
    )
    setTabsState((s) => ({
      ...s,
      tabs: s.tabs.map((t) =>
        t.source?.collectionId === collectionId && t.source.requestId === requestId
          ? { ...t, name }
          : t,
      ),
    }))
  }
  const deleteSaved = (collectionId: string, requestId: string) => {
    setCollections((cs) =>
      cs.map((c) =>
        c.id === collectionId
          ? { ...c, requests: c.requests.filter((r) => r.id !== requestId) }
          : c,
      ),
    )
    setTabsState((s) => ({
      ...s,
      tabs: s.tabs.map((t) =>
        t.source?.collectionId === collectionId && t.source.requestId === requestId
          ? { ...t, source: undefined }
          : t,
      ),
    }))
  }

  // ── 环境 ──
  const setEnvState = useCallback((s: EnvironmentsState) => setRawEnvs(s), [setRawEnvs])
  const setActiveEnv = (id: string | null) => setRawEnvs({ ...envState, activeId: id })

  return {
    imported: initial.imported,
    tabs,
    activeTab,
    dirty,
    options,
    setOptions,
    vars,
    envState,
    setEnvState,
    setActiveEnv,
    history,
    collections,
    updateRequest,
    patchTab,
    openTab,
    activate,
    removeTab,
    pushHistory,
    deleteHistory,
    clearHistory,
    saveExisting,
    saveAs,
    openSaved,
    newCollection,
    renameCollection,
    deleteCollection,
    renameSaved,
    deleteSaved,
  }
}
