/**
 * 「JSON 生成类型」的命名工具（纯函数）：
 * 单复数转换、各种命名风格、各语言关键字与合法标识符判断。
 */

/* ───────────────────────── 单数化 ───────────────────────── */

/** 不可数 / 单复同形：单数化后保持原样（类型名会补 Item） */
const UNCOUNTABLE = new Set([
  'news',
  'series',
  'species',
  'info',
  'information',
  'metadata',
  'data',
  'media',
  'equipment',
  'feedback',
  'software',
  'hardware',
  'firmware',
  'middleware',
  'advice',
  'furniture',
  'luggage',
  'baggage',
  'money',
  'music',
  'traffic',
  'weather',
  'sheep',
  'fish',
  'deer',
  'aircraft',
  'chassis',
  'sms',
  'gps',
  'ios',
  'macos',
  'os',
  'aws',
  'dns',
  'cms',
  'css',
  'js',
  'ts',
  'https',
  'analytics',
  'physics',
  'mathematics',
  'economics',
  'politics',
  'ethics',
  'logistics',
  'headquarters',
  'means',
  'kudos',
  'chaos',
  'ethos',
  'cosmos',
  'this',
  'yes',
  'alias',
  'bias',
  'canvas',
  'atlas',
  'gas',
  'lens',
  'plus',
  'bonus',
  'census',
  'campus',
  'virus',
  'status',
  'apparatus',
  'octopus',
  'focus',
  'corpus',
  'nexus',
  'bus',
  'cactus',
  'circus',
  'radius',
  'genus',
  'thesaurus',
  'syllabus',
  'stimulus',
  'fungus',
  'iris',
])

const IRREGULAR: Record<string, string> = {
  people: 'person',
  persons: 'person',
  children: 'child',
  men: 'man',
  women: 'woman',
  mice: 'mouse',
  geese: 'goose',
  feet: 'foot',
  teeth: 'tooth',
  oxen: 'ox',
  criteria: 'criterion',
  phenomena: 'phenomenon',
  indices: 'index',
  matrices: 'matrix',
  vertices: 'vertex',
  appendices: 'appendix',
  analyses: 'analysis',
  crises: 'crisis',
  diagnoses: 'diagnosis',
  theses: 'thesis',
  hypotheses: 'hypothesis',
  parentheses: 'parenthesis',
  synopses: 'synopsis',
  axes: 'axis',
  radii: 'radius',
  cacti: 'cactus',
  fungi: 'fungus',
  stimuli: 'stimulus',
  syllabi: 'syllabus',
  alumni: 'alumnus',
  curricula: 'curriculum',
  quizzes: 'quiz',
  leaves: 'leaf',
  knives: 'knife',
  wives: 'wife',
  lives: 'life',
  halves: 'half',
  shelves: 'shelf',
  wolves: 'wolf',
  thieves: 'thief',
  selves: 'self',
  calves: 'calf',
  loaves: 'loaf',
  scarves: 'scarf',
  elves: 'elf',
  heroes: 'hero',
  potatoes: 'potato',
  tomatoes: 'tomato',
  echoes: 'echo',
  vetoes: 'veto',
  torpedoes: 'torpedo',
  volcanoes: 'volcano',
  mosquitoes: 'mosquito',
  dominoes: 'domino',
  embargoes: 'embargo',
  menus: 'menu',
  gurus: 'guru',
  haikus: 'haiku',
  emus: 'emu',
  tutus: 'tutu',
}

/** 以 -ies 结尾但单数是 -ie 的词 */
const IE_WORDS =
  /^(?:movie|cookie|zombie|rookie|hoodie|selfie|calorie|pie|tie|lie|die|brownie|freebie|genie|goalie|smoothie|techie|prairie|auntie|birdie|cutie|newbie|sortie|lingerie|eerie|budgie)s$/

/** 以 -ches 结尾但单数是 -che 的词 */
const CHE_WORDS = /^(?:cache|niche|headache|moustache|mustache|avalanche|cliche|creche|psyche)s$/

/** 以 -uses / -ases 结尾、单数去掉 es 的词 */
const ES_WORDS =
  /^(?:alias|bias|canvas|atlas|gas|lens|plus|bonus|census|campus|virus|genus|status|apparatus|octopus|focus|corpus|nexus|prospectus|syllabus|thesaurus|bus|cactus|circus|fungus|stimulus|radius|iris)es$/

/**
 * 英文单词单数化（只处理纯小写 ASCII 单词；无法单数化时原样返回）：
 * items→item、categories→category、addresses→address、people→person、data→data
 */
export function singularize(word: string): string {
  const w = word
  if (!/^[a-z]+$/.test(w) || w.length < 2) return w
  if (UNCOUNTABLE.has(w)) return w
  if (IRREGULAR[w]) return IRREGULAR[w]
  if (IE_WORDS.test(w) || CHE_WORDS.test(w)) return w.slice(0, -1)
  if (ES_WORDS.test(w)) return w.slice(0, -2)
  if (/[^aeiou]ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(?:ss|x|ch|sh|zz)es$/.test(w)) return w.slice(0, -2)
  // -ss / -us 通常是单数；-is 只有 analysis、axis、tennis 这类（emojis、apis 仍是复数）
  if (/(?:ss|us|sis|xis|nis|lis|tis)$/.test(w)) return w
  if (w.endsWith('s') && w.length > 2) return w.slice(0, -1)
  return w
}

/* ───────────────────────── 命名风格 ───────────────────────── */

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)

/**
 * 把 JSON 键拆成小写单词：按驼峰与分隔符拆分，字母与数字之间不拆
 * （base64Data → base64、data；2fa-enabled → 2fa、enabled）。emoji、标点等会被丢弃。
 */
export function keyWords(key: string): string[] {
  return key
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

export function pascalCase(key: string): string {
  return keyWords(key).map(cap).join('')
}

export function camelCase(key: string): string {
  const w = keyWords(key)
  return w.length ? w[0] + w.slice(1).map(cap).join('') : ''
}

export function snakeCase(key: string): string {
  return keyWords(key).join('_')
}

/** Go 常见缩写（golint 列表），整词大写：userId → UserID */
const GO_INITIALISMS = new Set([
  'acl',
  'api',
  'ascii',
  'cpu',
  'css',
  'dns',
  'eof',
  'guid',
  'html',
  'http',
  'https',
  'id',
  'ip',
  'json',
  'lhs',
  'qps',
  'ram',
  'rhs',
  'rpc',
  'sla',
  'smtp',
  'sql',
  'ssh',
  'tcp',
  'tls',
  'ttl',
  'udp',
  'ui',
  'uid',
  'uuid',
  'uri',
  'url',
  'utf8',
  'vm',
  'xml',
  'xmpp',
  'xsrf',
  'xss',
])

function goWord(w: string): string {
  if (GO_INITIALISMS.has(w)) return w.toUpperCase()
  // 缩写的复数：ids → IDs、urls → URLs
  if (w.length > 2 && w.endsWith('s') && GO_INITIALISMS.has(w.slice(0, -1)))
    return w.slice(0, -1).toUpperCase() + 's'
  return cap(w)
}

export function goPascalCase(key: string): string {
  return keyWords(key).map(goWord).join('')
}

/**
 * 类型名：PascalCase，保证以字母开头（数字开头补 T）。
 * plural=true 时把最后一个单词单数化，无法单数化则补 Item（data → DataItem）。
 */
export function typeNameFromKey(key: string, plural = false): string {
  const words = keyWords(key)
  if (words.length === 0) return plural ? 'Item' : ''
  if (plural) {
    const last = words[words.length - 1]
    const single = singularize(last)
    if (single !== last) words[words.length - 1] = single
    else words.push('item')
  }
  const name = words.map(cap).join('')
  return /^\d/.test(name) ? 'T' + name : name
}

/** 若干候选名的公共「尾部单词」：BillingAddress + ShippingAddress → Address */
export function commonSuffixName(names: readonly string[]): string | null {
  if (names.length === 0) return null
  const split = names.map((n) => keyWords(n))
  const out: string[] = []
  for (let i = 1; ; i++) {
    const w = split[0][split[0].length - i]
    if (w === undefined) break
    if (!split.every((s) => s[s.length - i] === w)) break
    out.unshift(w)
  }
  if (out.length === 0) return null
  const name = out.map(cap).join('')
  return /^\d/.test(name) ? null : name
}

/* ───────────────────────── 标识符 ───────────────────────── */

/** JavaScript / TypeScript 合法标识符（Unicode） */
export function isJsIdentifier(s: string): boolean {
  return /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u.test(s)
}

/** 大多数语言通用的标识符规则（字母或下划线开头，字母数字下划线组成） */
export function isPlainIdentifier(s: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s)
}

/** Go 导出名必须以大写字母开头：中文等无大小写的名称补 X */
export function goExport(name: string): string {
  if (/^\p{Lu}/u.test(name)) return name
  if (/^[a-z]/.test(name)) return cap(name)
  return 'X' + name
}

/** 在已用集合里取一个不冲突的名字：name、name2、name3… */
export function uniqueName(name: string, used: Set<string>, fold = false): string {
  const k = (s: string) => (fold ? s.toLowerCase() : s)
  let out = name
  for (let i = 2; used.has(k(out)); i++) out = `${name}${i}`
  used.add(k(out))
  return out
}

/* ───────────────────────── 关键字 ───────────────────────── */

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

export const JAVA_KEYWORDS = words(`
  abstract assert boolean break byte case catch char class const continue default do double
  else enum extends final finally float for goto if implements import instanceof int interface
  long native new package private protected public return short static strictfp super switch
  synchronized this throw throws transient try void volatile while true false null var record
  yield sealed permits _
`)

export const KOTLIN_KEYWORDS = words(`
  as break class continue do else false for fun if in interface is null object package return
  super this throw true try typealias typeof val var when while
`)

export const RUST_KEYWORDS = words(`
  as async await break const continue crate dyn else enum extern false fn for if impl in let
  loop match mod move mut pub ref return self Self static struct super trait true type unsafe
  use where while abstract become box do final macro override priv typeof unsized virtual yield
  try gen
`)

/** 这些 Rust 关键字不能写成 r#xxx */
export const RUST_NO_RAW = new Set(['self', 'Self', 'super', 'crate', '_'])

export const SWIFT_KEYWORDS = words(`
  associatedtype class deinit enum extension fileprivate func import init inout internal let
  open operator private precedencegroup protocol public rethrows static struct subscript
  typealias var break case catch continue default defer do else fallthrough for guard if in
  repeat return throw switch where while Any as await false is nil self Self super throws true
  try _
`)

export const PYTHON_KEYWORDS = words(`
  False None True and as assert async await break class continue def del elif else except
  finally for from global if import in is lambda nonlocal not or pass raise return try while
  with yield match case type
`)

export const CSHARP_KEYWORDS = words(`
  abstract as base bool break byte case catch char checked class const continue decimal default
  delegate do double else enum event explicit extern false finally fixed float for foreach goto
  if implicit in int interface internal is lock long namespace new null object operator out
  override params private protected public readonly ref return sbyte sealed short sizeof
  stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe
  ushort using virtual void volatile while
`)

/**
 * 不宜直接用作类型名的名字（与各语言内置类型、生成代码里用到的库类型冲突），
 * 例如 Lombok 的 @Data、Swift 的 Data、Java 的 String / List。
 */
export const RESERVED_TYPE_NAMES = new Set([
  'Any',
  'Array',
  'Bool',
  'Boolean',
  'Box',
  'Byte',
  'Char',
  'Character',
  'Codable',
  'CodingKey',
  'CodingKeys',
  'Data',
  'Date',
  'Decimal',
  'Decoder',
  'Dict',
  'Dictionary',
  'Double',
  'Encoder',
  'Error',
  'Float',
  'Function',
  'HashMap',
  'Int',
  'Integer',
  'JSONValue',
  'JsonElement',
  'JsonProperty',
  'JsonPropertyName',
  'List',
  'Long',
  'Map',
  'Nil',
  'None',
  'NotRequired',
  'Nothing',
  'Null',
  'Number',
  'Object',
  'Option',
  'Optional',
  'Promise',
  'Record',
  'Result',
  'Self',
  'SerialName',
  'Serializable',
  'Set',
  'Short',
  'String',
  'Symbol',
  'Type',
  'TypedDict',
  'Union',
  'Unit',
  'Unknown',
  'Value',
  'Vec',
  'Void',
])
