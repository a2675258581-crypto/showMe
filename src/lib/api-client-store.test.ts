import { describe, expect, it } from 'vitest'
import { emptyBody, kv, newRequest, requestSignature } from './api-client'
import {
  HISTORY_BODY_LIMIT,
  SAMPLE_REQUESTS,
  addHistory,
  compactRequest,
  decodeImport,
  defaultEnvironments,
  defaultTabs,
  encodeImport,
  findSaved,
  groupHistory,
  makeTab,
  normalizeCollections,
  normalizeEnvironments,
  normalizeHistory,
  normalizeRequest,
  normalizeTabs,
  saveToCollection,
  searchHistory,
  updateSavedRequest,
  type HistoryEntry,
} from './api-client-store'

describe('normalizeRequest', () => {
  it('fills defaults for garbage input', () => {
    for (const raw of [null, 1, 'x', [], {}]) {
      const r = normalizeRequest(raw)
      expect(r.method).toBe('GET')
      expect(r.body.mode).toBe('none')
      expect(r.settings.timeoutMs).toBe(30_000)
    }
  })

  it('keeps valid fields and repairs invalid ones', () => {
    const r = normalizeRequest({
      method: 'post',
      url: 'https://a.dev?x=1',
      headers: [
        { key: 'A', value: 'b' },
        'junk',
        { key: 'C', value: 'd', enabled: false, id: 'keep' },
      ],
      body: {
        mode: 'weird',
        json: '{}',
        formData: [{ key: 'f', type: 'file', fileName: 'a.png', fileSize: 3 }],
      },
      auth: { type: 'bearer', token: 't', apiKeyIn: 'nowhere' },
      settings: { timeoutMs: 9_999_999, followRedirects: false },
    })
    expect(r.method).toBe('POST')
    expect(r.params.map((p) => [p.key, p.value])).toEqual([['x', '1']])
    expect(r.headers.map((h) => [h.key, h.value, h.enabled])).toEqual([
      ['A', 'b', true],
      ['C', 'd', false],
    ])
    expect(r.headers[1].id).toBe('keep')
    expect(r.body.mode).toBe('none')
    expect(r.body.formData[0]).toMatchObject({
      key: 'f',
      type: 'file',
      fileName: 'a.png',
      fileSize: 3,
    })
    expect(r.auth).toMatchObject({
      type: 'bearer',
      token: 't',
      apiKeyIn: 'header',
      apiKeyName: 'X-API-Key',
    })
    expect(r.settings).toEqual({ timeoutMs: 120_000, followRedirects: false, useProxy: true })
  })

  it('maps unknown methods back to GET', () => {
    expect(normalizeRequest({ method: 'BREW' }).method).toBe('GET')
  })
})

describe('tabs', () => {
  it('normalizeTabs validates the active tab and baselines', () => {
    expect(normalizeTabs(null)).toBeNull()
    expect(normalizeTabs({ tabs: [] })).toBeNull()
    const t = normalizeTabs({
      tabs: [
        { id: 'a', request: { url: 'x' }, name: '  ' },
        { id: 'b', name: '我的请求' },
      ],
      activeId: 'zzz',
    })!
    expect(t.activeId).toBe('a')
    expect(t.tabs[0].name).toBeUndefined()
    expect(t.tabs[1].name).toBe('我的请求')
    expect(t.tabs[0].baseline).toBe(requestSignature(t.tabs[0].request))
  })

  it('makeTab / defaultTabs', () => {
    const tab = makeTab(newRequest({ url: 'u' }))
    expect(tab.baseline).toBe(requestSignature(tab.request))
    const d = defaultTabs()
    expect(d.tabs).toHaveLength(1)
    expect(d.activeId).toBe(d.tabs[0].id)
    expect(d.tabs[0].request.url).toContain('{{baseUrl}}')
  })
})

describe('history', () => {
  const entry = (time: number, url: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
    id: String(time),
    time,
    request: newRequest({ url }),
    ...extra,
  })

  it('addHistory prepends, caps and compacts large bodies', () => {
    let list: HistoryEntry[] = []
    for (let i = 0; i < 205; i++) list = addHistory(list, entry(i, `u${i}`))
    expect(list).toHaveLength(200)
    expect(list[0].request.url).toBe('u204')
    const big = addHistory([], {
      ...entry(1, 'x'),
      request: newRequest({
        body: { ...emptyBody(), mode: 'json', json: 'x'.repeat(HISTORY_BODY_LIMIT + 10) },
      }),
    })
    expect(big[0].request.body.json.length).toBe(HISTORY_BODY_LIMIT)
  })

  it('addHistory drops the oldest entries when the serialized size exceeds the budget', () => {
    const withBody = (i: number) => ({
      ...entry(i, `u${i}`),
      request: newRequest({
        url: `u${i}`,
        body: { ...emptyBody(), mode: 'text', text: '文'.repeat(1000) },
      }),
    })
    let list: HistoryEntry[] = []
    for (let i = 0; i < 50; i++) list = addHistory(list, withBody(i), 200, 20_000)
    expect(list.length).toBeGreaterThan(5)
    expect(list.length).toBeLessThan(50)
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(20_000)
    expect(list[0].request.url).toBe('u49')
    expect(list.map((e) => e.request.url)).toEqual(
      Array.from({ length: list.length }, (_, k) => `u${49 - k}`),
    )
    // 单条就超出预算时仍然保留最新这一条
    expect(addHistory(list, withBody(99), 200, 10)).toHaveLength(1)
  })

  it('compactRequest leaves small requests untouched', () => {
    const r = newRequest({ body: { ...emptyBody(), text: 'abc' } })
    expect(compactRequest(r)).toEqual(r)
  })

  it('groupHistory by local day', () => {
    const now = new Date(2026, 8, 24, 10, 0, 0).getTime()
    const today = new Date(2026, 8, 24, 0, 0, 1).getTime()
    const yesterday = new Date(2026, 8, 23, 23, 59, 0).getTime()
    const older = new Date(2026, 8, 1).getTime()
    const g = groupHistory(
      [entry(now, 'a'), entry(today, 'b'), entry(yesterday, 'c'), entry(older, 'd')],
      now,
    )
    expect(g.map((x) => [x.label, x.items.map((i) => i.request.url)])).toEqual([
      ['今天', ['a', 'b']],
      ['昨天', ['c']],
      ['更早', ['d']],
    ])
    expect(groupHistory([], now)).toEqual([])
  })

  it('searchHistory matches method, url, resolved url and status', () => {
    const list = [
      entry(1, '{{base}}/users', { resolvedUrl: 'https://api.dev/users', status: 200 }),
      {
        ...entry(2, 'https://x.dev/orders', { status: 404 }),
        request: newRequest({ method: 'POST', url: 'https://x.dev/orders' }),
      },
    ]
    expect(searchHistory(list, '').length).toBe(2)
    expect(searchHistory(list, 'api.dev').map((e) => e.id)).toEqual(['1'])
    expect(searchHistory(list, 'post 404').map((e) => e.id)).toEqual(['2'])
    expect(searchHistory(list, 'POST 200')).toEqual([])
  })

  it('normalizeHistory', () => {
    expect(normalizeHistory('x')).toEqual([])
    const h = normalizeHistory([{ time: 5, request: { url: 'a' }, status: 201, error: 'e' }, 3])
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ time: 5, status: 201, error: 'e' })
  })
})

describe('collections', () => {
  it('saves into a new collection, then an existing one, then updates', () => {
    const r1 = saveToCollection(
      [],
      { newCollectionName: '用户服务', name: '获取用户' },
      newRequest({ url: 'a' }),
      1,
    )
    expect(r1.collections).toHaveLength(1)
    expect(r1.collections[0].name).toBe('用户服务')
    const r2 = saveToCollection(
      r1.collections,
      { collectionId: r1.collectionId, name: '  ' },
      newRequest({ url: 'b' }),
      2,
    )
    expect(r2.collections[0].requests.map((r) => r.name)).toEqual(['获取用户', '未命名请求'])
    const src = { collectionId: r2.collectionId, requestId: r2.requestId }
    expect(findSaved(r2.collections, src)?.request.url).toBe('b')
    const updated = updateSavedRequest(r2.collections, src, newRequest({ url: 'c' }), 3, '改名')!
    expect(findSaved(updated, src)).toMatchObject({ name: '改名', updatedAt: 3 })
    expect(findSaved(updated, src)?.request.url).toBe('c')
    expect(
      updateSavedRequest(updated, { collectionId: 'x', requestId: 'y' }, newRequest(), 4),
    ).toBeNull()
    expect(findSaved(updated, undefined)).toBeUndefined()
  })

  it('falls back to a new collection when the target id is gone', () => {
    const r = saveToCollection([], { collectionId: 'missing', name: 'x' }, newRequest(), 1)
    expect(r.collections[0].name).toBe('我的集合')
  })

  it('normalizeCollections', () => {
    expect(normalizeCollections({})).toEqual([])
    const c = normalizeCollections([
      { name: '', requests: [{ request: { method: 'DELETE' } }, null] },
    ])
    expect(c[0].name).toBe('未命名集合')
    expect(c[0].requests).toHaveLength(1)
    expect(c[0].requests[0].request.method).toBe('DELETE')
  })
})

describe('environments', () => {
  it('defaultEnvironments has an active sample environment', () => {
    const e = defaultEnvironments()
    expect(e.activeId).toBe(e.environments[0].id)
    expect(e.environments[0].variables.map((v) => v.key)).toEqual(['baseUrl', 'userId'])
  })
  it('normalizeEnvironments clears unknown active ids', () => {
    expect(normalizeEnvironments(null)).toBeNull()
    const n = normalizeEnvironments({
      environments: [{ id: 'a', name: '生产', variables: [kv('x', '1')] }],
      activeId: 'b',
    })!
    expect(n.activeId).toBeNull()
    expect(n.environments[0].variables[0]).toMatchObject({ key: 'x', value: '1' })
  })
})

describe('import handoff', () => {
  const req = {
    method: 'POST',
    url: 'https://a.dev',
    headers: [['A', 'b']] as [string, string][],
    body: { kind: 'text' as const, text: 'x' },
  }
  it('round-trips while fresh', () => {
    expect(decodeImport(encodeImport(req, 1000), 2000)).toEqual(req)
  })
  it('rejects stale, future, missing or malformed payloads', () => {
    expect(decodeImport(encodeImport(req, 0), 11 * 60_000)).toBeNull()
    expect(decodeImport(encodeImport(req, 10 * 60_000), 0)).toBeNull()
    expect(decodeImport(null, 0)).toBeNull()
    expect(decodeImport('{', 0)).toBeNull()
    expect(decodeImport(JSON.stringify({ request: { url: 1 }, at: 0 }), 0)).toBeNull()
  })
  it('sanitizes headers and body', () => {
    const raw = JSON.stringify({
      request: { method: 'GET', url: 'u', headers: [['a', 1], 'x'], body: 5 },
      at: 0,
    })
    expect(decodeImport(raw, 0)).toEqual({
      method: 'GET',
      url: 'u',
      headers: [['a', '1']],
      body: { kind: 'none' },
    })
  })

  it('rejects malformed bodies instead of passing them to the editor (regression)', () => {
    const decode = (body: unknown, extra: object = {}) =>
      decodeImport(
        JSON.stringify({ request: { method: 'POST', url: 'u', body, ...extra }, at: 0 }),
        0,
      )
    expect(decode({ kind: 'text' })?.body).toEqual({ kind: 'none' })
    expect(decode({ kind: 'text', text: 5 })?.body).toEqual({ kind: 'none' })
    expect(decode({ kind: 'file' })?.body).toEqual({ kind: 'none' })
    expect(decode({ kind: 'weird' })?.body).toEqual({ kind: 'none' })
    expect(decode({ kind: 'text', text: '中文' })?.body).toEqual({ kind: 'text', text: '中文' })
    expect(
      decode({
        kind: 'multipart',
        parts: [
          { name: 'a', value: '1', kind: 'text' },
          { name: 'f', value: 'x.png', kind: 'file', filename: 'y.png', contentType: 'image/png' },
          { name: 2, value: 'bad' },
          'junk',
        ],
      })?.body,
    ).toEqual({
      kind: 'multipart',
      parts: [
        { name: 'a', value: '1', kind: 'text' },
        { name: 'f', value: 'x.png', kind: 'file', filename: 'y.png', contentType: 'image/png' },
      ],
    })
    expect(decode({ kind: 'none' }, { auth: { username: 'u', password: 7 } })?.auth).toEqual({
      username: 'u',
      password: '7',
    })
  })
})

describe('samples', () => {
  it('builds every sample request', () => {
    for (const s of SAMPLE_REQUESTS) {
      const r = s.build()
      expect(r.url).toBeTruthy()
      expect(normalizeRequest(JSON.parse(JSON.stringify(r)))).toEqual(r)
    }
  })
})
