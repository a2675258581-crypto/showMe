/** 文本对比：行级对齐 + 行内（单词 / 字符）差异（纯函数，无 DOM 依赖） */
import { createTwoFilesPatch, diffArrays } from 'diff'

export type DiffGranularity = 'line' | 'word' | 'char'

export interface DiffOptions {
  granularity: DiffGranularity
  /** 忽略所有空白差异（类似 git diff -w） */
  ignoreWhitespace: boolean
  ignoreCase: boolean
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  granularity: 'word',
  ignoreWhitespace: false,
  ignoreCase: false,
}

export const GRANULARITY_UNIT: Record<DiffGranularity, string> = {
  line: '行',
  word: '词',
  char: '字符',
}

/** 行内片段：changed 表示在对面不存在（左侧=删除，右侧=新增） */
export interface Segment {
  text: string
  changed: boolean
}

export interface SideLine {
  /** 行号，从 1 开始 */
  no: number
  text: string
  segments: Segment[]
}

export type RowKind = 'equal' | 'removed' | 'added' | 'changed'

/** 并排视图的一行 */
export interface SplitRow {
  kind: RowKind
  left: SideLine | null
  right: SideLine | null
  /** 所属差异块序号；未改动的行为 -1 */
  block: number
}

export type UnifiedKind = 'equal' | 'removed' | 'added'

/** 行内（统一）视图的一行 */
export interface UnifiedRow {
  kind: UnifiedKind
  oldNo: number | null
  newNo: number | null
  text: string
  segments: Segment[]
  block: number
}

/** 一个连续的差异块，用于「上一处 / 下一处」导航 */
export interface DiffBlock {
  index: number
  splitStart: number
  splitEnd: number
  unifiedStart: number
  unifiedEnd: number
  /** 原文中的起始行号（1 起）与行数 */
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

export interface DiffStats {
  /** 按粒度单位计的新增 / 删除数量 */
  added: number
  removed: number
  unit: string
  /** 新增 / 删除 / 修改的行数（按行统计，任何粒度都有） */
  linesAdded: number
  linesRemoved: number
  /** 0~1，相同内容占两侧总量的比例（2×相同 / (左+右)） */
  similarity: number
  identical: boolean
  oldLines: number
  newLines: number
}

export type DiffResult =
  | {
      ok: true
      split: SplitRow[]
      unified: UnifiedRow[]
      blocks: DiffBlock[]
      stats: DiffStats
    }
  | { ok: false; error: string }

/** 统一换行后按行切分；末尾换行不产生额外的空行 */
export function splitTextLines(text: string): string[] {
  if (text === '') return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function lineKey(line: string, opts: DiffOptions): string {
  let k = line
  if (opts.ignoreWhitespace) k = k.replace(/\s+/g, '')
  if (opts.ignoreCase) k = k.toLowerCase()
  return k
}

// ───────────── 行内分词 ─────────────

interface Token {
  text: string
  ws: boolean
}

/** 中日韩文字逐字成词，其余按「字母数字串 / 空白串 / 单个符号」切分 */
const WORD_TOKEN_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{M}\p{N}_])+|\s+|[\s\S]/gu

export function tokenize(line: string, granularity: 'word' | 'char'): Token[] {
  if (granularity === 'char') {
    const out: Token[] = []
    for (const ch of line) out.push({ text: ch, ws: /\s/u.test(ch) })
    return out
  }
  const out: Token[] = []
  for (const m of line.matchAll(WORD_TOKEN_RE)) {
    out.push({ text: m[0], ws: /^\s+$/u.test(m[0]) })
  }
  return out
}

/** 参与计数的 token：单词粒度只数非空白；字符粒度忽略空白时不数空白 */
function counted(t: Token, granularity: 'word' | 'char', ignoreWs: boolean): boolean {
  if (granularity === 'word') return !t.ws
  return !(ignoreWs && t.ws)
}

function countTokens(line: string, opts: DiffOptions): number {
  if (opts.granularity === 'line') return 1
  const g = opts.granularity
  let n = 0
  for (const t of tokenize(line, g)) if (counted(t, g, opts.ignoreWhitespace)) n++
  return n
}

function mergeSegments(segs: Segment[]): Segment[] {
  const out: Segment[] = []
  for (const s of segs) {
    if (!s.text) continue
    const last = out[out.length - 1]
    if (last && last.changed === s.changed) last.text += s.text
    else out.push({ ...s })
  }
  return out
}

/** 夹在两段改动之间的纯空白也算作改动，高亮更连贯 */
function bridgeWhitespace(segs: Segment[]): Segment[] {
  for (let i = 1; i < segs.length - 1; i++) {
    if (!segs[i].changed && segs[i - 1].changed && segs[i + 1].changed && !segs[i].text.trim()) {
      segs[i] = { ...segs[i], changed: true }
    }
  }
  return mergeSegments(segs)
}

const plain = (text: string): Segment[] => (text ? [{ text, changed: false }] : [])

export interface IntraDiff {
  left: Segment[]
  right: Segment[]
  commonLeft: number
  commonRight: number
  removed: number
  added: number
  /** 这一对行的相似度 0~1 */
  similarity: number
}

/** 两行之间的行内差异；timeoutMs 用完时整行视为改动（不做逐词比较） */
export function intraLineDiff(a: string, b: string, opts: DiffOptions, timeoutMs = 300): IntraDiff {
  if (opts.granularity === 'line') {
    return {
      left: plain(a),
      right: plain(b),
      commonLeft: 0,
      commonRight: 0,
      removed: 1,
      added: 1,
      similarity: 0,
    }
  }
  const g = opts.granularity
  const ta = tokenize(a, g)
  const tb = tokenize(b, g)
  const ignoreWs = opts.ignoreWhitespace
  // 忽略空白时空白 token 不参与比较
  const fa = ignoreWs ? ta.filter((t) => !t.ws) : ta
  const fb = ignoreWs ? tb.filter((t) => !t.ws) : tb
  const key = (t: Token) => (opts.ignoreCase ? t.text.toLowerCase() : t.text)
  const changes =
    timeoutMs > 0 ? diffArrays(fa.map(key), fb.map(key), { timeout: timeoutMs }) : undefined
  const changedA = new Set<Token>()
  const changedB = new Set<Token>()
  if (!changes) {
    fa.forEach((t) => changedA.add(t))
    fb.forEach((t) => changedB.add(t))
  } else {
    let i = 0
    let j = 0
    for (const c of changes) {
      if (c.removed) for (let k = 0; k < c.count; k++) changedA.add(fa[i++])
      else if (c.added) for (let k = 0; k < c.count; k++) changedB.add(fb[j++])
      else {
        i += c.count
        j += c.count
      }
    }
  }
  const count = (tokens: Token[], changed: Set<Token>) => {
    let common = 0
    let diff = 0
    for (const t of tokens) {
      if (!counted(t, g, ignoreWs)) continue
      if (changed.has(t)) diff++
      else common++
    }
    return [common, diff] as const
  }
  const [commonLeft, removed] = count(ta, changedA)
  const [commonRight, added] = count(tb, changedB)
  const total = commonLeft + removed + commonRight + added
  const similarity = total === 0 ? 1 : (commonLeft + commonRight) / total
  const toSegs = (tokens: Token[], changed: Set<Token>) =>
    bridgeWhitespace(mergeSegments(tokens.map((t) => ({ text: t.text, changed: changed.has(t) }))))
  return {
    left: toSegs(ta, changedA),
    right: toSegs(tb, changedB),
    commonLeft,
    commonRight,
    removed,
    added,
    similarity,
  }
}

/** 相似度低于此值的两行不再显示行内高亮（整行都变了，逐词标红反而难读） */
export const INTRA_MIN_SIMILARITY = 0.3

// ───────────── 差异块内的行配对 ─────────────

/** 字符二元组（按码点），用于快速估算两行的相似度 */
function bigrams(s: string): Map<string, number> {
  const chars = Array.from(s)
  const m = new Map<string, number>()
  for (let k = 0; k + 1 < chars.length; k++) {
    const g = chars[k] + chars[k + 1]
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** Dice 系数：2 × 共有二元组 / 二元组总数 */
function dice(a: Map<string, number>, b: Map<string, number>, sa: string, sb: string): number {
  let na = 0
  let nb = 0
  a.forEach((v) => (na += v))
  b.forEach((v) => (nb += v))
  if (na === 0 || nb === 0) return sa === sb ? 1 : 0
  let common = 0
  a.forEach((v, k) => {
    const w = b.get(k)
    if (w) common += Math.min(v, w)
  })
  return (2 * common) / (na + nb)
}

/** 相似度达到此值的删除行与新增行才会配成一对（显示行内差异） */
export const PAIR_MIN_SIMILARITY = 0.35
/** 块太大时退化为按顺序配对，避免 O(n×m) 过慢 */
const MAX_ALIGN_CELLS = 40_000

export interface AlignOp {
  left: number | null
  right: number | null
}

/**
 * 在一个差异块内，把删除行与新增行按相似度做保序配对（动态规划，最大化相似度之和），
 * 这样「插入一行 + 修改一行」时修改的那一行能正确对上。
 */
export function alignLines(left: string[], right: string[], opts: DiffOptions): AlignOp[] {
  const n = left.length
  const m = right.length
  const ops: AlignOp[] = []
  if (!n || !m || n * m > MAX_ALIGN_CELLS) {
    for (let k = 0; k < Math.max(n, m); k++) {
      ops.push({ left: k < n ? k : null, right: k < m ? k : null })
    }
    return ops
  }
  const norm = (l: string) => {
    const t = l.trim().replace(/\s+/g, ' ')
    return opts.ignoreCase ? t.toLowerCase() : t
  }
  const ln = left.map(norm)
  const rn = right.map(norm)
  const lg = ln.map(bigrams)
  const rg = rn.map(bigrams)
  const W = m + 1
  const score = new Float64Array((n + 1) * W)
  // 0 = 配对，1 = 跳过左侧，2 = 跳过右侧
  const move = new Uint8Array((n + 1) * W)
  const sim = new Float64Array(n * m)
  for (let a = 1; a <= n; a++) {
    move[a * W] = 1
    for (let b = 1; b <= m; b++) {
      const s = dice(lg[a - 1], rg[b - 1], ln[a - 1], rn[b - 1])
      sim[(a - 1) * m + (b - 1)] = s
      // 平局时优先「跳过右侧」，回溯后删除行排在新增行前面
      let best = score[a * W + b - 1]
      let mv = 2
      if (score[(a - 1) * W + b] > best) {
        best = score[(a - 1) * W + b]
        mv = 1
      }
      if (s >= PAIR_MIN_SIMILARITY && score[(a - 1) * W + b - 1] + s > best) {
        best = score[(a - 1) * W + b - 1] + s
        mv = 0
      }
      score[a * W + b] = best
      move[a * W + b] = mv
    }
  }
  for (let b = 1; b <= m; b++) move[b] = 2
  let a = n
  let b = m
  while (a > 0 || b > 0) {
    const mv = move[a * W + b]
    if (mv === 0) {
      ops.push({ left: a - 1, right: b - 1 })
      a--
      b--
    } else if (mv === 1) {
      ops.push({ left: a - 1, right: null })
      a--
    } else {
      ops.push({ left: null, right: b - 1 })
      b--
    }
  }
  return ops.reverse()
}

// ───────────── 行级差异 ─────────────

export interface LineChange {
  kind: 'equal' | 'removed' | 'added'
  count: number
}

/**
 * 行级 LCS 差异。只在一侧出现的行不可能是公共行，先把它们剔除再跑 Myers，
 * 最后按配对结果还原（与 GNU diff 的 discard 优化相同）：
 * 两段完全不同的大文本不再需要 O(N×D) 的搜索，几毫秒就能出结果。
 * 超时返回 undefined。
 */
export function diffLineKeys(
  a: string[],
  b: string[],
  timeoutMs: number,
): LineChange[] | undefined {
  const inA = new Set(a)
  const inB = new Set(b)
  const ai: number[] = []
  const bi: number[] = []
  a.forEach((k, idx) => inB.has(k) && ai.push(idx))
  b.forEach((k, idx) => inA.has(k) && bi.push(idx))
  const out: LineChange[] = []
  const push = (kind: LineChange['kind'], count: number) => {
    if (count <= 0) return
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.count += count
    else out.push({ kind, count })
  }
  let i = 0
  let j = 0
  if (ai.length && bi.length) {
    const changes = diffArrays(
      ai.map((k) => a[k]),
      bi.map((k) => b[k]),
      { timeout: timeoutMs },
    )
    if (!changes) return undefined
    let x = 0
    let y = 0
    for (const c of changes) {
      if (c.removed) x += c.count
      else if (c.added) y += c.count
      else {
        for (let k = 0; k < c.count; k++) {
          const pa = ai[x + k]
          const pb = bi[y + k]
          // 被剔除的行（只在一侧出现）夹在公共行之间，先删后增
          push('removed', pa - i)
          push('added', pb - j)
          push('equal', 1)
          i = pa + 1
          j = pb + 1
        }
        x += c.count
        y += c.count
      }
    }
  }
  push('removed', a.length - i)
  push('added', b.length - j)
  return out
}

// ───────────── 主流程 ─────────────

export function computeDiff(
  oldText: string,
  newText: string,
  opts: DiffOptions = DEFAULT_DIFF_OPTIONS,
  timeoutMs = 3000,
): DiffResult {
  const t0 = Date.now()
  const A = splitTextLines(oldText)
  const B = splitTextLines(newText)
  const changes = diffLineKeys(
    A.map((l) => lineKey(l, opts)),
    B.map((l) => lineKey(l, opts)),
    timeoutMs,
  )
  if (!changes) {
    const secs = Math.max(1, Math.round(timeoutMs / 1000))
    return {
      ok: false,
      error: `两段文本差异过大，对比超时（超过 ${secs} 秒）。常见于大段内容被重新排序，可以缩小对比范围后再试。`,
    }
  }

  const split: SplitRow[] = []
  const unified: UnifiedRow[] = []
  const blocks: DiffBlock[] = []
  let addedTok = 0
  let removedTok = 0
  let commonTok = 0
  let linesAdded = 0
  let linesRemoved = 0
  let i = 0
  let j = 0
  let pendingRemoved: number[] = []
  let pendingAdded: number[] = []

  const countLine = (line: string) => countTokens(line, opts)

  const flush = () => {
    if (!pendingRemoved.length && !pendingAdded.length) return
    const index = blocks.length
    const block: DiffBlock = {
      index,
      splitStart: split.length,
      splitEnd: split.length,
      unifiedStart: unified.length,
      unifiedEnd: unified.length,
      oldStart: pendingRemoved.length ? pendingRemoved[0] + 1 : i,
      oldCount: pendingRemoved.length,
      newStart: pendingAdded.length ? pendingAdded[0] + 1 : j,
      newCount: pendingAdded.length,
    }
    linesRemoved += pendingRemoved.length
    linesAdded += pendingAdded.length
    const leftSegs = new Map<number, Segment[]>()
    const rightSegs = new Map<number, Segment[]>()
    const sideA = (li: number): SideLine => ({
      no: li + 1,
      text: A[li],
      segments: leftSegs.get(li)!,
    })
    const sideB = (ri: number): SideLine => ({
      no: ri + 1,
      text: B[ri],
      segments: rightSegs.get(ri)!,
    })
    // 没配上对的删除行与新增行在并排视图里并到同一行显示（与 GitHub 一致）
    let loneL: number[] = []
    let loneR: number[] = []
    const flushLone = () => {
      const n = Math.max(loneL.length, loneR.length)
      for (let k = 0; k < n; k++) {
        const li = loneL[k]
        const ri = loneR[k]
        split.push({
          kind:
            li !== undefined && ri !== undefined
              ? 'changed'
              : li !== undefined
                ? 'removed'
                : 'added',
          left: li !== undefined ? sideA(li) : null,
          right: ri !== undefined ? sideB(ri) : null,
          block: index,
        })
      }
      loneL = []
      loneR = []
    }
    const ops = alignLines(
      pendingRemoved.map((li) => A[li]),
      pendingAdded.map((ri) => B[ri]),
      opts,
    )
    for (const op of ops) {
      if (op.left !== null && op.right !== null) {
        flushLone()
        const li = pendingRemoved[op.left]
        const ri = pendingAdded[op.right]
        // 行内比较共享总的时间预算：超时后剩下的行只整行标记，保证总耗时有上限
        const budget = Math.min(300, timeoutMs - (Date.now() - t0))
        const d = intraLineDiff(A[li], B[ri], opts, budget)
        const keep = opts.granularity !== 'line' && d.similarity >= INTRA_MIN_SIMILARITY
        leftSegs.set(li, keep ? d.left : plain(A[li]))
        rightSegs.set(ri, keep ? d.right : plain(B[ri]))
        if (opts.granularity === 'line') {
          removedTok++
          addedTok++
        } else {
          removedTok += d.removed
          addedTok += d.added
          commonTok += d.commonLeft + d.commonRight
        }
        split.push({ kind: 'changed', left: sideA(li), right: sideB(ri), block: index })
      } else if (op.left !== null) {
        const li = pendingRemoved[op.left]
        leftSegs.set(li, plain(A[li]))
        removedTok += countLine(A[li])
        loneL.push(li)
      } else if (op.right !== null) {
        const ri = pendingAdded[op.right]
        rightSegs.set(ri, plain(B[ri]))
        addedTok += countLine(B[ri])
        loneR.push(ri)
      }
    }
    flushLone()
    for (const li of pendingRemoved) {
      unified.push({
        kind: 'removed',
        oldNo: li + 1,
        newNo: null,
        text: A[li],
        segments: leftSegs.get(li)!,
        block: index,
      })
    }
    for (const ri of pendingAdded) {
      unified.push({
        kind: 'added',
        oldNo: null,
        newNo: ri + 1,
        text: B[ri],
        segments: rightSegs.get(ri)!,
        block: index,
      })
    }
    block.splitEnd = split.length
    block.unifiedEnd = unified.length
    blocks.push(block)
    pendingRemoved = []
    pendingAdded = []
  }

  for (const c of changes) {
    if (c.kind === 'removed') {
      for (let k = 0; k < c.count; k++) pendingRemoved.push(i++)
    } else if (c.kind === 'added') {
      for (let k = 0; k < c.count; k++) pendingAdded.push(j++)
    } else {
      flush()
      for (let k = 0; k < c.count; k++) {
        const left: SideLine = { no: i + 1, text: A[i], segments: plain(A[i]) }
        const right: SideLine = { no: j + 1, text: B[j], segments: plain(B[j]) }
        split.push({ kind: 'equal', left, right, block: -1 })
        unified.push({
          kind: 'equal',
          oldNo: i + 1,
          newNo: j + 1,
          text: B[j],
          segments: right.segments,
          block: -1,
        })
        commonTok += opts.granularity === 'line' ? 2 : countLine(A[i]) + countLine(B[j])
        i++
        j++
      }
    }
  }
  flush()

  const total = commonTok + addedTok + removedTok
  return {
    ok: true,
    split,
    unified,
    blocks,
    stats: {
      added: addedTok,
      removed: removedTok,
      unit: GRANULARITY_UNIT[opts.granularity],
      linesAdded,
      linesRemoved,
      similarity: total === 0 ? 1 : commonTok / total,
      identical: blocks.length === 0,
      oldLines: A.length,
      newLines: B.length,
    },
  }
}

// ───────────── 折叠未改动的行 ─────────────

export type FoldItem = { type: 'row'; index: number } | { type: 'fold'; start: number; end: number }

/**
 * 只保留改动附近 context 行，其余连续的未改动行折叠成一项（end 不含）。
 * 连续未改动行少于 minFold 时不折叠。
 */
export function foldUnchanged(changed: readonly boolean[], context = 3, minFold = 4): FoldItem[] {
  const n = changed.length
  const visible = new Uint8Array(n)
  let last = -Infinity
  for (let k = 0; k < n; k++) {
    if (changed[k]) last = k
    if (k - last <= context) visible[k] = 1
  }
  last = Infinity
  for (let k = n - 1; k >= 0; k--) {
    if (changed[k]) last = k
    if (last - k <= context) visible[k] = 1
  }
  const out: FoldItem[] = []
  for (let k = 0; k < n;) {
    if (visible[k]) {
      out.push({ type: 'row', index: k })
      k++
      continue
    }
    let e = k
    while (e < n && !visible[e]) e++
    if (e - k >= minFold) out.push({ type: 'fold', start: k, end: e })
    else for (let x = k; x < e; x++) out.push({ type: 'row', index: x })
    k = e
  }
  return out
}

// ───────────── 补丁 ─────────────

/**
 * 生成统一格式（unified diff）补丁。
 * 总是按原文逐字比较，不受「忽略空白 / 大小写」影响：忽略空白时上下文行取自新文本，
 * 生成的补丁无法再应用回原文（git apply / patch 会失败）。
 */
export function createUnifiedPatch(
  oldText: string,
  newText: string,
  names: [string, string] = ['original.txt', 'modified.txt'],
  context = 3,
): string {
  return createTwoFilesPatch(names[0], names[1], oldText, newText, undefined, undefined, {
    context,
  })
}
