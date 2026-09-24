/**
 * JSON 样例 → 类型模型（纯逻辑）。
 *
 * - 数组里的对象会合并字段：部分元素缺少的字段标记为可选，出现过 null 的标记为可空；
 * - 不同基本类型混合时生成联合类型；整数与小数混合时统一为浮点数（`1.0` 也按小数处理）；
 * - 空数组的元素、只出现过 null 的值推断为 unknown / any；空对象推断为 Map；
 * - 嵌套类型按键名 PascalCase 命名，数组元素自动单数化（items → Item、data → DataItem）；
 * - 结构完全相同的对象共用一个类型（billingAddress / shippingAddress → Address）；
 * - 支持 JSON Lines（每行一个 JSON 样例）。
 *
 * 渲染成各语言代码见 `json-to-types-render.ts`。
 */
import { buildFrame } from './code-formatter-frame'
import { parseJson, type ConvertIssue } from './json-yaml'
import {
  RESERVED_TYPE_NAMES,
  commonSuffixName,
  keyWords,
  singularize,
  typeNameFromKey,
} from './json-to-types-names'

/* ───────────────────────── 模型 ───────────────────────── */

export type Primitive = 'string' | 'integer' | 'number' | 'boolean'

export type TypeRef = { nullable: boolean } & (
  | { kind: 'primitive'; type: Primitive }
  /** 无法推断（空数组元素、只出现过 null） */
  | { kind: 'any' }
  | { kind: 'array'; item: TypeRef }
  /** 空对象 {}：按「字符串 → 任意值」的字典处理 */
  | { kind: 'map'; value: TypeRef }
  | { kind: 'object'; def: ObjectDef }
  /** 两个以上互不相同的非 null 类型 */
  | { kind: 'union'; members: TypeRef[] }
)

export interface FieldDef {
  /** 原始 JSON 键 */
  key: string
  type: TypeRef
  /** 部分样本中缺少这个字段 */
  optional: boolean
}

export interface ObjectDef {
  name: string
  fields: FieldDef[]
}

export interface TypeModel {
  rootName: string
  root: TypeRef
  /** 根对象（若有）在前，其余按首次出现的顺序 */
  objects: ObjectDef[]
}

/* ───────────────────────── 解析样例 ───────────────────────── */

/** 源码里写成 1.0 / 1e3 的整数值：按浮点数推断 */
const FLOAT = Symbol('float')

interface ReviverContext {
  source?: string
}

function reviver(_key: string, value: unknown, ctx?: ReviverContext): unknown {
  if (typeof value === 'number' && Number.isInteger(value)) {
    const src = ctx?.source
    if (src !== undefined && /[.eE]/.test(src)) return FLOAT
  }
  return value
}

export type SamplesResult =
  | { ok: true; samples: unknown[]; jsonLines: boolean; empty: boolean }
  | { ok: false; error: ConvertIssue }

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/**
 * 解析输入：普通 JSON 返回一个样例；JSON Lines（每行一个值）返回多个样例。
 * 解析失败时返回带行列号的中文错误。
 */
export function parseSamples(text: string): SamplesResult {
  const src = stripBom(text)
  if (!src.trim()) return { ok: true, samples: [], jsonLines: false, empty: true }
  try {
    return { ok: true, samples: [JSON.parse(src, reviver)], jsonLines: false, empty: false }
  } catch {
    // 继续尝试 JSON Lines
  }
  const lines = src.split(/\r\n|\r|\n/)
  const filled = lines.map((text, i) => ({ text, no: i + 1 })).filter((l) => l.text.trim())
  if (filled.length >= 2) {
    const samples: unknown[] = []
    let bad: (typeof filled)[number] | null = null
    for (const line of filled) {
      try {
        samples.push(JSON.parse(line.text, reviver))
      } catch {
        bad = line
        break
      }
    }
    if (!bad) return { ok: true, samples, jsonLines: true, empty: false }
    // 前面至少有一行是完整的对象 / 数组：多半是 JSON Lines 里某一行写错了，直接指出那一行
    const first = filled[0].text.trim()
    if (samples.length > 0 && (first.startsWith('{') || first.startsWith('['))) {
      const r = parseJson(bad.text)
      if (!r.ok) {
        const line = bad.no - 1 + (r.error.line ?? 1)
        const column = r.error.column ?? 1
        return {
          ok: false,
          error: {
            message: `JSON Lines 第 ${bad.no} 行：${r.error.message}`,
            line,
            column,
            frame: buildFrame(src, line, column),
          },
        }
      }
    }
  }
  const r = parseJson(src)
  if (r.ok) {
    // 理论上不会走到这里（JSON.parse 已失败）
    return { ok: true, samples: [r.value], jsonLines: false, empty: false }
  }
  return { ok: false, error: r.error }
}

/* ───────────────────────── 形状推断 ───────────────────────── */

/** 超过此深度的值按 any 处理，避免超深嵌套导致栈溢出 */
const MAX_DEPTH = 128
/** 超出 int64 范围的整数按浮点数处理 */
const INT64_LIMIT = 9.223372036854776e18

interface ObjShape {
  count: number
  fields: Map<string, Shape>
}

interface Shape {
  /** 观察到的值数量（含 null） */
  count: number
  nulls: number
  string: number
  integer: number
  float: number
  boolean: number
  /** 超出深度限制 */
  deep: number
  array?: { count: number; items: Shape }
  object?: ObjShape
}

const newShape = (): Shape => ({
  count: 0,
  nulls: 0,
  string: 0,
  integer: 0,
  float: 0,
  boolean: 0,
  deep: 0,
})

function observe(s: Shape, v: unknown, depth: number): void {
  s.count++
  if (v === null || v === undefined) {
    s.nulls++
    return
  }
  if (v === FLOAT) {
    s.float++
    return
  }
  switch (typeof v) {
    case 'string':
      s.string++
      return
    case 'number':
      if (Number.isInteger(v) && Math.abs(v) < INT64_LIMIT) s.integer++
      else s.float++
      return
    case 'boolean':
      s.boolean++
      return
  }
  if (depth >= MAX_DEPTH) {
    s.deep++
    return
  }
  if (Array.isArray(v)) {
    const a = (s.array ??= { count: 0, items: newShape() })
    a.count++
    for (const item of v) observe(a.items, item, depth + 1)
    return
  }
  if (typeof v === 'object') {
    const o = (s.object ??= { count: 0, fields: new Map() })
    o.count++
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      let f = o.fields.get(k)
      if (!f) o.fields.set(k, (f = newShape()))
      observe(f, val, depth + 1)
    }
    return
  }
  s.deep++
}

/* ───────────────────────── 建模：去重 + 命名 ───────────────────────── */

interface NameCandidate {
  name: string
  parent: ObjNode | null
}

interface ObjNode {
  def: ObjectDef
  sig: string
  /** 先序编号：越小越先出现（用于稳定命名与输出顺序） */
  order: number
  candidates: NameCandidate[]
}

interface Ctx {
  bySig: Map<string, ObjNode>
  nodes: ObjNode[]
  sigOf: Map<ObjectDef, string>
  order: number
}

function refSig(t: TypeRef, ctx: Ctx): string {
  const n = t.nullable ? '?' : ''
  switch (t.kind) {
    case 'primitive':
      return t.type[0] + n
    case 'any':
      return 'A' + n
    case 'array':
      return `[${refSig(t.item, ctx)}]${n}`
    case 'map':
      return `M(${refSig(t.value, ctx)})${n}`
    case 'object':
      return `O${ctx.sigOf.get(t.def) ?? ''}${n}`
    case 'union':
      return `U(${t.members.map((m) => refSig(m, ctx)).join('|')})${n}`
  }
}

/** Shape → TypeRef；nameHint 为该位置的类型名候选，parent 为所在对象 */
function build(s: Shape, nameHint: string, parent: ObjNode | null, ctx: Ctx): TypeRef {
  const nullable = s.nulls > 0
  const members: TypeRef[] = []
  if (s.string) members.push({ kind: 'primitive', type: 'string', nullable: false })
  if (s.integer || s.float)
    members.push({ kind: 'primitive', type: s.float ? 'number' : 'integer', nullable: false })
  if (s.boolean) members.push({ kind: 'primitive', type: 'boolean', nullable: false })
  if (s.array) {
    const items = s.array.items
    const item: TypeRef =
      items.count === 0
        ? { kind: 'any', nullable: false }
        : build(items, typeNameFromKey(nameHint, true), parent, ctx)
    members.push({ kind: 'array', item, nullable: false })
  }
  if (s.object) members.push(buildObject(s.object, nameHint, parent, ctx))
  if (s.deep) members.push({ kind: 'any', nullable: false })

  if (members.some((m) => m.kind === 'any')) return { kind: 'any', nullable }
  if (members.length === 0) return { kind: 'any', nullable }
  if (members.length === 1) return { ...members[0], nullable }
  return { kind: 'union', members, nullable }
}

function buildObject(o: ObjShape, nameHint: string, parent: ObjNode | null, ctx: Ctx): TypeRef {
  if (o.fields.size === 0) {
    return { kind: 'map', value: { kind: 'any', nullable: false }, nullable: false }
  }
  const order = ctx.order++
  // 先占位，子类型命名时可以用它作为「父类型」前缀
  const placeholder: ObjNode = {
    def: { name: '', fields: [] },
    sig: '',
    order,
    candidates: [],
  }
  const fields: FieldDef[] = []
  for (const [key, shape] of o.fields) {
    fields.push({
      key,
      type: build(shape, key, placeholder, ctx),
      optional: shape.count < o.count,
    })
  }
  const sig = fields
    .map((f) => `${JSON.stringify(f.key)}:${refSig(f.type, ctx)}${f.optional ? '~' : ''}`)
    .sort()
    .join(',')
  const candidate: NameCandidate = { name: nameHint, parent }
  const existing = ctx.bySig.get(sig)
  if (existing) {
    existing.candidates.push(candidate)
    // 子类型里记录的父节点指向占位节点：改指向已有节点
    for (const n of ctx.nodes)
      for (const c of n.candidates) if (c.parent === placeholder) c.parent = existing
    return { kind: 'object', def: existing.def, nullable: false }
  }
  placeholder.def.fields = fields
  placeholder.sig = sig
  placeholder.candidates.push(candidate)
  ctx.bySig.set(sig, placeholder)
  ctx.sigOf.set(placeholder.def, String(ctx.nodes.length))
  ctx.nodes.push(placeholder)
  return { kind: 'object', def: placeholder.def, nullable: false }
}

/** 把用户输入的根类型名整理成合法的 PascalCase */
export function normalizeRootName(name: string): string {
  const n = typeNameFromKey(name.trim())
  return n || 'Root'
}

function assignNames(ctx: Ctx, rootName: string, rootIsObjectNode: ObjNode | null): void {
  const taken = new Set<string>()
  // 根不是对象时（数组 / 基本类型）根名用于类型别名，同样占用
  taken.add(rootName.toLowerCase())
  const sorted = [...ctx.nodes].sort((a, b) => a.order - b.order)
  const claim = (n: string) => {
    taken.add(n.toLowerCase())
    return n
  }
  const free = (n: string) => !!n && !taken.has(n.toLowerCase()) && !RESERVED_TYPE_NAMES.has(n)
  for (const node of sorted) {
    if (node === rootIsObjectNode) {
      node.def.name = rootName
      continue
    }
    const names = [...new Set(node.candidates.map((c) => typeNameFromKey(c.name) || 'Type'))]
    const base = names.length === 1 ? names[0] : (commonSuffixName(names) ?? names[0])
    const parent = node.candidates[0]?.parent
    const parentName = parent && parent !== node ? parent.def.name : ''
    let name: string
    if (free(base)) name = base
    else if (parentName && free(parentName + base)) name = parentName + base
    else {
      const stem = RESERVED_TYPE_NAMES.has(base) ? (parentName || '') + base + 'Model' : base
      name = stem
      for (let i = 2; !free(name); i++) name = `${stem}${i}`
    }
    node.def.name = claim(name)
  }
}

export interface InferOptions {
  rootName?: string
}

/**
 * 从若干样例推断类型模型。多个样例（JSON Lines）视为同一个根类型的多次观察。
 */
export function inferModel(samples: readonly unknown[], opts: InferOptions = {}): TypeModel {
  const rootName = normalizeRootName(opts.rootName ?? 'Root')
  const shape = newShape()
  for (const s of samples) observe(shape, s, 0)

  const ctx: Ctx = { bySig: new Map(), nodes: [], sigOf: new Map(), order: 0 }
  // 根数组的元素名：Root → RootItem、Users → User
  const itemHint = singularOrItem(rootName)
  let root: TypeRef
  if (shape.count === 0) root = { kind: 'any', nullable: false }
  else if (shape.array && !shape.object && !hasPrimitive(shape)) {
    // 根是数组：元素直接用单数名，避免 RootItem 再套一层
    const items = shape.array.items
    const item =
      items.count === 0
        ? ({ kind: 'any', nullable: false } as TypeRef)
        : build(items, itemHint, null, ctx)
    root = { kind: 'array', item, nullable: shape.nulls > 0 }
  } else root = build(shape, rootName, null, ctx)

  const rootNode =
    root.kind === 'object' ? (ctx.nodes.find((n) => n.def === root.def) ?? null) : null
  assignNames(ctx, rootName, rootNode)

  const objects = [...ctx.nodes].sort((a, b) => a.order - b.order).map((n) => n.def)
  return { rootName, root, objects }
}

function hasPrimitive(s: Shape): boolean {
  return s.string + s.integer + s.float + s.boolean + s.deep > 0
}

/** Root → RootItem；Users → User */
function singularOrItem(name: string): string {
  const words = keyWords(name)
  if (!words.length) return 'Item'
  const last = words[words.length - 1]
  const single = singularize(last)
  const out = single !== last ? [...words.slice(0, -1), single] : [...words, 'item']
  return out.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

/* ───────────────────────── 统计 ───────────────────────── */

export interface ModelStats {
  types: number
  fields: number
  optional: number
  nullable: number
}

export function modelStats(model: TypeModel): ModelStats {
  let fields = 0
  let optional = 0
  let nullable = 0
  for (const o of model.objects) {
    fields += o.fields.length
    for (const f of o.fields) {
      if (f.optional) optional++
      if (f.type.nullable) nullable++
    }
  }
  return { types: model.objects.length, fields, optional, nullable }
}
