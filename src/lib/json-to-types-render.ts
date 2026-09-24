/**
 * 类型模型 → 各语言代码（纯函数）。
 * TypeScript、Go、Java、Kotlin、Rust、Swift、Python、C#。
 */
import type { ConvertIssue } from './json-yaml'
import {
  inferModel,
  modelStats,
  parseSamples,
  type FieldDef,
  type ModelStats,
  type ObjectDef,
  type TypeModel,
  type TypeRef,
} from './json-to-types'
import {
  CSHARP_KEYWORDS,
  JAVA_KEYWORDS,
  KOTLIN_KEYWORDS,
  PYTHON_KEYWORDS,
  RUST_KEYWORDS,
  RUST_NO_RAW,
  SWIFT_KEYWORDS,
  camelCase,
  goExport,
  goPascalCase,
  isJsIdentifier,
  isPlainIdentifier,
  pascalCase,
  snakeCase,
  uniqueName,
} from './json-to-types-names'

export type TargetLang =
  'typescript' | 'go' | 'java' | 'kotlin' | 'rust' | 'swift' | 'python' | 'csharp'

export interface RenderOptions {
  /** TypeScript：interface 还是 type 别名 */
  tsDeclaration: 'interface' | 'type'
  tsReadonly: boolean
  tsExport: boolean
  /** Java：用 Lombok @Data 代替 getter / setter */
  javaLombok: boolean
  /** Python：dataclass 或 TypedDict */
  pythonStyle: 'dataclass' | 'typeddict'
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  tsDeclaration: 'interface',
  tsReadonly: false,
  tsExport: true,
  javaLombok: false,
  pythonStyle: 'dataclass',
}

export interface TargetInfo {
  id: TargetLang
  label: string
  /**
   * 下载文件名。mainName 是生成代码里的主类型名（Java 的 public 类名必须与文件名一致，
   * 根节点是数组时它是元素类型名而不是根类型名）。
   */
  fileName: (rootName: string, mainName?: string) => string
}

export const TARGETS: readonly TargetInfo[] = [
  { id: 'typescript', label: 'TypeScript', fileName: () => 'types.ts' },
  { id: 'go', label: 'Go', fileName: () => 'types.go' },
  { id: 'java', label: 'Java', fileName: (r, main) => `${main || r}.java` },
  { id: 'kotlin', label: 'Kotlin', fileName: (r) => `${r}.kt` },
  { id: 'rust', label: 'Rust', fileName: () => 'types.rs' },
  { id: 'swift', label: 'Swift', fileName: (r) => `${r}.swift` },
  { id: 'python', label: 'Python', fileName: () => 'models.py' },
  { id: 'csharp', label: 'C#', fileName: (r) => `${r}.cs` },
]

/** 主类型名：根是对象时为根类型，否则为第一个生成的类（Java 的 public 类） */
export function mainTypeName(model: TypeModel): string {
  if (model.root.kind === 'object') return model.root.def.name
  return model.objects[0]?.name ?? model.rootName
}

/* ───────────────────────── 通用工具 ───────────────────────── */

type QuoteStyle = 'c' | 'swift' | 'rust' | 'kotlin'

/** 生成各语言的双引号字符串字面量 */
export function quote(s: string, style: QuoteStyle = 'c'): string {
  let out = '"'
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch === '$' && style === 'kotlin') out += '\\$'
    else if (code < 0x20 || code === 0x7f) {
      const hex = code.toString(16).toUpperCase()
      out += style === 'swift' || style === 'rust' ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`
    } else out += ch
  }
  return out + '"'
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** 按显示宽度（码点数）补齐 */
const width = (s: string) => Array.from(s).length
const padEnd = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)))

/** 深度优先、依赖在前的顺序（Python 需要先定义再引用） */
function dependencyOrder(model: TypeModel): ObjectDef[] {
  const out: ObjectDef[] = []
  const seen = new Set<ObjectDef>()
  const visitRef = (t: TypeRef) => {
    if (t.kind === 'object') visit(t.def)
    else if (t.kind === 'array') visitRef(t.item)
    else if (t.kind === 'map') visitRef(t.value)
    else if (t.kind === 'union') t.members.forEach(visitRef)
  }
  const visit = (d: ObjectDef) => {
    if (seen.has(d)) return
    seen.add(d)
    for (const f of d.fields) visitRef(f.type)
    out.push(d)
  }
  visitRef(model.root)
  model.objects.forEach(visit)
  return out
}

/** 模型里是否用到了某种类型；includeRoot=false 时只看各个类的字段 */
function uses(model: TypeModel, pred: (t: TypeRef) => boolean, includeRoot = true): boolean {
  const check = (t: TypeRef): boolean =>
    pred(t) ||
    (t.kind === 'array' && check(t.item)) ||
    (t.kind === 'map' && check(t.value)) ||
    (t.kind === 'union' && t.members.some(check))
  return (
    (includeRoot && check(model.root)) ||
    model.objects.some((o) => o.fields.some((f) => check(f.type)))
  )
}

const isAnyLike = (t: TypeRef) => t.kind === 'any' || t.kind === 'map' || t.kind === 'union'

interface NamedField {
  field: FieldDef
  name: string
}

/**
 * 为一个类的所有字段生成互不冲突的成员名。
 * convert 把 JSON 键转成该语言风格；空结果回退为 field1、field2…
 */
function nameFields(
  fields: readonly FieldDef[],
  convert: (key: string) => string,
  fixup: (name: string) => string,
  opts: { fold?: boolean; reserved?: string[]; fallback?: string } = {},
): NamedField[] {
  const used = new Set<string>((opts.reserved ?? []).map((r) => (opts.fold ? r.toLowerCase() : r)))
  return fields.map((field, i) => {
    let base = convert(field.key)
    if (!base) base = `${opts.fallback ?? 'field'}${i + 1}`
    base = fixup(base)
    return { field, name: uniqueName(base, used, opts.fold) }
  })
}

/** 数字开头等不合法的名字补下划线 */
const underscoreIfInvalid = (name: string) => (isPlainIdentifier(name) ? name : '_' + name)

/* ───────────────────────── TypeScript ───────────────────────── */

function renderTypeScript(model: TypeModel, o: RenderOptions): string {
  const ex = o.tsExport ? 'export ' : ''
  const ro = o.tsReadonly ? 'readonly ' : ''
  const type = (t: TypeRef): string => {
    let s: string
    switch (t.kind) {
      case 'primitive':
        s = t.type === 'string' ? 'string' : t.type === 'boolean' ? 'boolean' : 'number'
        break
      case 'any':
        return 'unknown'
      case 'array': {
        const inner = type(t.item)
        const wrap = inner.includes('|') || inner.startsWith('readonly ')
        s = `${ro}${wrap ? `(${inner})` : inner}[]`
        break
      }
      case 'map':
        s = o.tsReadonly ? 'Readonly<Record<string, unknown>>' : 'Record<string, unknown>'
        break
      case 'object':
        s = t.def.name
        break
      case 'union':
        s = t.members.map(type).join(' | ')
        break
    }
    return t.nullable ? `${s} | null` : s
  }

  const blocks: string[] = []
  if (model.root.kind !== 'object')
    blocks.push(`${ex}type ${model.rootName} = ${type(model.root)};`)
  for (const d of model.objects) {
    const body = d.fields
      .map((f) => {
        const key = isJsIdentifier(f.key) ? f.key : JSON.stringify(f.key)
        return `  ${ro}${key}${f.optional ? '?' : ''}: ${type(f.type)};`
      })
      .join('\n')
    blocks.push(
      o.tsDeclaration === 'interface'
        ? `${ex}interface ${d.name} {\n${body}\n}`
        : `${ex}type ${d.name} = {\n${body}\n};`,
    )
  }
  return blocks.join('\n\n') + '\n'
}

/* ───────────────────────── Go ───────────────────────── */

/** encoding/json 能识别的标签名字符（其余字符会让标签被忽略） */
function goTagNameValid(key: string): boolean {
  if (key === '') return false
  for (const ch of key) {
    if (/[\p{L}\p{N}]/u.test(ch)) continue
    if ('!#$%&()*+-./:;<=>?@[]^_{|}~ '.includes(ch)) continue
    return false
  }
  return true
}

function renderGo(model: TypeModel): string {
  const typeName = (d: ObjectDef) => goExport(d.name)
  const type = (t: TypeRef, pointer = false): string => {
    switch (t.kind) {
      case 'primitive': {
        const base = { string: 'string', integer: 'int64', number: 'float64', boolean: 'bool' }[
          t.type
        ]
        return (pointer || t.nullable ? '*' : '') + base
      }
      case 'any':
      case 'union':
        return 'any'
      case 'array':
        return `[]${type(t.item)}`
      case 'map':
        return 'map[string]any'
      case 'object':
        return (pointer || t.nullable ? '*' : '') + typeName(t.def)
    }
  }

  const blocks: string[] = []
  if (model.root.kind !== 'object')
    blocks.push(`type ${goExport(model.rootName)} ${type(model.root)}`)
  for (const d of model.objects) {
    const named = nameFields(d.fields, goPascalCase, (n) => goExport(n), { fallback: 'Field' })
    const rows = named.map(({ field, name }) => {
      // 可选的对象用指针，才能真正省略
      const ptr = field.optional && field.type.kind === 'object'
      const t = type(field.type, ptr)
      const tagName = field.key === '-' ? '-,' : field.key
      const tagValue = `json:${quote(tagName + (field.optional ? ',omitempty' : ''))}`
      const tag = tagValue.includes('`') ? quote(tagValue) : `\`${tagValue}\``
      const note =
        goTagNameValid(field.key) || field.key === '-'
          ? ''
          : ` // 注意：键 ${quote(field.key)} 含 encoding/json 不支持的字符，需自定义解析`
      return { name, t, tag, note }
    })
    const nw = rows.reduce((m, r) => Math.max(m, width(r.name)), 0)
    const tw = rows.reduce((m, r) => Math.max(m, width(r.t)), 0)
    const body = rows
      .map((r) => `\t${padEnd(r.name, nw)} ${padEnd(r.t, tw)} ${r.tag}${r.note}`)
      .join('\n')
    blocks.push(`type ${typeName(d)} struct {\n${body}\n}`)
  }
  return blocks.join('\n\n') + '\n'
}

/* ───────────────────────── Java ───────────────────────── */

function renderJava(model: TypeModel, o: RenderOptions): string {
  const type = (t: TypeRef, boxed: boolean): string => {
    switch (t.kind) {
      case 'primitive':
        if (t.type === 'string') return 'String'
        if (t.type === 'integer') return boxed || t.nullable ? 'Long' : 'long'
        if (t.type === 'number') return boxed || t.nullable ? 'Double' : 'double'
        return boxed || t.nullable ? 'Boolean' : 'boolean'
      case 'any':
      case 'union':
        return 'Object'
      case 'array':
        return `List<${type(t.item, true)}>`
      case 'map':
        return 'Map<String, Object>'
      case 'object':
        return t.def.name
    }
  }
  // 根类型只出现在注释里，不需要 import
  const usesList = uses(model, (t) => t.kind === 'array', false)
  const usesMap = uses(model, (t) => t.kind === 'map', false)
  let usesJsonProperty = false

  const main =
    model.root.kind === 'object' ? model.root.def : (model.objects[0] as ObjectDef | undefined)
  if (!main) {
    return `// JSON 根节点是 ${type(model.root, true)}，没有需要生成的类\n`
  }

  const renderClass = (d: ObjectDef, indent: string, isMain: boolean): string => {
    const i1 = indent + '    '
    const i2 = i1 + '    '
    const named = nameFields(
      d.fields,
      camelCase,
      (n) => {
        const v = underscoreIfInvalid(n)
        return JAVA_KEYWORDS.has(v) ? v + 'Value' : v
      },
      {},
    )
    const lines: string[] = []
    if (o.javaLombok) lines.push(`${indent}@Data`)
    lines.push(`${indent}public ${isMain ? '' : 'static '}class ${d.name} {`)
    for (const { field, name } of named) {
      const t = type(field.type, field.optional)
      // Lombok 给 boolean 字段 isActive 生成的是 isActive() / setActive()，
      // Jackson 会把属性名推断成 active：必须显式标注 JSON 键
      const lombokIs = o.javaLombok && t === 'boolean' && /^is\p{Lu}/u.test(name)
      if (name !== field.key || lombokIs) {
        usesJsonProperty = true
        lines.push(`${i1}@JsonProperty(${quote(field.key)})`)
      }
      lines.push(`${i1}private ${t} ${name};`)
    }
    if (!o.javaLombok) {
      for (const { field, name } of named) {
        const t = type(field.type, field.optional)
        const getter = (t === 'boolean' ? 'is' : 'get') + cap(name)
        lines.push(
          '',
          `${i1}public ${t} ${getter}() {`,
          `${i2}return ${name};`,
          `${i1}}`,
          '',
          `${i1}public void set${cap(name)}(${t} ${name}) {`,
          `${i2}this.${name} = ${name};`,
          `${i1}}`,
        )
      }
    }
    if (isMain) {
      for (const other of model.objects) {
        if (other === d) continue
        lines.push('', renderClass(other, i1, false))
      }
    }
    lines.push(`${indent}}`)
    return lines.join('\n')
  }

  const body = renderClass(main, '', true)
  const imports: string[] = []
  if (usesJsonProperty) imports.push('import com.fasterxml.jackson.annotation.JsonProperty;')
  if (usesList) imports.push('import java.util.List;')
  if (usesMap) imports.push('import java.util.Map;')
  if (o.javaLombok) imports.push('import lombok.Data;')
  const head: string[] = []
  if (imports.length) head.push(imports.join('\n'))
  if (model.root.kind !== 'object') head.push(`// JSON 根节点是 ${type(model.root, true)}`)
  return [...head, body].join('\n\n') + '\n'
}

/* ───────────────────────── Kotlin ───────────────────────── */

function renderKotlin(model: TypeModel): string {
  const type = (t: TypeRef): string => {
    let s: string
    switch (t.kind) {
      case 'primitive':
        s = { string: 'String', integer: 'Long', number: 'Double', boolean: 'Boolean' }[t.type]
        break
      case 'any':
      case 'union':
        s = 'JsonElement'
        break
      case 'array':
        s = `List<${type(t.item)}>`
        break
      case 'map':
        s = 'Map<String, JsonElement>'
        break
      case 'object':
        s = t.def.name
        break
    }
    return t.nullable ? s + '?' : s
  }
  let usesSerialName = false
  const blocks: string[] = []
  if (model.root.kind !== 'object') blocks.push(`typealias ${model.rootName} = ${type(model.root)}`)
  for (const d of model.objects) {
    const named = nameFields(d.fields, camelCase, underscoreIfInvalid)
    const params = named.map(({ field, name }) => {
      const ident = KOTLIN_KEYWORDS.has(name) ? `\`${name}\`` : name
      let t = type(field.type)
      if (field.optional && !t.endsWith('?')) t += '?'
      const ann = name !== field.key ? `@SerialName(${quote(field.key, 'kotlin')}) ` : ''
      if (ann) usesSerialName = true
      return `    ${ann}val ${ident}: ${t}${field.optional ? ' = null' : ''},`
    })
    blocks.push(`@Serializable\ndata class ${d.name}(\n${params.join('\n')}\n)`)
  }
  const imports: string[] = []
  if (usesSerialName) imports.push('import kotlinx.serialization.SerialName')
  if (model.objects.length) imports.push('import kotlinx.serialization.Serializable')
  if (uses(model, isAnyLike)) imports.push('import kotlinx.serialization.json.JsonElement')
  return [...(imports.length ? [imports.join('\n')] : []), ...blocks].join('\n\n') + '\n'
}

/* ───────────────────────── Rust ───────────────────────── */

/** serde 的 rename_all = "camelCase" 规则 */
function serdeCamel(snake: string): string {
  const parts = snake.split('_')
  return parts[0] + parts.slice(1).map(cap).join('')
}

function renderRust(model: TypeModel): string {
  const type = (t: TypeRef): string => {
    let s: string
    switch (t.kind) {
      case 'primitive':
        s = { string: 'String', integer: 'i64', number: 'f64', boolean: 'bool' }[t.type]
        break
      case 'any':
      case 'union':
        // serde_json::Value 本身就能表示 null
        return 'serde_json::Value'
      case 'array':
        s = `Vec<${type(t.item)}>`
        break
      case 'map':
        s = 'HashMap<String, serde_json::Value>'
        break
      case 'object':
        s = t.def.name
        break
    }
    return t.nullable ? `Option<${s}>` : s
  }
  const blocks: string[] = []
  if (model.root.kind !== 'object') blocks.push(`pub type ${model.rootName} = ${type(model.root)};`)
  for (const d of model.objects) {
    const named = nameFields(d.fields, snakeCase, (n) => {
      const v = underscoreIfInvalid(n)
      if (RUST_NO_RAW.has(v)) return v + '_'
      return v
    })
    const rows = named.map(({ field, name }) => {
      const ident = RUST_KEYWORDS.has(name) ? `r#${name}` : name
      let t = type(field.type)
      if (field.optional && !t.startsWith('Option<')) t = `Option<${t}>`
      return { field, name, ident, t }
    })
    // 大部分字段只是 camelCase 差异时，用 rename_all 减少逐个 rename
    const plainRenames = rows.filter((r) => r.name !== r.field.key).length
    const camelRenames = rows.filter((r) => serdeCamel(r.name) !== r.field.key).length
    const renameAll = plainRenames >= 2 && camelRenames < plainRenames
    const lines = ['#[derive(Debug, Clone, Serialize, Deserialize)]']
    if (renameAll) lines.push('#[serde(rename_all = "camelCase")]')
    lines.push(`pub struct ${d.name} {`)
    for (const r of rows) {
      const serdeName = renameAll ? serdeCamel(r.name) : r.name
      const attrs: string[] = []
      if (serdeName !== r.field.key) attrs.push(`rename = ${quote(r.field.key, 'rust')}`)
      if (r.field.optional) attrs.push('skip_serializing_if = "Option::is_none"')
      if (attrs.length) lines.push(`    #[serde(${attrs.join(', ')})]`)
      lines.push(`    pub ${r.ident}: ${r.t},`)
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  // 与 rustfmt 一致：按 crate 名排序
  const imports: string[] = []
  if (model.objects.length) imports.push('use serde::{Deserialize, Serialize};')
  if (uses(model, (t) => t.kind === 'map')) imports.push('use std::collections::HashMap;')
  return [...(imports.length ? [imports.join('\n')] : []), ...blocks].join('\n\n') + '\n'
}

/* ───────────────────────── Swift ───────────────────────── */

const SWIFT_JSON_VALUE = `/// 任意 JSON 值
enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}`

function renderSwift(model: TypeModel): string {
  const type = (t: TypeRef): string => {
    let s: string
    switch (t.kind) {
      case 'primitive':
        s = { string: 'String', integer: 'Int', number: 'Double', boolean: 'Bool' }[t.type]
        break
      case 'any':
      case 'union':
        s = 'JSONValue'
        break
      case 'array':
        s = `[${type(t.item)}]`
        break
      case 'map':
        s = '[String: JSONValue]'
        break
      case 'object':
        s = t.def.name
        break
    }
    return t.nullable ? s + '?' : s
  }
  const ident = (n: string) => (SWIFT_KEYWORDS.has(n) ? `\`${n}\`` : n)
  const blocks: string[] = []
  if (model.root.kind !== 'object') blocks.push(`typealias ${model.rootName} = ${type(model.root)}`)
  for (const d of model.objects) {
    const named = nameFields(d.fields, camelCase, underscoreIfInvalid)
    const lines = [`struct ${d.name}: Codable {`]
    for (const { field, name } of named) {
      let t = type(field.type)
      if (field.optional && !t.endsWith('?')) t += '?'
      lines.push(`    let ${ident(name)}: ${t}`)
    }
    if (named.some(({ field, name }) => field.key !== name)) {
      lines.push('', '    enum CodingKeys: String, CodingKey {')
      for (const { field, name } of named)
        lines.push(
          `        case ${ident(name)}${name === field.key ? '' : ` = ${quote(field.key, 'swift')}`}`,
        )
      lines.push('    }')
    }
    lines.push('}')
    blocks.push(lines.join('\n'))
  }
  if (uses(model, isAnyLike)) blocks.push(SWIFT_JSON_VALUE)
  return ['import Foundation', ...blocks].join('\n\n') + '\n'
}

/* ───────────────────────── Python ───────────────────────── */

function renderPython(model: TypeModel, o: RenderOptions): string {
  const typed = o.pythonStyle === 'typeddict'
  let usesAny = false
  const type = (t: TypeRef): string => {
    let s: string
    switch (t.kind) {
      case 'primitive':
        s = { string: 'str', integer: 'int', number: 'float', boolean: 'bool' }[t.type]
        break
      case 'any':
        usesAny = true
        return 'Any'
      case 'array':
        s = `list[${type(t.item)}]`
        break
      case 'map':
        usesAny = true
        s = 'dict[str, Any]'
        break
      case 'object':
        s = t.def.name
        break
      case 'union':
        s = t.members.map(type).join(' | ')
        break
    }
    return t.nullable ? `${s} | None` : s
  }

  let usesNotRequired = false
  const blocks: string[] = []
  for (const d of dependencyOrder(model)) {
    if (typed) {
      const classSyntax = d.fields.every(
        (f) => isPlainIdentifier(f.key) && !PYTHON_KEYWORDS.has(f.key),
      )
      const entries = d.fields.map((f) => {
        let t = type(f.type)
        if (f.optional) {
          usesNotRequired = true
          t = `NotRequired[${t}]`
        }
        return { key: f.key, t }
      })
      if (classSyntax) {
        blocks.push(
          `class ${d.name}(TypedDict):\n${entries.map((e) => `    ${e.key}: ${e.t}`).join('\n')}`,
        )
      } else {
        blocks.push(
          `${d.name} = TypedDict(\n    ${quote(d.name)},\n    {\n${entries
            .map((e) => `        ${quote(e.key)}: ${e.t},`)
            .join('\n')}\n    },\n)`,
        )
      }
      continue
    }
    const named = nameFields(d.fields, snakeCase, (n) => {
      const v = underscoreIfInvalid(n)
      return PYTHON_KEYWORDS.has(v) ? v + '_' : v
    })
    // dataclass：有默认值的字段必须排在后面
    const ordered = [
      ...named.filter((n) => !n.field.optional),
      ...named.filter((n) => n.field.optional),
    ]
    const lines = ordered.map(({ field, name }) => {
      let t = type(field.type)
      if (field.optional && !t.endsWith('| None') && t !== 'Any') t += ' | None'
      const def = field.optional ? ' = None' : ''
      const note = name !== field.key ? `  # JSON 键：${quote(field.key)}` : ''
      return `    ${name}: ${t}${def}${note}`
    })
    blocks.push(`@dataclass\nclass ${d.name}:\n${lines.join('\n')}`)
  }
  if (model.root.kind !== 'object') blocks.push(`${model.rootName} = ${type(model.root)}`)

  const imports = ['from __future__ import annotations']
  const typing: string[] = []
  if (usesAny) typing.push('Any')
  if (typed) {
    if (usesNotRequired) typing.push('NotRequired')
    if (model.objects.length) typing.push('TypedDict')
  }
  const stdlib: string[] = []
  if (!typed && model.objects.length) stdlib.push('from dataclasses import dataclass')
  if (typing.length) stdlib.push(`from typing import ${typing.join(', ')}`)
  const head = [imports.join('\n'), ...(stdlib.length ? [stdlib.join('\n')] : [])].join('\n\n')
  return [head, ...blocks].join('\n\n\n') + '\n'
}

/* ───────────────────────── C# ───────────────────────── */

function renderCSharp(model: TypeModel): string {
  const type = (t: TypeRef): string => {
    let s: string
    switch (t.kind) {
      case 'primitive':
        s = { string: 'string', integer: 'long', number: 'double', boolean: 'bool' }[t.type]
        break
      case 'any':
      case 'union':
        return 'object?'
      case 'array':
        s = `List<${type(t.item)}>`
        break
      case 'map':
        s = 'Dictionary<string, object?>'
        break
      case 'object':
        s = t.def.name
        break
    }
    return t.nullable ? s + '?' : s
  }
  const blocks: string[] = []
  for (const d of model.objects) {
    const named = nameFields(
      d.fields,
      pascalCase,
      (n) => {
        const v = underscoreIfInvalid(n)
        return CSHARP_KEYWORDS.has(v) ? '@' + v : v
      },
      // 成员名不能与所在类同名
      { reserved: [d.name], fallback: 'Field' },
    )
    const props = named.map(({ field, name }) => {
      let t = type(field.type)
      if (field.optional && !t.endsWith('?')) t += '?'
      let init = ''
      if (!t.endsWith('?')) {
        if (t === 'string') init = ' = string.Empty;'
        else if (field.type.kind !== 'primitive') init = ' = new();'
      }
      return `    [JsonPropertyName(${quote(field.key)})]\n    public ${t} ${name} { get; set; }${init}`
    })
    blocks.push(`public class ${d.name}\n{\n${props.join('\n\n')}\n}`)
  }
  const usings: string[] = []
  if (uses(model, (t) => t.kind === 'array' || t.kind === 'map', false))
    usings.push('using System.Collections.Generic;')
  if (model.objects.length) usings.push('using System.Text.Json.Serialization;')
  const head: string[] = []
  if (usings.length) head.push(usings.join('\n'))
  if (model.root.kind !== 'object') head.push(`// JSON 根节点是 ${type(model.root)}`)
  return [...head, ...blocks].join('\n\n') + '\n'
}

/* ───────────────────────── 入口 ───────────────────────── */

export function renderModel(
  model: TypeModel,
  lang: TargetLang,
  opts: RenderOptions = DEFAULT_RENDER_OPTIONS,
): string {
  switch (lang) {
    case 'typescript':
      return renderTypeScript(model, opts)
    case 'go':
      return renderGo(model)
    case 'java':
      return renderJava(model, opts)
    case 'kotlin':
      return renderKotlin(model)
    case 'rust':
      return renderRust(model)
    case 'swift':
      return renderSwift(model)
    case 'python':
      return renderPython(model, opts)
    case 'csharp':
      return renderCSharp(model)
  }
}

export interface TypeGenOptions extends RenderOptions {
  lang: TargetLang
  rootName: string
}

export const DEFAULT_TYPEGEN_OPTIONS: TypeGenOptions = {
  ...DEFAULT_RENDER_OPTIONS,
  lang: 'typescript',
  rootName: 'Root',
}

export interface GenerateStats extends ModelStats {
  /** 参与推断的样本数（根为数组时是元素个数；JSON Lines 是行数） */
  samples: number
  jsonLines: boolean
}

export type GenerateResult =
  | { ok: true; code: string; model: TypeModel | null; stats: GenerateStats | null }
  | { ok: false; error: ConvertIssue }

/** 解析 JSON 样例并生成目标语言代码；输入为空时返回空代码 */
export function generateTypes(text: string, opts: Partial<TypeGenOptions> = {}): GenerateResult {
  const o = { ...DEFAULT_TYPEGEN_OPTIONS, ...opts }
  try {
    const parsed = parseSamples(text)
    if (!parsed.ok) return parsed
    if (parsed.empty) return { ok: true, code: '', model: null, stats: null }
    const model = inferModel(parsed.samples, { rootName: o.rootName })
    const code = renderModel(model, o.lang, o)
    const first = parsed.samples[0]
    const samples = parsed.jsonLines
      ? parsed.samples.length
      : Array.isArray(first)
        ? first.length
        : 1
    return {
      ok: true,
      code,
      model,
      stats: { ...modelStats(model), samples, jsonLines: parsed.jsonLines },
    }
  } catch (e) {
    return {
      ok: false,
      error: {
        message:
          e instanceof RangeError
            ? 'JSON 嵌套层级过深，无法生成类型'
            : `生成失败：${e instanceof Error ? e.message : String(e)}`,
      },
    }
  }
}
