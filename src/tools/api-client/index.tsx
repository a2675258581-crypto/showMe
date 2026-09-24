import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useToast } from '@/components/ui'
import { useHotkey } from '@/hooks/useHotkey'
import {
  buildRequest,
  cloneRequest,
  fromHttpRequest,
  importNotes,
  newRequest,
  syncParamsFromUrl,
  uid,
  type ApiRequest,
} from '@/lib/api-client'
import { getHeader, mimeType } from '@/lib/api-client-response'
import { SAMPLE_REQUESTS, type HistoryEntry, type SampleRequest } from '@/lib/api-client-store'
import { cn } from '@/lib/cn'
import { parseCurl, type HttpRequest } from '@/lib/curl'
import {
  CodeDialog,
  ConfirmCloseDialog,
  CurlImportDialog,
  EnvironmentsDialog,
  SaveDialog,
} from './Dialogs'
import { RequestPanel, type ProxyStatus } from './RequestPanel'
import { ResponsePanel, type ResponseState } from './ResponsePanel'
import { binaryKey, setFile } from './files'
import { detectProxy, SendError, sendRequest } from './send'
import { Sidebar } from './Sidebar'
import { TabStrip, tabTitle } from './TabStrip'
import { UrlBar } from './UrlBar'
import { useWorkspace } from './useWorkspace'

type DialogState =
  | { kind: 'save'; tabId: string; closeAfter?: boolean }
  | { kind: 'close'; tabId: string }
  | { kind: 'curl' }
  | { kind: 'code' }
  | { kind: 'envs' }
  | null

export default function ApiClient() {
  const ws = useWorkspace()
  const toast = useToast()
  const { activeTab, vars, options } = ws
  const tabId = activeTab.id
  const request = activeTab.request

  const [responses, setResponses] = useState<Record<string, ResponseState>>({})
  const [proxy, setProxy] = useState<ProxyStatus>('checking')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [drawer, setDrawer] = useState(false)
  const controllers = useRef(new Map<string, AbortController>())
  const imageUrls = useRef(new Map<string, string>())
  const seq = useRef(0)
  const asideRef = useRef<HTMLElement>(null)

  // ── 本地代理探测 ──
  const recheckProxy = useCallback((force = true) => {
    setProxy('checking')
    detectProxy(force).then((ok) => setProxy(ok ? 'available' : 'unavailable'))
  }, [])
  useEffect(() => {
    let alive = true
    detectProxy().then((ok) => alive && setProxy(ok ? 'available' : 'unavailable'))
    return () => {
      alive = false
    }
  }, [])

  // 从其它工具导入时提示一下
  // （StrictMode 下 effect 会执行两次，用 ref 保证只提示一次）
  const { imported } = ws
  const importToasted = useRef(false)
  useEffect(() => {
    if (!imported || importToasted.current) return
    importToasted.current = true
    toast('已从 cURL 转代码导入请求', 'info')
  }, [imported, toast])

  // 卸载时中止进行中的请求、释放图片预览的 object URL
  useEffect(() => {
    const ctrls = controllers.current
    const urls = imageUrls.current
    return () => {
      ctrls.forEach((c) => c.abort())
      urls.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
    }
  }, [])

  const built = useMemo(() => buildRequest(request, vars), [request, vars])
  const loadingIds = useMemo(
    () =>
      new Set(
        Object.entries(responses)
          .filter(([, r]) => r.phase === 'loading')
          .map(([id]) => id),
      ),
    [responses],
  )

  const releaseImage = (id: string) => {
    const u = imageUrls.current.get(id)
    if (u) {
      URL.revokeObjectURL(u)
      imageUrls.current.delete(id)
    }
  }

  // ── 发送 ──
  const send = async (id = tabId) => {
    const tab = ws.tabs.find((t) => t.id === id)
    if (!tab || controllers.current.has(id)) return
    const req = tab.request
    const b = buildRequest(req, vars)
    const controller = new AbortController()
    controllers.current.set(id, controller)
    const startedAt = performance.now()
    releaseImage(id)
    setResponses((r) => ({ ...r, [id]: { phase: 'loading', startedAt } }))
    const time = Date.now()
    try {
      const res = await sendRequest(b, {
        tabId: id,
        timeoutMs: Math.max(100, req.settings.timeoutMs || 30_000),
        followRedirects: req.settings.followRedirects,
        useProxy: req.settings.useProxy,
        signal: controller.signal,
      })
      if (res.via === 'direct' && req.settings.useProxy) setProxy('unavailable')
      let imageUrl: string | undefined
      const ct = getHeader(res.headers, 'content-type')
      if (mimeType(ct).startsWith('image/') && res.body.length) {
        imageUrl = URL.createObjectURL(new Blob([res.body as BlobPart], { type: mimeType(ct) }))
        imageUrls.current.set(id, imageUrl)
      }
      const doneSeq = ++seq.current
      // 标签在请求过程中被关闭时不再写回结果
      setResponses((r) =>
        id in r ? { ...r, [id]: { phase: 'done', response: res, seq: doneSeq, imageUrl } } : r,
      )
      ws.pushHistory({
        id: uid(),
        time,
        request: req,
        resolvedUrl: b.request.url,
        status: res.status,
        timeMs: Math.round(res.timeMs),
        size: res.size,
      })
    } catch (e) {
      const err =
        e instanceof SendError ? e : new SendError(e instanceof Error ? e.message : String(e))
      const errSeq = ++seq.current
      setResponses((r) =>
        id in r
          ? {
              ...r,
              [id]: {
                phase: 'error',
                error: err.message,
                kind: err.kind,
                timeMs: err.timeMs,
                seq: errSeq,
              },
            }
          : r,
      )
      if (err.kind !== 'aborted' && err.kind !== 'invalid') {
        ws.pushHistory({
          id: uid(),
          time,
          request: req,
          resolvedUrl: b.request.url,
          error: err.message,
        })
      }
    } finally {
      controllers.current.delete(id)
    }
  }
  const cancel = (id = tabId) => controllers.current.get(id)?.abort()

  // ── 标签页 ──
  const closeNow = (id: string) => {
    cancel(id)
    releaseImage(id)
    // 释放这个标签选过的文件（只保存在内存里）
    const closing = ws.tabs.find((t) => t.id === id)
    setFile(binaryKey(id), undefined)
    closing?.request.body.formData.forEach((f) => setFile(f.id, undefined))
    setResponses((r) => {
      const next = { ...r }
      delete next[id]
      return next
    })
    ws.removeTab(id)
  }
  const requestClose = (id: string) => {
    if (ws.dirty.has(id)) setDialog({ kind: 'close', tabId: id })
    else closeNow(id)
  }

  const save = (id = tabId, closeAfter = false) => {
    const tab = ws.tabs.find((t) => t.id === id)
    if (!tab) return
    const col = ws.saveExisting(tab)
    if (col) {
      toast(`已保存到「${col.name}」`)
      if (closeAfter) closeNow(id)
      setDialog(null)
      return
    }
    setDialog({ kind: 'save', tabId: id, closeAfter })
  }

  const importHttpRequest = (r: HttpRequest, warnings: string[], mode: 'replace' | 'new') => {
    const req = fromHttpRequest(r)
    if (mode === 'replace') ws.updateRequest(tabId, () => req)
    else ws.openTab(req)
    const notes = importNotes(r)
    toast(
      notes.length
        ? `已导入：${notes.join('；')}`
        : warnings.length
          ? `已导入（${warnings.length} 条提示，参数可能不完整）`
          : '已从 cURL 导入',
      notes.length || warnings.length ? 'info' : 'success',
    )
  }

  const pasteCurl = (text: string) => {
    const r = parseCurl(text)
    if (!r.ok) {
      toast(r.error, 'error')
      return
    }
    importHttpRequest(r.request, r.warnings, 'replace')
  }

  const openSample = (s: SampleRequest) => {
    if (!request.url.trim()) ws.updateRequest(tabId, () => s.build())
    else ws.openTab(s.build())
  }

  const openHistory = (e: HistoryEntry) => {
    ws.openTab(cloneRequest(e.request))
    setDrawer(false)
  }

  // ── 快捷键 ──
  useHotkey('mod+enter', (e) => {
    if (dialog) return
    e.preventDefault()
    if (controllers.current.has(tabId)) cancel()
    else void send()
  })
  useHotkey('mod+s', (e) => {
    e.preventDefault()
    if (!dialog) save()
  })
  useHotkey('escape', () => setDrawer(false), { enabled: drawer })

  const update = (fn: (r: ApiRequest) => ApiRequest) => ws.updateRequest(tabId, fn)
  const dialogTab =
    dialog && 'tabId' in dialog ? ws.tabs.find((t) => t.id === dialog.tabId) : undefined

  const sidebar = (
    <Sidebar
      tab={options.sidebarTab}
      onTab={(sidebarTab) => ws.setOptions({ sidebarTab })}
      history={ws.history}
      onOpenHistory={openHistory}
      onDeleteHistory={ws.deleteHistory}
      onClearHistory={ws.clearHistory}
      collections={ws.collections}
      activeSource={activeTab.source}
      onOpenSaved={(c, r) => {
        ws.openSaved(c, r)
        setDrawer(false)
      }}
      onNewCollection={ws.newCollection}
      onRenameCollection={ws.renameCollection}
      onDeleteCollection={ws.deleteCollection}
      onRenameSaved={ws.renameSaved}
      onDeleteSaved={ws.deleteSaved}
    />
  )

  return (
    <div className="flex gap-4">
      <AnimatePresence initial={false}>
        {options.sidebarOpen && (
          <motion.aside
            key="sidebar"
            // 宽度动画期间裁剪内容（初始透明，第一帧溢出看不见）；平时保持 visible，否则卡片阴影会被切成方角
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 272 }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            onAnimationStart={() => asideRef.current?.style.setProperty('overflow', 'hidden')}
            onAnimationComplete={() => asideRef.current?.style.setProperty('overflow', 'visible')}
            ref={asideRef}
            className="sticky top-16 hidden h-[calc(100dvh-5rem)] max-h-[900px] shrink-0 self-start lg:block"
          >
            <div className="h-full w-[272px] overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
              {sidebar}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <TabStrip
          tabs={ws.tabs}
          activeId={tabId}
          dirty={ws.dirty}
          loading={loadingIds}
          onActivate={ws.activate}
          onClose={requestClose}
          onRename={(id, name) => ws.patchTab(id, { name: name.trim() || undefined })}
          onNew={() => ws.openTab(newRequest())}
          leading={
            <>
              <button
                type="button"
                onClick={() => setDrawer(true)}
                aria-label="打开历史与集合"
                title="历史与集合"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-fg-2 shadow-card transition-colors hover:text-fg lg:hidden"
              >
                <PanelLeftOpen className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => ws.setOptions({ sidebarOpen: !options.sidebarOpen })}
                aria-label={options.sidebarOpen ? '收起侧栏' : '展开侧栏'}
                title={options.sidebarOpen ? '收起侧栏' : '展开历史与集合'}
                className="hidden size-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface text-fg-2 shadow-card transition-colors hover:text-fg lg:inline-flex"
              >
                {options.sidebarOpen ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
              </button>
            </>
          }
        />

        <UrlBar
          request={request}
          vars={vars}
          loading={loadingIds.has(tabId)}
          dirty={ws.dirty.has(tabId)}
          missingVars={built.missingVars}
          environments={ws.envState.environments}
          activeEnvId={ws.envState.activeId}
          proxy={proxy}
          layout={options.layout}
          onMethod={(method) => update((r) => ({ ...r, method }))}
          onUrl={(url) => update((r) => ({ ...r, url, params: syncParamsFromUrl(url, r.params) }))}
          onSend={() => void send()}
          onCancel={() => cancel()}
          onPasteCurl={pasteCurl}
          onEnv={ws.setActiveEnv}
          onManageEnvs={() => setDialog({ kind: 'envs' })}
          onImportCurl={() => setDialog({ kind: 'curl' })}
          onShowCode={() => setDialog({ kind: 'code' })}
          onSave={() => save()}
          onLayout={(layout) => ws.setOptions({ layout })}
        />

        {built.warnings.length > 0 && (
          <div className="rounded-2xl border border-warning/20 bg-warning/5 px-4 py-2 text-xs leading-relaxed text-warning">
            {built.warnings.map((w) => (
              <div key={w}>· {w}</div>
            ))}
          </div>
        )}

        <div
          className={cn(
            'grid min-w-0 gap-3',
            options.layout === 'split' && 'xl:grid-cols-2 xl:items-start',
          )}
        >
          <RequestPanel
            key={tabId}
            request={request}
            tabId={tabId}
            vars={vars}
            proxy={proxy}
            onRecheckProxy={() => recheckProxy(true)}
            onChange={update}
          />
          <ResponsePanel
            state={responses[tabId]}
            proxy={proxy}
            samples={SAMPLE_REQUESTS}
            onSample={openSample}
            onRetry={() => void send()}
            onCancel={() => cancel()}
            className={options.layout === 'split' ? 'xl:sticky xl:top-16' : undefined}
          />
        </div>
      </div>

      {/* 移动端侧栏抽屉 */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {drawer && (
              <div className="fixed inset-0 z-[80] lg:hidden">
                <motion.div
                  className="absolute inset-0 bg-fill-3 backdrop-blur-[2px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setDrawer(false)}
                />
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label="历史与集合"
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                  className="absolute inset-y-0 left-0 flex w-[min(320px,86vw)] flex-col border-r border-line bg-surface shadow-float"
                  data-lenis-prevent
                >
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <span className="text-[15px] font-semibold text-fg">历史与集合</span>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setDrawer(false)}
                      aria-label="关闭"
                      className="inline-flex size-8 items-center justify-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">{sidebar}</div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <SaveDialog
        open={dialog?.kind === 'save'}
        onClose={() => setDialog(null)}
        collections={ws.collections}
        defaultName={dialogTab ? tabTitle(dialogTab) : ''}
        onSave={(target) => {
          if (!dialogTab || dialog?.kind !== 'save') return
          const col = ws.saveAs(dialogTab, target)
          toast(`已保存到「${col?.name ?? '集合'}」`)
          if (dialog.closeAfter) closeNow(dialogTab.id)
          setDialog(null)
          ws.setOptions({ sidebarTab: 'collections' })
        }}
      />
      <ConfirmCloseDialog
        open={dialog?.kind === 'close'}
        name={dialogTab ? tabTitle(dialogTab) : ''}
        onCancel={() => setDialog(null)}
        onDiscard={() => {
          if (dialogTab) closeNow(dialogTab.id)
          setDialog(null)
        }}
        onSave={() => dialogTab && save(dialogTab.id, true)}
      />
      <CurlImportDialog
        open={dialog?.kind === 'curl'}
        onClose={() => setDialog(null)}
        onImport={(r, warnings) => {
          importHttpRequest(r, warnings, request.url.trim() ? 'new' : 'replace')
          setDialog(null)
        }}
      />
      <CodeDialog
        open={dialog?.kind === 'code'}
        onClose={() => setDialog(null)}
        request={built.request}
        missingVars={built.missingVars}
        target={options.codeTarget}
        onTarget={(codeTarget) => ws.setOptions({ codeTarget })}
      />
      <EnvironmentsDialog
        open={dialog?.kind === 'envs'}
        onClose={() => setDialog(null)}
        state={ws.envState}
        onChange={ws.setEnvState}
      />
    </div>
  )
}
